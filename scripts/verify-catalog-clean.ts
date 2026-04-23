/**
 * scripts/verify-catalog-clean.ts
 *
 * READ-ONLY verification that Abel_Catalog_CLEAN.xlsx is absorbed into the
 * Aegis Product table.
 *
 * Context: etl-product-catalog.ts previously loaded Abel_Product_Catalog_LIVE.xlsx
 * (2,852 products). CLEAN is a sibling file with the same SKU universe but
 * different column names (Clean Category, Unit Cost, Default List Price).
 * File mtimes: CLEAN 2026-03-20 21:02, LIVE 2026-03-20 20:21 — CLEAN is
 * ~41 min newer. This script diffs and reports; NO DB WRITES.
 *
 * Source sheet: "Product Master — Clean" (2,852 data rows)
 * Column layout:
 *   SKU                = Product.sku
 *   Product Name       = Product.name
 *   Clean Category     = Product.category
 *   Unit Cost          = Product.cost
 *   Default List Price = Product.basePrice
 *
 * Usage:
 *   tsx scripts/verify-catalog-clean.ts
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'

const FILE = path.resolve(__dirname, '..', '..', 'Abel_Catalog_CLEAN.xlsx')
const SHEET = 'Product Master — Clean'
const EPS = 0.01 // 1 cent tolerance

interface RawRow {
  SKU?: string | null
  'Product Name'?: string | null
  'Clean Category'?: string | null
  'Unit Cost'?: number | string | null
  'Default List Price'?: number | string | null
}

interface XlsxProduct {
  sku: string
  name: string
  category: string
  cost: number
  basePrice: number
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$]/g, ''))
  return Number.isFinite(n) ? n : null
}

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}

async function main() {
  console.log(`Verify Abel_Catalog_CLEAN.xlsx (READ-ONLY)`)
  console.log(`Reading: ${FILE}`)
  if (!fs.existsSync(FILE)) {
    console.error(`ERROR: file not found: ${FILE}`)
    process.exit(1)
  }

  const wb = XLSX.readFile(FILE, { cellDates: false })
  const sheet = wb.Sheets[SHEET]
  if (!sheet) {
    console.error(`ERROR: sheet "${SHEET}" not found. Sheets: ${wb.SheetNames.join(', ')}`)
    process.exit(1)
  }
  const raw = XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: null })
  console.log(`Raw data rows in "${SHEET}": ${raw.length}`)

  const parsedMap = new Map<string, XlsxProduct>()
  let skipped = 0
  for (const r of raw) {
    const sku = normStr(r.SKU)
    const name = normStr(r['Product Name'])
    const category = normStr(r['Clean Category'])
    const cost = toNum(r['Unit Cost'])
    const basePrice = toNum(r['Default List Price'])
    if (!sku || !name || cost === null || basePrice === null) {
      skipped++
      continue
    }
    parsedMap.set(sku, { sku, name, category, cost, basePrice })
  }
  const products = Array.from(parsedMap.values())
  console.log(`Skipped rows (empty sku/name/cost/price): ${skipped}`)
  console.log(`Unique SKUs in file: ${products.length}`)

  const prisma = new PrismaClient()
  try {
    const skus = products.map((p) => p.sku)
    const dbRows = await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, name: true, category: true, cost: true, basePrice: true },
    })
    const dbMap = new Map(dbRows.map((p) => [p.sku, p]))
    console.log(`Aegis matches: ${dbRows.length}/${products.length}`)

    const unmatched: XlsxProduct[] = []
    const nameDiffs: Array<{ sku: string; xlsx: string; db: string }> = []
    const categoryDiffs: Array<{ sku: string; xlsx: string; db: string }> = []
    const costDiffs: Array<{ sku: string; name: string; xlsxCost: number; dbCost: number }> = []
    const priceDiffs: Array<{ sku: string; name: string; xlsxPrice: number; dbPrice: number }> = []
    let allMatch = 0

    for (const x of products) {
      const db = dbMap.get(x.sku)
      if (!db) {
        unmatched.push(x)
        continue
      }
      let dirty = false
      if (normStr(db.name) !== x.name) {
        nameDiffs.push({ sku: x.sku, xlsx: x.name, db: normStr(db.name) })
        dirty = true
      }
      if (normStr(db.category) !== x.category) {
        categoryDiffs.push({ sku: x.sku, xlsx: x.category, db: normStr(db.category) })
        dirty = true
      }
      const costDelta = Math.abs((db.cost ?? 0) - x.cost)
      const priceDelta = Math.abs((db.basePrice ?? 0) - x.basePrice)
      if (costDelta > EPS) {
        costDiffs.push({ sku: x.sku, name: x.name, xlsxCost: x.cost, dbCost: db.cost ?? 0 })
        dirty = true
      }
      if (priceDelta > EPS) {
        priceDiffs.push({ sku: x.sku, name: x.name, xlsxPrice: x.basePrice, dbPrice: db.basePrice ?? 0 })
        dirty = true
      }
      if (!dirty) allMatch++
    }

    console.log()
    console.log('=== DELTA REPORT ===')
    console.log(`  Unique SKUs in XLSX:       ${products.length}`)
    console.log(`  Matched in DB:             ${dbRows.length}`)
    console.log(`  Unmatched (not in DB):     ${unmatched.length}`)
    console.log(`  name differs:              ${nameDiffs.length}`)
    console.log(`  category differs:          ${categoryDiffs.length}`)
    console.log(`  cost differs:              ${costDiffs.length}`)
    console.log(`  basePrice differs:         ${priceDiffs.length}`)
    console.log(`  All four fields match:     ${allMatch}`)

    const changedSkus = new Set<string>([
      ...nameDiffs.map((d) => d.sku),
      ...categoryDiffs.map((d) => d.sku),
      ...costDiffs.map((d) => d.sku),
      ...priceDiffs.map((d) => d.sku),
    ])
    const divergedIncludingUnmatched = changedSkus.size + unmatched.length
    const changePct = products.length > 0 ? (divergedIncludingUnmatched / products.length) * 100 : 0
    console.log(`  SKUs with ANY drift:       ${divergedIncludingUnmatched} (${changePct.toFixed(2)}% of file)`)
    console.log()

    if (unmatched.length > 0) {
      console.log(`Sample unmatched (first 10):`)
      unmatched.slice(0, 10).forEach((p) =>
        console.log(`  ? ${p.sku.padEnd(10)} | ${p.name.slice(0, 60)}`)
      )
      console.log()
    }

    if (nameDiffs.length > 0) {
      console.log(`Sample name differences (first 5):`)
      nameDiffs.slice(0, 5).forEach((d) =>
        console.log(`  ~ ${d.sku.padEnd(10)} | xlsx="${d.xlsx.slice(0, 50)}"  db="${d.db.slice(0, 50)}"`)
      )
      console.log()
    }

    if (categoryDiffs.length > 0) {
      console.log(`Sample category differences (first 5):`)
      categoryDiffs.slice(0, 5).forEach((d) =>
        console.log(`  ~ ${d.sku.padEnd(10)} | xlsx="${d.xlsx}"  db="${d.db}"`)
      )
      console.log()
    }

    if (costDiffs.length > 0) {
      const sorted = [...costDiffs].sort(
        (a, b) => Math.abs(b.xlsxCost - b.dbCost) - Math.abs(a.xlsxCost - a.dbCost)
      )
      console.log(`Top 5 cost discrepancies (by |$ delta|):`)
      sorted.slice(0, 5).forEach((d) => {
        const delta = d.xlsxCost - d.dbCost
        console.log(
          `  ~ ${d.sku.padEnd(10)} | xlsx=$${d.xlsxCost.toFixed(2).padStart(9)}  db=$${d.dbCost.toFixed(2).padStart(9)}  Δ=$${delta.toFixed(2).padStart(9)} | ${d.name.slice(0, 50)}`
        )
      })
      console.log()
    }

    if (priceDiffs.length > 0) {
      const sorted = [...priceDiffs].sort(
        (a, b) => Math.abs(b.xlsxPrice - b.dbPrice) - Math.abs(a.xlsxPrice - a.dbPrice)
      )
      console.log(`Top 5 basePrice discrepancies (by |$ delta|):`)
      sorted.slice(0, 5).forEach((d) => {
        const delta = d.xlsxPrice - d.dbPrice
        console.log(
          `  ~ ${d.sku.padEnd(10)} | xlsx=$${d.xlsxPrice.toFixed(2).padStart(9)}  db=$${d.dbPrice.toFixed(2).padStart(9)}  Δ=$${delta.toFixed(2).padStart(9)} | ${d.name.slice(0, 50)}`
        )
      })
      console.log()
    }

    console.log('=== VERDICT ===')
    const liveMtime = (() => {
      const p = path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')
      return fs.existsSync(p) ? fs.statSync(p).mtime : null
    })()
    const cleanMtime = fs.statSync(FILE).mtime
    console.log(`  CLEAN mtime: ${cleanMtime.toISOString()}`)
    if (liveMtime) console.log(`  LIVE mtime:  ${liveMtime.toISOString()}`)
    const cleanIsNewer = liveMtime ? cleanMtime.getTime() > liveMtime.getTime() : false

    if (changePct <= 1.0) {
      console.log(`  CLEAN is fully absorbed — ${changePct.toFixed(2)}% of rows differ. Safe to archive the file.`)
    } else {
      console.log(`  STALE/DIVERGED — ${changePct.toFixed(2)}% of rows differ from Aegis.`)
      if (cleanIsNewer) {
        console.log(`  NOTE: CLEAN mtime is NEWER than LIVE. If CLEAN's Clean Category and pricing were intended to supersede LIVE,`)
        console.log(`        re-run ETL against CLEAN. Otherwise LIVE (the file previously absorbed) remains authoritative.`)
      } else {
        console.log(`  LIVE is authoritative (newer or equal mtime). Treat CLEAN as reference/archive.`)
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
