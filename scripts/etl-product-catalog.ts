/**
 * scripts/etl-product-catalog.ts
 *
 * Loads the "Product Master" sheet of Abel_Product_Catalog_LIVE.xlsx into the
 * Aegis Product table. SKU is the unique key; run is idempotent — a second run
 * is a no-op for unchanged rows.
 *
 * Modes:
 *   --dry-run  (default) — compute the diff, print summary, write nothing
 *   --commit           — actually upsert
 *
 * Usage:
 *   tsx scripts/etl-product-catalog.ts --file "../Abel_Product_Catalog_LIVE.xlsx"
 *   tsx scripts/etl-product-catalog.ts --file "../Abel_Product_Catalog_LIVE.xlsx" --commit
 *
 * Safety:
 *   - SKU-only upsert (Prisma upsert on @unique sku)
 *   - `active` column defaults to true; we only set it on create, never overwrite
 *   - `inflowId`/`lastSyncedAt` left untouched — this isn't InFlow sync
 *   - We ONLY write fields we have authoritative data for: name, category,
 *     subcategory, description, cost, basePrice. Everything else (handing,
 *     coreType, imageUrl, …) stays as whatever is already in Aegis.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'

const argv = process.argv.slice(2)
const arg = (name: string, def?: string): string | undefined => {
  const i = argv.indexOf(name)
  return i >= 0 ? argv[i + 1] : def
}
const DRY_RUN = !argv.includes('--commit')
const FILE = arg('--file') || path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')

interface XlsxRow {
  SKU?: string
  'Product Name'?: string
  Category?: string
  Subcategory?: string
  'Item Type'?: string
  Description?: string
  'Unit Cost'?: number | string
  'Default Price'?: number | string
  'Margin %'?: number | string
}

interface ParsedRow {
  sku: string
  name: string
  category: string
  subcategory: string | null
  description: string | null
  cost: number
  basePrice: number
  // NOTE: minMargin is intentionally NOT written from the XLSX. The sheet's
  // "Margin %" column is the CALCULATED margin at current price, but the
  // Prisma field is a POLICY FLOOR (e.g. "never sell below 25% margin").
  // We leave existing minMargin untouched on update, and let the schema
  // default (0.25) apply on create.
}

function toNum(v: unknown, fallback = 0): number {
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : fallback
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

function parseRow(raw: XlsxRow): ParsedRow | null {
  const sku = normStr(raw.SKU)
  const name = normStr(raw['Product Name'])
  if (!sku || !name) return null

  return {
    sku,
    name,
    category: normStr(raw.Category) || 'Uncategorized',
    subcategory: normStr(raw.Subcategory) || null,
    description: normStr(raw.Description) || null,
    cost: toNum(raw['Unit Cost']),
    basePrice: toNum(raw['Default Price']),
  }
}

async function main() {
  console.log(`ETL product catalog — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Reading: ${FILE}`)
  if (!fs.existsSync(FILE)) {
    throw new Error(`File not found: ${FILE}`)
  }

  const wb = XLSX.readFile(FILE, { cellDates: false })
  const sheet = wb.Sheets['Product Master']
  if (!sheet) {
    throw new Error(`Sheet "Product Master" not found. Sheets: ${wb.SheetNames.join(', ')}`)
  }
  const rows = XLSX.utils.sheet_to_json<XlsxRow>(sheet, { defval: null })
  console.log(`XLSX rows: ${rows.length}`)

  // Parse + dedupe by SKU (last wins)
  const parsedMap = new Map<string, ParsedRow>()
  const parseErrors: string[] = []
  for (const raw of rows) {
    const p = parseRow(raw)
    if (!p) {
      parseErrors.push(`skipped (empty sku/name): ${JSON.stringify(raw).slice(0, 120)}`)
      continue
    }
    parsedMap.set(p.sku, p)
  }
  const parsed = Array.from(parsedMap.values())
  console.log(`Parsed rows (unique SKUs): ${parsed.length}`)
  if (parseErrors.length) {
    console.log(`Parse warnings: ${parseErrors.length} (first 3):`)
    parseErrors.slice(0, 3).forEach((e) => console.log('  -', e))
  }

  // Load all current SKUs
  const prisma = new PrismaClient()
  try {
    const existing = await prisma.product.findMany({
      select: { id: true, sku: true, name: true, category: true, subcategory: true, description: true, cost: true, basePrice: true, minMargin: true },
    })
    const existingMap = new Map(existing.map((p) => [p.sku, p]))
    console.log(`Aegis current Product rows: ${existing.length}`)

    // Diff. Track per-field change counts for summary.
    const toCreate: ParsedRow[] = []
    const toUpdate: Array<{ sku: string; changes: string[]; next: ParsedRow }> = []
    const unchanged: string[] = []
    const fieldCounts = { name: 0, category: 0, subcategory: 0, description: 0, cost: 0, basePrice: 0 }
    const priceMoves: Array<{ sku: string; delta: number; pct: number }> = []

    for (const next of parsed) {
      const prev = existingMap.get(next.sku)
      if (!prev) {
        toCreate.push(next)
        continue
      }
      const changes: string[] = []
      if (prev.name !== next.name) { changes.push(`name: "${prev.name}" → "${next.name}"`); fieldCounts.name++ }
      if (prev.category !== next.category) { changes.push(`category: "${prev.category}" → "${next.category}"`); fieldCounts.category++ }
      if ((prev.subcategory || null) !== (next.subcategory || null)) { changes.push(`subcategory: "${prev.subcategory}" → "${next.subcategory}"`); fieldCounts.subcategory++ }
      if ((prev.description || null) !== (next.description || null)) { changes.push(`description changed`); fieldCounts.description++ }
      if (Math.abs(prev.cost - next.cost) > 0.001) { changes.push(`cost: ${prev.cost} → ${next.cost}`); fieldCounts.cost++ }
      if (Math.abs(prev.basePrice - next.basePrice) > 0.001) {
        changes.push(`basePrice: ${prev.basePrice} → ${next.basePrice}`)
        fieldCounts.basePrice++
        if (prev.basePrice > 0) {
          priceMoves.push({ sku: next.sku, delta: next.basePrice - prev.basePrice, pct: (next.basePrice - prev.basePrice) / prev.basePrice })
        }
      }
      if (changes.length === 0) {
        unchanged.push(next.sku)
      } else {
        toUpdate.push({ sku: next.sku, changes, next })
      }
    }

    // Orphans: Aegis SKUs not in XLSX (we do NOT delete — just report)
    const xlsxSkus = new Set(parsed.map((p) => p.sku))
    const orphans = existing.filter((p) => !xlsxSkus.has(p.sku))

    console.log()
    console.log('=== DIFF SUMMARY ===')
    console.log(`  Will CREATE:    ${toCreate.length}`)
    console.log(`  Will UPDATE:    ${toUpdate.length}`)
    console.log(`  Unchanged:      ${unchanged.length}`)
    console.log(`  Aegis-only:     ${orphans.length} (not deleted — just reported)`)
    console.log()
    console.log('=== Per-field change counts (updates only) ===')
    console.log(`  name:         ${fieldCounts.name}`)
    console.log(`  category:     ${fieldCounts.category}`)
    console.log(`  subcategory:  ${fieldCounts.subcategory}`)
    console.log(`  description:  ${fieldCounts.description}`)
    console.log(`  cost:         ${fieldCounts.cost}`)
    console.log(`  basePrice:    ${fieldCounts.basePrice}`)
    console.log()
    if (priceMoves.length) {
      const sorted = [...priceMoves].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
      const up = priceMoves.filter((m) => m.delta > 0).length
      const down = priceMoves.filter((m) => m.delta < 0).length
      console.log(`  Price moves: ${up} up, ${down} down`)
      console.log(`  Biggest 5 shifts (by %):`)
      sorted.slice(0, 5).forEach((m) =>
        console.log(`    ${m.sku.padEnd(10)} Δ$${m.delta.toFixed(2).padStart(8)}  (${(m.pct * 100).toFixed(1)}%)`)
      )
      console.log()
    }

    if (toCreate.length > 0) {
      console.log(`Sample CREATE (first 5):`)
      toCreate.slice(0, 5).forEach((p) =>
        console.log(`  + ${p.sku.padEnd(10)} | ${p.category.padEnd(18)} | cost=${p.cost} price=${p.basePrice} | ${p.name.slice(0, 50)}`)
      )
      console.log()
    }
    if (toUpdate.length > 0) {
      console.log(`Sample UPDATE (first 5):`)
      toUpdate.slice(0, 5).forEach((u) => {
        console.log(`  ~ ${u.sku.padEnd(10)}`)
        u.changes.forEach((c) => console.log(`      ${c}`))
      })
      console.log()
    }
    if (orphans.length > 0) {
      console.log(`Sample Aegis-only (first 5) — present in DB, not in XLSX:`)
      orphans.slice(0, 5).forEach((p) =>
        console.log(`  - ${p.sku.padEnd(10)} | ${p.name.slice(0, 60)}`)
      )
      console.log()
    }

    if (DRY_RUN) {
      console.log('DRY-RUN — no changes written. Re-run with --commit to apply.')
      return
    }

    console.log('COMMIT — applying upserts...')
    let created = 0, updated = 0, failed = 0
    const CHUNK = 200
    const all = [...toCreate, ...toUpdate.map((u) => u.next)]
    for (let i = 0; i < all.length; i += CHUNK) {
      const slice = all.slice(i, i + CHUNK)
      await Promise.all(
        slice.map(async (p) => {
          try {
            const isNew = !existingMap.has(p.sku)
            await prisma.product.upsert({
              where: { sku: p.sku },
              create: {
                sku: p.sku,
                name: p.name,
                category: p.category,
                subcategory: p.subcategory,
                description: p.description,
                cost: p.cost,
                basePrice: p.basePrice,
                // minMargin left to schema default (0.25) — see parseRow note
              },
              update: {
                name: p.name,
                category: p.category,
                subcategory: p.subcategory,
                description: p.description,
                cost: p.cost,
                basePrice: p.basePrice,
                // minMargin intentionally NOT written — see parseRow note
              },
            })
            if (isNew) created++
            else updated++
          } catch (e) {
            failed++
            console.error(`  FAIL ${p.sku}:`, (e as Error).message.slice(0, 140))
          }
        })
      )
      process.stdout.write(`  progress: ${Math.min(i + CHUNK, all.length)} / ${all.length}\r`)
    }
    console.log()
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
