/**
 * scripts/etl-boise-negotiation.ts
 *
 * Load the Boise Cascade Negotiation Package prep data into Aegis ahead of
 * the 4/28 lunch with Boise.
 *
 * Folder: C:\Users\natha\OneDrive\Abel Lumber\Boise Cascade Negotiation Package\
 *
 * What this loads:
 *   1) Per-SKU negotiation targets (Pricing Proposal sheet, 20 SKUs) →
 *      VendorProduct rows on the existing Boise vendor (code BOIS1).
 *      Current Avg Price → vendorCost.  Target price, reduction %, and
 *      annual savings are encoded in vendorName so the data shows up in the
 *      vendor catalog views without schema changes.
 *   2) A summary InboxItem (HIGH priority, dueBy 2026-04-28) that pins the
 *      headline negotiation numbers + AR exposure on Nate's inbox.
 *
 * What it does NOT touch:
 *   - Vendor row itself (already exists, we only tag NEW VendorProducts)
 *   - schema.prisma
 *   - Product rows
 *   - PDFs / DOCX (narrative — not parsed here)
 *
 * Source tag: BOISE_NEGOTIATION_APR2026 — embedded in InboxItem.source and in
 *   VendorProduct.vendorName suffix so rows can be filtered/retired later.
 *
 * Idempotency:
 *   - VendorProduct is upserted by (vendorId, productId) composite unique.
 *   - InboxItem is deterministic-id: `boise-neg-apr2026-summary`.
 *
 * Usage:
 *   npx tsx scripts/etl-boise-negotiation.ts          # dry run
 *   npx tsx scripts/etl-boise-negotiation.ts --commit # write
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'BOISE_NEGOTIATION_APR2026'
const VENDOR_CODE = 'BOIS1'
const MEETING_DATE = new Date('2026-04-28T17:00:00.000Z')

const FOLDER = 'C:/Users/natha/OneDrive/Abel Lumber/Boise Cascade Negotiation Package'
const PROPOSAL_FILE = path.join(FOLDER, '02_SKU_Pricing_Analysis_v2.xlsx')
const INVOICES_FILE = path.join(FOLDER, 'Boise_Cascade_Invoices_Due_04-20-2026.xlsx')

const prisma = new PrismaClient()

type ProposalRow = {
  SKU: string | null
  'Product Name': string | null
  'Total Spend': number | null
  'Order Count': number | null
  'Current Avg Price': number | null
  'Target Price': number | null
  'Reduction %': number | null
  'Estimated Annual Savings': number | null
}

type SummaryHeadline = {
  totalSpend: string | null
  totalPOs: string | null
  uniqueSKUs: string | null
  totalOverpayment: string | null
  dateRange: string | null
}

function readProposal(): ProposalRow[] {
  if (!fs.existsSync(PROPOSAL_FILE)) throw new Error(`Missing: ${PROPOSAL_FILE}`)
  const wb = XLSX.readFile(PROPOSAL_FILE)
  const rows = XLSX.utils.sheet_to_json<ProposalRow>(wb.Sheets['Pricing Proposal'], {
    defval: null,
  })
  return rows.filter(
    (r) => r.SKU && r.SKU !== 'TOTAL' && typeof r['Target Price'] === 'number',
  )
}

function readSummary(): SummaryHeadline {
  const wb = XLSX.readFile(PROPOSAL_FILE)
  const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets['Summary Dashboard'], {
    header: 1,
    defval: null,
  })
  const find = (label: string) => {
    const hit = rows.find((r) => Array.isArray(r) && r[0] === label)
    return hit ? String(hit[1] ?? '') : null
  }
  return {
    totalSpend: find('Total Spend'),
    totalPOs: find('Total POs'),
    uniqueSKUs: find('Unique SKUs'),
    totalOverpayment: find('Total Overpayment'),
    dateRange: find('Date Range'),
  }
}

function readInvoiceTotal(): { gross: number; net: number; discount: number } {
  if (!fs.existsSync(INVOICES_FILE)) return { gross: 0, net: 0, discount: 0 }
  const wb = XLSX.readFile(INVOICES_FILE)
  const sheet = wb.Sheets['Due by 04-20-26']
  const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null })
  let gross = 0,
    net = 0,
    discount = 0
  for (const r of rows) {
    if (!Array.isArray(r)) continue
    const label = String(r[0] ?? '')
    if (label.startsWith('Total Gross Amount')) gross = Number(r[7]) || 0
    if (label.startsWith('Less: Prompt-Pay Discount')) discount = Number(r[7]) || 0
    if (label.startsWith('Net Amount Due')) net = Number(r[7]) || 0
  }
  return { gross, net, discount }
}

async function main() {
  console.log(`[etl-boise-negotiation] ${DRY_RUN ? 'DRY RUN' : 'COMMIT'}`)
  console.log(`[etl-boise-negotiation] source tag: ${SOURCE_TAG}`)

  const vendor = await prisma.vendor.findUnique({ where: { code: VENDOR_CODE } })
  if (!vendor) {
    console.error(`[fatal] No Vendor row with code ${VENDOR_CODE}. Stop.`)
    process.exit(1)
  }
  console.log(`[vendor] ${vendor.name} (${vendor.id})`)

  const proposalRows = readProposal()
  const summary = readSummary()
  const invoices = readInvoiceTotal()
  console.log(`[proposal] ${proposalRows.length} SKU rows`)
  console.log(`[summary] ${JSON.stringify(summary)}`)
  console.log(`[invoices] ${JSON.stringify(invoices)}`)

  // Match SKUs to Product rows
  const skus = proposalRows.map((r) => r.SKU!).filter(Boolean)
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true },
  })
  const prodBySku = new Map(products.map((p) => [p.sku, p.id]))
  const matched = proposalRows.filter((r) => prodBySku.has(r.SKU!))
  const unmatched = proposalRows.filter((r) => !prodBySku.has(r.SKU!))
  console.log(`[match] matched=${matched.length} unmatched=${unmatched.length}`)
  if (unmatched.length) {
    console.log(`[match] unmatched SKUs:`, unmatched.map((r) => r.SKU).join(', '))
  }

  // 1. VendorProduct upserts ------------------------------------------------
  let vpCreated = 0
  let vpUpdated = 0
  for (const r of matched) {
    const productId = prodBySku.get(r.SKU!)!
    const target = r['Target Price']!
    const current = r['Current Avg Price']!
    const savings = r['Estimated Annual Savings'] ?? 0
    const pct = Math.round((r['Reduction %'] ?? 0) * 100)
    const vendorName = `${r['Product Name'] ?? ''} [${SOURCE_TAG} target=$${target.toFixed(2)} (-${pct}%) save=$${savings.toFixed(0)}/yr]`

    if (DRY_RUN) {
      console.log(
        `  [dry] VP ${r.SKU}: cost $${current.toFixed(2)} target $${target.toFixed(2)} (-${pct}%, save $${savings.toFixed(0)})`,
      )
      vpCreated++
      continue
    }

    const existing = await prisma.vendorProduct.findUnique({
      where: { vendorId_productId: { vendorId: vendor.id, productId } },
    })
    if (existing) {
      await prisma.vendorProduct.update({
        where: { id: existing.id },
        data: {
          vendorSku: r.SKU!,
          vendorName,
          vendorCost: current,
        },
      })
      vpUpdated++
    } else {
      await prisma.vendorProduct.create({
        data: {
          vendorId: vendor.id,
          productId,
          vendorSku: r.SKU!,
          vendorName,
          vendorCost: current,
          preferred: false,
        },
      })
      vpCreated++
    }
  }

  // 2. Summary InboxItem ----------------------------------------------------
  const totalAnnualSavings = matched.reduce(
    (s, r) => s + (r['Estimated Annual Savings'] ?? 0),
    0,
  )
  const top5 = matched
    .slice()
    .sort((a, b) => (b['Total Spend'] ?? 0) - (a['Total Spend'] ?? 0))
    .slice(0, 5)

  const descLines = [
    `Boise Cascade 4/28 Negotiation — prep data`,
    ``,
    `HEADLINE NUMBERS (from 02_SKU_Pricing_Analysis_v2.xlsx)`,
    `  Total 2-yr spend:       ${summary.totalSpend}`,
    `  Total POs:              ${summary.totalPOs}`,
    `  Unique SKUs:            ${summary.uniqueSKUs}`,
    `  Total overpayment:      ${summary.totalOverpayment}`,
    `  Date range:             ${summary.dateRange}`,
    ``,
    `NEGOTIATION ASK — 20 SKUs, ${(totalAnnualSavings / 1000).toFixed(1)}K/yr savings`,
    `  Est. annual savings:    $${totalAnnualSavings.toFixed(0)}`,
    `  Avg reduction request:  10–15%`,
    ``,
    `AR EXPOSURE (Boise_Cascade_Invoices_Due_04-20-2026.xlsx)`,
    `  Gross due 4/20:         $${invoices.gross.toFixed(2)}`,
    `  Prompt-pay discount:    $${invoices.discount.toFixed(2)}`,
    `  Net due:                $${invoices.net.toFixed(2)}`,
    ``,
    `TOP-5 SKUs BY SPEND (bring to the lunch)`,
    ...top5.map(
      (r, i) =>
        `  ${i + 1}. ${r.SKU} ${r['Product Name']?.slice(0, 50) ?? ''} — spend $${(r['Total Spend'] ?? 0).toFixed(0)}, current $${(r['Current Avg Price'] ?? 0).toFixed(2)} → target $${(r['Target Price'] ?? 0).toFixed(2)} (save $${(r['Estimated Annual Savings'] ?? 0).toFixed(0)}/yr)`,
    ),
    ``,
    `Source files (full detail):`,
    `  01_Executive_Summary.docx`,
    `  02_SKU_Pricing_Analysis_v2.xlsx`,
    `  03_Market_Research_Brief.docx`,
    `  04_Meeting_Prep_Talking_Points.docx`,
    `  05_Data_Quality_Audit.pdf`,
    `  06_Interactive_Pricing_Dashboard.html`,
    `  07_Credit_Line_Increase_Justification.docx`,
    `  08_Pipeline_Snapshot_for_Antonio_LC.pdf`,
    `  Boise_Statement_vs_InFlow_Receipt_Audit_v2.xlsx`,
  ]
  const description = descLines.join('\n')

  const inboxId = 'boise-neg-apr2026-summary'
  if (DRY_RUN) {
    console.log(`\n[dry] InboxItem ${inboxId}:`)
    console.log(description)
  } else {
    await prisma.inboxItem.upsert({
      where: { id: inboxId },
      create: {
        id: inboxId,
        type: 'AGENT_TASK',
        source: SOURCE_TAG,
        title: 'Boise Cascade 4/28 negotiation — prep pack loaded',
        description,
        priority: 'HIGH',
        status: 'PENDING',
        entityType: 'Vendor',
        entityId: vendor.id,
        financialImpact: totalAnnualSavings,
        dueBy: MEETING_DATE,
        actionData: {
          sourceTag: SOURCE_TAG,
          vendorId: vendor.id,
          vendorCode: VENDOR_CODE,
          skuCount: matched.length,
          annualSavings: totalAnnualSavings,
          invoicesDue420: invoices,
          headline: summary,
        } as any,
      },
      update: {
        description,
        financialImpact: totalAnnualSavings,
        dueBy: MEETING_DATE,
        priority: 'HIGH',
        status: 'PENDING',
        actionData: {
          sourceTag: SOURCE_TAG,
          vendorId: vendor.id,
          vendorCode: VENDOR_CODE,
          skuCount: matched.length,
          annualSavings: totalAnnualSavings,
          invoicesDue420: invoices,
          headline: summary,
        } as any,
      },
    })
  }

  console.log(`\n[summary]`)
  console.log(`  VendorProduct created: ${vpCreated}`)
  console.log(`  VendorProduct updated: ${vpUpdated}`)
  console.log(`  SKUs unmatched:        ${unmatched.length}`)
  console.log(`  InboxItem:             ${inboxId}`)
  console.log(`  Annual savings target: $${totalAnnualSavings.toFixed(0)}`)
  console.log(`  Meeting due:           ${MEETING_DATE.toISOString()}`)
  console.log(`  Mode:                  ${DRY_RUN ? 'DRY RUN (no writes)' : 'COMMITTED'}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
