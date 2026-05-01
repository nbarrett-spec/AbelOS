// ──────────────────────────────────────────────────────────────────────────
// scripts/test-boise-pricing-diff.ts
//
// Smoke test for the Boise pricing watcher's parse + diff (no DB writes,
// no Brain calls). Reads an .xlsx, parses it, diffs against an empty
// baseline (everything is "new") AND a 5%-shifted synthetic baseline, then
// prints what would be emitted.
//
// Usage:
//   npx tsx scripts/test-boise-pricing-diff.ts <path-to-xlsx>
// ──────────────────────────────────────────────────────────────────────────

import * as fs from 'node:fs'
import * as path from 'node:path'
import {
  parseBoisePriceXlsx,
  diffSnapshots,
  type ParsedPriceRow,
} from '../src/lib/integrations/boise-pricing-watcher'

function main() {
  const argPath = process.argv[2]
  if (!argPath) {
    console.error('Usage: npx tsx scripts/test-boise-pricing-diff.ts <xlsx>')
    process.exit(1)
  }
  const abs = path.resolve(argPath)
  if (!fs.existsSync(abs)) {
    console.error('File not found:', abs)
    process.exit(1)
  }

  const buf = fs.readFileSync(abs)
  console.log(`\n=== Parsing ${path.basename(abs)} (${(buf.length / 1024).toFixed(1)} KB) ===`)

  const rows = parseBoisePriceXlsx(buf)
  console.log(`Parsed rows: ${rows.length}`)
  if (!rows.length) {
    console.error('NO ROWS PARSED — parser failed to find recognizable columns')
    process.exit(2)
  }

  console.log('\n--- First 5 rows ---')
  for (const r of rows.slice(0, 5)) {
    console.log(`  ${r.sku.padEnd(12)} $${r.unitPrice.toFixed(2).padStart(9)} | ${(r.name || '').slice(0, 60)}`)
  }

  // Diff #1: empty baseline → all skus are "new"
  console.log('\n--- Diff vs EMPTY baseline ---')
  const d1 = diffSnapshots(rows, null, { thresholdPct: 1.0, topN: 50 })
  console.log(`  totalSkus=${d1.totalSkus}  newSkus=${d1.newSkus}  changedSkus=${d1.changedSkus}  removedSkus=${d1.removedSkus}`)
  console.log(`  Top movers (would emit): ${d1.topMovers.length} events  [empty baseline produces no movers — expected]`)

  // Diff #2: synthetic baseline = all prices 5% lower → every SKU is a +5% mover
  console.log('\n--- Diff vs SYNTHETIC baseline (all prices -5%) — simulates a 5% across-board hike ---')
  const synthMap: Record<string, { name: string | null; price: number }> = {}
  for (const r of rows) {
    synthMap[r.sku] = { name: r.name, price: r.unitPrice / 1.05 }
  }
  const d2 = diffSnapshots(rows, synthMap, { thresholdPct: 1.0, topN: 50 })
  console.log(`  totalSkus=${d2.totalSkus}  newSkus=${d2.newSkus}  changedSkus=${d2.changedSkus}  removedSkus=${d2.removedSkus}`)
  console.log(`  Top movers (would emit ${d2.topMovers.length} events to brain.abellumber.com/brain/ingest/batch):`)
  console.log()
  for (const m of d2.topMovers.slice(0, 15)) {
    const arrow = m.direction === 'UP' ? '▲' : '▼'
    console.log(
      `   ${arrow} ${m.sku.padEnd(12)} $${m.previousPrice.toFixed(2).padStart(9)} → $${m.newPrice.toFixed(2).padStart(9)}  (${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(2)}%)  | ${(m.name || '').slice(0, 50)}`
    )
  }
  if (d2.topMovers.length > 15) console.log(`   … and ${d2.topMovers.length - 15} more`)

  // Diff #3: realistic drift — bump 8 SKUs by various pcts, leave the rest flat
  console.log('\n--- Diff vs REALISTIC baseline (8 SKUs shifted, rest flat) ---')
  const realMap: Record<string, { name: string | null; price: number }> = {}
  for (const r of rows) realMap[r.sku] = { name: r.name, price: r.unitPrice }
  const shifts: Array<[number, number]> = [
    [0, 0.92], // -8%
    [1, 1.045], // +4.5%
    [2, 1.12], // +12%
    [3, 0.987], // -1.3%
    [4, 1.035], // +3.5%
    [5, 0.85], // -15%
    [6, 1.005], // +0.5% (below threshold — should NOT emit)
    [7, 1.22], // +22%
  ]
  for (const [idx, factor] of shifts) {
    const r = rows[idx]
    if (r) realMap[r.sku] = { name: r.name, price: r.unitPrice / factor } // baseline is "before", new is r.unitPrice
  }
  const d3 = diffSnapshots(rows, realMap, { thresholdPct: 1.0, topN: 50 })
  console.log(
    `  totalSkus=${d3.totalSkus}  newSkus=${d3.newSkus}  changedSkus=${d3.changedSkus}  removedSkus=${d3.removedSkus}  (expected ~7 changed — the 0.5% bump filtered)`
  )
  for (const m of d3.topMovers) {
    const arrow = m.direction === 'UP' ? '▲' : '▼'
    console.log(
      `   ${arrow} ${m.sku.padEnd(12)} $${m.previousPrice.toFixed(2).padStart(9)} → $${m.newPrice.toFixed(2).padStart(9)}  (${m.deltaPct >= 0 ? '+' : ''}${m.deltaPct.toFixed(2)}%)`
    )
  }

  console.log('\n=== Smoke test PASSED ===\n')
}

main()
