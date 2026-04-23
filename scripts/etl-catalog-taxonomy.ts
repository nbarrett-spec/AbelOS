/**
 * scripts/etl-catalog-taxonomy.ts
 *
 * Applies the cleaned category/subcategory taxonomy from Abel_Catalog_CLEAN.xlsx
 * to the Aegis Product table. The LIVE ETL (etl-product-catalog.ts) already
 * loaded authoritative cost/basePrice/name; A21's verify script found 2,001
 * rows where only category/subcategory differ between LIVE and CLEAN.
 *
 * This script writes ONLY category + subcategory fields — nothing else.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Catalog_CLEAN.xlsx')

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

async function main() {
  console.log(`ETL catalog taxonomy — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  const wb = XLSX.readFile(FILE)
  const sheet = wb.Sheets['Product Master — Clean']
  if (!sheet) throw new Error('Sheet "Product Master — Clean" not found')
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { defval: null })
  console.log(`XLSX rows: ${rows.length}`)

  const xlsxMap = new Map<string, { category: string; subcategory: string | null }>()
  for (const r of rows) {
    const sku = normStr(r.SKU)
    const category = normStr(r['Clean Category']) || normStr(r['Category']) || 'Uncategorized'
    const subcategory = normStr(r['Clean Subcategory']) || normStr(r['Subcategory']) || null
    if (sku) xlsxMap.set(sku, { category, subcategory })
  }
  console.log(`Parsed unique SKUs: ${xlsxMap.size}`)

  const prisma = new PrismaClient()
  try {
    const existing = await prisma.product.findMany({
      select: { id: true, sku: true, category: true, subcategory: true },
    })
    const existingMap = new Map(existing.map((p) => [p.sku, p]))

    const toUpdate: Array<{ id: string; sku: string; from: { cat: string; sub: string | null }; to: { cat: string; sub: string | null } }> = []
    for (const [sku, next] of xlsxMap) {
      const prev = existingMap.get(sku)
      if (!prev) continue
      const catChanged = prev.category !== next.category
      const subChanged = (prev.subcategory || null) !== (next.subcategory || null)
      if (!catChanged && !subChanged) continue
      toUpdate.push({
        id: prev.id,
        sku,
        from: { cat: prev.category, sub: prev.subcategory },
        to: { cat: next.category, sub: next.subcategory },
      })
    }

    console.log(`Will update: ${toUpdate.length}`)

    // Sample the category remapping distribution
    const remap = new Map<string, number>()
    for (const u of toUpdate) {
      const k = `"${u.from.cat}" → "${u.to.cat}"`
      remap.set(k, (remap.get(k) || 0) + 1)
    }
    const topRemap = [...remap.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
    console.log()
    console.log('Top category remappings:')
    for (const [k, n] of topRemap) console.log(`  ${n.toString().padStart(5)} × ${k}`)
    console.log()

    if (DRY_RUN) { console.log('DRY-RUN — re-run with --commit.'); return }

    console.log('COMMIT — applying...')
    const CHUNK = 300
    let updated = 0, failed = 0
    for (let i = 0; i < toUpdate.length; i += CHUNK) {
      const slice = toUpdate.slice(i, i + CHUNK)
      await Promise.all(slice.map(async (u) => {
        try {
          await prisma.product.update({
            where: { id: u.id },
            data: { category: u.to.cat, subcategory: u.to.sub },
          })
          updated++
        } catch (e) {
          failed++
        }
      }))
      process.stdout.write(`  progress: ${Math.min(i + CHUNK, toUpdate.length)} / ${toUpdate.length}\r`)
    }
    console.log()
    console.log(`Committed: updated=${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
