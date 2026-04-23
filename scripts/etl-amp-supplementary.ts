/**
 * scripts/etl-amp-supplementary.ts
 *
 * Supplementary loader for the AMP Material Planning workbook. Agent A2
 * already loaded the Company_NetBuy sheet (68 rows -> 11 DRAFT POs) via
 * scripts/etl-amp-material-planning.ts.
 *
 * This script covers the other etl-worthy sheets WITHOUT duplicating A2's
 * work. After inspecting all 12 sheets, only two contain distinct planning
 * line items that are not already in Company_NetBuy:
 *
 *   1) Company_Buy_Timeline  — 151 rows; 13 (sku,vendor) pairs are NOT in
 *      Company_NetBuy. These are per-line buy recommendations with NeedBy /
 *      OrderBy / Urgent flags. We load the 13-row delta as DRAFT POs tagged
 *      AMP_PLANNING_2026-02-25_TIMELINE.
 *
 *   2) Company_Expedite — 10 rows; 6 SKUs are NOT in Company_NetBuy. These
 *      are SKUs where open POs exist but arrive after EarliestNeed — the
 *      "timing gap" buy-around list. We load the 6-row delta as DRAFT POs
 *      tagged AMP_PLANNING_2026-02-25_EXPEDITE.
 *
 * All other sheets are either duplicates (Abel_Critical_POs overlaps
 * OpenPOs_for_Action, Abel_Backup_Buy overlaps NetBuy), pivot/analysis
 * (Vendor_Rollup, Abel_Req_Summary, Company_Action_SKUs, Assumptions), raw
 * InFlow export (Abel_SalesOrders, OpenPOs_for_Action — owned by InFlow
 * sync), or computed BoM views (Abel_BOM_Explosion). None are loaded here.
 *
 * Modes:
 *   --dry-run (default) — summarise, write nothing
 *   --commit            — apply
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'
import * as fs from 'node:fs'

const DRY_RUN = !process.argv.includes('--commit')
const FILE = path.resolve(
  __dirname,
  '..',
  '..',
  'AMP_Material_Planning_Abel_and_Company_2026-02-25.xlsx'
)
const PLAN_DATE = '2026-02-25'

function excelSerialToDate(serial: number | null | undefined): Date | null {
  if (!serial || !Number.isFinite(serial as number)) return null
  const ms = Math.round(((serial as number) - 25569) * 86400 * 1000)
  return new Date(ms)
}

function normVendor(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

function mkId(prefix: string): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
}

interface PlanRow {
  sku: string
  productName: string
  vendor: string
  qty: number
  unitCost: number
  needBy: number | null
  orderBy: number | null
  uom: string | null
  sourceNote: string
}

/**
 * Load a set of supplementary planning rows as DRAFT POs, one per vendor,
 * tagged with the given source. Deterministic poNumber means re-runs are
 * idempotent; we refuse to overwrite if a matching PO has been edited
 * outside this ETL (status != DRAFT or source != sourceTag).
 */
async function loadPlanRows(
  prisma: PrismaClient,
  rows: PlanRow[],
  sourceTag: string,
  poPrefix: string,
  creatorId: string,
  label: string
) {
  console.log(`\n--- ${label} ---`)
  console.log(`Input rows: ${rows.length}`)
  if (rows.length === 0) {
    console.log('  (nothing to load)')
    return { created: 0, updated: 0, items: 0 }
  }

  const allVendors = await prisma.vendor.findMany({ select: { id: true, name: true, code: true } })
  const vByName = new Map(allVendors.map(v => [normVendor(v.name), v]))

  const skus = [...new Set(rows.map(r => r.sku))]
  const products = await prisma.product.findMany({
    where: { sku: { in: skus } },
    select: { id: true, sku: true, name: true },
  })
  const pBySku = new Map(products.map(p => [p.sku, p]))

  type Resolved = PlanRow & { vendorId: string; vendorCode: string; productId: string }
  const resolved: Resolved[] = []
  const unmatchedVendors = new Set<string>()
  const unmatchedSkus = new Set<string>()
  for (const r of rows) {
    const v = vByName.get(normVendor(r.vendor))
    const p = pBySku.get(r.sku)
    if (!v) unmatchedVendors.add(r.vendor)
    if (!p) unmatchedSkus.add(r.sku)
    if (v && p) resolved.push({ ...r, vendorId: v.id, vendorCode: v.code, productId: p.id })
  }
  console.log(`  resolved (vendor + sku match): ${resolved.length}/${rows.length}`)
  if (unmatchedVendors.size) console.log(`  unmatched vendors: ${[...unmatchedVendors].join(' | ')}`)
  if (unmatchedSkus.size) console.log(`  unmatched SKUs: ${[...unmatchedSkus].join(', ')}`)

  type POPlan = {
    poNumber: string
    vendorId: string
    items: Resolved[]
    subtotal: number
    earliestNeed: Date | null
    earliestOrderBy: Date | null
  }
  const byVendor = new Map<string, Resolved[]>()
  for (const r of resolved) {
    if (!byVendor.has(r.vendorId)) byVendor.set(r.vendorId, [])
    byVendor.get(r.vendorId)!.push(r)
  }
  const plans: POPlan[] = []
  for (const [vendorId, items] of byVendor.entries()) {
    const subtotal = items.reduce((s, i) => s + Math.ceil(i.qty) * i.unitCost, 0)
    const earliestNeed = items
      .map(i => excelSerialToDate(i.needBy))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    const earliestOrderBy = items
      .map(i => excelSerialToDate(i.orderBy))
      .filter((d): d is Date => d !== null)
      .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
    const vendorCode = items[0].vendorCode
    plans.push({
      poNumber: `${poPrefix}-${PLAN_DATE}-${vendorCode}`,
      vendorId,
      items,
      subtotal: Math.round(subtotal * 100) / 100,
      earliestNeed,
      earliestOrderBy,
    })
  }
  plans.sort((a, b) => b.subtotal - a.subtotal)

  console.log(`  POs planned: ${plans.length}`)
  for (const p of plans) {
    console.log(`    ${p.poNumber}  items=${p.items.length}  subtotal=$${p.subtotal.toFixed(2)}  need=${p.earliestNeed?.toISOString().slice(0, 10) ?? '-'}`)
  }

  const poNumbers = plans.map(p => p.poNumber)
  const existing = await prisma.purchaseOrder.findMany({
    where: { poNumber: { in: poNumbers } },
    select: { id: true, poNumber: true, status: true, source: true },
  })
  const existingByNumber = new Map(existing.map(e => [e.poNumber, e]))
  const blocked = existing.filter(e => !(e.source === sourceTag && e.status === 'DRAFT'))
  if (blocked.length) {
    for (const b of blocked) console.log(`  BLOCKED  ${b.poNumber}  status=${b.status}  source=${b.source}`)
    throw new Error(`Refusing to overwrite edited POs for ${label}. Resolve manually.`)
  }
  console.log(`  safe to rewrite (existing DRAFTs w/ source=${sourceTag}): ${existing.length}`)

  if (DRY_RUN) {
    console.log('  DRY-RUN — no writes.')
    return { created: 0, updated: 0, items: 0 }
  }

  let created = 0
  let updated = 0
  let items = 0
  await prisma.$transaction(async (tx) => {
    for (const plan of plans) {
      const subtotal = plan.items.reduce((s, i) => s + Math.ceil(i.qty) * i.unitCost, 0)
      const roundedSubtotal = Math.round(subtotal * 100) / 100
      const noteLines = [
        `AMP Material Planning — supplementary loader`,
        `Plan date: ${PLAN_DATE}`,
        `Source: ${sourceTag}`,
        plan.earliestOrderBy ? `EarliestOrderBy: ${plan.earliestOrderBy.toISOString().slice(0, 10)}` : '',
        plan.earliestNeed ? `EarliestNeed: ${plan.earliestNeed.toISOString().slice(0, 10)}` : '',
        `DO NOT SEND — planning draft.`,
      ].filter(Boolean)
      const notes = noteLines.join('\n')

      const existingPO = existingByNumber.get(plan.poNumber)
      let poId: string
      if (existingPO) {
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: existingPO.id } })
        await tx.$executeRaw`
          UPDATE "PurchaseOrder"
          SET "vendorId" = ${plan.vendorId},
              "subtotal" = ${roundedSubtotal},
              "total"    = ${roundedSubtotal},
              "expectedDate" = ${plan.earliestNeed},
              "notes"    = ${notes},
              "source"   = ${sourceTag},
              "status"   = 'DRAFT'::"POStatus",
              "updatedAt" = NOW()
          WHERE "id" = ${existingPO.id}
        `
        poId = existingPO.id
        updated++
      } else {
        poId = mkId('amp')
        await tx.$executeRaw`
          INSERT INTO "PurchaseOrder" (
            "id", "poNumber", "vendorId", "createdById",
            "status", "subtotal", "shippingCost", "total",
            "expectedDate", "notes", "source",
            "createdAt", "updatedAt"
          ) VALUES (
            ${poId}, ${plan.poNumber}, ${plan.vendorId}, ${creatorId},
            'DRAFT'::"POStatus", ${roundedSubtotal}, 0, ${roundedSubtotal},
            ${plan.earliestNeed}, ${notes}, ${sourceTag},
            NOW(), NOW()
          )
        `
        created++
      }

      for (const it of plan.items) {
        const qty = Math.ceil(it.qty)
        const lineTotal = Math.round(qty * it.unitCost * 100) / 100
        const needByStr = excelSerialToDate(it.needBy)?.toISOString().slice(0, 10)
        const desc = [
          it.productName,
          it.uom ? `(${it.uom})` : '',
          needByStr ? `need ${needByStr}` : '',
          `[${it.sourceNote}]`,
        ]
          .filter(Boolean)
          .join(' ')
        await tx.purchaseOrderItem.create({
          data: {
            purchaseOrderId: poId,
            productId: it.productId,
            vendorSku: it.sku,
            description: desc || it.sku,
            quantity: qty,
            unitCost: it.unitCost,
            lineTotal,
          },
        })
        items++
      }
    }
  }, { timeout: 120_000, maxWait: 10_000 })

  console.log(`  COMMIT ${label}: created=${created} updated=${updated} items=${items}`)
  return { created, updated, items }
}

export async function loadCompanyBuyTimelineDelta(prisma: PrismaClient, creatorId: string) {
  const wb = XLSX.readFile(FILE)
  const netBuy = XLSX.utils.sheet_to_json<any>(wb.Sheets['Company_NetBuy'], { defval: null })
  const timeline = XLSX.utils.sheet_to_json<any>(wb.Sheets['Company_Buy_Timeline'], { defval: null })

  // Key by (sku, vendor). Timeline rows whose key is NOT in NetBuy are deltas.
  const nbKeys = new Set(
    netBuy.map(r => `${r.SKU}|${normVendor(String(r.RecommendedVendor ?? ''))}`)
  )
  const deltaRows = timeline.filter(
    r => r.SKU && r.RecommendedVendor &&
      !nbKeys.has(`${r.SKU}|${normVendor(String(r.RecommendedVendor))}`)
  )

  const rows: PlanRow[] = deltaRows
    .map(r => ({
      sku: String(r.SKU).trim(),
      productName: String(r.ProductName ?? '').trim(),
      vendor: String(r.RecommendedVendor).trim(),
      qty: typeof r.Qty === 'number' ? r.Qty : parseFloat(String(r.Qty ?? '0')),
      unitCost: typeof r.UnitCost === 'number' ? r.UnitCost : parseFloat(String(r.UnitCost ?? '0')),
      needBy: typeof r.NeedBy === 'number' ? r.NeedBy : null,
      orderBy: typeof r.OrderBy === 'number' ? r.OrderBy : null,
      uom: null,
      sourceNote: r.Urgent === 'YES' ? 'URGENT timeline buy' : 'timeline buy',
    }))
    .filter(r => r.sku && r.vendor && Number.isFinite(r.qty) && r.qty > 0 && Number.isFinite(r.unitCost))

  return loadPlanRows(
    prisma,
    rows,
    'AMP_PLANNING_2026-02-25_TIMELINE',
    'AMP-TIMELINE',
    creatorId,
    'Company_Buy_Timeline delta (rows not in NetBuy)'
  )
}

export async function loadCompanyExpediteDelta(prisma: PrismaClient, creatorId: string) {
  const wb = XLSX.readFile(FILE)
  const netBuy = XLSX.utils.sheet_to_json<any>(wb.Sheets['Company_NetBuy'], { defval: null })
  const expedite = XLSX.utils.sheet_to_json<any>(wb.Sheets['Company_Expedite'], { defval: null })

  // Expedite rows whose SKU is NOT in NetBuy. (NetBuy-overlapping SKUs are
  // already covered by A2 as a standard buy; expedite-only rows represent
  // timing-gap buys A2 didn't write.)
  const nbSkus = new Set(netBuy.map(r => r.SKU))
  const deltaRows = expedite.filter(r => r.SKU && !nbSkus.has(r.SKU))

  const rows: PlanRow[] = deltaRows
    .map(r => ({
      sku: String(r.SKU).trim(),
      productName: String(r.ProductName ?? '').trim(),
      vendor: String(r.RecommendedVendor ?? '').trim(),
      qty: typeof r.QtyNeededBeforeReceipts === 'number'
        ? r.QtyNeededBeforeReceipts
        : parseFloat(String(r.QtyNeededBeforeReceipts ?? '0')),
      unitCost: typeof r.UnitCost === 'number' ? r.UnitCost : parseFloat(String(r.UnitCost ?? '0')),
      needBy: typeof r.EarliestNeed === 'number' ? r.EarliestNeed : null,
      orderBy: null,
      uom: r.Uom ?? null,
      sourceNote: 'timing-gap expedite buy',
    }))
    .filter(r => r.sku && r.vendor && Number.isFinite(r.qty) && r.qty > 0 && Number.isFinite(r.unitCost))

  return loadPlanRows(
    prisma,
    rows,
    'AMP_PLANNING_2026-02-25_EXPEDITE',
    'AMP-EXPEDITE',
    creatorId,
    'Company_Expedite delta (SKUs not in NetBuy)'
  )
}

async function main() {
  console.log(`ETL AMP Supplementary — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Plan date: ${PLAN_DATE}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)

  const prisma = new PrismaClient()
  try {
    const creator = await prisma.staff.findFirst({
      where: { email: 'n.barrett@abellumber.com' },
      select: { id: true, email: true },
    }) ?? await prisma.staff.findFirst({
      where: { role: 'ADMIN' as any },
      orderBy: { createdAt: 'asc' },
      select: { id: true, email: true },
    })
    if (!creator) throw new Error('No creator Staff found')
    console.log(`Creator: ${creator.email} (${creator.id})`)

    const t = await loadCompanyBuyTimelineDelta(prisma, creator.id)
    const e = await loadCompanyExpediteDelta(prisma, creator.id)

    console.log(`\n=== SUMMARY (${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}) ===`)
    console.log(`Timeline delta:  created=${t.created}  updated=${t.updated}  items=${t.items}`)
    console.log(`Expedite delta:  created=${e.created}  updated=${e.updated}  items=${e.items}`)
    console.log(`Total POs written:  ${t.created + t.updated + e.created + e.updated}`)
    console.log(`Total items written: ${t.items + e.items}`)
    if (DRY_RUN) console.log(`\nRe-run with --commit to apply.`)
  } finally {
    await prisma.$disconnect()
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
