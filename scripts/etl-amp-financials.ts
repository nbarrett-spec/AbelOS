/**
 * scripts/etl-amp-financials.ts
 *
 * Evaluates three AMP financial-planning workbooks and loads what fits the
 * current schema. Summary of decisions (full rationale in the report body):
 *
 *   1) AMP_Boise_Cascade_Spend_Outlook_2026.xlsx
 *        Monthly_Forecast is clean time-series spend projection data
 *        (12 rows × 4 scenarios), but there is NO schema home for it.
 *        FinancialSnapshot is a company-wide daily cash snapshot (unique
 *        on snapshotDate, no vendor / scenario / projection-month
 *        dimensions). A VendorSpendForecast model does not exist. The
 *        task explicitly forbids synthesizing missing fields and forbids
 *        schema changes. → REPORT ONLY, DO NOT LOAD.
 *
 *   2) AMP_Won_Work_and_Pipeline_Projection_2026.xlsx
 *        Won_Work_2026 (16 rows) and Pipeline_Upside (12 rows) are clean.
 *        Monthly_Forecast sheet is a pivoted matrix with the report title
 *        on header row 0 — unloadable without reshape. FinancialSnapshot
 *        has no account / start-month / probability / scenario columns,
 *        so pipeline data cannot be stuffed there either.
 *        → REPORT ONLY, DO NOT LOAD.
 *
 *   3) AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx
 *        Narrative/support workbook assembled for the Hancock Whitney
 *        line renewal. 11 sheets, most with title rows and qualitative
 *        content. Contains one genuinely actionable artifact — the
 *        reported-vs-adjusted EBITDA bridge with an explicit Action_List.
 *        → CREATE ONE InboxItem summarising the action list, tagged
 *          source=AMP_LEGAL_EBITDA_2026 for traceability.
 *
 * Modes:
 *   --dry-run (default) — parse, summarise, write nothing
 *   --commit            — apply InboxItem upsert
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')

const ABEL_FOLDER = path.resolve(__dirname, '..', '..')
const F_BOISE = path.join(ABEL_FOLDER, 'AMP_Boise_Cascade_Spend_Outlook_2026.xlsx')
const F_PIPE = path.join(ABEL_FOLDER, 'AMP_Won_Work_and_Pipeline_Projection_2026.xlsx')
const F_EBITDA = path.join(ABEL_FOLDER, 'AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx')

const SOURCE_EBITDA = 'AMP_LEGAL_EBITDA_2026'

function readSheet(fp: string, sheetName: string, headerRow = 0) {
  const wb = XLSX.readFile(fp, { cellDates: true })
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Sheet not found: ${sheetName} in ${path.basename(fp)}`)
  const matrix = XLSX.utils.sheet_to_json<any[]>(ws, { header: 1, defval: null, raw: true })
  const hdrRow = (matrix[headerRow] || []) as any[]
  const headers = hdrRow.map((h, i) => (h == null ? `col_${i}` : String(h).trim()))
  const rows: Record<string, any>[] = []
  for (let r = headerRow + 1; r < matrix.length; r++) {
    const arr = (matrix[r] || []) as any[]
    if (arr.every(v => v == null || v === '')) continue
    const obj: Record<string, any> = {}
    headers.forEach((h, i) => { obj[h] = arr[i] == null ? '' : arr[i] })
    rows.push(obj)
  }
  return { headers, rows }
}

function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

function sum(nums: number[]): number {
  return nums.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
}

// ────────────────────────────────────────────────────────────────────────────
// Report builders
// ────────────────────────────────────────────────────────────────────────────

function reportBoise(): { annualBase: number; annualGrowth: number; topSkus: { sku: string; spend: number }[] } {
  console.log('\n[1/3] BOISE SPEND OUTLOOK — structure check')
  const mf = readSheet(F_BOISE, 'Monthly_Forecast')
  const annualBase = sum(mf.rows.map(r => Number(r['Boise Spend (purchase-timed) – Baseline']) || 0))
  const annualGrowth = sum(mf.rows.map(r => Number(r['Boise Spend (purchase-timed) – Growth']) || 0))
  console.log(`  Monthly_Forecast: ${mf.rows.length} rows, 4 spend-scenario columns`)
  console.log(`  2026 annual Boise spend (purchase-timed): Baseline=${fmtMoney(annualBase)}  Growth=${fmtMoney(annualGrowth)}`)

  const topSkus = readSheet(F_BOISE, 'Top_SKUs').rows.map(r => ({
    sku: String(r['ProductSKU']), name: String(r['ProductName']),
    spend: Number(r['12-mo spend']) || 0,
  }))
  const top3 = topSkus.slice(0, 3)
  console.log(`  Top_SKUs top 3: ${top3.map(s => `${s.sku}=${fmtMoney(s.spend)}`).join(', ')}`)

  const poLines = readSheet(F_BOISE, 'Boise_PO_Lines_12mo').rows
  console.log(`  Boise_PO_Lines_12mo: ${poLines.length} historical PO lines`)

  console.log('  DECISION: No schema home. FinancialSnapshot is daily/unique, has no vendor/scenario dim. SKIP LOAD.')
  return { annualBase, annualGrowth, topSkus }
}

function reportPipeline(): { wonBase: number; wonRunRate: number; pipelineWeighted: number; wonAccounts: number } {
  console.log('\n[2/3] WON WORK + PIPELINE PROJECTION — structure check')
  const won = readSheet(F_PIPE, 'Won_Work_2026').rows
  const wonBase = sum(won.map(r => Number(r['2026 Rev (Base)']) || 0))
  const wonRunRate = sum(won.map(r => Number(r['2026 Rev (Run-rate)']) || 0))
  console.log(`  Won_Work_2026: ${won.length} accounts  | 2026 Base=${fmtMoney(wonBase)}  Run-rate=${fmtMoney(wonRunRate)}`)

  const pipe = readSheet(F_PIPE, 'Pipeline_Upside').rows
  const pipelineWeighted = sum(pipe.map(r => Number(r['Expected 2026 (prob-weighted)']) || 0))
  console.log(`  Pipeline_Upside: ${pipe.length} accounts  | prob-weighted 2026 = ${fmtMoney(pipelineWeighted)}`)

  console.log('  DECISION: FinancialSnapshot has no account/scenario dim. Monthly_Forecast sheet is pivoted (title on row 0). SKIP LOAD.')
  return { wonBase, wonRunRate, pipelineWeighted, wonAccounts: won.length }
}

function reportEbitda(): { reportedNI: number; reportedRev: number; adjustments: { candidate: string; amount: number; useNow: string }[] } {
  console.log('\n[3/3] LEGAL-ADJUSTED EBITDA PACKAGE — structure check')
  const readme = readSheet(F_EBITDA, 'Read_Me').rows
  const rep = readSheet(F_EBITDA, 'Reported_Summary').rows
  const revRow = rep.find(r => String(r['Reported 2025 Summary and EBITDA']).includes('revenue / total income'))
  const reportedRev = revRow ? Number(revRow['col_13']) || 0 : 0
  const niRow = readme.find(r => String(r['AMP 2025 Legal Adjusted EBITDA Pack']).includes('Reported FY2025 net income'))
  const reportedNI = niRow ? Number(niRow['col_1']) || 0 : 0
  console.log(`  Reported FY2025: revenue=${fmtMoney(reportedRev)}  net income=${fmtMoney(reportedNI)}`)

  const sup = readSheet(F_EBITDA, 'Support_Candidates').rows
  const adjustments = sup
    .filter(r => Number(r['col_0']) || Number(r['col_1']))
    .slice(0, 10)
    .map(r => ({
      candidate: String(r['Adjustment Support Register'] || '').slice(0, 120),
      amount: Number(r['col_1']) || 0,
      useNow: String(r['col_4'] || ''),
    }))
    .filter(a => a.candidate && a.amount)

  console.log(`  Support_Candidates: ${adjustments.length} quantified candidates`)
  for (const a of adjustments.slice(0, 5)) {
    console.log(`    - ${a.candidate} : ${fmtMoney(a.amount)}  (use now? ${a.useNow || '—'})`)
  }

  console.log('  DECISION: Narrative/support workbook. Create ONE InboxItem summarising action list.')
  return { reportedNI, reportedRev, adjustments }
}

// ────────────────────────────────────────────────────────────────────────────
// Loader
// ────────────────────────────────────────────────────────────────────────────

async function upsertEbitdaInboxItem(prisma: PrismaClient, data: ReturnType<typeof reportEbitda>) {
  const title = 'Hancock Whitney line renewal — EBITDA bridge package ready for review'
  const adjLines = data.adjustments.slice(0, 8)
    .map(a => `  - ${a.candidate}: ${fmtMoney(a.amount)} (use now? ${a.useNow || 'TBD'})`)
    .join('\n')
  const description = [
    'AMP 2025 Legal Adjusted EBITDA Pack — workbook summary.',
    '',
    `Reported FY2025: revenue=${fmtMoney(data.reportedRev)}, net income=${fmtMoney(data.reportedNI)}.`,
    '',
    'Top quantified adjustment candidates (Support_Candidates sheet):',
    adjLines,
    '',
    'Source file: AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx',
    'Use: Hancock Whitney line renewal pitch. Column C of EBITDA_Bridge is bank-safe only after support is assembled; Column D is internal upside only.',
  ].join('\n')

  const totalAdj = sum(data.adjustments.map(a => a.amount))

  if (DRY_RUN) {
    console.log('\n[DRY-RUN] Would upsert InboxItem:')
    console.log(`  source=${SOURCE_EBITDA}`)
    console.log(`  title=${title}`)
    console.log(`  priority=HIGH  financialImpact=${fmtMoney(totalAdj)}`)
    console.log(`  description preview: ${description.split('\n').slice(0, 5).join(' | ')}`)
    return
  }

  // Idempotent upsert keyed on (source, entityType='AMP_EBITDA_PACK_V2').
  // Using raw SQL because Prisma client expects columns (brainAcknowledgedAt)
  // that exist in schema.prisma but not yet in the DB — schema drift that is
  // owned by another workstream. Raw SQL writes only the columns the DB has.
  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT id FROM "InboxItem" WHERE source=$1 AND "entityType"=$2 LIMIT 1`,
    SOURCE_EBITDA, 'AMP_EBITDA_PACK_V2'
  )
  if (existing.length > 0) {
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem" SET title=$1, description=$2, priority=$3, "financialImpact"=$4, "updatedAt"=NOW() WHERE id=$5`,
      title, description, 'HIGH', totalAdj, existing[0].id
    )
    console.log(`[COMMIT] Updated existing InboxItem id=${existing[0].id}`)
  } else {
    const id = 'cuid_amp_ebitda_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem"
         (id, type, source, title, description, priority, status, "entityType", "entityId", "financialImpact", "createdAt", "updatedAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW())`,
      id, 'SYSTEM', SOURCE_EBITDA, title, description, 'HIGH', 'PENDING',
      'AMP_EBITDA_PACK_V2', 'AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx', totalAdj
    )
    console.log(`[COMMIT] Created InboxItem id=${id}`)
  }
}

// ────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`=== AMP Financials ETL (${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}) ===`)
  for (const f of [F_BOISE, F_PIPE, F_EBITDA]) {
    if (!fs.existsSync(f)) throw new Error(`Missing source file: ${f}`)
  }

  reportBoise()
  reportPipeline()
  const eb = reportEbitda()

  const prisma = new PrismaClient()
  try {
    await upsertEbitdaInboxItem(prisma, eb)
  } finally {
    await prisma.$disconnect()
  }

  console.log('\n=== Plan summary ===')
  console.log('  Boise Spend Outlook   : REPORTED, NOT LOADED (no compatible table in schema)')
  console.log('  Won Work + Pipeline   : REPORTED, NOT LOADED (no compatible table in schema)')
  console.log('  Legal EBITDA Package  : 1 InboxItem ' + (DRY_RUN ? '(dry-run, not written)' : '(written)'))
  if (DRY_RUN) console.log('\nRe-run with --commit to apply.')
}

main().catch((e) => { console.error(e); process.exit(1) })
