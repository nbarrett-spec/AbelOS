/**
 * scripts/etl-turnaround-extras.ts
 *
 * Loads the remaining actionable sheets from Abel_Turnaround_Action_Plan_April2026.xlsx
 * into InboxItem. Builds on etl-turnaround-plan.ts (90-Day Action Plan) and
 * etl-final-batch.ts (Financial Snapshot). Does NOT touch Payroll Detail (PII).
 *
 * Three source tags are produced:
 *   - TURNAROUND_KPIS_APR2026  — one summary item from the Weekly Scorecard
 *   - ACCOUNT_SCORECARD_APR2026 — per-builder items for rows NOT already flagged
 *                                by etl-margin-analysis.ts (AccountReviewTrigger)
 *   - PIPELINE_TRACKER_APR2026 — one item per tracked deal/opportunity; deduped
 *                                (read-only) against existing rows in Deal
 *
 * Modes:
 *   default    DRY-RUN (print only)
 *   --commit   actually upsert InboxItem rows
 *
 * Usage:
 *   tsx scripts/etl-turnaround-extras.ts
 *   tsx scripts/etl-turnaround-extras.ts --commit
 *
 * Idempotent: each InboxItem id is derived from sha256(tag::key). Re-running is
 * an update, not a duplicate.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'Abel_Turnaround_Action_Plan_April2026.xlsx'
)

const TAG_KPIS = 'TURNAROUND_KPIS_APR2026'
const TAG_ACCOUNT = 'ACCOUNT_SCORECARD_APR2026'
const TAG_PIPELINE = 'PIPELINE_TRACKER_APR2026'

function normStr(v: unknown): string {
  return (v ?? '').toString().trim()
}
function hashId(tag: string, key: string): string {
  return (
    'ib_txt_' +
    crypto
      .createHash('sha256')
      .update(`${tag}::${key}`)
      .digest('hex')
      .slice(0, 16)
  )
}
function norm(s: string): string {
  return (s || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}
function normalizeFuzzy(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
function fuzzyMatch(a: string, b: string): number {
  const na = normalizeFuzzy(a)
  const nb = normalizeFuzzy(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.9
  const wa = new Set(na.split(' ').filter((w) => w.length > 2))
  const wb = new Set(nb.split(' ').filter((w) => w.length > 2))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter++
  return inter / (wa.size + wb.size - inter)
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  if (typeof v === 'number') return v
  const s = String(v).replace(/[$,%\s]/g, '')
  const n = parseFloat(s)
  return isFinite(n) ? n : null
}
function pctString(v: unknown): string {
  if (v == null || v === '') return ''
  if (typeof v === 'number') {
    return v <= 1 ? `${(v * 100).toFixed(1)}%` : `${v.toFixed(1)}%`
  }
  return String(v).trim()
}

// ─── WEEKLY SCORECARD ──────────────────────────────────────────────────
interface KpiRow {
  kpi: string
  target: string
  currentLabel: string
  currentValue: string
  offTarget: boolean
}

function parseWeeklyScorecard(wb: XLSX.WorkBook): {
  weekHeaders: string[]
  kpis: KpiRow[]
  currentCol: number
  columns: number
} {
  const ws = wb.Sheets['Weekly Scorecard']
  if (!ws) throw new Error('Weekly Scorecard sheet missing')
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    defval: null,
  }) as any[][]

  // Row 2 = header (KPI, Target, Week 1 4/11, Week 2 4/18, ...)
  const header = (rows[2] || []).map((h) => normStr(h))
  const weekHeaders = header.slice(2)

  // Pick the right-most week-column that has any non-null values in it
  let currentCol = 2 // default to the first week col
  for (let c = header.length - 1; c >= 2; c--) {
    let hasData = false
    for (let r = 3; r < rows.length; r++) {
      if (rows[r]?.[c] != null && String(rows[r][c]).trim() !== '') {
        hasData = true
        break
      }
    }
    if (hasData) {
      currentCol = c
      break
    }
  }

  const kpis: KpiRow[] = []
  for (let r = 3; r < rows.length; r++) {
    const row = rows[r] || []
    const kpi = normStr(row[0])
    if (!kpi) continue
    const target = normStr(row[1])
    const current = row[currentCol]
    const currentValue = normStr(current)

    // Crude off-target check: compare numerics where possible
    let offTarget = false
    const tNum = toNum(target)
    const cNum = toNum(current)
    if (tNum != null && cNum != null) {
      // Heuristic: for "0" targets, any positive is off; for "$0", same; for
      // "<3%" the target cell would be "<3%" (non-numeric after strip — skip).
      // For "35%+" string, toNum('35+') → 35, cNum of "17.4%" → 17.4 < 35 → off.
      if (/^<|under|below/i.test(target)) {
        offTarget = cNum > Math.abs(tNum)
      } else if (/\+|at least|min/i.test(target)) {
        offTarget = cNum < Math.abs(tNum)
      } else {
        // equal-target (e.g. "0"): any deviation is off
        offTarget = cNum > tNum && tNum === 0
      }
    } else if (/DONE/i.test(currentValue)) {
      offTarget = false
    } else if (currentValue && /signed|done/i.test(target) && !/done|signed/i.test(currentValue)) {
      offTarget = true
    }

    kpis.push({ kpi, target, currentLabel: normStr(header[currentCol]), currentValue, offTarget })
  }

  return { weekHeaders, kpis, currentCol, columns: header.length }
}

function buildKpiInboxItem(parsed: ReturnType<typeof parseWeeklyScorecard>) {
  const { kpis, currentCol } = parsed
  const weekLabel = kpis[0]?.currentLabel || 'current week'
  const off = kpis.filter((k) => k.offTarget)
  const critical = off.filter((k) =>
    /margin|credit|below cost|overtime|software spend/i.test(k.kpi)
  )

  const lines: string[] = []
  lines.push(`Weekly Turnaround Scorecard — standing as of ${weekLabel.replace(/\n/g, ' ')}.`)
  lines.push('')
  lines.push('KPI | Target | Current | Status')
  lines.push('--- | --- | --- | ---')
  for (const k of kpis) {
    const status = k.offTarget
      ? 'OFF'
      : k.currentValue
        ? 'on track'
        : 'no reading'
    lines.push(
      `${k.kpi.replace(/\n/g, ' ')} | ${k.target} | ${k.currentValue.replace(/\n/g, ' ') || '—'} | ${status}`
    )
  }
  lines.push('')
  lines.push(`Off-target KPIs this week: ${off.length} / ${kpis.length}`)
  if (off.length) {
    lines.push('Off-target: ' + off.map((k) => k.kpi).join('; '))
  }

  const priority = critical.length >= 2 ? 'CRITICAL' : off.length >= 3 ? 'HIGH' : 'MEDIUM'

  return {
    key: `weekly-scorecard::${weekLabel}::col${currentCol}`,
    title: `[TURNAROUND KPIs] Weekly Scorecard — ${weekLabel.replace(/\n/g, ' ')} — ${off.length}/${kpis.length} off-target`,
    description: lines.join('\n').slice(0, 2000),
    priority,
  }
}

// ─── ACCOUNT SCORECARD ─────────────────────────────────────────────────
interface AccountRow {
  rank: number | null
  account: string
  revenue: number | null
  cogs: number | null
  grossProfit: number | null
  netGm: number | null
  targetGm: number | null
  gap: string
  orders: number | null
  avgOrder: number | null
  riskLevel: string
  action: string
}

function parseAccountScorecard(wb: XLSX.WorkBook): AccountRow[] {
  const ws = wb.Sheets['Account Scorecard']
  if (!ws) throw new Error('Account Scorecard sheet missing')
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    defval: null,
  }) as any[][]

  // header row index 2
  const out: AccountRow[] = []
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] || []
    const account = normStr(r[1])
    if (!account) continue
    if (/^TOTAL$|^PIPELINE/i.test(account)) continue
    out.push({
      rank: toNum(r[0]),
      account,
      revenue: toNum(r[2]),
      cogs: toNum(r[3]),
      grossProfit: toNum(r[4]),
      netGm: toNum(r[5]),
      targetGm: toNum(r[6]),
      gap: normStr(r[7]),
      orders: toNum(r[8]),
      avgOrder: toNum(r[9]),
      riskLevel: normStr(r[10]),
      action: normStr(r[11]),
    })
  }
  return out
}

function riskToPriority(risk: string): string {
  const r = risk.toUpperCase()
  if (r === 'CRITICAL' || r === 'HIGH') return 'CRITICAL'
  if (r === 'MEDIUM') return 'HIGH'
  if (r === 'LOST' || r === 'EXIT') return 'LOW'
  return 'MEDIUM'
}

// ─── PIPELINE TRACKER ──────────────────────────────────────────────────
interface PipelineRow {
  builder: string
  status: string
  monthlyRev: number | null
  annualRev: number | null
  gmTarget: number | null
  annualGp: number | null
  probability: number | null
  risk: string
  nextAction: string
}

function parsePipelineTracker(wb: XLSX.WorkBook): PipelineRow[] {
  const ws = wb.Sheets['Pipeline Tracker']
  if (!ws) throw new Error('Pipeline Tracker sheet missing')
  const rows = XLSX.utils.sheet_to_json<any[]>(ws, {
    header: 1,
    defval: null,
  }) as any[][]

  const out: PipelineRow[] = []
  for (let i = 3; i < rows.length; i++) {
    const r = rows[i] || []
    const builder = normStr(r[0])
    if (!builder) continue
    if (/^WON TOTAL|^PIPELINE TOTAL|^PROB-WEIGHTED|^TOTAL$/i.test(builder)) continue
    out.push({
      builder,
      status: normStr(r[1]),
      monthlyRev: toNum(r[2]),
      annualRev: toNum(r[3]),
      gmTarget: toNum(r[4]),
      annualGp: toNum(r[5]),
      probability: toNum(r[6]),
      risk: normStr(r[7]),
      nextAction: normStr(r[8]),
    })
  }
  return out
}

function pipelinePriority(row: PipelineRow): string {
  const s = row.status.toUpperCase()
  const prob = row.probability ?? 0
  const gp = row.annualGp ?? 0
  if (s === 'LOST') return 'LOW'
  if (s === 'WON') return gp > 1_000_000 ? 'HIGH' : 'MEDIUM'
  // PIPELINE
  if (prob >= 0.7 && gp > 500_000) return 'CRITICAL'
  if (prob >= 0.5) return 'HIGH'
  if (prob >= 0.35) return 'MEDIUM'
  return 'LOW'
}

// ─── MAIN ──────────────────────────────────────────────────────────────
async function main() {
  console.log(`ETL turnaround extras — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Reading: ${FILE}`)

  const wb = XLSX.readFile(FILE)

  // --- Weekly Scorecard
  const weekly = parseWeeklyScorecard(wb)
  console.log()
  console.log('=== WEEKLY SCORECARD ===')
  console.log(
    `  Columns: ${weekly.columns}  KPIs parsed: ${weekly.kpis.length}  Using col ${weekly.currentCol} (${(weekly.kpis[0]?.currentLabel || '').replace(/\n/g, ' ')})`
  )
  const kpiItem = buildKpiInboxItem(weekly)
  console.log(`  Will create 1 summary InboxItem: ${kpiItem.title.slice(0, 110)}`)

  // --- Account Scorecard
  const accounts = parseAccountScorecard(wb)
  console.log()
  console.log('=== ACCOUNT SCORECARD ===')
  console.log(`  Columns: 12  Rows parsed: ${accounts.length}`)

  // --- Pipeline Tracker
  const pipeline = parsePipelineTracker(wb)
  console.log()
  console.log('=== PIPELINE TRACKER ===')
  console.log(`  Columns: 10  Rows parsed: ${pipeline.length}`)

  const prisma = new PrismaClient()
  try {
    // Existing AccountReviewTrigger rows (A6) — dedupe against these builders
    const reviewTriggers = await prisma.accountReviewTrigger.findMany({
      where: { triggerType: 'LOW_MARGIN' },
      select: { builderId: true },
    })
    const flaggedBuilderIds = new Set(reviewTriggers.map((t) => t.builderId))

    // All builders for name matching
    const allBuilders = await prisma.builder.findMany({
      select: { id: true, companyName: true },
    })

    function matchBuilder(name: string): { id: string; companyName: string } | null {
      const key = norm(name)
      // exact
      for (const b of allBuilders) {
        if (norm(b.companyName) === key) return b
      }
      // fuzzy > 0.7
      let best: { id: string; companyName: string } | null = null
      let bestScore = 0.7
      for (const b of allBuilders) {
        const s = fuzzyMatch(name, b.companyName)
        if (s > bestScore) {
          best = b
          bestScore = s
        }
      }
      return best
    }

    // ── Account Scorecard → InboxItems (skip already-flagged builders)
    interface AccountPlan {
      key: string
      title: string
      description: string
      priority: string
      financialImpact: number | null
      entityType?: string
      entityId?: string
    }
    const accountPlans: AccountPlan[] = []
    let accMatched = 0
    let accSkippedAlreadyFlagged = 0
    let accNoBuilder = 0
    for (const a of accounts) {
      const hit = matchBuilder(a.account)
      if (hit) {
        accMatched++
        if (flaggedBuilderIds.has(hit.id)) {
          accSkippedAlreadyFlagged++
          continue
        }
      } else {
        accNoBuilder++
      }
      const gmPct = a.netGm != null ? `${(a.netGm * 100).toFixed(1)}%` : '—'
      const targetPct = a.targetGm != null ? `${(a.targetGm * 100).toFixed(1)}%` : '—'
      const revFmt = a.revenue != null ? `$${a.revenue.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
      const gpFmt = a.grossProfit != null ? `$${a.grossProfit.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
      const desc = [
        `Rank ${a.rank ?? '?'} — ${a.account}`,
        `Revenue: ${revFmt}  ·  Orders: ${a.orders ?? '—'}  ·  Avg order: $${a.avgOrder ?? '—'}`,
        `Net GM: ${gmPct}  ·  Target: ${targetPct}  ·  Gap: ${a.gap || '—'}`,
        `Gross profit: ${gpFmt}`,
        `Risk level: ${a.riskLevel}`,
        `Action required: ${a.action}`,
      ].join('\n')
      accountPlans.push({
        key: `${TAG_ACCOUNT}::${norm(a.account)}`,
        title: `[ACCOUNT] ${a.account} — ${a.riskLevel || 'REVIEW'} — ${gmPct}`.slice(0, 240),
        description: desc.slice(0, 2000),
        priority: riskToPriority(a.riskLevel),
        financialImpact: a.grossProfit ?? null,
        entityType: hit ? 'Builder' : undefined,
        entityId: hit?.id,
      })
    }
    console.log()
    console.log('=== ACCOUNT PLAN ===')
    console.log(`  Matched to Builder:       ${accMatched}`)
    console.log(`  No Builder match:         ${accNoBuilder}`)
    console.log(`  Skipped (already flagged):${accSkippedAlreadyFlagged}`)
    console.log(`  InboxItems to create:     ${accountPlans.length}`)

    // ── Pipeline Tracker → InboxItems (dedupe read-only against Deal)
    const existingDeals = await prisma.deal.findMany({
      select: { id: true, dealNumber: true, companyName: true, stage: true },
    })

    interface PipelinePlan {
      key: string
      title: string
      description: string
      priority: string
      financialImpact: number | null
      entityType?: string
      entityId?: string
      matchedDeal?: string
    }
    const pipelinePlans: PipelinePlan[] = []
    let pMatchedDeal = 0
    let pMatchedBuilder = 0
    let pUnmatched = 0
    for (const p of pipeline) {
      // Try Deal match
      let dealHit: (typeof existingDeals)[number] | null = null
      for (const d of existingDeals) {
        if (fuzzyMatch(p.builder, d.companyName) > 0.75) {
          dealHit = d
          break
        }
      }
      if (dealHit) pMatchedDeal++

      // Try Builder match (for entity link if no deal)
      const builderHit = matchBuilder(p.builder)
      if (!dealHit && builderHit) pMatchedBuilder++
      if (!dealHit && !builderHit) pUnmatched++

      const gmPct = p.gmTarget != null ? `${(p.gmTarget * 100).toFixed(1)}%` : '—'
      const probPct = p.probability != null ? `${(p.probability * 100).toFixed(0)}%` : '—'
      const rrFmt = p.annualRev != null ? `$${p.annualRev.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
      const gpFmt = p.annualGp != null ? `$${p.annualGp.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '—'
      const desc = [
        `${p.builder} — ${p.status}`,
        `Annual run-rate revenue: ${rrFmt}  ·  Monthly: ${p.monthlyRev != null ? `$${p.monthlyRev.toLocaleString('en-US')}` : '—'}`,
        `GM target: ${gmPct}  ·  Est annual GP: ${gpFmt}  ·  Probability: ${probPct}`,
        p.risk && `Risk/notes: ${p.risk}`,
        p.nextAction && `Next action: ${p.nextAction}`,
        dealHit
          ? `Matched existing Deal: ${dealHit.dealNumber} (${dealHit.stage}) — read-only, Deal row not modified`
          : builderHit
            ? `No matching Deal row; linked to Builder: ${builderHit.companyName}`
            : `No matching Deal or Builder row`,
      ]
        .filter(Boolean)
        .join('\n')
      pipelinePlans.push({
        key: `${TAG_PIPELINE}::${norm(p.builder)}::${p.status}`,
        title: `[PIPELINE ${p.status}] ${p.builder} — ${rrFmt} @ ${probPct}`.slice(0, 240),
        description: desc.slice(0, 2000),
        priority: pipelinePriority(p),
        financialImpact: p.annualGp ?? null,
        entityType: dealHit ? 'Deal' : builderHit ? 'Builder' : undefined,
        entityId: dealHit?.id ?? builderHit?.id,
        matchedDeal: dealHit?.dealNumber,
      })
    }
    console.log()
    console.log('=== PIPELINE PLAN ===')
    console.log(`  Matched existing Deal:    ${pMatchedDeal}`)
    console.log(`  Matched Builder only:     ${pMatchedBuilder}`)
    console.log(`  Unmatched:                ${pUnmatched}`)
    console.log(`  InboxItems to create:     ${pipelinePlans.length}`)

    // ─── Summary + write plan
    const totalWrite = 1 + accountPlans.length + pipelinePlans.length
    console.log()
    console.log('=== TOTAL PLAN ===')
    console.log(`  Weekly KPI summary:   1`)
    console.log(`  Account InboxItems:   ${accountPlans.length}`)
    console.log(`  Pipeline InboxItems:  ${pipelinePlans.length}`)
    console.log(`  TOTAL upserts:        ${totalWrite}`)

    // Sample print
    console.log()
    console.log('Sample items:')
    console.log(`  [${kpiItem.priority.padEnd(8)}] ${kpiItem.title.slice(0, 110)}`)
    for (const p of accountPlans.slice(0, 3))
      console.log(`  [${p.priority.padEnd(8)}] ${p.title.slice(0, 110)}`)
    for (const p of pipelinePlans.slice(0, 3))
      console.log(`  [${p.priority.padEnd(8)}] ${p.title.slice(0, 110)}`)

    if (DRY_RUN) {
      console.log()
      console.log('DRY-RUN — no writes. Re-run with --commit.')
      return
    }

    // COMMIT
    console.log()
    console.log('COMMIT — upserting...')
    let created = 0
    let updated = 0
    let failed = 0
    async function upsert(
      tag: string,
      key: string,
      title: string,
      description: string,
      priority: string,
      financialImpact: number | null,
      entityType?: string,
      entityId?: string
    ) {
      try {
        const id = hashId(tag, key)
        const res = await prisma.inboxItem.upsert({
          where: { id },
          create: {
            id,
            type: 'ACTION_REQUIRED',
            source:
              tag === TAG_KPIS
                ? 'turnaround-kpis'
                : tag === TAG_ACCOUNT
                  ? 'account-scorecard'
                  : 'pipeline-tracker',
            title: title.slice(0, 240),
            description: description.slice(0, 2000),
            priority,
            status: 'PENDING',
            financialImpact,
            entityType,
            entityId,
          },
          update: {
            title: title.slice(0, 240),
            description: description.slice(0, 2000),
            priority,
            financialImpact,
            entityType,
            entityId,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
        else updated++
      } catch (e) {
        failed++
        console.error('  FAIL:', (e as Error).message.slice(0, 160))
      }
    }

    await upsert(
      TAG_KPIS,
      kpiItem.key,
      kpiItem.title,
      kpiItem.description,
      kpiItem.priority,
      null
    )
    for (const p of accountPlans) {
      await upsert(
        TAG_ACCOUNT,
        p.key,
        p.title,
        p.description,
        p.priority,
        p.financialImpact,
        p.entityType,
        p.entityId
      )
    }
    for (const p of pipelinePlans) {
      await upsert(
        TAG_PIPELINE,
        p.key,
        p.title,
        p.description,
        p.priority,
        p.financialImpact,
        p.entityType,
        p.entityId
      )
    }
    console.log(`Committed: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
