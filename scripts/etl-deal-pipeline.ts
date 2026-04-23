/**
 * scripts/etl-deal-pipeline.ts
 *
 * Builds a consolidated Aegis pipeline snapshot from two sources:
 *   1) AMP_Won_Work_and_Pipeline_Projection_2026.xlsx
 *        - Won_Work_2026 sheet (contracted deals)
 *        - Pipeline_Upside sheet (prospects with probability)
 *   2) Abel_Turnaround_Action_Plan_April2026.xlsx
 *        - Pipeline Tracker sheet (union view, already partially seeded by A34)
 *
 * Writes InboxItems with source='deal-pipeline' and tag DEAL_PIPELINE_APR2026.
 * Does NOT touch the Deal table — NUC seeds Deal rows from brain JSONL.
 *
 * Dedup: skips any item whose normalized title is close to an existing
 * TURNAROUND_APR2026 / PIPELINE_TRACKER_APR2026 item (sources turnaround-plan,
 * pipeline-tracker) or a prior run of this script (deal-pipeline).
 *
 * Priority rules:
 *   CRITICAL = revenue > $1M AND probability > 50%
 *   HIGH     = revenue > $500K AND probability > 30%
 *   MEDIUM   = everything else
 *
 * Cap: 30 items. DRY-RUN by default; pass --commit to write.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC_TAG = 'DEAL_PIPELINE_APR2026'
const SRC_FIELD = 'deal-pipeline'
const CAP = 30

const AMP_FILE = path.resolve(__dirname, '..', '..', 'AMP_Won_Work_and_Pipeline_Projection_2026.xlsx')
const TURN_FILE = path.resolve(__dirname, '..', '..', 'Abel_Turnaround_Action_Plan_April2026.xlsx')

type DealRow = {
  key: string
  builder: string
  stage: string
  status: 'WON' | 'PIPELINE' | 'LOST' | 'UNKNOWN'
  revenue: number // 2026 run-rate or potential
  probability: number // 0..1
  nextAction: string
  notes: string
  sheetSource: string
  weightedRevenue: number
}

function normStr(v: unknown): string { return (v ?? '').toString().trim() }
function toNum(v: unknown): number {
  if (v == null || v === '') return 0
  if (typeof v === 'number') return v
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? n : 0
}
function hashId(tag: string, key: string): string {
  return 'ib_dlp_' + crypto.createHash('sha256').update(`${tag}::${key}`).digest('hex').slice(0, 16)
}
function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()
}
function similarity(a: string, b: string): number {
  const na = normalize(a), nb = normalize(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  const wa = new Set(na.split(' ').filter((w) => w.length > 3))
  const wb = new Set(nb.split(' ').filter((w) => w.length > 3))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0; for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}
function builderKey(name: string): string {
  // Collapse common suffixes + parenthetical qualifiers so "MSR (Sorovar - Frisco)"
  // and "MSR (Sorovar)" resolve to the same key.
  return normalize(name.replace(/\(.*?\)/g, ''))
    .replace(/\b(homes|builders|construction|development|group|inc|llc|the)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
function fmtMoney(n: number): string {
  if (!n) return '$0'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n.toFixed(0)}`
}

function classifyPriority(revenue: number, probability: number): 'CRITICAL' | 'HIGH' | 'MEDIUM' {
  if (revenue > 1_000_000 && probability > 0.5) return 'CRITICAL'
  if (revenue > 500_000 && probability > 0.3) return 'HIGH'
  return 'MEDIUM'
}

function parseWonWork(wb: XLSX.WorkBook): DealRow[] {
  const sheet = wb.Sheets['Won_Work_2026']
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null }) as any[][]
  const out: DealRow[] = []
  // Headers at row 0: Account, Status, Start, Cadence/Notes, Monthly Rev, 2026 Rev (Base), 2026 Rev (Run-rate), GM Target Notes, Flags
  for (const row of rows.slice(1)) {
    const builder = normStr(row[0])
    if (!builder || /^TOTAL/i.test(builder)) continue
    const status = normStr(row[1])
    const cadence = normStr(row[3])
    const monthly = toNum(row[4])
    const revBase = toNum(row[5])
    const revRun = toNum(row[6])
    const gm = normStr(row[7])
    const flags = normStr(row[8])
    const revenue = revRun || revBase || monthly * 12
    if (revenue <= 0 && !/trophy/i.test(builder)) continue
    out.push({
      key: `amp-won::${builderKey(builder)}`,
      builder,
      stage: 'WON / Contracted',
      status: 'WON',
      revenue,
      probability: 1.0,
      nextAction: cadence || 'Maintain cadence; execute run-rate',
      notes: [gm, flags].filter(Boolean).join(' · '),
      sheetSource: 'AMP_Won_Work_2026',
      weightedRevenue: revenue * 1.0,
    })
  }
  return out
}

function parsePipelineUpside(wb: XLSX.WorkBook): DealRow[] {
  const sheet = wb.Sheets['Pipeline_Upside']
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null }) as any[][]
  const out: DealRow[] = []
  // Headers row 0: Account, Stage, Prob., 2026 Start Assumption, 2026 Factor, Full-Year Potential, 2026 Potential, Expected 2026 (prob-weighted), Notes
  for (const row of rows.slice(1)) {
    const builder = normStr(row[0])
    if (!builder || /^TOTAL/i.test(builder)) continue
    const stage = normStr(row[1])
    const prob = toNum(row[2])
    const potential = toNum(row[6])
    const weighted = toNum(row[7])
    const notes = normStr(row[8])
    const revenue = potential || (weighted && prob ? weighted / prob : 0)
    out.push({
      key: `amp-upside::${builderKey(builder)}`,
      builder,
      stage,
      status: 'PIPELINE',
      revenue,
      probability: prob,
      nextAction: notes || 'Advance bid; confirm next step',
      notes: `${stage}`,
      sheetSource: 'AMP_Pipeline_Upside',
      weightedRevenue: weighted || revenue * prob,
    })
  }
  return out
}

function parsePipelineTracker(wb: XLSX.WorkBook): DealRow[] {
  const sheet = wb.Sheets['Pipeline Tracker']
  if (!sheet) return []
  const rows = XLSX.utils.sheet_to_json<any>(sheet, { header: 1, defval: null }) as any[][]
  const out: DealRow[] = []
  // Headers row 2: Builder, Status, Monthly Rev, 2026 Rev (Run-Rate), GM Target, Est Annual GP, Probability, Risk/Notes, Next Action
  for (const row of rows.slice(3)) {
    const builder = normStr(row[0])
    if (!builder || /TOTAL|PROB-WEIGHTED/i.test(builder)) continue
    const status = normStr(row[1]).toUpperCase()
    const revenue = toNum(row[3])
    const prob = toNum(row[6])
    const risk = normStr(row[7])
    const next = normStr(row[8])
    if (revenue <= 0 && status !== 'LOST') continue
    out.push({
      key: `tracker::${builderKey(builder)}`,
      builder,
      stage: status,
      status: status === 'WON' ? 'WON' : status === 'LOST' ? 'LOST' : 'PIPELINE',
      revenue,
      probability: prob,
      nextAction: next || 'TBD',
      notes: risk,
      sheetSource: 'Turnaround_Pipeline_Tracker',
      weightedRevenue: revenue * prob,
    })
  }
  return out
}

function consolidate(all: DealRow[]): DealRow[] {
  // Merge rows by builderKey — prefer AMP sheets over Tracker when duplicated,
  // but attach tracker's next-action if AMP is silent.
  const byKey = new Map<string, DealRow>()
  const preference = (src: string) => src.startsWith('AMP_') ? 2 : 1
  for (const r of all) {
    const k = builderKey(r.builder)
    const existing = byKey.get(k)
    if (!existing) { byKey.set(k, r); continue }
    if (preference(r.sheetSource) > preference(existing.sheetSource)) {
      // Keep AMP values; fold tracker next-action if AMP's is weak
      if ((!r.nextAction || r.nextAction.length < 8) && existing.nextAction) r.nextAction = existing.nextAction
      byKey.set(k, r)
    } else {
      if ((!existing.nextAction || existing.nextAction.length < 8) && r.nextAction) existing.nextAction = r.nextAction
    }
  }
  return [...byKey.values()]
}

async function main() {
  console.log(`ETL deal pipeline — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'} — tag: ${SRC_TAG}`)

  const ampWb = XLSX.readFile(AMP_FILE)
  const turnWb = XLSX.readFile(TURN_FILE)

  const wonDeals = parseWonWork(ampWb)
  const upsideDeals = parsePipelineUpside(ampWb)
  const trackerDeals = parsePipelineTracker(turnWb)
  console.log(`Parsed: won=${wonDeals.length} upside=${upsideDeals.length} tracker=${trackerDeals.length}`)

  const merged = consolidate([...wonDeals, ...upsideDeals, ...trackerDeals])
  merged.sort((a, b) => b.weightedRevenue - a.weightedRevenue)
  console.log(`After intra-source consolidation: ${merged.length} unique deals`)

  // Build InboxItem candidates
  const candidates = merged.map((d) => {
    const priority = classifyPriority(d.revenue, d.probability)
    const revLabel = fmtMoney(d.revenue)
    const probLabel = `${Math.round(d.probability * 100)}%`
    const title = d.status === 'WON'
      ? `[PIPELINE] ${d.builder} — WON ${revLabel}/yr — ${d.nextAction.slice(0, 80)}`
      : d.status === 'LOST'
        ? `[PIPELINE] ${d.builder} — LOST — ${d.nextAction.slice(0, 80)}`
        : `[PIPELINE] ${d.builder} — ${d.stage} — ${revLabel} @ ${probLabel} — ${d.nextAction.slice(0, 60)}`
    const description = [
      `Builder: ${d.builder}`,
      `Stage: ${d.stage}`,
      `2026 Revenue: ${revLabel}`,
      `Probability: ${probLabel}`,
      `Weighted 2026 Revenue: ${fmtMoney(d.weightedRevenue)}`,
      `Next action: ${d.nextAction}`,
      d.notes && `Notes: ${d.notes}`,
      `Source sheet: ${d.sheetSource}`,
    ].filter(Boolean).join('\n')
    return {
      key: d.key,
      title: title.slice(0, 240),
      description: description.slice(0, 2000),
      priority,
      financialImpact: d.revenue > 0 ? d.revenue : null,
      weighted: d.weightedRevenue,
      builder: d.builder,
    }
  })

  const prisma = new PrismaClient()
  try {
    // Deal table sanity check — we never write, but log size for the report
    const dealCount = await prisma.deal.count()
    console.log(`Deal table rows: ${dealCount} (read-only; NUC owns seeding)`)

    // Load existing dedup set: prior deal-pipeline + turnaround-plan + pipeline-tracker titles
    const existing = await prisma.inboxItem.findMany({
      where: { source: { in: ['deal-pipeline', 'turnaround-plan', 'pipeline-tracker'] } },
      select: { id: true, title: true, source: true },
    })
    console.log(`Existing related inbox items (dedup pool): ${existing.length}`)
    const sourceBreakdown: Record<string, number> = {}
    existing.forEach((e) => { sourceBreakdown[e.source] = (sourceBreakdown[e.source] || 0) + 1 })
    console.log('  by source:', sourceBreakdown)

    // Dedup pass — skip a candidate if another inbox item already represents
    // the same builder/deal (similarity > 0.55 on normalized title).
    let skippedDup = 0
    const toWrite: typeof candidates = []
    for (const c of candidates) {
      // Compare against existing titles, but only flag as duplicate if the
      // existing title also mentions the builder name.
      const bKey = builderKey(c.builder)
      const match = existing.find((e) => {
        if (bKey.length < 3) return false
        return normalize(e.title).includes(bKey) && similarity(e.title, c.title) > 0.45
      })
      if (match) {
        skippedDup++
        continue
      }
      toWrite.push(c)
    }
    console.log(`Dedup: skipped=${skippedDup} kept=${toWrite.length}`)

    // Apply cap of 30 (already sorted by weighted revenue descending)
    const capped = toWrite.slice(0, CAP)
    const droppedCap = toWrite.length - capped.length
    if (droppedCap > 0) console.log(`Capped at ${CAP}: dropped ${droppedCap} lower-value items`)

    console.log('\nTop 5 candidates by weighted 2026 revenue:')
    ;[...capped].sort((a, b) => b.weighted - a.weighted).slice(0, 5).forEach((c, i) => {
      console.log(`  ${i + 1}. [${c.priority}] ${c.builder} — weighted ${fmtMoney(c.weighted)}`)
    })
    console.log('\nSample titles (first 8):')
    capped.slice(0, 8).forEach((c) => console.log(`  [${c.priority.padEnd(8)}] ${c.title.slice(0, 110)}`))

    if (DRY_RUN) {
      console.log(`\nDRY-RUN — would write ${capped.length} InboxItems. Re-run with --commit.`)
      return
    }

    console.log(`\nCOMMIT — writing ${capped.length} InboxItems...`)
    let created = 0, updated = 0, failed = 0
    for (const it of capped) {
      try {
        const id = hashId(SRC_TAG, it.key)
        const res = await prisma.inboxItem.upsert({
          where: { id },
          create: {
            id,
            type: 'ACTION_REQUIRED',
            source: SRC_FIELD,
            title: it.title,
            description: it.description,
            priority: it.priority,
            status: 'PENDING',
            financialImpact: it.financialImpact,
          },
          update: {
            title: it.title,
            description: it.description,
            priority: it.priority,
            financialImpact: it.financialImpact,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++; else updated++
      } catch (e) {
        failed++
        console.error('  FAIL:', (e as Error).message.slice(0, 160))
      }
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
