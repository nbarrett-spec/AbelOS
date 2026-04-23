/**
 * scripts/etl-profitability-plan.ts
 *
 * Loads action items from Abel_Profitability_Improvement_Plan.xlsx (7 sheets).
 * Source tag: PROFITABILITY_IMPROVEMENT_V1
 *
 * Dedup: against existing InboxItem rows from improvement-plan, turnaround-plan,
 * and this source. Uses token-overlap similarity > 0.55 to skip duplicates.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Profitability_Improvement_Plan.xlsx')
const SRC_TAG = 'PROFITABILITY_IMPROVEMENT_V1'

function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function hashId(tag: string, k: string): string {
  return 'ib_prf_' + crypto.createHash('sha256').update(`${tag}::${k}`).digest('hex').slice(0, 18)
}
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function similarity(a: string, b: string): number {
  const wa = new Set(normalize(a).split(' ').filter((w) => w.length > 3))
  const wb = new Set(normalize(b).split(' ').filter((w) => w.length > 3))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0; for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,$%]/g, ''))
  return Number.isFinite(n) ? n : null
}

// Extract action-like rows from a sheet. Heuristic: rows with a meaningful
// first-string column and optional $ impact column.
function extractActionRows(wb: XLSX.WorkBook, sheet: string, sheetLabel: string): Array<{ title: string; description: string; financialImpact: number | null; priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }> {
  const ws = wb.Sheets[sheet]
  if (!ws) return []
  const rows = XLSX.utils.sheet_to_json<any>(ws, { header: 1, defval: null }) as any[][]

  // Find header row
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const cells = rows[i].map(normStr).map((s) => s.toLowerCase())
    const nonEmpty = cells.filter((c) => c.length > 0).length
    if (nonEmpty >= 3 && cells.some((c) => /action|initiative|category|sku|item|task|vendor|week|phase/.test(c))) {
      hdrIdx = i; break
    }
  }
  if (hdrIdx < 0) return []

  const items: Array<{ title: string; description: string; financialImpact: number | null; priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }> = []
  for (const row of rows.slice(hdrIdx + 1)) {
    const cells = row.map(normStr)
    const first = cells[0]
    if (!first || first.length < 4) continue
    if (/^(WEEK|MONTH|PHASE|DAY|TOTAL|SECTION|NOTES)/i.test(first)) continue
    // Find a meaningful description cell (longest non-blank that isn't the first)
    const rest = cells.slice(1).filter((c) => c.length > 3).sort((a, b) => b.length - a.length)
    const desc = rest[0] || ''
    // Find a $ column
    let impact: number | null = null
    for (const c of row) {
      if (typeof c === 'number' && c > 100 && c < 10_000_000) { impact = c; break }
      const m = String(c ?? '').match(/\$\s*([\d,]+(?:\.\d+)?)/)
      if (m) { impact = toNum(m[1]); break }
    }
    const priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' =
      impact && impact > 50000 ? 'CRITICAL' :
      impact && impact > 10000 ? 'HIGH' :
      impact && impact > 1000 ? 'MEDIUM' : 'LOW'
    items.push({
      title: `[${sheetLabel}] ${first.slice(0, 180)}`,
      description: desc ? `${first}\n\n${desc}` : first,
      financialImpact: impact,
      priority,
    })
    if (items.length >= 100) break // safety cap per sheet
  }
  return items
}

async function main() {
  console.log(`ETL profitability plan — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  const wb = XLSX.readFile(FILE)

  const sheetLabels: Array<[string, string]> = [
    ['Pricing Corrections', 'PRICING'],
    ['Inventory Liquidation', 'LIQUIDATE'],
    ['Open PO Review', 'PO-REVIEW'],
    ['Pipeline Strategy', 'PIPELINE'],
    ['Market Position', 'MARKET'],
    ['90-Day Action Plan', '90-DAY'],
  ]

  let allItems: Array<{ key: string; title: string; description: string; financialImpact: number | null; priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' }> = []
  for (const [sh, lbl] of sheetLabels) {
    const items = extractActionRows(wb, sh, lbl)
    console.log(`  ${sh}: ${items.length} items`)
    allItems.push(...items.map((it) => ({ ...it, key: `${lbl}::${it.title}` })))
  }

  const prisma = new PrismaClient()
  try {
    const existing = await prisma.inboxItem.findMany({
      where: { source: { in: ['improvement-plan', 'turnaround-plan', 'profitability-plan'] } },
      select: { title: true },
    })
    let skipped = 0
    const toWrite: typeof allItems = []
    for (const it of allItems) {
      if (existing.some((e) => similarity(e.title, it.title) > 0.55)) { skipped++; continue }
      toWrite.push(it)
    }
    console.log(`Total parsed: ${allItems.length}, dedup-skipped: ${skipped}, to write: ${toWrite.length}`)
    const byP = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
    let totalImpact = 0
    for (const it of toWrite) {
      byP[it.priority]++
      if (it.financialImpact) totalImpact += it.financialImpact
    }
    console.log('Priority mix:', byP)
    console.log(`Total $ impact: $${totalImpact.toFixed(0)}`)
    console.log()
    console.log('Sample (first 5):')
    toWrite.slice(0, 5).forEach((it) => console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 110)}`))
    console.log()

    if (DRY_RUN) { console.log('DRY-RUN — re-run with --commit.'); return }

    console.log('COMMIT — applying...')
    let created = 0, updated = 0, failed = 0
    for (const it of toWrite) {
      try {
        const id = hashId(SRC_TAG, it.key)
        const res = await prisma.inboxItem.upsert({
          where: { id },
          create: {
            id,
            type: 'ACTION_REQUIRED',
            source: 'profitability-plan',
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            financialImpact: it.financialImpact,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
      } catch (e) { failed++; console.error('  FAIL:', (e as Error).message.slice(0, 120)) }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally { await prisma.$disconnect() }
}

main().catch((e) => { console.error(e); process.exit(1) })
