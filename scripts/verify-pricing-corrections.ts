/**
 * scripts/verify-pricing-corrections.ts
 *
 * READ-ONLY verification that Abel_Pricing_Corrections.xlsx has been absorbed
 * into the Aegis Product table (via the Product Master catalog).
 *
 * Hypothesis: after etl-product-catalog.ts, the corrected Cost + Default List
 * Price in this file should match Product.cost + Product.basePrice. A near-zero
 * delta confirms absorption.
 *
 * Does NOT write to DB. Pure diff report.
 *
 * Source sheet: "All Corrections" — 310 rows (+1 header) of per-builder
 * corrections. Cost and Default List Price are product-level values (same for
 * every builder row with the same SKU). We dedupe by SKU (last wins).
 *
 * Column layout (row 1 is header; headers live in the __EMPTY_* slots):
 *   __EMPTY     = SKU
 *   __EMPTY_1   = Product Name
 *   __EMPTY_2   = Category
 *   __EMPTY_3   = Cost
 *   __EMPTY_4   = Default List Price
 *
 * Usage:
 *   tsx scripts/verify-pricing-corrections.ts
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as fs from 'node:fs'
import * as path from 'node:path'

const FILE = path.resolve(__dirname, '..', '..', 'Abel_Pricing_Corrections.xlsx')
const SHEET = 'All Corrections'
const EPS = 0.01 // tolerate 1 cent rounding

interface RawRow {
  __EMPTY?: string | null        // SKU
  __EMPTY_1?: string | null      // Product Name
  __EMPTY_2?: string | null      // Category
  __EMPTY_3?: number | string | null // Cost
  __EMPTY_4?: number | string | null // Default List Price
}

interface XlsxProduct {
  sku: string
  name: string
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
  console.log(`Verify pricing corrections (READ-ONLY)`)
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
  console.log(`Raw rows in "${SHEET}" (incl. header): ${raw.length}`)

  // Row 0 is the header ("SKU", "Product Name", ...). Skip it, then parse.
  const parsedMap = new Map<string, XlsxProduct>()
  let skipped = 0
  for (let i = 1; i < raw.length; i++) {
    const r = raw[i]
    const sku = normStr(r.__EMPTY)
    const name = normStr(r.__EMPTY_1)
    const cost = toNum(r.__EMPTY_3)
    const basePrice = toNum(r.__EMPTY_4)
    if (!sku || cost === null || basePrice === null) {
      skipped++
      continue
    }
    // Last wins on duplicate SKU (per-builder rows share product-level values)
    parsedMap.set(sku, { sku, name, cost, basePrice })
  }
  const products = Array.from(parsedMap.values())
  console.log(`Data rows parsed: ${raw.length - 1}  (skipped: ${skipped})`)
  console.log(`Unique SKUs in file: ${products.length}`)

  const prisma = new PrismaClient()
  try {
    const skus = products.map((p) => p.sku)
    const dbRows = await prisma.product.findMany({
      where: { sku: { in: skus } },
      select: { sku: true, name: true, cost: true, basePrice: true },
    })
    const dbMap = new Map(dbRows.map((p) => [p.sku, p]))
    console.log(`Aegis matches: ${dbRows.length}/${products.length}`)

    const unmatched: XlsxProduct[] = []
    const costDiffs: Array<{ sku: string; xlsxCost: number; dbCost: number; name: string }> = []
    const priceDiffs: Array<{ sku: string; xlsxPrice: number; dbPrice: number; name: string }> = []
    let bothMatch = 0

    for (const x of products) {
      const db = dbMap.get(x.sku)
      if (!db) {
        unmatched.push(x)
        continue
      }
      const costDelta = Math.abs((db.cost ?? 0) - x.cost)
      const priceDelta = Math.abs((db.basePrice ?? 0) - x.basePrice)
      if (costDelta > EPS) {
        costDiffs.push({ sku: x.sku, xlsxCost: x.cost, dbCost: db.cost ?? 0, name: x.name })
      }
      if (priceDelta > EPS) {
        priceDiffs.push({ sku: x.sku, xlsxPrice: x.basePrice, dbPrice: db.basePrice ?? 0, name: x.name })
      }
      if (costDelta <= EPS && priceDelta <= EPS) bothMatch++
    }

    console.log()
    console.log('=== DELTA REPORT ===')
    console.log(`  Unique SKUs in XLSX:      ${products.length}`)
    console.log(`  Unmatched (not in DB):    ${unmatched.length}`)
    console.log(`  Matched in DB:            ${dbRows.length}`)
    console.log(`  Cost differs from DB:     ${costDiffs.length}`)
    console.log(`  basePrice differs from DB: ${priceDiffs.length}`)
    console.log(`  Both match exactly:       ${bothMatch}`)
    console.log()

    const totalChanged = new Set([
      ...costDiffs.map((d) => d.sku),
      ...priceDiffs.map((d) => d.sku),
    ]).size
    const changePct = products.length > 0 ? (totalChanged / products.length) * 100 : 0
    console.log(`  SKUs with ANY difference: ${totalChanged} (${changePct.toFixed(2)}% of file)`)
    console.log()

    if (unmatched.length > 0) {
      console.log(`Sample unmatched (first 10):`)
      unmatched.slice(0, 10).forEach((p) =>
        console.log(`  ? ${p.sku.padEnd(10)} | cost=${p.cost} price=${p.basePrice} | ${p.name.slice(0, 60)}`)
      )
      console.log()
    }

    // Top discrepancies by abs price delta
    if (priceDiffs.length > 0) {
      const sorted = [...priceDiffs].sort(
        (a, b) => Math.abs(b.xlsxPrice - b.dbPrice) - Math.abs(a.xlsxPrice - a.dbPrice)
      )
      console.log(`Top 10 basePrice discrepancies (by $ delta):`)
      sorted.slice(0, 10).forEach((d) => {
        const delta = d.xlsxPrice - d.dbPrice
        console.log(
          `  ~ ${d.sku.padEnd(10)} | xlsx=$${d.xlsxPrice.toFixed(2).padStart(9)}  db=$${d.dbPrice.toFixed(2).padStart(9)}  Δ=$${delta.toFixed(2).padStart(9)} | ${d.name.slice(0, 50)}`
        )
      })
      console.log()
    }
    if (costDiffs.length > 0) {
      const sorted = [...costDiffs].sort(
        (a, b) => Math.abs(b.xlsxCost - b.dbCost) - Math.abs(a.xlsxCost - a.dbCost)
      )
      console.log(`Top 10 cost discrepancies (by $ delta):`)
      sorted.slice(0, 10).forEach((d) => {
        const delta = d.xlsxCost - d.dbCost
        console.log(
          `  ~ ${d.sku.padEnd(10)} | xlsx=$${d.xlsxCost.toFixed(2).padStart(9)}  db=$${d.dbCost.toFixed(2).padStart(9)}  Δ=$${delta.toFixed(2).padStart(9)} | ${d.name.slice(0, 50)}`
        )
      })
      console.log()
    }

    console.log('=== VERDICT ===')
    if (changePct <= 1.0 && unmatched.length === 0) {
      console.log(`ABSORPTION CONFIRMED — ${changePct.toFixed(2)}% delta, all SKUs matched.`)
    } else if (changePct <= 1.0) {
      console.log(`ABSORPTION LIKELY — ${changePct.toFixed(2)}% price/cost delta, but ${unmatched.length} SKUs unmatched.`)
    } else {
      console.log(`DELTA SIGNIFICANT — ${changePct.toFixed(2)}% of file rows differ. Review above, consider re-running ETL against this file.`)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
