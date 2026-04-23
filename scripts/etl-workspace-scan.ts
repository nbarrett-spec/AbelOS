/**
 * scripts/etl-workspace-scan.ts
 *
 * Final sweep of workspace root xlsx/csv files that had not been loaded by
 * prior ETL passes. Inspected sheets/columns and classified each file:
 *
 *   - Raw catalog / transactional data  -> SKIP (NUC session owns Builder,
 *     Product, InventoryItem, Vendor writes — forbidden here).
 *   - Actionable list                   -> load as InboxItem with per-row
 *     action pointers or a single summary item if rows are few.
 *   - Pure analytical / report          -> create a single pointer InboxItem
 *     referencing the file path so Nate can find the analysis later.
 *   - Stale / obsolete                  -> SKIP and log reason.
 *
 * Cap: 15 InboxItems.
 *
 * Source tag: WORKSPACE_SCAN_REMAINING
 *
 * Writes: InboxItem only. (Forbidden: Builder, Product, InventoryItem,
 * Vendor, Staff-create, CommunityFloorPlan-create, AccountTouchpoint-create,
 * CollectionAction-create. This script creates zero of those.)
 *
 * Usage:
 *   tsx scripts/etl-workspace-scan.ts            (dry-run)
 *   tsx scripts/etl-workspace-scan.ts --commit   (write)
 */

import { PrismaClient } from '@prisma/client'
import * as path from 'node:path'
import * as fs from 'node:fs'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const ROOT = path.resolve(__dirname, '..', '..')
const SRC = 'WORKSPACE_SCAN_REMAINING'

function hashId(k: string): string {
  return 'ib_wsscan_' + crypto.createHash('sha256').update(`${SRC}::${k}`).digest('hex').slice(0, 16)
}

interface Item {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  dueBy?: Date | null
}

// ---------------------------------------------------------------------------
// Actionable files -> one InboxItem per file (summary pointer with counts)
// ---------------------------------------------------------------------------

interface Actionable {
  key: string
  file: string
  title: string
  summary: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM'
  dueOffsetDays?: number
  type: string
}

const ACTIONABLE: Actionable[] = [
  {
    key: 'material-coverage-0422',
    file: 'Abel_Material_Coverage_Master_2026-04-22.xlsx',
    title: '[MATERIAL COVERAGE 4/22] 46 jobs, 216 short SKU lines — review blocked builds',
    summary:
      "Today's material coverage master. 9 sheets: Executive Summary, Coverage by Builder, Coverage by Job (46), Short Lines by SKU (216), and cure plans. Drives the daily MRP/PO release cadence — blocked jobs here are the ones that stall deliveries this week.",
    priority: 'CRITICAL',
    dueOffsetDays: 1,
    type: 'MRP_RECOMMENDATION',
  },
  {
    key: 'procurement-plan',
    file: 'Abel_Lumber_Procurement_Plan.xlsx',
    title: '[PROCUREMENT PLAN] PO release schedule + Boise credit hold + vendor lead times',
    summary:
      '6 sheets: PO Release Schedule, Order Now by Vendor (all SKUs), Boise Cascade credit-hold subplan ($63,98x), Vendor Lead Times. Anchor doc for purchasing ops — pairs with the weekly staged plan.',
    priority: 'HIGH',
    dueOffsetDays: 3,
    type: 'PO_APPROVAL',
  },
  {
    key: 'po-weekly-staging',
    file: 'Abel_Lumber_PO_Weekly_Staging.xlsx',
    title: '[PO WEEKLY STAGING] Week-by-week staged POs, vendor totals, cash flow',
    summary:
      '3 sheets: Weekly Staged Plan (Week/Vendor/SKU/Qty/Line Total/Cumulative), Vendor Totals, Weekly Cash Flow. Use this to commit the purchasing calendar and sync with Dawn on cash timing.',
    priority: 'HIGH',
    dueOffsetDays: 3,
    type: 'PO_APPROVAL',
  },
  {
    key: 'products-needing-pricing',
    file: 'Abel_Products_Needing_Pricing.xlsx',
    title: '[PRICING GAPS] Unpriced products list + summary by category',
    summary:
      "Catalog products without a cost or sell price. Assign to Lisa (estimator) or Dalton to chase vendor quotes. Blocks quote generation for any SKU on this list — every row is a potential stalled bid.",
    priority: 'HIGH',
    dueOffsetDays: 7,
    type: 'ACTION_REQUIRED',
  },
  {
    key: 'boise-full-audit-0421',
    file: 'Boise_Cascade_Full_Audit_04-21-2026.xlsx',
    title: '[BOISE 4/28 PREP] Full audit 4/21 — invoices, Agility credit detail, payment ledger',
    summary:
      '6 sheets: Executive Summary, Invoice Audit (4/20), Agility Credit Detail, Payment Ledger + more. Dated one day before the 4/28 Boise meeting — this is the reconciled baseline Nate walks in with. Read alongside the Boise meeting prep folder.',
    priority: 'CRITICAL',
    dueOffsetDays: 6,
    type: 'ACTION_REQUIRED',
  },
  {
    key: 'boise-credit-hold',
    file: 'Boise_Credit_Hold_Analysis.xlsx',
    title: '[BOISE CREDIT HOLD] Single-sheet analysis — reference for 4/28 meeting',
    summary:
      'Single-sheet Boise credit-hold analysis. Short reference doc — pair with the credit-line-increase justification already in the Boise negotiation package.',
    priority: 'HIGH',
    dueOffsetDays: 6,
    type: 'ACTION_REQUIRED',
  },
  {
    key: 'ops-prelaunch-checklist',
    file: 'Abel_Lumber_Ops_PreLaunch_Checklist.xlsx',
    title: '[OPS CHECKLIST] Pre-launch checklist + completed fixes — residual items',
    summary:
      "Abel OS pre-launch checklist and the 'completed fixes' log. Platform went live 4/13. Treat this as a residual-items audit: close or explicitly defer any row still open so the checklist stops being a zombie doc.",
    priority: 'MEDIUM',
    dueOffsetDays: 14,
    type: 'ACTION_REQUIRED',
  },
  {
    key: 'catalog-cleanup-phase1',
    file: 'Abel_Catalog_Cleanup_Phase1_Review.xlsx',
    title: '[CATALOG CLEANUP P1] 10 sheets — proposed rules, duplicates, before/after',
    summary:
      '10-sheet review of Phase-1 catalog cleanup: Summary Stats, Proposed Rules (before/after/why), Duplicates with proposed actions, and more. Approve/reject the rule set before anyone runs destructive catalog writes.',
    priority: 'MEDIUM',
    dueOffsetDays: 10,
    type: 'ACTION_REQUIRED',
  },
]

// ---------------------------------------------------------------------------
// Pointer-only files -> one InboxItem per file (reference, no action deadline)
// ---------------------------------------------------------------------------

interface Pointer {
  key: string
  file: string
  title: string
  summary: string
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
}

const POINTERS: Pointer[] = [
  {
    key: 'master-financial-apr',
    file: 'Abel_Master_Financial_Analysis_April2026.xlsx',
    title: '[REF] Master Financial Analysis April 2026 — 8 sheets (P&L, margin trend, account analysis)',
    summary:
      'Executive-level analysis workbook: Executive Dashboard, Account-by-Account Margin, FY2025 P&L, Gross Margin Trend by Month + more. Read-only reference for financial questions; pair with Hancock Whitney pitch and AMP files.',
    priority: 'MEDIUM',
  },
  {
    key: 'overhead-profitability-apr',
    file: 'Abel_Overhead_Profitability_Analysis_April2026.xlsx',
    title: '[REF] Overhead & Profitability Analysis April 2026 — break-even, expense cuts, scenarios',
    summary:
      '7 sheets: Overhead Structure, Break-Even Analysis, Expense Optimization, Profitability Scenarios. Companion to the Master Financial Analysis; drives the turnaround plan.',
    priority: 'MEDIUM',
  },
  {
    key: 'system-audit-2026',
    file: 'Abel_Lumber_System_Audit_2026.xlsx',
    title: '[REF] System Audit 2026 — 104 ops pages, 17 portals, ~312 API routes',
    summary:
      "Full Abel OS / Aegis system audit: Executive Summary, Ops Pages (104), Other Portals (17), API Routes (~312). Source-of-truth inventory when you need to reason about what's shipped vs planned.",
    priority: 'MEDIUM',
  },
  {
    key: 'data-integration-report',
    file: 'Abel_Lumber_Data_Integration_Report.xlsx',
    title: '[REF] Data Integration Report — InFlow + ECI Bolt setup + action items',
    summary:
      'Snapshot of the InFlow / ECI Bolt data-integration state with an action-items sheet. Historical reference — any open action here should already live in the NUC knowledge base or ops checklist.',
    priority: 'LOW',
  },
  {
    key: 'bolt-data-export',
    file: 'Abel_Lumber_Bolt_Data_Export.xlsx',
    title: '[REF] ECI Bolt Data Export — customers, communities, work orders',
    summary:
      'ECI Bolt export: Customers (builders), Communities (subdivisions), Work Orders (schedule). Legacy ERP dump kept for reference during the Bolt → Abel OS migration. Raw product/customer rows are out of scope (NUC owns writes).',
    priority: 'LOW',
  },
  {
    key: 'pulte-analytics-bundle',
    file: 'Abel_Lumber_Pulte_Growth_Strategy_April2026_EXTERNAL.xlsx',
    title: '[REF] Pulte analytics bundle (EXTERNAL growth strategy, community quotes, takeoff BOMs)',
    summary:
      'Three Pulte analytical workbooks kept together: the external growth-strategy deck, community-quotes detail (45 communities with route/package breakdown), and takeoff BOMs (small/medium/large plan). Pulte account was LOST 4/20 — these are retained for post-mortem and any revival pitch.\n\nAlso in this bundle:\n  - Abel_Lumber_Pulte_Community_Quotes.xlsx\n  - Abel_Lumber_Pulte_Takeoff_BOMs.xlsx',
    priority: 'MEDIUM',
  },
  {
    key: 'brookfield-plan-reference',
    file: 'Brookfield.xlsx',
    title: '[REF] Brookfield plan reference — 44 sheets (price guide + per-plan SPECS/EXT/INT)',
    summary:
      "44-sheet Brookfield workbook: Price Guide plus per-plan sheets (SPECS/EXT DOORS/INT DOORS per plan, e.g. 5515). Primary reference for Brookfield quoting and the Rev 4 Plan Breakdown work with Amanda Barham.\n\nCompanion bids (FIRST TX HOMES Brentwood/Hillcrest/Stonebriar + MSR plan bid) live in the workspace root as well.",
    priority: 'MEDIUM',
  },
]

// ---------------------------------------------------------------------------
// Files intentionally skipped — logged here so the sweep is auditable.
// ---------------------------------------------------------------------------

const SKIPPED_RAW: { file: string; reason: string }[] = [
  { file: 'Abel_GM_Calculated_Line_Extract.csv', reason: 'raw GM line-item extract (NUC owns)' },
  { file: 'Abel_InFlow_Price_Import.csv', reason: 'raw InFlow price import (NUC owns Product writes)' },
  { file: 'Abel_Product_Catalog_Template.xlsx', reason: 'catalog template, not actionable rows' },
  { file: 'Abel_Lumber_PO_Import.csv', reason: 'raw PO import (NUC owns)' },
  { file: 'Abel_Lumber_PO_Import_v2.csv', reason: 'raw PO import v2 (NUC owns)' },
  { file: 'Abel_Lumber_PO_Release_Schedule.csv', reason: 'raw PO release CSV (pointer covered by Procurement Plan xlsx)' },
  { file: 'InFlow_Upload_ProductDetails.csv', reason: 'raw InFlow upload file (NUC owns Product)' },
  { file: 'InFlow_Upload_StockLevels.csv', reason: 'raw InFlow upload file (NUC owns InventoryItem)' },
  { file: 'InFlow_BACKUP_PreUpload_20260412_1933.xlsx', reason: 'pre-upload backup — superseded' },
  { file: 'inFlow_BOM (8).csv', reason: 'raw InFlow BOM export (NUC owns)' },
  { file: 'inFlow_Customer (5).csv', reason: 'raw InFlow customer export (NUC owns Builder)' },
  { file: 'inFlow_Operations (4).csv', reason: 'raw InFlow operations export' },
  { file: 'inFlow_ProductDetails (11).csv', reason: 'raw InFlow product export (NUC owns Product)' },
  { file: 'inFlow_ProductGroups (1).csv', reason: 'raw InFlow product-groups export' },
  { file: 'inFlow_ProductImages (1).csv', reason: 'raw InFlow product-image manifest' },
  { file: 'inFlow_PurchaseOrder (8).csv', reason: 'raw InFlow PO export' },
  { file: 'inFlow_ReorderSettings (2).csv', reason: 'raw InFlow reorder settings' },
  { file: 'inFlow_SalesOrder (16).csv', reason: 'raw InFlow sales-order export' },
  { file: 'inFlow_SalesOrder (17).csv', reason: 'raw InFlow sales-order export (newer)' },
  { file: 'inFlow_StockLevels (9).csv', reason: 'raw InFlow stock levels (NUC owns InventoryItem)' },
  { file: 'inFlow_Vendor (5).csv', reason: 'raw InFlow vendor export (NUC owns Vendor)' },
  { file: 'inFlow_VendorProductDetails (2).csv', reason: 'raw InFlow vendor-product export (NUC owns)' },
  { file: 'Inventory summary - Dec 5, 2025 at 3_39 pm.csv', reason: 'stale inventory snapshot (Dec 2025)' },
  { file: 'Sales order profit report - Apr 10, 2026 at 7_23 am.csv', reason: 'raw SO profit report (superseded by AR reports)' },
  { file: 'Abel_OS_Seed_Data.xlsx', reason: 'Abel OS seed workbook (was used for initial seed on 4/13)' },
  { file: 'MILLWORK ^0 DOORS PRICING 2025 Template 9.12 int.xlsx', reason: 'vendor pricing template — NUC owns catalog' },
  { file: 'Master Interior Trim ^L0 Door Price Sheet - Abel Copy  1.7.26.xlsx', reason: 'vendor price sheet — NUC owns catalog' },
  { file: 'OLERIO internal.xlsx', reason: 'vendor internal pricing sheet — NUC owns catalog' },
  { file: 'PO_Metrie_Consolidated.csv', reason: 'raw consolidated PO CSV (NUC owns)' },
  { file: 'PO_Novo_Consolidated.csv', reason: 'raw consolidated PO CSV (NUC owns)' },
  { file: 'PO-003777.xlsx', reason: 'single-PO Pulte pricing doc (account lost 4/20)' },
  { file: 'Pulte_BWP_Backcharges.csv', reason: 'raw BWP export (already loaded in prior BWP ETL)' },
  { file: 'Pulte_BWP_Contacts.csv', reason: 'raw BWP contacts export' },
  { file: 'Pulte_BWP_Invoices.csv', reason: 'raw BWP invoice export' },
  { file: 'Pulte_BWP_PO_LineItems.csv', reason: 'raw BWP PO line items export' },
  { file: 'Pulte_BWP_PaymentChecks.csv', reason: 'raw BWP payment check export' },
  { file: 'Pulte_BWP_PurchaseOrders.csv', reason: 'raw BWP PO export' },
  { file: 'Back order report - Mar 31, 2026 at 2_49 pm.xlsx', reason: 'raw InFlow back-order report (operational data, NUC owns)' },
  { file: 'FIRST TX HOMES BRENTWOOD PLAN BID.xlsx', reason: 'raw plan bid — consolidated via Brookfield pointer reference' },
  { file: 'FIRST TX HOMES HILLCREST PLAN BID.xlsx', reason: 'raw plan bid — consolidated via Brookfield pointer reference' },
  { file: 'FIRST TX HOMES STONEBRIAR PLAN BID.xlsx', reason: 'raw plan bid — consolidated via Brookfield pointer reference' },
  { file: 'MSR.xlsx', reason: 'single plan bid — consolidated via Brookfield pointer reference' },
  { file: 'Abel_Lumber_Pulte_Community_Quotes.xlsx', reason: 'consolidated into pulte-analytics-bundle pointer' },
  { file: 'Abel_Lumber_Pulte_Takeoff_BOMs.xlsx', reason: 'consolidated into pulte-analytics-bundle pointer' },
]

const SKIPPED_STALE: { file: string; reason: string }[] = [
  { file: 'AMP_Legal_Adjusted_EBITDA_Package_v2 (1).xlsx', reason: 'duplicate of AMP_Legal_Adjusted_EBITDA_Package_v2.xlsx (already loaded)' },
  { file: 'Abel_Inventory_Count_Sheet_April2026 (1).xlsx', reason: 'duplicate of Abel_Inventory_Count_Sheet_April2026.xlsx (already loaded)' },
  { file: 'Abel_Lumber_Employee_Directory_CONFIDENTIAL_BACKUP_20260422.xlsx', reason: 'dated backup of confidential directory (already loaded main)' },
  { file: 'Employee Pay Rates - Mar 2026.xlsx', reason: 'superseded by current Staff table + confidential directory' },
  { file: 'Employee Pay Rates - Mar 2026.csv', reason: 'csv twin of the xlsx — same pay data, already superseded' },
  { file: 'Abel Account.xlsx', reason: 'Agility credit-export stub, ~2 rows; no actionable content' },
  { file: 'J. Barrett - Expenses.xlsx', reason: 'Josh Barrett personal expenses — bought out April 2026, out of scope for Abel ops' },
  { file: 'Payroll Report - K. Johnson.xlsx', reason: 'individual payroll report — not on current roster; archive' },
]

function build(): Item[] {
  const items: Item[] = []
  const now = Date.now()

  for (const a of ACTIONABLE) {
    const full = path.join(ROOT, a.file)
    const exists = fs.existsSync(full)
    if (!exists) console.warn(`  MISSING: ${a.file}`)
    const due = a.dueOffsetDays
      ? new Date(now + a.dueOffsetDays * 24 * 60 * 60 * 1000)
      : null
    items.push({
      id: hashId(a.key),
      type: a.type,
      source: 'workspace-scan',
      title: a.title,
      description:
        `${a.summary}\n\nFile: ${full}${exists ? '' : '\n\n[WARN: file not found at expected path]'}`,
      priority: a.priority,
      dueBy: due,
    })
  }

  for (const p of POINTERS) {
    const full = path.join(ROOT, p.file)
    const exists = fs.existsSync(full)
    if (!exists) console.warn(`  MISSING: ${p.file}`)
    items.push({
      id: hashId(p.key),
      type: 'REFERENCE',
      source: 'workspace-scan',
      title: p.title,
      description:
        `${p.summary}\n\nFile: ${full}${exists ? '' : '\n\n[WARN: file not found at expected path]'}`,
      priority: p.priority,
      dueBy: null,
    })
  }

  return items
}

async function main() {
  console.log(`ETL workspace-scan — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Root: ${ROOT}`)

  const items = build()
  if (items.length > 15) {
    throw new Error(`Cap exceeded: ${items.length} > 15 InboxItems`)
  }

  console.log(`\n=== Classification summary ===`)
  console.log(`  Actionable:   ${ACTIONABLE.length} files -> ${ACTIONABLE.length} InboxItems`)
  console.log(`  Pointer:      ${POINTERS.length} files -> ${POINTERS.length} InboxItems`)
  console.log(`  Skipped raw:  ${SKIPPED_RAW.length} files (NUC-owned or subsumed)`)
  console.log(`  Skipped stale:${SKIPPED_STALE.length} files (dup/obsolete/out-of-scope)`)
  console.log(`  Total InboxItems: ${items.length} / 15 cap`)

  console.log(`\n=== Stale/obsolete (logged) ===`)
  for (const s of SKIPPED_STALE) console.log(`  [STALE] ${s.file}  —  ${s.reason}`)

  console.log(`\n=== InboxItems to upsert ===`)
  for (const it of items) {
    console.log(`  [${it.priority.padEnd(8)}] ${it.type.padEnd(22)} ${it.title.slice(0, 90)}`)
  }

  if (DRY_RUN) {
    console.log('\nDRY-RUN — re-run with --commit to write.')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of items) {
      try {
        const res = await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            dueBy: it.dueBy ?? undefined,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            dueBy: it.dueBy ?? undefined,
          },
          select: { createdAt: true, updatedAt: true },
        })
        if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
        else updated++
      } catch (e) {
        failed++
        console.error('  FAIL:', (e as Error).message.slice(0, 180))
      }
    }
    console.log(`\nCommitted: created=${created} updated=${updated} failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
