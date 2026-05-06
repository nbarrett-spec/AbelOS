/**
 * MASS DATA REFRESH
 * ===================
 * One-shot job that uses the InFlow CSV exports + Bolt XLSX as source of truth
 * to fix the catastrophic data quality issues in Aegis:
 *
 *   - 3,479 Products with NULL supplierId (100%)
 *   - 1,318 Products with cost = 0 (38%)
 *   - 5 Builder duplicate groups
 *   - Stale per-builder pricing
 *
 * Source files:
 *   ../In Flow Exports/inFlow_Vendor (4).csv             → Vendor master
 *   ../In Flow Exports/inFlow_ProductDetails (10).csv    → Product + Cost + LastVendor + per-builder prices
 *   ../In Flow Exports/inFlow_VendorProductDetails.csv  → Secondary supplier info
 *   ../Abel_Lumber_Bolt_Data_Export.xlsx                  → Historical Bolt data
 *
 * Usage:
 *   npx tsx scripts/mass-data-refresh.ts            # DRY-RUN (default)
 *   npx tsx scripts/mass-data-refresh.ts --commit   # actually write
 */

import { PrismaClient } from '@prisma/client'
import * as fs from 'node:fs'
import * as path from 'node:path'

const COMMIT = process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')
const prisma = new PrismaClient()

// ──────────────────────────────────────────────────────────────────────
// Tiny CSV parser — handles quoted strings + commas inside quotes
// ──────────────────────────────────────────────────────────────────────
function parseCSV(content: string): string[][] {
  // Strip BOM
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const c = content[i]
    if (inQuotes) {
      if (c === '"') {
        if (content[i + 1] === '"') { cell += '"'; i++ }
        else inQuotes = false
      } else cell += c
    } else {
      if (c === '"') inQuotes = true
      else if (c === ',') { row.push(cell); cell = '' }
      else if (c === '\n' || c === '\r') {
        if (cell || row.length) { row.push(cell); rows.push(row); row = []; cell = '' }
        if (c === '\r' && content[i + 1] === '\n') i++
      } else cell += c
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row) }
  return rows
}

function csvToObjects(csv: string): Record<string, string>[] {
  const rows = parseCSV(csv)
  if (rows.length < 2) return []
  const headers = rows[0]
  return rows.slice(1).filter(r => r.some(c => c)).map(r => {
    const obj: Record<string, string> = {}
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = r[i] ?? ''
    return obj
  })
}

// Normalize for case-insensitive name matching
function norm(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9 &]/g, '')
}

const stats = {
  vendors_upserted: 0,
  vendors_existing: 0,
  products_updated_cost: 0,
  products_updated_supplier: 0,
  products_skipped_no_match: 0,
  builder_pricing_upserted: 0,
  builder_dedupe_groups: 0,
  builder_dedupe_merged: 0,
  errors: [] as string[],
}

// ──────────────────────────────────────────────────────────────────────
// Phase 1 — Vendor master from inFlow_Vendor (4).csv
// ──────────────────────────────────────────────────────────────────────
async function phase1_upsertVendors(): Promise<Map<string, string>> {
  console.log('\n═══ PHASE 1: Vendor master upsert ═══')
  const file = path.join(ROOT, 'In Flow Exports', 'inFlow_Vendor (4).csv')
  if (!fs.existsSync(file)) { console.log('  SKIP: file not found'); return new Map() }
  const rows = csvToObjects(fs.readFileSync(file, 'utf8'))
  console.log(`  parsed ${rows.length} vendors from CSV`)

  // Build name → vendorId map for downstream phases
  const nameToId = new Map<string, string>()

  // Pre-load existing vendors for fast lookup
  const existing = await prisma.vendor.findMany({
    select: { id: true, name: true },
  })
  for (const v of existing) {
    if (v.name) nameToId.set(norm(v.name), v.id)
  }

  for (const r of rows) {
    const name = r.Name?.trim()
    if (!name) continue
    const key = norm(name)
    if (nameToId.has(key)) {
      stats.vendors_existing++
      continue
    }
    if (COMMIT) {
      try {
        const created = await prisma.vendor.create({
          data: {
            name,
            contactName: r.ContactName || null,
            contactEmail: r.Email || null,
            contactPhone: r.Phone || null,
            address: [r.Address1, r.Address2].filter(Boolean).join(', ') || null,
            city: r.City || null,
            state: r.State || null,
            zip: r.PostalCode || null,
            paymentTerms: r.PaymentTerms || null,
            leadTimeDays: r.LeadTimeDays ? parseInt(r.LeadTimeDays, 10) || null : null,
            isActive: (r.IsActive || '').toLowerCase() === 'true',
          },
        })
        nameToId.set(key, created.id)
        stats.vendors_upserted++
      } catch (e: any) {
        stats.errors.push(`Vendor ${name}: ${e.message?.slice(0, 100)}`)
      }
    } else {
      stats.vendors_upserted++
      nameToId.set(key, `dry-run:${name}`)
    }
  }
  console.log(`  → ${stats.vendors_upserted} new, ${stats.vendors_existing} already existed`)
  return nameToId
}

// ──────────────────────────────────────────────────────────────────────
// Phase 2 — Backfill Product.cost + Product.supplierId from inFlow_ProductDetails
// Also captures per-builder pricing (BROOKFIELD, TOLL BROTHERS, etc. columns)
// ──────────────────────────────────────────────────────────────────────
const BUILDER_COLUMNS = [
  'AGD', 'BROOKFIELD', 'CROSS CUSTOM', 'Country Road Homebuilders',
  'FIG TREE HOMES', 'Imagination Homes', 'JOSEPH PAUL HOMES',
  'Pulte ', 'RDR Developement', 'Shaddock Homes', 'TOLL BROTHERS',
]

async function phase2_backfillProductsAndPricing(vendorMap: Map<string, string>) {
  console.log('\n═══ PHASE 2: Product cost + supplier + builder pricing ═══')
  const file = path.join(ROOT, 'In Flow Exports', 'inFlow_ProductDetails (10).csv')
  if (!fs.existsSync(file)) { console.log('  SKIP: file not found'); return }
  const rows = csvToObjects(fs.readFileSync(file, 'utf8'))
  console.log(`  parsed ${rows.length} products from CSV`)

  // Build SKU → Aegis Product map
  const allProducts = await prisma.product.findMany({
    select: { id: true, sku: true, cost: true, supplierId: true },
  })
  const skuToProduct = new Map<string, { id: string; sku: string; cost: number | null; supplierId: string | null }>()
  for (const p of allProducts) {
    if (p.sku) skuToProduct.set(p.sku.trim().toUpperCase(), p as any)
  }

  // Build Aegis Builder map (companyName → builderId) for builder pricing
  const allBuilders = await prisma.builder.findMany({
    select: { id: true, companyName: true },
  })
  const builderNameToId = new Map<string, string>()
  for (const b of allBuilders) {
    if (b.companyName) builderNameToId.set(norm(b.companyName), b.id)
  }

  let processed = 0
  for (const r of rows) {
    const sku = r.SKU?.trim().toUpperCase()
    if (!sku) continue
    const aegisProd = skuToProduct.get(sku)
    if (!aegisProd) {
      stats.products_skipped_no_match++
      continue
    }

    // 2a — backfill cost
    const inflowCost = parseFloat(r.Cost || '0')
    if (inflowCost > 0 && (!aegisProd.cost || aegisProd.cost === 0)) {
      if (COMMIT) {
        try {
          await prisma.product.update({
            where: { id: aegisProd.id },
            data: { cost: inflowCost },
          })
        } catch (e: any) {
          stats.errors.push(`Product ${sku} cost update: ${e.message?.slice(0, 100)}`)
          continue
        }
      }
      stats.products_updated_cost++
    }

    // 2b — backfill supplierId from LastVendor column
    const lastVendor = r.LastVendor?.trim()
    if (lastVendor && !aegisProd.supplierId) {
      const vendorId = vendorMap.get(norm(lastVendor))
      if (vendorId && !vendorId.startsWith('dry-run:')) {
        if (COMMIT) {
          try {
            await prisma.product.update({
              where: { id: aegisProd.id },
              data: { supplierId: vendorId },
            })
            stats.products_updated_supplier++
          } catch (e: any) {
            stats.errors.push(`Product ${sku} supplier update: ${e.message?.slice(0, 100)}`)
          }
        } else {
          stats.products_updated_supplier++
        }
      }
    }

    // 2c — per-builder pricing
    for (const col of BUILDER_COLUMNS) {
      const priceStr = r[col]
      if (!priceStr) continue
      const price = parseFloat(priceStr)
      if (!Number.isFinite(price) || price <= 0) continue

      const builderId = builderNameToId.get(norm(col))
      if (!builderId) continue

      if (COMMIT) {
        try {
          // Upsert by composite key (builderId, productId)
          await prisma.builderPricing.upsert({
            where: {
              builderId_productId: { builderId, productId: aegisProd.id },
            } as any,
            create: { builderId, productId: aegisProd.id, customPrice: price, source: 'inflow_csv_refresh' as any },
            update: { customPrice: price, source: 'inflow_csv_refresh' as any },
          })
          stats.builder_pricing_upserted++
        } catch (e: any) {
          // The composite-key constraint name might differ — fall back to find+update
          const existing = await prisma.builderPricing.findFirst({
            where: { builderId, productId: aegisProd.id },
            select: { id: true },
          })
          try {
            if (existing) {
              await prisma.builderPricing.update({ where: { id: existing.id }, data: { customPrice: price } })
            } else {
              await prisma.builderPricing.create({ data: { builderId, productId: aegisProd.id, customPrice: price } })
            }
            stats.builder_pricing_upserted++
          } catch (e2: any) {
            stats.errors.push(`BuilderPricing ${col}/${sku}: ${e2.message?.slice(0, 100)}`)
          }
        }
      } else {
        stats.builder_pricing_upserted++
      }
    }

    if (++processed % 500 === 0) console.log(`  processed ${processed}/${rows.length}`)
  }
  console.log(`  → ${stats.products_updated_cost} costs filled, ${stats.products_updated_supplier} suppliers linked, ${stats.builder_pricing_upserted} pricing rows`)
  console.log(`  → ${stats.products_skipped_no_match} products in CSV had no Aegis match`)
}

// ──────────────────────────────────────────────────────────────────────
// Phase 3 — Builder dedup
// ──────────────────────────────────────────────────────────────────────
async function phase3_dedupBuilders() {
  console.log('\n═══ PHASE 3: Builder duplicate merge ═══')
  const groups = await prisma.$queryRawUnsafe<Array<{ companyName: string; ids: string[] }>>(`
    SELECT "companyName", array_agg(id ORDER BY "createdAt" ASC) as ids
    FROM "Builder"
    WHERE "companyName" IS NOT NULL
    GROUP BY "companyName"
    HAVING COUNT(*) > 1
  `)
  stats.builder_dedupe_groups = groups.length
  console.log(`  found ${groups.length} duplicate groups`)
  for (const g of groups) {
    const [keep, ...drop] = g.ids
    console.log(`  ${g.companyName}: keep ${keep}, drop ${drop.join(', ')}`)
    if (!COMMIT) continue
    for (const dropId of drop) {
      try {
        // Reassign foreign keys
        await prisma.$transaction([
          prisma.$executeRawUnsafe(`UPDATE "Job" SET "builderId" = $1 WHERE "builderId" = $2`, keep, dropId),
          prisma.$executeRawUnsafe(`UPDATE "Order" SET "builderId" = $1 WHERE "builderId" = $2`, keep, dropId),
          prisma.$executeRawUnsafe(`UPDATE "BuilderPricing" SET "builderId" = $1 WHERE "builderId" = $2`, keep, dropId),
          prisma.$executeRawUnsafe(`DELETE FROM "Builder" WHERE id = $1`, dropId),
        ])
        stats.builder_dedupe_merged++
      } catch (e: any) {
        stats.errors.push(`Dedupe ${g.companyName} (drop ${dropId}): ${e.message?.slice(0, 200)}`)
      }
    }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`MASS DATA REFRESH — mode: ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`)
  console.log(`Workspace root: ${ROOT}`)

  const beforeProd = await prisma.product.count({ where: { cost: 0 } })
  const beforeProdNoCost = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*) c FROM "Product" WHERE cost IS NULL OR cost = 0`
  const beforeProdNoSup = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*) c FROM "Product" WHERE "supplierId" IS NULL`
  console.log(`\nBEFORE:`)
  console.log(`  Products with no cost:     ${Number(beforeProdNoCost[0].c)}`)
  console.log(`  Products with no supplier: ${Number(beforeProdNoSup[0].c)}`)

  const vendorMap = await phase1_upsertVendors()
  await phase2_backfillProductsAndPricing(vendorMap)
  await phase3_dedupBuilders()

  console.log('\n═══ STATS ═══')
  console.log(JSON.stringify(stats, null, 2))

  if (COMMIT) {
    console.log('\nAFTER:')
    const afterProdNoCost = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*) c FROM "Product" WHERE cost IS NULL OR cost = 0`
    const afterProdNoSup = await prisma.$queryRaw<Array<{ c: bigint }>>`SELECT COUNT(*) c FROM "Product" WHERE "supplierId" IS NULL`
    console.log(`  Products with no cost:     ${Number(afterProdNoCost[0].c)}  (was ${Number(beforeProdNoCost[0].c)})`)
    console.log(`  Products with no supplier: ${Number(afterProdNoSup[0].c)}  (was ${Number(beforeProdNoSup[0].c)})`)
  }

  await prisma.$disconnect()
}
main().catch(e => { console.error(e); process.exit(1) })
