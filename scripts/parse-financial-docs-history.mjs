#!/usr/bin/env node
/**
 * scripts/parse-financial-docs-history.mjs
 *
 * Parse Abel's historical financial workbooks in `../Abel Financial Docs/`
 * and populate the FinancialSnapshot table so the exec trend dashboard at
 * `/ops/finance` can show real multi-period history (powers the Hancock
 * Whitney pitch deck).
 *
 * Source files (parent workspace, `Abel Financial Docs/`):
 *   - 2024.04.30 Abel Financials.xlsx   ->  FY2022-12-31, FY2023-12-31,
 *                                          YTD 2024-04-30 snapshots
 *                                          (P&L + Balance Sheet, 3 periods)
 *   - Liabilities - 3-31-26.xlsx        ->  Total-liabilities rollup as of
 *                                          2026-03-31 (patch onto existing
 *                                          snapshot or create a lean snap)
 *   - AP 4-3-26.xlsx                    ->  AP grand total as of 2026-04-03
 *                                          (AR/credit-hold files are a
 *                                          sibling agent's scope — DON'T
 *                                          touch AR-aging here.)
 *   - P&L - 2025 (by month) (1).xlsx    ->  SKIPPED (password-protected)
 *   - 2025.04.30 YTD Itemized SG&A      ->  SKIPPED (transaction-level, too
 *                                          granular for a month-end snap)
 *   - All 37 PDFs                       ->  SKIPPED (unstructured — pointers
 *                                          already cataloged by
 *                                          etl-financial-docs.ts)
 *
 * ---------------------------------------------------------------------------
 * The FinancialSnapshot schema only has these flat numeric columns (see
 * prisma/schema.prisma model FinancialSnapshot):
 *    cashOnHand, arTotal, apTotal, netCashPosition,
 *    arCurrent, ar30, ar60, ar90Plus,
 *    dso, dpo, currentRatio,
 *    revenueMonth, revenuePrior, revenueYTD,
 *    openPOTotal, pendingInvoices, overdueARPct, topExposure
 *
 * It lacks a COGS / grossProfit / operatingExpenses / netIncome / liabilities
 * set. Per the task envelope: "If FinancialSnapshot needs additional columns,
 * use ALTER TABLE IF NOT EXISTS" — so this script adds (idempotently):
 *    cogs              double precision
 *    grossProfit       double precision
 *    operatingExpenses double precision
 *    netIncome         double precision
 *    liabilities       double precision
 *    notes             text           (source/vintage stamp per snapshot)
 *
 * Dry-run by default. Pass --commit to apply.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import XLSX from 'xlsx'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')
const FIN_FOLDER = join(PROJECT_ROOT, '..', 'Abel Financial Docs')

const DRY_RUN = !process.argv.includes('--commit')
const NOW_ISO = new Date().toISOString()

const dbUrl = readFileSync(join(PROJECT_ROOT, '.env'), 'utf-8').match(
  /DATABASE_URL="([^"]+)"/,
)?.[1]
if (!dbUrl) {
  console.error('No DATABASE_URL in .env')
  process.exit(1)
}
const { neon } = await import('@neondatabase/serverless')
const sql = neon(dbUrl)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function bar(title) {
  console.log('\n' + '='.repeat(78))
  console.log('  ' + title)
  console.log('='.repeat(78))
}

function num(v) {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-')
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

function matrixFromSheet(wb, sheetName) {
  const ws = wb.Sheets[sheetName]
  if (!ws) throw new Error(`Sheet not found: ${sheetName}`)
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true })
}

function findRow(matrix, label, startCol = 0) {
  return matrix.find(
    r =>
      Array.isArray(r) &&
      typeof r[startCol] === 'string' &&
      r[startCol].trim() === label,
  )
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

/**
 * Parse 2024.04.30 Abel Financials.xlsx — 3 snapshots:
 *   col 1: YTD 4/30/2024, col 2: FY 2023 year-end, col 3: FY 2022 year-end.
 * Balance Sheet header row (index 4) has actual Date objects in those cols:
 *   2024-04-30, 2023-12-31, 2022-12-31.
 *
 * Returns an array of SnapshotInput objects.
 */
function parse2024_04_30_Financials() {
  const fpath = join(FIN_FOLDER, '2024.04.30 Abel Financials.xlsx')
  if (!existsSync(fpath)) {
    console.warn(`  MISSING: ${fpath}`)
    return []
  }
  const wb = XLSX.readFile(fpath, { cellDates: true })
  const pl = matrixFromSheet(wb, 'Profit and Loss')
  const bs = matrixFromSheet(wb, 'Balance Sheet')

  // -- Profit & Loss rows (col 0 label, cols 1..3 period values) ---------
  const income = findRow(pl, 'Income') || []
  const cogs = findRow(pl, 'Cost of Goods Sold') || []
  const gp = findRow(pl, 'Gross Profit') || []
  const totalExp = findRow(pl, 'Total Expenses') || []
  const netIncome = findRow(pl, 'Net Income') || []

  // -- Balance Sheet rows (labels are indented with leading spaces; findRow trims) --
  const totBank = findRow(bs, 'Total Bank Accounts') || []
  const totAR = findRow(bs, 'Total Accounts Receivable') || []
  const totAP = findRow(bs, 'Total Accounts Payable') || []
  const totLiab = findRow(bs, 'Total Liabilities') || []

  // BS header row (row 4 in this workbook) has the actual Date objects.
  const bsHdr = bs[4] || []

  // The 3 periods: col 1 = latest (YTD 4/30/24), col 2 = FY2023, col 3 = FY2022.
  // Map date -> (revenue, cogs, gp, netIncome, ...).
  const periods = [
    {
      label: 'YTD 2024-04-30',
      col: 1,
      snapshotDate: bsHdr[1] instanceof Date ? bsHdr[1] : new Date('2024-04-30'),
      isYTD: true,
    },
    {
      label: 'FY 2023 year-end',
      col: 2,
      snapshotDate: bsHdr[2] instanceof Date ? bsHdr[2] : new Date('2023-12-31'),
      isYTD: false,
    },
    {
      label: 'FY 2022 year-end',
      col: 3,
      snapshotDate: bsHdr[3] instanceof Date ? bsHdr[3] : new Date('2022-12-31'),
      isYTD: false,
    },
  ]

  const out = []
  for (const p of periods) {
    const revenue = num(income[p.col])
    const cogsVal = num(cogs[p.col])
    const grossProfit = num(gp[p.col])
    const opEx = num(totalExp[p.col])
    const ni = num(netIncome[p.col])
    const cash = num(totBank[p.col])
    const ar = num(totAR[p.col])
    const ap = num(totAP[p.col])
    const liab = num(totLiab[p.col])

    out.push({
      snapshotDate: p.snapshotDate,
      cashOnHand: cash,
      arTotal: ar,
      apTotal: ap,
      netCashPosition: cash - ap,
      revenueMonth: p.isYTD ? 0 : revenue, // FY columns are full-year, not month
      revenueYTD: revenue, // YTD column IS ytd-thru; FY columns are the whole year (also YTD at year-end)
      cogs: cogsVal,
      grossProfit,
      operatingExpenses: opEx,
      netIncome: ni,
      liabilities: liab,
      notes: `Source: 2024.04.30 Abel Financials.xlsx, period "${p.label}" (QuickBooks rollup).`,
    })
  }
  return out
}

/**
 * Parse Liabilities - 3-31-26.xlsx. The sheet has a deeply-indented layout
 * where leaf amounts sit in col 6; grand totals are the last two numeric
 * entries. We use the larger grand total (includes LOC line) as liabilities.
 */
function parseLiabilities_3_31_26() {
  const fpath = join(FIN_FOLDER, 'Liabilities - 3-31-26.xlsx')
  if (!existsSync(fpath)) {
    console.warn(`  MISSING: ${fpath}`)
    return []
  }
  const wb = XLSX.readFile(fpath, { cellDates: true })
  const m = matrixFromSheet(wb, 'Sheet1')

  let accountsPayable = null
  for (const row of m) {
    if (!Array.isArray(row)) continue
    if (row[4] === 'Accounts Payable' && typeof row[6] === 'number') {
      accountsPayable = row[6]
    }
  }

  const numericTail = []
  for (const row of m) {
    if (Array.isArray(row) && typeof row[6] === 'number') numericTail.push(row[6])
  }
  const grandTotalWithLOC =
    numericTail.length >= 2 ? numericTail[numericTail.length - 2] : 0
  // const grandTotalExclAP = numericTail.length >= 1 ? numericTail[numericTail.length - 1] : 0

  return [
    {
      snapshotDate: new Date('2026-03-31'),
      cashOnHand: 0,
      arTotal: 0,
      apTotal: num(accountsPayable),
      netCashPosition: -num(accountsPayable),
      revenueMonth: 0,
      revenueYTD: 0,
      cogs: 0,
      grossProfit: 0,
      operatingExpenses: 0,
      netIncome: 0,
      liabilities: num(grandTotalWithLOC),
      notes:
        `Source: Liabilities - 3-31-26.xlsx (liabilities rollup only — no P&L or cash data for this period). ` +
        `AP=$${Math.round(num(accountsPayable)).toLocaleString()}, ` +
        `grand total incl LOC=$${Math.round(num(grandTotalWithLOC)).toLocaleString()}.`,
    },
  ]
}

/**
 * Parse AP 4-3-26.xlsx — Summary sheet grand-total cell.
 * Summary row structure:
 *   col 0: vendor row labels
 *   cols 1..5: aging buckets (Current / 1-30 / 31-60 / 61-90 / >90)
 *   col 6: Grand Total
 * The last numeric row is the "Grand Total" row.
 */
function parseAP_4_3_26() {
  const fpath = join(FIN_FOLDER, 'AP 4-3-26.xlsx')
  if (!existsSync(fpath)) {
    console.warn(`  MISSING: ${fpath}`)
    return []
  }
  const wb = XLSX.readFile(fpath, { cellDates: true })
  const m = matrixFromSheet(wb, 'Summary')
  // Scan the Grand Total column (col 6) for the "Grand Total" row.
  let grandTotal = 0
  for (const row of m) {
    if (!Array.isArray(row)) continue
    if (typeof row[0] === 'string' && /grand total/i.test(row[0])) {
      grandTotal = num(row[6])
    }
  }
  // Fallback: sum of all numeric col 6 values minus the vendor rows
  if (!grandTotal) {
    // header row is at index 1; vendor rows from 2..n-1; last row at n may be the grand total
    for (let i = m.length - 1; i >= 0; i--) {
      const row = m[i]
      if (Array.isArray(row) && typeof row[6] === 'number' && typeof row[0] === 'string') {
        grandTotal = row[6]
        break
      }
    }
  }
  return [
    {
      snapshotDate: new Date('2026-04-03'),
      cashOnHand: 0,
      arTotal: 0,
      apTotal: num(grandTotal),
      netCashPosition: -num(grandTotal),
      revenueMonth: 0,
      revenueYTD: 0,
      cogs: 0,
      grossProfit: 0,
      operatingExpenses: 0,
      netIncome: 0,
      liabilities: 0,
      notes:
        `Source: AP 4-3-26.xlsx Summary sheet. AP grand total $${Math.round(num(grandTotal)).toLocaleString()}. ` +
        `(AR + credit-hold parsing is handled by a sibling agent — this snapshot is AP-only.)`,
    },
  ]
}

// ---------------------------------------------------------------------------
// Idempotent upsert (by snapshotDate — which has a unique index)
// ---------------------------------------------------------------------------

async function ensureColumns() {
  // Columns FinancialSnapshot lacks today. Use ALTER TABLE ADD COLUMN IF NOT
  // EXISTS so this stays idempotent across re-runs.
  const statements = [
    `ALTER TABLE "FinancialSnapshot" ADD COLUMN IF NOT EXISTS "cogs" double precision NOT NULL DEFAULT 0`,
    `ALTER TABLE "FinancialSnapshot" ADD COLUMN IF NOT EXISTS "grossProfit" double precision NOT NULL DEFAULT 0`,
    `ALTER TABLE "FinancialSnapshot" ADD COLUMN IF NOT EXISTS "operatingExpenses" double precision NOT NULL DEFAULT 0`,
    `ALTER TABLE "FinancialSnapshot" ADD COLUMN IF NOT EXISTS "netIncome" double precision NOT NULL DEFAULT 0`,
    `ALTER TABLE "FinancialSnapshot" ADD COLUMN IF NOT EXISTS "liabilities" double precision NOT NULL DEFAULT 0`,
    `ALTER TABLE "FinancialSnapshot" ADD COLUMN IF NOT EXISTS "notes" text`,
  ]
  if (DRY_RUN) {
    console.log('\n[DRY-RUN] would run ALTER TABLE IF NOT EXISTS for cogs/grossProfit/operatingExpenses/netIncome/liabilities/notes')
    return
  }
  for (const s of statements) {
    await sql.query(s)
  }
  console.log('  schema: ensured columns cogs/grossProfit/operatingExpenses/netIncome/liabilities/notes')
}

function isoDate(d) {
  return d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10)
}

async function upsertSnapshot(s) {
  const d = s.snapshotDate
  // Check for existing row on the SAME snapshotDate (unique index).
  const existing = await sql`
    SELECT id, "arTotal", "apTotal", "cashOnHand", liabilities, "revenueYTD"
    FROM "FinancialSnapshot"
    WHERE "snapshotDate" = ${d}
    LIMIT 1
  `
  if (existing.length > 0) {
    // Update — but MERGE, not overwrite. If the existing row has a non-zero
    // value and we bring a zero (e.g. the AP-only snapshot for 2026-04-03
    // has no cash/AR), keep the existing non-zero value. This preserves the
    // current baseline snapshot at 2026-04-23 that already has AR=$81K.
    const e = existing[0]
    const mergedAR = s.arTotal || e.arTotal || 0
    const mergedAP = s.apTotal || e.apTotal || 0
    const mergedCash = s.cashOnHand || e.cashOnHand || 0
    const mergedLiab = s.liabilities || e.liabilities || 0
    await sql`
      UPDATE "FinancialSnapshot"
      SET
        "cashOnHand" = ${mergedCash},
        "arTotal" = ${mergedAR},
        "apTotal" = ${mergedAP},
        "netCashPosition" = ${mergedCash - mergedAP},
        "revenueMonth" = ${s.revenueMonth},
        "revenueYTD" = ${s.revenueYTD},
        "cogs" = ${s.cogs},
        "grossProfit" = ${s.grossProfit},
        "operatingExpenses" = ${s.operatingExpenses},
        "netIncome" = ${s.netIncome},
        "liabilities" = ${mergedLiab},
        "notes" = ${s.notes}
      WHERE id = ${e.id}
    `
    return { action: 'updated', id: e.id }
  }

  // Insert new row. Use a deterministic id so re-running is stable.
  const id = `fs_hist_${isoDate(d).replace(/-/g, '')}`
  await sql`
    INSERT INTO "FinancialSnapshot" (
      id, "snapshotDate",
      "cashOnHand", "arTotal", "apTotal", "netCashPosition",
      "arCurrent", "ar30", "ar60", "ar90Plus",
      dso, dpo, "currentRatio",
      "revenueMonth", "revenuePrior", "revenueYTD",
      "openPOTotal", "pendingInvoices", "overdueARPct",
      "cogs", "grossProfit", "operatingExpenses", "netIncome",
      liabilities, notes,
      "createdAt"
    ) VALUES (
      ${id}, ${d},
      ${s.cashOnHand}, ${s.arTotal}, ${s.apTotal}, ${s.netCashPosition},
      0, 0, 0, 0,
      0, 0, 0,
      ${s.revenueMonth}, 0, ${s.revenueYTD},
      0, 0, 0,
      ${s.cogs}, ${s.grossProfit}, ${s.operatingExpenses}, ${s.netIncome},
      ${s.liabilities}, ${s.notes},
      ${NOW_ISO}
    )
  `
  return { action: 'created', id }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  bar(`parse-financial-docs-history  (DRY_RUN=${DRY_RUN})`)
  console.log('  folder:', FIN_FOLDER)

  if (!existsSync(FIN_FOLDER)) {
    console.error(`ERROR: financial docs folder not found at ${FIN_FOLDER}`)
    process.exit(1)
  }

  await ensureColumns()

  // -- Per-file parse, with counts ------------------------------------------
  const plan = []

  bar('File 1: 2024.04.30 Abel Financials.xlsx  (P&L + Balance Sheet, 3 periods)')
  const a = parse2024_04_30_Financials()
  a.forEach(s => plan.push({ src: '2024.04.30 Abel Financials.xlsx', snap: s }))
  for (const s of a) {
    console.log(
      `  ${isoDate(s.snapshotDate)}  rev=$${Math.round(s.revenueYTD).toLocaleString()}  ` +
      `cogs=$${Math.round(s.cogs).toLocaleString()}  gp=$${Math.round(s.grossProfit).toLocaleString()}  ` +
      `ni=$${Math.round(s.netIncome).toLocaleString()}  cash=$${Math.round(s.cashOnHand).toLocaleString()}  ` +
      `AR=$${Math.round(s.arTotal).toLocaleString()}  AP=$${Math.round(s.apTotal).toLocaleString()}  ` +
      `liab=$${Math.round(s.liabilities).toLocaleString()}`,
    )
  }

  bar('File 2: Liabilities - 3-31-26.xlsx  (liabilities rollup as of 2026-03-31)')
  const b = parseLiabilities_3_31_26()
  b.forEach(s => plan.push({ src: 'Liabilities - 3-31-26.xlsx', snap: s }))
  for (const s of b) {
    console.log(
      `  ${isoDate(s.snapshotDate)}  AP=$${Math.round(s.apTotal).toLocaleString()}  ` +
      `liab=$${Math.round(s.liabilities).toLocaleString()}`,
    )
  }

  bar('File 3: AP 4-3-26.xlsx  (AP grand total as of 2026-04-03)')
  const c = parseAP_4_3_26()
  c.forEach(s => plan.push({ src: 'AP 4-3-26.xlsx', snap: s }))
  for (const s of c) {
    console.log(`  ${isoDate(s.snapshotDate)}  AP=$${Math.round(s.apTotal).toLocaleString()}`)
  }

  bar('Skipped files (documented intent, not a bug)')
  console.log('  P&L - 2025 (by month) (1).xlsx  — password-protected (flagged)')
  console.log('  2025.04.30 YTD Itemized SG&A Expenses.xlsx  — transaction-level, not a month snap')
  console.log('  Due to Agritec - 4-3-26.xlsx  — intercompany ledger, not P&L or BS data')
  console.log('  37 PDFs (HW/FBTX bank statements, CPA P&Ls, model decks)  — unstructured')

  // -- Persist --------------------------------------------------------------
  bar(`Writing snapshots (${plan.length} prepared)`)
  if (DRY_RUN) {
    console.log('  [DRY-RUN] skipping writes. Re-run with --commit to apply.')
    return
  }

  let created = 0
  let updated = 0
  for (const { src, snap } of plan) {
    const res = await upsertSnapshot(snap)
    console.log(
      `  ${res.action === 'created' ? '+' : '*'} ${isoDate(snap.snapshotDate)}  ` +
      `(${res.action}, id=${res.id}, src=${src})`,
    )
    if (res.action === 'created') created++
    else updated++
  }

  // -- Summary --------------------------------------------------------------
  bar('Summary')
  const all = await sql`
    SELECT "snapshotDate", "revenueYTD", "grossProfit", "netIncome", "arTotal", "apTotal", liabilities, "cashOnHand"
    FROM "FinancialSnapshot"
    ORDER BY "snapshotDate" ASC
  `
  console.log(`  FinancialSnapshot rows in DB: ${all.length}`)
  console.log(`  created: ${created}  updated: ${updated}`)
  console.log('')
  console.log('  date        rev(YTD)      gp         ni          cash       AR         AP         liab')
  for (const r of all) {
    const fmt = v => `$${Math.round(v ?? 0).toLocaleString().padStart(10)}`
    console.log(
      `  ${isoDate(r.snapshotDate)}  ${fmt(r.revenueYTD)}  ${fmt(r.grossProfit)}  ${fmt(r.netIncome)}  ${fmt(r.cashOnHand)}  ${fmt(r.arTotal)}  ${fmt(r.apTotal)}  ${fmt(r.liabilities)}`,
    )
  }
}

main().catch(err => {
  console.error('\nFAILED:', err)
  process.exit(1)
})
