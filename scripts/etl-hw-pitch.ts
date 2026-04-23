/**
 * scripts/etl-hw-pitch.ts
 *
 * Load the Hancock Whitney line-renewal pitch pack into Aegis so the
 * numbers, asks, and narrative anchors are queryable from Nate's inbox
 * before the May 30 internal-close deadline.
 *
 * Folder: C:\Users\natha\OneDrive\Abel Lumber\Hancock Whitney Pitch - April 2026\
 *
 * Contents of the folder:
 *   1 - Abel Lumber Master Bank Pitch - April 2026.pptx        (narrative — deferred)
 *   2 - Abel Lumber P-Card Partnership Proposal.pptx           (narrative — deferred)
 *   3 - Won Work and Pipeline Projection 2026.xlsx             (loaded)
 *   4 - Boise Cascade Spend Outlook 2026.xlsx                  (loaded — cross-ref)
 *   6 - Abel Lumber EBITDA Package.xlsx                        (loaded — FY2025 financials)
 *
 * What this loads:
 *   A) FY2025 financial headline  (InboxItem, CRITICAL)
 *      Reported EBITDA -$481K, illustrative adjusted -$253K, net -$872K.
 *      These are the numbers HW will see on the front page — pin them.
 *   B) 2026 won-work + pipeline projection  (InboxItem, CRITICAL)
 *      Base $9.94M / run-rate $11.26M plus $3.57M Bloomfield upside.
 *      This is the forward-looking story after Pulte loss (4/20/2026).
 *   C) P-Card partnership ask  (InboxItem, HIGH)
 *      File "2 - Abel Lumber P-Card Partnership Proposal.pptx" (285KB)
 *      Flagged for follow-up review — ask terms aren't extractable from
 *      a PPTX here without a parser; summary points at file.
 *   D) Master pitch deck pointer  (InboxItem, HIGH)
 *      File "1 - Abel Lumber Master Bank Pitch - April 2026.pptx"
 *      Top-level narrative doc — single pointer so the deck is findable.
 *   E) Boise spend outlook cross-ref  (InboxItem, MEDIUM)
 *      $2.0M–$3.7M 2026 Boise spend underpins cost-of-goods in the pitch.
 *
 * Target table decision:
 *   - InboxItem (not FinancialSnapshot). FinancialSnapshot is point-in-time
 *     (cashOnHand, AR/AP aging, DSO/DPO). Pitch data is multi-year forecasts
 *     and narrative asks — InboxItem with structured actionData payload is
 *     the right home.
 *
 * Source tag: HW_RENEWAL_PITCH_APR2026
 *
 * Priority logic:
 *   - CRITICAL for anything HW will grade the renewal on (FY25 loss + 2026
 *     forward plan). Due-by = 2026-05-30 (TASKS.md target for decisions
 *     landing before June).
 *   - HIGH for specific asks (P-Card, master deck review).
 *   - MEDIUM for supporting cross-refs.
 *
 * Idempotency: deterministic ids, upsert pattern.
 *
 * Usage:
 *   npx tsx scripts/etl-hw-pitch.ts          # dry run (default)
 *   npx tsx scripts/etl-hw-pitch.ts --commit # write
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'HW_RENEWAL_PITCH_APR2026'
const DUE_BY = new Date('2026-05-30T23:59:00.000Z') // TASKS.md target: decisions land by May 30

const FOLDER = 'C:/Users/natha/OneDrive/Abel Lumber/Hancock Whitney Pitch - April 2026'
const EBITDA_FILE = path.join(FOLDER, '6 - Abel Lumber EBITDA Package.xlsx')
const PIPELINE_FILE = path.join(FOLDER, '3 - Won Work and Pipeline Projection 2026.xlsx')
const BOISE_FILE = path.join(FOLDER, '4 - Boise Cascade Spend Outlook 2026.xlsx')
const MASTER_DECK = '1 - Abel Lumber Master Bank Pitch - April 2026.pptx'
const PCARD_DECK = '2 - Abel Lumber P-Card Partnership Proposal.pptx'

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

function pickScalar(matrix: any[][], label: string): any {
  for (const row of matrix) {
    if (!Array.isArray(row)) continue
    const first = row[0] == null ? '' : String(row[0]).trim()
    if (first.toLowerCase().startsWith(label.toLowerCase())) {
      // return the next non-null cell
      for (let i = 1; i < row.length; i++) {
        if (row[i] !== null && row[i] !== undefined && row[i] !== '') return row[i]
      }
    }
  }
  return null
}

function readEbitdaHeadline() {
  if (!fs.existsSync(EBITDA_FILE)) throw new Error(`Missing: ${EBITDA_FILE}`)
  const wb = XLSX.readFile(EBITDA_FILE, { cellDates: true })
  const exec = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Executive Summary'], {
    header: 1,
    defval: null,
  })
  const debt = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Debt Service Support'], {
    header: 1,
    defval: null,
  })

  const num = (v: any) => (typeof v === 'number' ? v : Number(v) || 0)

  const headline = {
    fy2025Revenue: num(pickScalar(exec, 'Reported FY2025 Revenue')),
    fy2025GrossProfit: num(pickScalar(exec, 'Reported FY2025 Gross Profit')),
    fy2025GrossMargin: num(pickScalar(exec, 'Reported FY2025 Gross Margin')),
    fy2025NetIncome: num(pickScalar(exec, 'Reported FY2025 Net Income')),
    fy2025EBITDA: num(pickScalar(exec, 'Reported FY2025 EBITDA')),
    illustrativeAdjustedEBITDA: num(pickScalar(exec, 'Illustrative Adjusted EBITDA')),
    inventoryAdj: num(pickScalar(exec, 'Inventory / COGS timing')),
    salesTaxAdj: num(pickScalar(exec, 'Sales-tax overpayment')),
    invoicedRev2025: num(pickScalar(exec, '2025 Invoiced Revenue')),
    currentInventory: num(pickScalar(exec, 'Current Inventory Support')),
    unfulfilledBacklog: num(pickScalar(exec, 'Unfulfilled Open-Order Backlog')),
    yeToDate2026: num(pickScalar(exec, '2026 Jan–Feb Invoiced Revenue')),
    confirmedWonWork2026: num(pickScalar(exec, '2026 Confirmed Won Work')),
  }

  // Pull Known+Modeled debt principal from Debt Service sheet
  let debtPrincipal2025 = 0
  let debtInterest2025 = 0
  for (const row of debt) {
    if (!Array.isArray(row)) continue
    const first = row[0] == null ? '' : String(row[0]).trim()
    if (first === 'Known + Modeled Total') {
      debtInterest2025 = num(row[4])
      debtPrincipal2025 = num(row[5])
    }
  }

  return { ...headline, debtPrincipal2025, debtInterest2025 }
}

function readPipelineProjection() {
  if (!fs.existsSync(PIPELINE_FILE)) throw new Error(`Missing: ${PIPELINE_FILE}`)
  const wb = XLSX.readFile(PIPELINE_FILE, { cellDates: true })
  const cfo = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['CFO_Summary'], {
    header: 1,
    defval: null,
  })
  const won = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Won_Work_2026'], {
    header: 1,
    defval: null,
  })
  const pipe = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Pipeline_Upside'], {
    header: 1,
    defval: null,
  })

  const num = (v: any) => (typeof v === 'number' ? v : Number(v) || 0)

  const baseCase = num(pickScalar(cfo, 'Base case'))
  const runRateCase = num(pickScalar(cfo, 'Run-rate case'))

  // Won work: skip header, totals, and any non-account rows
  const wonRows = won
    .slice(1)
    .filter(r => Array.isArray(r) && r[0] && !String(r[0]).toUpperCase().startsWith('TOTAL'))
  const wonTotalBase = wonRows.reduce((s, r) => s + num(r[5]), 0)
  const wonTotalRunRate = wonRows.reduce((s, r) => s + num(r[6]), 0)

  // Pipeline: skip header + totals
  const pipeRows = pipe
    .slice(1)
    .filter(r => Array.isArray(r) && r[0] && !String(r[0]).toUpperCase().startsWith('TOTAL'))
  const probWeightedUpside = pipeRows.reduce((s, r) => s + num(r[7]), 0)

  // Top won accounts
  const topWon = wonRows
    .slice()
    .sort((a, b) => num(b[6]) - num(a[6]))
    .slice(0, 8)
    .map(r => ({
      account: String(r[0] ?? ''),
      status: String(r[1] ?? ''),
      start: String(r[2] ?? ''),
      base: num(r[5]),
      runRate: num(r[6]),
    }))

  const topPipeline = pipeRows
    .slice()
    .sort((a, b) => num(b[7]) - num(a[7]))
    .slice(0, 6)
    .map(r => ({
      account: String(r[0] ?? ''),
      stage: String(r[1] ?? ''),
      prob: num(r[2]),
      expected2026: num(r[7]),
    }))

  return {
    baseCase,
    runRateCase,
    wonTotalBase,
    wonTotalRunRate,
    probWeightedUpside,
    topWon,
    topPipeline,
    wonCount: wonRows.length,
    pipelineCount: pipeRows.length,
  }
}

function readBoiseSpend() {
  if (!fs.existsSync(BOISE_FILE)) return null
  const wb = XLSX.readFile(BOISE_FILE, { cellDates: true })
  const summary = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Summary'], {
    header: 1,
    defval: null,
  })
  const num = (v: any) => (typeof v === 'number' ? v : Number(v) || 0)
  return {
    committedRev: num(pickScalar(summary, 'Committed 2026 revenue')),
    growthRev: num(pickScalar(summary, 'Growth revenue')),
    boiseSharePct: num(pickScalar(summary, 'Boise share')),
    spendToRevRatio: num(pickScalar(summary, 'PO spend-to-revenue ratio')),
    spendBaseline: num(pickScalar(summary, 'Estimated Boise spend – baseli')),
    spendGrowth: num(pickScalar(summary, 'Estimated Boise spend – growth')),
  }
}

// ---------------------------------------------------------------------------
// InboxItem builders
// ---------------------------------------------------------------------------

function fmtMoney(n: number): string {
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

async function upsertInbox(
  id: string,
  data: {
    title: string
    description: string
    priority: string
    financialImpact?: number | null
    actionData: any
  },
) {
  if (DRY_RUN) {
    console.log(`\n[dry] InboxItem ${id} (${data.priority})`)
    console.log(`  title: ${data.title}`)
    console.log(`  fin. impact: ${data.financialImpact != null ? fmtMoney(data.financialImpact) : '-'}`)
    console.log(data.description)
    return
  }
  await prisma.inboxItem.upsert({
    where: { id },
    create: {
      id,
      type: 'AGENT_TASK',
      source: SOURCE_TAG,
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      entityType: 'BankPitch',
      entityId: SOURCE_TAG,
      financialImpact: data.financialImpact ?? null,
      dueBy: DUE_BY,
      actionData: data.actionData,
    },
    update: {
      title: data.title,
      description: data.description,
      priority: data.priority,
      status: 'PENDING',
      financialImpact: data.financialImpact ?? null,
      dueBy: DUE_BY,
      actionData: data.actionData,
    },
  })
}

async function main() {
  console.log(`[etl-hw-pitch] ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}`)
  console.log(`[etl-hw-pitch] source tag: ${SOURCE_TAG}`)
  console.log(`[etl-hw-pitch] due-by: ${DUE_BY.toISOString()}`)

  const ebitda = readEbitdaHeadline()
  const pipeline = readPipelineProjection()
  const boise = readBoiseSpend()

  console.log(`\n[ebitda] FY2025 revenue=${fmtMoney(ebitda.fy2025Revenue)} EBITDA=${fmtMoney(ebitda.fy2025EBITDA)} net=${fmtMoney(ebitda.fy2025NetIncome)}`)
  console.log(`[pipeline] won rows=${pipeline.wonCount} base=${fmtMoney(pipeline.baseCase)} run-rate=${fmtMoney(pipeline.runRateCase)} upside=${fmtMoney(pipeline.probWeightedUpside)}`)
  if (boise) {
    console.log(`[boise] committed=${fmtMoney(boise.committedRev)} spend baseline=${fmtMoney(boise.spendBaseline)}-${fmtMoney(boise.spendGrowth)}`)
  }

  // -----------------------------------------------------------------------
  // A) FY2025 financial headline — CRITICAL
  // -----------------------------------------------------------------------
  {
    const lines = [
      `Hancock Whitney line renewal — FY2025 financial headline (what HW opens the deck with).`,
      ``,
      `REPORTED FY2025`,
      `  Revenue:             ${fmtMoney(ebitda.fy2025Revenue)}`,
      `  Gross Profit:        ${fmtMoney(ebitda.fy2025GrossProfit)} (${pct(ebitda.fy2025GrossMargin)})`,
      `  Net Income:          ${fmtMoney(ebitda.fy2025NetIncome)}`,
      `  Reported EBITDA:     ${fmtMoney(ebitda.fy2025EBITDA)}`,
      ``,
      `ILLUSTRATIVE EBITDA BRIDGE (lender-safe — needs proof)`,
      `  + Inventory/COGS true-up:  ${fmtMoney(ebitda.inventoryAdj)}  (pending 12/31 count + valuation)`,
      `  + Sales-tax overpayment:   ${fmtMoney(ebitda.salesTaxAdj)}   (pending tax-ledger cleanup)`,
      `  = Adj. EBITDA (if proven): ${fmtMoney(ebitda.illustrativeAdjustedEBITDA)}`,
      ``,
      `2025 DEBT SERVICE (known + modeled)`,
      `  Interest:            ${fmtMoney(ebitda.debtInterest2025)}`,
      `  Principal:           ${fmtMoney(ebitda.debtPrincipal2025)}`,
      ``,
      `OPERATING SUPPORT`,
      `  2025 inFlow-invoiced revenue:      ${fmtMoney(ebitda.invoicedRev2025)}`,
      `  Current inventory (std cost):      ${fmtMoney(ebitda.currentInventory)}`,
      `  Unfulfilled open-order backlog:    ${fmtMoney(ebitda.unfulfilledBacklog)}`,
      `  2026 Jan–Feb invoiced revenue:     ${fmtMoney(ebitda.yeToDate2026)}`,
      `  2026 confirmed won work:           ${fmtMoney(ebitda.confirmedWonWork2026)}`,
      ``,
      `SOURCE: ${path.basename(EBITDA_FILE)} (sheets: Executive Summary, Monthly P&L Summary, EBITDA Bridge, Debt Service Support, Customer & Activity Support)`,
    ]
    await upsertInbox('hw-pitch-apr2026-fy25-financials', {
      title: 'HW renewal — FY2025 financial headline (-$481K EBITDA, -$872K net)',
      description: lines.join('\n'),
      priority: 'CRITICAL',
      financialImpact: ebitda.fy2025EBITDA,
      actionData: {
        sourceTag: SOURCE_TAG,
        sourceFile: path.basename(EBITDA_FILE),
        ebitda,
      },
    })
  }

  // -----------------------------------------------------------------------
  // B) 2026 forward plan — CRITICAL (the case for the renewal)
  // -----------------------------------------------------------------------
  {
    const lines = [
      `Hancock Whitney line renewal — 2026 forward case (the reason to renew).`,
      ``,
      `CONFIRMED 2026 REVENUE`,
      `  Base case (mgmt conservative): ${fmtMoney(pipeline.baseCase)}`,
      `  Run-rate case (cadence):       ${fmtMoney(pipeline.runRateCase)}`,
      `  Won accounts:                  ${pipeline.wonCount}`,
      ``,
      `TOP WON ACCOUNTS (base / run-rate)`,
      ...pipeline.topWon.map(
        (r, i) =>
          `  ${i + 1}. ${r.account} — ${r.status} — start ${r.start} — ${fmtMoney(r.base)} / ${fmtMoney(r.runRate)}`,
      ),
      ``,
      `PROBABILITY-WEIGHTED PIPELINE UPSIDE: ${fmtMoney(pipeline.probWeightedUpside)}`,
      ...pipeline.topPipeline.map(
        (r, i) =>
          `  ${i + 1}. ${r.account} — ${r.stage} — ${pct(r.prob)} prob — ${fmtMoney(r.expected2026)} expected`,
      ),
      ``,
      `NARRATIVE FRAMING (per TASKS.md, post-Pulte-loss 4/20/2026):`,
      `  - 2025 largest customer (Pulte, $1.21M) is dead weight — reframe.`,
      `  - Anchor story: Brookfield Rev 4 + diversified won book (Shaddock, Toll, MSR, Olerio, Imagination) + Bloomfield upside.`,
      `  - Won book alone (base case ${fmtMoney(pipeline.baseCase)}) is ~${(pipeline.baseCase / ebitda.fy2025Revenue).toFixed(1)}x FY25 revenue.`,
      ``,
      `SOURCE: ${path.basename(PIPELINE_FILE)} (sheets: CFO_Summary, Won_Work_2026, Monthly_Forecast, Pipeline_Upside)`,
    ]
    await upsertInbox('hw-pitch-apr2026-2026-forecast', {
      title: `HW renewal — 2026 forward plan (${fmtMoney(pipeline.baseCase)} base / ${fmtMoney(pipeline.runRateCase)} run-rate)`,
      description: lines.join('\n'),
      priority: 'CRITICAL',
      financialImpact: pipeline.baseCase,
      actionData: {
        sourceTag: SOURCE_TAG,
        sourceFile: path.basename(PIPELINE_FILE),
        baseCase: pipeline.baseCase,
        runRateCase: pipeline.runRateCase,
        wonTotalBase: pipeline.wonTotalBase,
        wonTotalRunRate: pipeline.wonTotalRunRate,
        probWeightedUpside: pipeline.probWeightedUpside,
        topWon: pipeline.topWon,
        topPipeline: pipeline.topPipeline,
      },
    })
  }

  // -----------------------------------------------------------------------
  // C) P-Card partnership ask — HIGH (narrative, not parseable as tabular)
  // -----------------------------------------------------------------------
  {
    const file = path.join(FOLDER, PCARD_DECK)
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0
    const lines = [
      `Hancock Whitney P-Card (purchasing-card) partnership proposal — separate ask alongside the line renewal.`,
      ``,
      `SOURCE FILE (not parsed — PPTX narrative):`,
      `  ${PCARD_DECK} (${(size / 1024).toFixed(0)} KB)`,
      ``,
      `ACTION: Before the HW conversation, open this deck and extract the explicit ask:`,
      `  - P-Card spend volume commitment (expected annual throughput)`,
      `  - Rebate / rewards structure requested from HW`,
      `  - Card controls / limit structure proposed`,
      `  - Vendor mix (Boise, DW, Masonite, JELD-WEN, Therma-Tru, Emtek, Kwikset, Schlage)`,
      ``,
      `Once extracted, update this inbox item or spin a new one with concrete numbers.`,
    ]
    await upsertInbox('hw-pitch-apr2026-pcard-ask', {
      title: 'HW renewal — P-Card partnership proposal (review deck, extract ask)',
      description: lines.join('\n'),
      priority: 'HIGH',
      financialImpact: null,
      actionData: {
        sourceTag: SOURCE_TAG,
        sourceFile: PCARD_DECK,
        sizeBytes: size,
        status: 'NARRATIVE_DEFERRED',
      },
    })
  }

  // -----------------------------------------------------------------------
  // D) Master pitch deck pointer — HIGH
  // -----------------------------------------------------------------------
  {
    const file = path.join(FOLDER, MASTER_DECK)
    const size = fs.existsSync(file) ? fs.statSync(file).size : 0
    const lines = [
      `Hancock Whitney master bank pitch — the umbrella narrative deck that pulls together the FY25 story, 2026 plan, Boise spend outlook, and P-Card ask.`,
      ``,
      `SOURCE FILE (not parsed — PPTX narrative):`,
      `  ${MASTER_DECK} (${(size / 1024).toFixed(0)} KB)`,
      ``,
      `REVIEW CHECKLIST (per TASKS.md — HW line renewal is the top finance item):`,
      `  [ ] Refresh 2025 top-customer slide — Pulte ($1.21M) is dead; reframe around Brookfield + diversification.`,
      `  [ ] Confirm 2026 base case (${fmtMoney(pipeline.baseCase)}) vs run-rate (${fmtMoney(pipeline.runRateCase)}) on forward slide.`,
      `  [ ] Include EBITDA bridge with proof path: inventory count + sales-tax cleanup status.`,
      `  [ ] Cover: cash position, AR aging, open-order backlog (${fmtMoney(ebitda.unfulfilledBacklog)}).`,
      `  [ ] Review ask slide (line size, covenant proposal, term) — extract to follow-up inbox item.`,
      ``,
      `Related items in this inbox (same source tag):`,
      `  - hw-pitch-apr2026-fy25-financials  (FY25 numbers)`,
      `  - hw-pitch-apr2026-2026-forecast    (2026 plan)`,
      `  - hw-pitch-apr2026-pcard-ask        (P-Card partnership)`,
      `  - hw-pitch-apr2026-boise-spend      (supplier cost-side cross-ref)`,
    ]
    await upsertInbox('hw-pitch-apr2026-master-deck', {
      title: 'HW renewal — master pitch deck review + ask extraction',
      description: lines.join('\n'),
      priority: 'HIGH',
      financialImpact: null,
      actionData: {
        sourceTag: SOURCE_TAG,
        sourceFile: MASTER_DECK,
        sizeBytes: size,
        status: 'NARRATIVE_DEFERRED',
      },
    })
  }

  // -----------------------------------------------------------------------
  // E) Boise spend outlook cross-ref — MEDIUM
  // -----------------------------------------------------------------------
  if (boise) {
    const lines = [
      `Hancock Whitney pitch — Boise Cascade 2026 spend outlook (cost-of-goods cross-ref for the EBITDA story).`,
      ``,
      `2026 REVENUE BASE`,
      `  Committed revenue:        ${fmtMoney(boise.committedRev)}`,
      `  Growth scenario (1.85x):  ${fmtMoney(boise.growthRev)}`,
      ``,
      `BOISE SHARE`,
      `  Boise % of PO spend:      ${pct(boise.boiseSharePct)}`,
      `  PO spend / revenue:       ${pct(boise.spendToRevRatio)}`,
      ``,
      `ESTIMATED 2026 BOISE SPEND`,
      `  Baseline:                 ${fmtMoney(boise.spendBaseline)}`,
      `  Growth scenario:          ${fmtMoney(boise.spendGrowth)}`,
      ``,
      `Relevant to HW conversation: establishes vendor concentration and working-capital need if the line supports the Boise AP cycle.`,
      ``,
      `SOURCE: ${path.basename(BOISE_FILE)}`,
    ]
    await upsertInbox('hw-pitch-apr2026-boise-spend', {
      title: `HW renewal — 2026 Boise spend outlook (${fmtMoney(boise.spendBaseline)} baseline)`,
      description: lines.join('\n'),
      priority: 'MEDIUM',
      financialImpact: boise.spendBaseline,
      actionData: {
        sourceTag: SOURCE_TAG,
        sourceFile: path.basename(BOISE_FILE),
        ...boise,
      },
    })
  }

  console.log(`\n[summary]`)
  console.log(`  InboxItems upserted: 5 (2 CRITICAL, 2 HIGH, 1 MEDIUM)`)
  console.log(`  Due-by: ${DUE_BY.toISOString()}`)
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMITTED'}`)
  if (DRY_RUN) console.log(`  Re-run with --commit to persist.`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
