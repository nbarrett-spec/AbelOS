/**
 * sync-catalog.ts
 * Imports the Abel_Catalog_CLEAN.xlsx Product Master into the Prisma Product table.
 * Also imports BOM Explorer → BomEntry and Category Mapping → category normalization.
 *
 * Usage:  npx tsx scripts/sync-catalog.ts
 *   or:  npx ts-node --skip-project scripts/sync-catalog.ts
 *
 * Flags:
 *   --dry-run     Print stats without writing to DB
 *   --bom-only    Only import BOM relationships
 *   --skip-bom    Skip BOM import
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'path'
import * as fs from 'fs'

const prisma = new PrismaClient()

// ── Config ──────────────────────────────────────────────────────────
const CATALOG_PATH = path.resolve(__dirname, '../../Abel_Catalog_CLEAN.xlsx')
const DRY_RUN = process.argv.includes('--dry-run')
const BOM_ONLY = process.argv.includes('--bom-only')
const SKIP_BOM = process.argv.includes('--skip-bom')

// ── Types ───────────────────────────────────────────────────────────
interface CatalogRow {
  SKU: string
  'Product Name': string
  'Clean Category': string
  'Original InFlow Category': string
  'Product Type': string
  'Door Size': string | null
  Handing: string | null
  'Core Type': string | null
  'Panel Style': string | null
  'Fire Rating': string | null
  'Jamb Size': string | null
  Casing: string | null
  'Hardware Finish': string | null
  Material: string | null
  'Unit Cost': number
  'Default List Price': number
  'Markup %': number
  'Margin %': number
  UOM: string | null
  Vendor: string | null
  'Is Active': boolean
  Remarks: string | null
}

interface BomRow {
  'Finished Product Name': string
  'Finished Product SKU': string
  'Clean Category': string
  'Component Name': string
  'Component Type': string
  Quantity: number
  UOM: string
}

interface CategoryRow {
  'Original InFlow Category': string
  'Clean Category': string
  'Product Count': number
  'Avg Cost': number
  'Avg Price': number
  Notes: string | null
}

// ── Helpers ─────────────────────────────────────────────────────────
function clean(val: any): string | null {
  if (val === undefined || val === null || val === '') return null
  return String(val).trim()
}

function cleanNum(val: any): number {
  if (val === undefined || val === null || val === '') return 0
  const n = Number(val)
  return isNaN(n) ? 0 : n
}

function mapSubcategory(cleanCategory: string): string | null {
  // Extract subcategory from clean category name
  const parts = cleanCategory.split(' - ')
  return parts.length > 1 ? parts.slice(1).join(' - ') : null
}

function mapCategory(cleanCategory: string): string {
  // Map to the broader portal category
  const cat = cleanCategory.toLowerCase()
  if (cat.includes('exterior door')) return 'Exterior Doors'
  if (cat.includes('interior door') || cat.includes('hollow core') || cat.includes('solid core'))
    return 'Interior Doors'
  if (cat.includes('bifold')) return 'Interior Doors'
  if (cat.includes('pocket')) return 'Interior Doors'
  if (cat.includes('barn door')) return 'Interior Doors'
  if (cat.includes('fire-rated')) return 'Fire-Rated Doors'
  if (cat.includes('patio') || cat.includes('sliding glass')) return 'Patio Doors'
  if (cat.includes('garage')) return 'Exterior Doors'
  if (cat.includes('door frame')) return 'Door Frames'
  if (cat.includes('door slab')) return 'Door Slabs'
  if (cat.includes('trim') || cat.includes('molding') || cat.includes('moulding')) return 'Trim & Molding'
  if (cat.includes('hardware')) return 'Hardware'
  if (cat.includes('jamb')) return 'Jambs'
  if (cat.includes('stair')) return 'Stair Parts'
  if (cat.includes('closet') || cat.includes('shelf')) return 'Closet & Shelf'
  if (cat.includes('lumber') || cat.includes('sheet good')) return 'Lumber & Sheet Goods'
  if (cat.includes('glass') || cat.includes('lite')) return 'Glass & Inserts'
  if (cat.includes('threshold')) return 'Thresholds'
  if (cat.includes('weather')) return 'Weatherstripping'
  if (cat.includes('attic')) return 'Attic Access'
  if (cat.includes('hvac')) return 'HVAC Doors'
  if (cat.includes('service') || cat.includes('labor')) return 'Services & Labor'
  if (cat.includes('building material')) return 'Building Materials'
  if (cat.includes('window')) return 'Window Components'
  if (cat.includes('dunnage')) return 'Dunnage'
  return cleanCategory // fallback to original
}

function normalizeDoorSize(raw: string | null): string | null {
  if (!raw) return null
  // Already formatted like "20\" x 80\"" → convert to compact "2068"
  const match = raw.match(/(\d+)["″]?\s*x\s*(\d+)["″]?/)
  if (match) {
    return `${match[1]}${match[2]}`
  }
  return raw
}

function normalizeCasing(raw: string | null): string | null {
  if (!raw) return null
  const c = raw.toLowerCase()
  if (c.includes('a-col') || c.includes('a-colonial') || c.includes('2-1/4'))
    return 'A-Col'
  if (c.includes('colonial') || c.includes('3-1/4') || c.includes('c-322'))
    return 'C-322'
  if (c.includes('no casing') || c.includes('none')) return null
  return raw
}

function normalizeHardwareFinish(raw: string | null): string | null {
  if (!raw) return null
  const f = raw.toLowerCase()
  if (f.includes('satin nickel') || f === 'sn') return 'SN'
  if (f.includes('oil rubbed bronze') || f === 'orb') return 'ORB'
  if (f.includes('black') || f === 'blk') return 'BLK'
  if (f.includes('antique brass') || f === 'ab') return 'AB'
  if (f.includes('satin chrome') || f === 'sc') return 'SC'
  if (f.includes('polished chrome') || f === 'pc') return 'PC'
  return raw
}

// ── Product Sync ────────────────────────────────────────────────────
async function syncProducts(rows: CatalogRow[]) {
  console.log(`\n📦 Syncing ${rows.length} products...`)

  let created = 0
  let updated = 0
  let skipped = 0
  let errors = 0

  // Process in batches of 50
  const BATCH_SIZE = 50
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    for (const row of batch) {
      try {
        const sku = clean(row.SKU)
        if (!sku) {
          skipped++
          continue
        }

        const name = clean(row['Product Name']) || sku
        const cleanCategory = clean(row['Clean Category']) || 'Other'
        const cost = cleanNum(row['Unit Cost'])
        const listPrice = cleanNum(row['Default List Price'])

        // Calculate minimum margin from the data
        const margin = listPrice > 0 ? (listPrice - cost) / listPrice : 0.25

        const data = {
          name,
          displayName: name,
          category: mapCategory(cleanCategory),
          subcategory: mapSubcategory(cleanCategory) || clean(row['Product Type']),
          cost: cost,
          basePrice: listPrice > 0 ? listPrice : cost * 1.35, // 35% markup fallback
          minMargin: Math.max(0.10, Math.min(margin, 0.60)), // clamp 10%-60%
          doorSize: normalizeDoorSize(clean(row['Door Size'])),
          handing: clean(row.Handing),
          coreType: clean(row['Core Type']),
          panelStyle: clean(row['Panel Style']),
          jambSize: clean(row['Jamb Size']),
          casingCode: normalizeCasing(clean(row.Casing)),
          hardwareFinish: normalizeHardwareFinish(clean(row['Hardware Finish'])),
          material: clean(row.Material),
          fireRating: clean(row['Fire Rating']),
          active: row['Is Active'] !== false,
          inStock: true, // default; real inventory syncs separately
          inflowCategory: clean(row['Original InFlow Category']),
          lastSyncedAt: new Date(),
        }

        if (DRY_RUN) {
          updated++ // count as would-be upserted
          continue
        }

        await prisma.product.upsert({
          where: { sku },
          create: { sku, ...data },
          update: data,
        })

        // Check if it was create vs update
        updated++
      } catch (err: any) {
        errors++
        if (errors <= 5) {
          console.error(`  ❌ Error on SKU "${row.SKU}": ${err.message}`)
        }
      }
    }

    // Progress bar
    const pct = Math.min(100, Math.round(((i + batch.length) / rows.length) * 100))
    process.stdout.write(`\r  Progress: ${pct}% (${i + batch.length}/${rows.length})`)
  }

  console.log(`\n  ✅ Products synced: ${updated} upserted, ${skipped} skipped, ${errors} errors`)
  return { updated, skipped, errors }
}

// ── BOM Sync ────────────────────────────────────────────────────────
async function syncBom(rows: BomRow[]) {
  console.log(`\n🔧 Syncing ${rows.length} BOM entries...`)

  // First, build a SKU → Product ID lookup from the DB
  const products: Array<{ id: string; sku: string; name: string }> =
    await prisma.$queryRawUnsafe(
      `SELECT id, sku, name FROM "Product" WHERE active = true`
    )

  const skuToId: Record<string, string> = {}
  const nameToId: Record<string, string> = {}
  for (const p of products) {
    skuToId[p.sku] = p.id
    nameToId[p.name.toLowerCase()] = p.id
  }

  let created = 0
  let skipped = 0
  let errors = 0

  // Clear existing BOM entries for a clean sync
  if (!DRY_RUN) {
    const deleted = await prisma.bomEntry.deleteMany({})
    console.log(`  🗑️  Cleared ${deleted.count} existing BOM entries`)
  }

  const BATCH_SIZE = 100
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE)

    for (const row of batch) {
      try {
        const parentSku = clean(row['Finished Product SKU'])
        const componentName = clean(row['Component Name'])
        if (!parentSku || !componentName) {
          skipped++
          continue
        }

        const parentId = skuToId[parentSku]
        if (!parentId) {
          skipped++ // Parent product not in DB
          continue
        }

        // Try to find component by name match
        const componentId = nameToId[componentName.toLowerCase()]
        if (!componentId) {
          skipped++ // Component not found as a product
          continue
        }

        if (DRY_RUN) {
          created++
          continue
        }

        await prisma.bomEntry.create({
          data: {
            parentId,
            componentId,
            quantity: cleanNum(row.Quantity) || 1,
            componentType: clean(row['Component Type']),
          },
        })
        created++
      } catch (err: any) {
        errors++
        if (errors <= 3) {
          console.error(`  ❌ BOM error: ${err.message}`)
        }
      }
    }

    const pct = Math.min(100, Math.round(((i + batch.length) / rows.length) * 100))
    process.stdout.write(`\r  Progress: ${pct}% (${i + batch.length}/${rows.length})`)
  }

  console.log(`\n  ✅ BOM synced: ${created} created, ${skipped} skipped, ${errors} errors`)
  return { created, skipped, errors }
}

// ── Category Validation ─────────────────────────────────────────────
async function validateCategories(mappingRows: CategoryRow[]) {
  console.log(`\n📊 Validating category mapping (${mappingRows.length} entries)...`)

  // Get actual categories from DB
  const dbCategories: Array<{ category: string; count: bigint }> =
    await prisma.$queryRawUnsafe(
      `SELECT category, COUNT(*)::bigint as count FROM "Product" WHERE active = true GROUP BY category ORDER BY count DESC`
    )

  console.log(`\n  Database categories after sync:`)
  for (const cat of dbCategories) {
    console.log(`    ${cat.category}: ${cat.count} products`)
  }

  // Check coverage
  const totalProducts: Array<{ count: bigint }> =
    await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint as count FROM "Product"`)
  const activeProducts: Array<{ count: bigint }> =
    await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint as count FROM "Product" WHERE active = true`)
  const withCost: Array<{ count: bigint }> =
    await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint as count FROM "Product" WHERE cost > 0`)
  const withPrice: Array<{ count: bigint }> =
    await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint as count FROM "Product" WHERE "basePrice" > 0`)

  console.log(`\n  📈 Data Quality:`)
  console.log(`    Total products:   ${totalProducts[0].count}`)
  console.log(`    Active products:  ${activeProducts[0].count}`)
  console.log(`    With cost > 0:    ${withCost[0].count}`)
  console.log(`    With price > 0:   ${withPrice[0].count}`)

  // Attribute coverage
  const attrs = ['doorSize', 'handing', 'coreType', 'panelStyle', 'hardwareFinish', 'material', 'jambSize', 'casingCode', 'fireRating']
  console.log(`\n  🏷️  Attribute Coverage:`)
  for (const attr of attrs) {
    const result: Array<{ count: bigint }> =
      await prisma.$queryRawUnsafe(`SELECT COUNT(*)::bigint as count FROM "Product" WHERE "${attr}" IS NOT NULL`)
    console.log(`    ${attr}: ${result[0].count}`)
  }
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log('═══════════════════════════════════════════════════')
  console.log('  Abel Lumber Catalog Sync')
  console.log(`  Source: ${CATALOG_PATH}`)
  console.log(`  Mode: ${DRY_RUN ? '🔍 DRY RUN' : '🚀 LIVE'}`)
  console.log('═══════════════════════════════════════════════════')

  // Check file exists
  if (!fs.existsSync(CATALOG_PATH)) {
    console.error(`❌ File not found: ${CATALOG_PATH}`)
    console.error(`   Place Abel_Catalog_CLEAN.xlsx in the project root's parent directory.`)
    process.exit(1)
  }

  // Read XLSX
  const workbook = XLSX.readFile(CATALOG_PATH)
  console.log(`\n📖 Sheets found: ${workbook.SheetNames.join(', ')}`)

  // ── Product Master ──
  if (!BOM_ONLY) {
    const productSheet = workbook.Sheets[workbook.SheetNames[0]] // "Product Master — Clean"
    const productRows: CatalogRow[] = XLSX.utils.sheet_to_json(productSheet)
    console.log(`   Product Master: ${productRows.length} rows`)
    await syncProducts(productRows)
  }

  // ── BOM Explorer ──
  if (!SKIP_BOM) {
    const bomSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('bom'))
    if (bomSheetName) {
      const bomSheet = workbook.Sheets[bomSheetName]
      const bomRows: BomRow[] = XLSX.utils.sheet_to_json(bomSheet)
      console.log(`   BOM Explorer: ${bomRows.length} rows`)
      await syncBom(bomRows)
    } else {
      console.log('   ⚠️  No BOM sheet found, skipping.')
    }
  }

  // ── Category Mapping (validation only) ──
  const catSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('category'))
  if (catSheetName) {
    const catSheet = workbook.Sheets[catSheetName]
    const catRows: CategoryRow[] = XLSX.utils.sheet_to_json(catSheet)
    await validateCategories(catRows)
  }

  console.log('\n═══════════════════════════════════════════════════')
  console.log(DRY_RUN ? '  ✅ Dry run complete — no data written' : '  ✅ Catalog sync complete!')
  console.log('═══════════════════════════════════════════════════\n')
}

main()
  .catch((err) => {
    console.error('Fatal error:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
