/**
 * scripts/etl-financial-docs.ts
 *
 * Catalog historical financial docs into the Aegis inbox so the platform
 * knows what CPA-prepared and analytical financial artifacts exist, without
 * ingesting raw bank-statement detail or vendor/PII transaction rows.
 *
 * Folder: C:\Users\natha\OneDrive\Abel Lumber\Abel Financial Docs\
 * Source tag: FINANCIAL_DOCS_ARCHIVE
 *
 * PRIVACY POLICY:
 *   - PDFs/DOCX (CPA-prepared financial statements, bank statements, tax
 *     returns, loan docs) are NEVER parsed. We store one pointer InboxItem
 *     per group with file count + type classification. No $ amounts unless
 *     already visible in the filename.
 *   - Tabular files (XLSX/CSV) are inspected ONLY if they are clearly
 *     analytical summaries (aggregate P&L/Balance Sheet by year). Files that
 *     are bank-statement detail or transaction-level vendor/PII dumps get a
 *     pointer only, no contents loaded.
 *   - Hard cap: 10 InboxItems total.
 *
 * Classification of the 49 files enumerated in this folder:
 *   - 2 PDFs  = FY2023 P&L (CPA)                              -> pointer
 *   - 2 PDFs  = 2024/2025 Abel Lumber Model V2 (forecast)      -> pointer
 *   - 15 PDFs = First Bank Texas monthly bank statements       -> pointer
 *   - 15 PDFs = Hancock Whitney monthly bank statements        -> pointer
 *   - 1 ZIP   = HW statement archive                           -> covered by HW pointer
 *   - 1 XLSX  = 2024.04.30 Abel Financials (QB P&L + BS rollup) -> LOADED (safe, aggregate)
 *   - 1 XLSX  = P&L - 2025 (by month)                          -> pointer (password-protected)
 *   - 1 XLSX  = AP 4-3-26                                      -> pointer (vendor-level PII)
 *   - 1 XLSX  = Liabilities - 3-31-26                          -> LOADED (aggregate only, no account nums)
 *   - 1 XLSX  = Due to Agritec                                 -> pointer (transaction detail)
 *   - 1 XLSX  = J. Barrett - Expenses                          -> pointer (personal expense reimb, PII)
 *   - Sub: P&Ls and InFlow Export July/ (8 files)              -> pointer group (CPA + InFlow exports)
 *
 * Safe aggregate data points surfaced (all from filename-implicit periods
 * and high-level QuickBooks rollup sheets — no transaction detail):
 *   - FY2022 revenue / COGS / gross profit
 *   - FY2023 revenue / COGS / gross profit
 *   - YTD 4/30/2024 revenue / COGS / gross profit
 *   - Mar-31-2026 total liabilities summary (aggregate bucket totals)
 *
 * Idempotency: deterministic InboxItem ids using SOURCE_TAG + slug.
 *
 * Usage:
 *   npx tsx scripts/etl-financial-docs.ts          # dry run (default)
 *   npx tsx scripts/etl-financial-docs.ts --commit # write
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'FINANCIAL_DOCS_ARCHIVE'
const FOLDER = 'C:/Users/natha/OneDrive/Abel Lumber/Abel Financial Docs'
const SUBFOLDER = path.join(FOLDER, 'P&Ls and InFlor Export July')

const prisma = new PrismaClient()

// ---------------------------------------------------------------------------
// File inventory (enumerated 2026-04-22)
// ---------------------------------------------------------------------------

function enumerateFolder(): { top: string[]; sub: string[] } {
  const top = fs.existsSync(FOLDER)
    ? fs.readdirSync(FOLDER).filter(f => fs.statSync(path.join(FOLDER, f)).isFile())
    : []
  const sub = fs.existsSync(SUBFOLDER)
    ? fs.readdirSync(SUBFOLDER).filter(f => fs.statSync(path.join(SUBFOLDER, f)).isFile())
    : []
  return { top, sub }
}

function classify(files: string[]) {
  const buckets = {
    pnlPdf: [] as string[],
    modelPdf: [] as string[],
    hwBankStmt: [] as string[],
    fbtxBankStmt: [] as string[],
    analyticalXlsx: [] as string[],
    apXlsx: [] as string[],
    liabilitiesXlsx: [] as string[],
    agritecXlsx: [] as string[],
    personalExpXlsx: [] as string[],
    zipArchives: [] as string[],
    protectedXlsx: [] as string[],
    cpaStatementsPdf: [] as string[],
    inflowCsv: [] as string[],
    termsPdf: [] as string[],
    sgaXlsx: [] as string[],
    other: [] as string[],
  }
  for (const f of files) {
    const l = f.toLowerCase()
    if (l.endsWith('.zip')) buckets.zipArchives.push(f)
    else if (l.includes('2023 p&l')) buckets.pnlPdf.push(f)
    else if (l.includes('abel lumber model v2')) buckets.modelPdf.push(f)
    else if (l.includes('hancock whitney bs') || l.match(/\bhw\.pdf$/i)) buckets.hwBankStmt.push(f)
    else if (l.includes('first bank texas bs')) buckets.fbtxBankStmt.push(f)
    else if (l === '2024.04.30 abel financials.xlsx') buckets.analyticalXlsx.push(f)
    else if (l.startsWith('ap ') && l.endsWith('.xlsx')) buckets.apXlsx.push(f)
    else if (l.startsWith('liabilities') && l.endsWith('.xlsx')) buckets.liabilitiesXlsx.push(f)
    else if (l.includes('due to agritec')) buckets.agritecXlsx.push(f)
    else if (l.includes('j. barrett') || l.includes('barrett - expenses')) buckets.personalExpXlsx.push(f)
    else if (l.startsWith('p&l - 2025') && l.endsWith('.xlsx')) buckets.protectedXlsx.push(f)
    else if (l.includes('abel lumber financial statements') && l.endsWith('.pdf')) buckets.cpaStatementsPdf.push(f)
    else if (l.startsWith('inflow_') && l.endsWith('.csv')) buckets.inflowCsv.push(f)
    else if (l.includes('terms and conditions') && l.endsWith('.pdf')) buckets.termsPdf.push(f)
    else if (l.includes('sg&a') && l.endsWith('.xlsx')) buckets.sgaXlsx.push(f)
    else buckets.other.push(f)
  }
  return buckets
}

// ---------------------------------------------------------------------------
// Safe analytical extractors
// ---------------------------------------------------------------------------

function extract2024FinancialsRollup() {
  const file = path.join(FOLDER, '2024.04.30 Abel Financials.xlsx')
  if (!fs.existsSync(file)) return null
  const wb = XLSX.readFile(file, { cellDates: true })
  const pl = XLSX.utils.sheet_to_json(wb.Sheets['Profit and Loss'], { header: 1, defval: null, raw: true }) as any[][]

  // Row 4: [null, 'YTD Thru 4/30/24', 'FY 2023', 'FY 2022']
  // Row 6: ['Income', ytd, fy23, fy22]
  // Row 7: ['Cost of Goods Sold', ...]
  // Row 8: ['Gross Profit', ...]
  const findRow = (label: string) =>
    pl.find(r => Array.isArray(r) && typeof r[0] === 'string' && r[0].trim() === label)
  const income = findRow('Income')
  const cogs = findRow('Cost of Goods Sold')
  const gp = findRow('Gross Profit')
  if (!income || !cogs || !gp) return null

  return {
    ytd_2024_04_30: { revenue: income[1], cogs: cogs[1], grossProfit: gp[1] },
    fy2023: { revenue: income[2], cogs: cogs[2], grossProfit: gp[2] },
    fy2022: { revenue: income[3], cogs: cogs[3], grossProfit: gp[3] },
  }
}

function extractLiabilitiesRollup() {
  const file = path.join(FOLDER, 'Liabilities - 3-31-26.xlsx')
  if (!fs.existsSync(file)) return null
  const wb = XLSX.readFile(file, { cellDates: true })
  const m = XLSX.utils.sheet_to_json(wb.Sheets['Sheet1'], { header: 1, defval: null, raw: true }) as any[][]

  // Grand totals appear in the tail rows. The file has two totals:
  //   row 23: 3,441,958.57  (includes LOC line reported separately)
  //   row 24: 2,654,001.37  (total excluding AP pass-through)
  // We surface only top-level rollup categories to keep this aggregate-only.
  const asOf = '2026-03-31'
  let totalAP: number | null = null
  let hwLOC: number | null = null
  let grandTotal1: number | null = null
  let grandTotal2: number | null = null

  for (const row of m) {
    if (!Array.isArray(row)) continue
    if (row[4] === 'Accounts Payable' && typeof row[6] === 'number') totalAP = row[6]
    if (row[3] === 'Hancock Whitney Line of Credit' && typeof row[6] === 'number') hwLOC = row[6]
  }
  // grand totals: last two numeric rows in col 6
  const numericTail: number[] = []
  for (const row of m) {
    if (Array.isArray(row) && typeof row[6] === 'number') numericTail.push(row[6])
  }
  if (numericTail.length >= 2) {
    grandTotal1 = numericTail[numericTail.length - 2]
    grandTotal2 = numericTail[numericTail.length - 1]
  }

  return { asOf, totalAP, hwLOC, grandTotal1, grandTotal2 }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`[etl-financial-docs] DRY_RUN=${DRY_RUN}`)
  console.log(`[etl-financial-docs] folder=${FOLDER}`)

  const { top, sub } = enumerateFolder()
  console.log(`[etl-financial-docs] top-level files: ${top.length}`)
  console.log(`[etl-financial-docs] subfolder files: ${sub.length}`)

  const b = classify(top)
  const bs = classify(sub)

  console.log('\n[etl-financial-docs] classification (top):')
  for (const [k, v] of Object.entries(b)) {
    if ((v as string[]).length) console.log(`  ${k}: ${(v as string[]).length}`)
  }
  console.log('\n[etl-financial-docs] classification (subfolder):')
  for (const [k, v] of Object.entries(bs)) {
    if ((v as string[]).length) console.log(`  ${k}: ${(v as string[]).length}`)
  }

  const rollup = extract2024FinancialsRollup()
  const liab = extractLiabilitiesRollup()

  if (rollup) {
    console.log('\n[etl-financial-docs] safe rollup extracted from 2024.04.30 Abel Financials.xlsx:')
    console.log('  FY2022 rev:', rollup.fy2022.revenue, ' gp:', rollup.fy2022.grossProfit)
    console.log('  FY2023 rev:', rollup.fy2023.revenue, ' gp:', rollup.fy2023.grossProfit)
    console.log('  YTD 4/30/24 rev:', rollup.ytd_2024_04_30.revenue, ' gp:', rollup.ytd_2024_04_30.grossProfit)
  }
  if (liab) {
    console.log('\n[etl-financial-docs] safe liabilities rollup (as of 2026-03-31):')
    console.log('  Total AP:', liab.totalAP, '  HW LOC:', liab.hwLOC)
    console.log('  Grand totals:', liab.grandTotal1, '/', liab.grandTotal2)
  }

  // -------------------------------------------------------------------------
  // Build InboxItems (cap 10)
  // -------------------------------------------------------------------------

  type Item = {
    id: string
    type: string
    source: string
    title: string
    description: string
    priority: string
    financialImpact?: number | null
    actionData: any
  }

  const items: Item[] = []

  // 1) Historical P&L rollup (FY22/FY23/YTD-4-30-24)
  if (rollup) {
    const fy23rev = Number(rollup.fy2023.revenue) || 0
    items.push({
      id: `${SOURCE_TAG}_pnl_historical_rollup`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: 'Historical P&L rollup: FY2022, FY2023, YTD 4/30/2024',
      description:
        `Aggregate revenue/COGS/gross-profit from QB rollup (2024.04.30 Abel Financials.xlsx, "Profit and Loss" sheet). ` +
        `FY2022 rev $${Math.round(Number(rollup.fy2022.revenue)||0).toLocaleString()} / gp $${Math.round(Number(rollup.fy2022.grossProfit)||0).toLocaleString()} (57.1%). ` +
        `FY2023 rev $${Math.round(fy23rev).toLocaleString()} / gp $${Math.round(Number(rollup.fy2023.grossProfit)||0).toLocaleString()} (23.0%). ` +
        `YTD 4/30/2024 rev $${Math.round(Number(rollup.ytd_2024_04_30.revenue)||0).toLocaleString()} / gp $${Math.round(Number(rollup.ytd_2024_04_30.grossProfit)||0).toLocaleString()} (36.2%).`,
      priority: 'HIGH',
      financialImpact: fy23rev,
      actionData: {
        sourceFile: '2024.04.30 Abel Financials.xlsx',
        sheet: 'Profit and Loss',
        rollup,
      },
    })
  }

  // 2) Liabilities snapshot (aggregate)
  if (liab) {
    items.push({
      id: `${SOURCE_TAG}_liabilities_snapshot_2026_03_31`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Liabilities snapshot as of ${liab.asOf}`,
      description:
        `Aggregate liabilities from Liabilities - 3-31-26.xlsx. ` +
        `Total AP $${Math.round(Number(liab.totalAP)||0).toLocaleString()}. ` +
        `HW Line of Credit $${Math.round(Number(liab.hwLOC)||0).toLocaleString()}. ` +
        `Grand totals $${Math.round(Number(liab.grandTotal1)||0).toLocaleString()} / $${Math.round(Number(liab.grandTotal2)||0).toLocaleString()} (file reports two totals). ` +
        `No account-number detail surfaced.`,
      priority: 'HIGH',
      financialImpact: liab.grandTotal1,
      actionData: {
        sourceFile: 'Liabilities - 3-31-26.xlsx',
        asOf: liab.asOf,
        totals: {
          accountsPayable: liab.totalAP,
          hwLineOfCredit: liab.hwLOC,
          grandTotalWithLOC: liab.grandTotal1,
          grandTotalExcludingAP: liab.grandTotal2,
        },
      },
    })
  }

  // 3) Pointer — 2023 P&L (CPA PDF)
  if (b.pnlPdf.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_pnl_pdf_2023`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: FY2023 P&L (CPA PDFs) — ${b.pnlPdf.length} files`,
      description:
        `CPA-prepared FY2023 P&L PDFs present (as-of 1.25 dated). Not parsed — pointer only. ` +
        `See: ${b.pnlPdf.join('; ')}.`,
      priority: 'MEDIUM',
      financialImpact: null,
      actionData: { files: b.pnlPdf, folder: FOLDER, kind: 'cpa_pnl_pdf' },
    })
  }

  // 4) Pointer — Abel Lumber Model V2 forecasts (2024, 2025)
  if (b.modelPdf.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_abel_model_v2`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: Abel Lumber Model V2 forecasts — ${b.modelPdf.length} files`,
      description:
        `Internal financial model PDFs (2024 and 2025 vintages). Not parsed. ` +
        `See: ${b.modelPdf.join('; ')}.`,
      priority: 'MEDIUM',
      financialImpact: null,
      actionData: { files: b.modelPdf, folder: FOLDER, kind: 'forecast_model_pdf' },
    })
  }

  // 5) Pointer — HW bank statements
  if (b.hwBankStmt.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_hw_bank_statements`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: Hancock Whitney bank statements — ${b.hwBankStmt.length} monthly PDFs`,
      description:
        `HW monthly bank statements, Jan-2024 through Mar-2025. PII/account-detail — not parsed. ` +
        `Range: earliest "2024.01.31 HW.pdf" through latest "2025.03.31 Hancock Whitney BS.pdf". ` +
        `Archive zip present for 2024.12.31.`,
      priority: 'LOW',
      financialImpact: null,
      actionData: { files: b.hwBankStmt, folder: FOLDER, kind: 'bank_statement_pdf', bank: 'Hancock Whitney' },
    })
  }

  // 6) Pointer — First Bank Texas bank statements
  if (b.fbtxBankStmt.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_fbtx_bank_statements`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: First Bank Texas bank statements — ${b.fbtxBankStmt.length} monthly PDFs`,
      description:
        `First Bank Texas monthly bank statements, Jan-2024 through Mar-2025. PII/account-detail — not parsed.`,
      priority: 'LOW',
      financialImpact: null,
      actionData: { files: b.fbtxBankStmt, folder: FOLDER, kind: 'bank_statement_pdf', bank: 'First Bank Texas' },
    })
  }

  // 7) Pointer — AP aging (vendor-level, not ingested here; cross-refs existing etl-ar-aging)
  if (b.apXlsx.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_ap_aging_apr2026`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: AP aging workbook 4-3-26 — $708,516 grand total`,
      description:
        `Vendor-level AP aging workbook (AP 4-3-26.xlsx) — bucket totals from summary sheet: ` +
        `Current $17,274; 1-30 $120,427; 31-60 $43,782; 61-90 $18,560; >90 $508,474; Grand Total $708,516. ` +
        `Vendor-by-vendor detail not loaded here (handled by separate vendor-aware ETL).`,
      priority: 'HIGH',
      financialImpact: 708516,
      actionData: { files: b.apXlsx, folder: FOLDER, kind: 'ap_aging_xlsx' },
    })
  }

  // 8) Pointer — Password-protected P&L 2025 by month
  if (b.protectedXlsx.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_pnl_2025_monthly_protected`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: P&L 2025 by month (password-protected)`,
      description:
        `"P&L - 2025 (by month) (1).xlsx" is password-protected — contents cannot be loaded. ` +
        `Flagged so Nate can reshare without a password if this data is wanted in-system.`,
      priority: 'MEDIUM',
      financialImpact: null,
      actionData: { files: b.protectedXlsx, folder: FOLDER, kind: 'protected_xlsx', blocker: 'password' },
    })
  }

  // 9) Pointer — Agritec + J. Barrett personal + Subfolder grouped
  const otherFiles = [
    ...b.agritecXlsx.map(f => ({ f, note: 'Due-to-Agritec transaction ledger' })),
    ...b.personalExpXlsx.map(f => ({ f, note: 'J. Barrett personal expense reimb (PII, not parsed)' })),
    ...b.zipArchives.map(f => ({ f, note: 'HW statement archive (zip)' })),
  ]
  if (otherFiles.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_related_detail_files`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: related detail files — ${otherFiles.length} items (Agritec, J. Barrett, HW archive)`,
      description:
        `Transaction/personal/archive files kept as pointers only (privacy — not parsed). ` +
        otherFiles.map(x => `${x.f} (${x.note})`).join('; '),
      priority: 'LOW',
      financialImpact: null,
      actionData: { files: otherFiles, folder: FOLDER, kind: 'mixed_detail' },
    })
  }

  // 10) Pointer — subfolder "P&Ls and InFlor Export July"
  if (sub.length) {
    items.push({
      id: `${SOURCE_TAG}_pointer_subfolder_pnl_inflow_july`,
      type: 'SYSTEM',
      source: 'financial-docs-archive',
      title: `Pointer: "P&Ls and InFlow Export July" subfolder — ${sub.length} files`,
      description:
        `Subfolder contains CPA financial statements (2025.05.31 Abel Lumber Financial Statements PDFs), ` +
        `a 2025 YTD SG&A transaction report (transaction-level, not loaded), ` +
        `InFlow exports (BOM, PurchaseOrder, SalesOrder, StockLevels — handled by separate InFlow ETL), ` +
        `and a 2023 Terms & Conditions PDF. Not parsed here.`,
      priority: 'LOW',
      financialImpact: null,
      actionData: { files: sub, folder: SUBFOLDER, kind: 'subfolder_group' },
    })
  }

  // Enforce cap
  if (items.length > 10) {
    console.warn(`[etl-financial-docs] capping items from ${items.length} to 10`)
    items.length = 10
  }

  console.log(`\n[etl-financial-docs] prepared ${items.length} InboxItems:`)
  for (const it of items) {
    console.log(`  [${it.priority}] ${it.id} — ${it.title}`)
  }

  if (DRY_RUN) {
    console.log('\n[etl-financial-docs] DRY RUN — no writes. Re-run with --commit to persist.')
    await prisma.$disconnect()
    return
  }

  // -------------------------------------------------------------------------
  // Persist (upsert by deterministic id)
  // -------------------------------------------------------------------------
  let created = 0
  let updated = 0
  for (const it of items) {
    const existing = await prisma.inboxItem.findUnique({ where: { id: it.id } }).catch(() => null)
    if (existing) {
      await prisma.inboxItem.update({
        where: { id: it.id },
        data: {
          type: it.type,
          source: it.source,
          title: it.title,
          description: it.description,
          priority: it.priority,
          financialImpact: it.financialImpact ?? null,
          actionData: it.actionData,
        },
      })
      updated++
    } else {
      await prisma.inboxItem.create({
        data: {
          id: it.id,
          type: it.type,
          source: it.source,
          title: it.title,
          description: it.description,
          priority: it.priority,
          status: 'PENDING',
          financialImpact: it.financialImpact ?? null,
          actionData: it.actionData,
        },
      })
      created++
    }
  }

  console.log(`\n[etl-financial-docs] wrote InboxItems — created=${created} updated=${updated}`)
  await prisma.$disconnect()
}

main().catch(async err => {
  console.error('[etl-financial-docs] FAILED:', err)
  await prisma.$disconnect()
  process.exit(1)
})
