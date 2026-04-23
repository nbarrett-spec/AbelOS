/**
 * scripts/etl-turnaround-plan.ts
 *
 * Loads the "90-Day Action Plan" sheet of Abel_Turnaround_Action_Plan_April2026.xlsx
 * into InboxItem with source tag `TURNAROUND_APR2026`.
 *
 * Dedup: skips any item whose title is a near-duplicate of an existing item
 * (from A5 IMPROVEMENT_PLAN_V1 source or earlier runs of this script).
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(__dirname, '..', '..', 'Abel_Turnaround_Action_Plan_April2026.xlsx')
const SRC_TAG = 'TURNAROUND_APR2026'

function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function hashId(tag: string, key: string): string {
  return 'ib_tna_' + crypto.createHash('sha256').update(`${tag}::${key}`).digest('hex').slice(0, 16)
}
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b)
  if (na === nb) return 1
  const wa = new Set(na.split(' ').filter((w) => w.length > 3))
  const wb = new Set(nb.split(' ').filter((w) => w.length > 3))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0; for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}

async function main() {
  console.log(`ETL turnaround plan — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  const wb = XLSX.readFile(FILE)
  const sheet = wb.Sheets['90-Day Action Plan']
  if (!sheet) throw new Error('"90-Day Action Plan" sheet missing')
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null }) as any[][]

  // Find header row (has "Action", "Priority", "Owner", or similar)
  let hdrIdx = -1
  for (let i = 0; i < Math.min(rows.length, 8); i++) {
    const cells = rows[i].map(normStr).map((s) => s.toLowerCase())
    if (cells.some((c) => /action|initiative|task/.test(c)) && cells.some((c) => /priority|impact|owner/.test(c))) {
      hdrIdx = i; break
    }
  }
  if (hdrIdx < 0) {
    // Fallback: rows have >= 5 non-empty cells
    for (let i = 2; i < Math.min(rows.length, 10); i++) {
      if (rows[i].filter((c) => normStr(c).length > 0).length >= 4) { hdrIdx = i; break }
    }
  }
  if (hdrIdx < 0) throw new Error('Could not locate header row')
  const hdrs = rows[hdrIdx].map((h) => normStr(h).toLowerCase())
  const col = (keys: string[]) => hdrs.findIndex((h) => keys.some((k) => h.includes(k)))
  const cIdx = {
    phase: col(['phase', 'week']),
    action: col(['action', 'initiative', 'task', 'description']),
    owner: col(['owner']),
    priority: col(['priority', 'impact']),
    target: col(['target', 'goal', 'expected']),
    status: col(['status']),
    date: col(['date', 'deadline', 'due']),
    impact: col(['impact', 'savings', 'value', '$']),
  }
  console.log('Header row index:', hdrIdx, 'columns:', cIdx)

  const items: Array<{ key: string; title: string; description: string; priority: string; financialImpact: number | null }> = []
  for (const row of rows.slice(hdrIdx + 1)) {
    const action = cIdx.action >= 0 ? normStr(row[cIdx.action]) : ''
    if (!action || action.length < 6) continue
    if (/^(WEEK|MONTH|PHASE|DAY)/i.test(action)) continue // section dividers
    const priority = normStr(cIdx.priority >= 0 ? row[cIdx.priority] : '').toUpperCase()
    const owner = normStr(cIdx.owner >= 0 ? row[cIdx.owner] : '')
    const phase = normStr(cIdx.phase >= 0 ? row[cIdx.phase] : '')
    const target = normStr(cIdx.target >= 0 ? row[cIdx.target] : '')
    const status = normStr(cIdx.status >= 0 ? row[cIdx.status] : '')
    const impactCell = cIdx.impact >= 0 ? row[cIdx.impact] : null
    const financialImpact = typeof impactCell === 'number' ? impactCell : parseFloat(String(impactCell ?? '').replace(/[,$]/g, '')) || null
    const p = priority.includes('CRIT') || priority === 'P0' ? 'CRITICAL' :
              priority.includes('HIGH') || priority === 'P1' ? 'HIGH' :
              priority.includes('LOW') || priority === 'P3' ? 'LOW' : 'MEDIUM'
    const extras = [phase && `Phase: ${phase}`, owner && `Owner: ${owner}`, target && `Target: ${target}`, status && `Status: ${status}`].filter(Boolean).join(' · ')
    items.push({
      key: action.slice(0, 120),
      title: `[TURNAROUND] ${action.slice(0, 180)}`,
      description: extras ? `${action}\n\n${extras}` : action,
      priority: p,
      financialImpact: financialImpact && financialImpact > 0 ? financialImpact : null,
    })
  }
  console.log(`Parsed action items: ${items.length}`)

  const prisma = new PrismaClient()
  try {
    // Load existing improvement-plan / turnaround / profitability items for dedup
    const existing = await prisma.inboxItem.findMany({
      where: { source: { in: ['improvement-plan', 'turnaround-plan', 'profitability-plan'] } },
      select: { id: true, title: true },
    })
    const existingTitles = existing.map((e) => e.title)
    console.log(`Existing related items to dedupe against: ${existingTitles.length}`)

    let skipped = 0
    const toWrite: typeof items = []
    for (const it of items) {
      const match = existingTitles.find((t) => similarity(t, it.title) > 0.55)
      if (match) { skipped++; continue }
      toWrite.push(it)
    }

    console.log(`Deduped: ${skipped} skipped as duplicates, ${toWrite.length} new`)
    console.log()
    console.log('Sample new items (first 5):')
    toWrite.slice(0, 5).forEach((it) => console.log(`  [${it.priority.padEnd(8)}] ${it.title.slice(0, 100)}`))
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
            source: 'turnaround-plan',
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
      } catch (e) {
        failed++
        console.error('  FAIL:', (e as Error).message.slice(0, 120))
      }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
