/**
 * scripts/etl-amp-material-planning.ts
 *
 * Loads the AMP (Abel Material Partners) planning workbook into Aegis as
 * DRAFT PurchaseOrder + PurchaseOrderItem records. These are planning rows,
 * not sent to vendors — status is always DRAFT and source is tagged so they
 * can be filtered or purged later.
 *
 * Source: ../AMP_Material_Planning_Abel_and_Company_2026-02-25.xlsx
 * Sheet:  Company_NetBuy (68 rows, company-wide net-buy plan)
 *
 * Grouping:  one PO per (vendor, plan-date). poNumber format:
 *   AMP-PLAN-{YYYY-MM-DD}-{VENDOR_CODE}
 *   — deterministic, idempotent: re-running replaces items on same poNumber.
 *
 * Matching:
 *   - Vendor: exact case-insensitive name match on Vendor.name. Unmatched -> skip + report.
 *   - Product: exact sku match on Product.sku. Unmatched -> skip + report.
 *
 * Quantity handling: PurchaseOrderItem.quantity is Int; fractional XLSX qty
 * is Math.ceil'd. The rounded delta is logged per line.
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
const PLAN_DATE = '2026-02-25' // from file name + Assumptions.Today
const SOURCE_TAG = 'AMP_PLANNING_2026-02-25'

interface RawRow {
  SKU: string
  ProductName: string
  ItemType: string | null
  Uom: string | null
  QtyToBuy: number
  EarliestNeed: number | null
  EarliestOrderBy: number | null
  RecommendedVendor: string
  UnitCost: number
  EstCost: number | null
}

function excelSerialToDate(serial: number | null | undefined): Date | null {
  if (!serial || !Number.isFinite(serial)) return null
  // Excel serial 1 = 1900-01-01 (with 1900 leap bug). Standard JS offset:
  // days from 1899-12-30.
  const ms = Math.round((serial - 25569) * 86400 * 1000)
  return new Date(ms)
}

function normVendor(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ')
}

async function main() {
  console.log(`ETL AMP Material Planning — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Plan date: ${PLAN_DATE}`)
  console.log(`Source tag: ${SOURCE_TAG}`)
  if (!fs.existsSync(FILE)) throw new Error(`Not found: ${FILE}`)

  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets['Company_NetBuy']
  if (!ws) throw new Error('Sheet "Company_NetBuy" not found')
  const raw = XLSX.utils.sheet_to_json<any>(ws, { defval: null })
  console.log(`\nXLSX Company_NetBuy rows: ${raw.length}`)

  // Parse + validate rows
  const parsed: RawRow[] = []
  let skippedNoSku = 0
  let skippedNoVendor = 0
  let skippedBadQty = 0
  for (const r of raw) {
    const sku = String(r.SKU ?? '').trim()
    const vendor = String(r.RecommendedVendor ?? '').trim()
    const qty = typeof r.QtyToBuy === 'number' ? r.QtyToBuy : parseFloat(String(r.QtyToBuy ?? '0'))
    if (!sku) { skippedNoSku++; continue }
    if (!vendor) { skippedNoVendor++; continue }
    if (!Number.isFinite(qty) || qty <= 0) { skippedBadQty++; continue }
    const unitCost = typeof r.UnitCost === 'number' ? r.UnitCost : parseFloat(String(r.UnitCost ?? '0'))
    parsed.push({
      SKU: sku,
      ProductName: String(r.ProductName ?? '').trim(),
      ItemType: r.ItemType ?? null,
      Uom: r.Uom ?? null,
      QtyToBuy: qty,
      EarliestNeed: r.EarliestNeed ?? null,
      EarliestOrderBy: r.EarliestOrderBy ?? null,
      RecommendedVendor: vendor,
      UnitCost: Number.isFinite(unitCost) ? unitCost : 0,
      EstCost: typeof r.EstCost === 'number' ? r.EstCost : null,
    })
  }
  console.log(`Parsed rows: ${parsed.length}`)
  if (skippedNoSku) console.log(`  skipped (no SKU): ${skippedNoSku}`)
  if (skippedNoVendor) console.log(`  skipped (no vendor): ${skippedNoVendor}`)
  if (skippedBadQty) console.log(`  skipped (bad qty): ${skippedBadQty}`)

  const prisma = new PrismaClient()
  try {
    // Resolve vendors
    const allVendors = await prisma.vendor.findMany({ select: { id: true, name: true, code: true } })
    const vByName = new Map(allVendors.map(v => [normVendor(v.name), v]))

    // Resolve products
    const skus = [...new Set(parsed.map(r => r.SKU))]
    const products = await prisma.product.findMany({ where: { sku: { in: skus } }, select: { id: true, sku: true, name: true } })
    const pBySku = new Map(products.map(p => [p.sku, p]))

    const unmatchedVendors = new Set<string>()
    const unmatchedSkus = new Set<string>()

    type Resolved = RawRow & { vendorId: string; vendorCode: string; productId: string }
    const resolved: Resolved[] = []
    for (const r of parsed) {
      const v = vByName.get(normVendor(r.RecommendedVendor))
      const p = pBySku.get(r.SKU)
      if (!v) unmatchedVendors.add(r.RecommendedVendor)
      if (!p) unmatchedSkus.add(r.SKU)
      if (v && p) resolved.push({ ...r, vendorId: v.id, vendorCode: v.code, productId: p.id })
    }
    console.log(`\nResolution:`)
    console.log(`  rows resolved (vendor + sku match): ${resolved.length} / ${parsed.length}`)
    console.log(`  unmatched vendors: ${unmatchedVendors.size}`)
    if (unmatchedVendors.size) console.log(`    ${[...unmatchedVendors].join(' | ')}`)
    console.log(`  unmatched SKUs: ${unmatchedSkus.size}`)
    if (unmatchedSkus.size) console.log(`    ${[...unmatchedSkus].slice(0, 20).join(', ')}${unmatchedSkus.size > 20 ? ', ...' : ''}`)

    // Group into POs by vendor
    const byVendor = new Map<string, Resolved[]>()
    for (const r of resolved) {
      const k = r.vendorId
      if (!byVendor.has(k)) byVendor.set(k, [])
      byVendor.get(k)!.push(r)
    }
    console.log(`\nPOs to create: ${byVendor.size}`)

    // Creator Staff — prefer Nate, fall back to any ADMIN
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

    // Build PO summaries
    type POPlan = {
      poNumber: string
      vendorId: string
      vendorCode: string
      items: Resolved[]
      subtotal: number
      earliestNeed: Date | null
      earliestOrderBy: Date | null
    }
    const plans: POPlan[] = []
    for (const [vendorId, items] of byVendor.entries()) {
      const vendorCode = items[0].vendorCode
      const subtotal = items.reduce((s, i) => s + Math.ceil(i.QtyToBuy) * i.UnitCost, 0)
      const earliestNeed = items
        .map(i => excelSerialToDate(i.EarliestNeed))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
      const earliestOrderBy = items
        .map(i => excelSerialToDate(i.EarliestOrderBy))
        .filter((d): d is Date => d !== null)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null
      plans.push({
        poNumber: `AMP-PLAN-${PLAN_DATE}-${vendorCode}`,
        vendorId,
        vendorCode,
        items,
        subtotal: Math.round(subtotal * 100) / 100,
        earliestNeed,
        earliestOrderBy,
      })
    }
    plans.sort((a, b) => b.subtotal - a.subtotal)

    console.log(`\nPlanned POs (top 10 by value):`)
    for (const p of plans.slice(0, 10)) {
      console.log(`  ${p.poNumber}  items=${p.items.length}  subtotal=$${p.subtotal.toFixed(2)}  need=${p.earliestNeed?.toISOString().slice(0, 10) ?? '-'}`)
    }
    const grandTotal = plans.reduce((s, p) => s + p.subtotal, 0)
    console.log(`  ...`)
    console.log(`  Total POs: ${plans.length}   Total items: ${plans.reduce((s, p) => s + p.items.length, 0)}   Grand total: $${grandTotal.toFixed(2)}`)

    // Check existing POs for idempotent replace
    const poNumbers = plans.map(p => p.poNumber)
    const existing = await prisma.purchaseOrder.findMany({
      where: { poNumber: { in: poNumbers } },
      select: { id: true, poNumber: true, status: true, source: true, items: { select: { id: true } } },
    })
    const existingByNumber = new Map(existing.map(e => [e.poNumber, e]))
    const toRewrite = existing.filter(e => e.source === SOURCE_TAG && e.status === 'DRAFT')
    const blocked = existing.filter(e => !(e.source === SOURCE_TAG && e.status === 'DRAFT'))
    console.log(`\nExisting PO collision check:`)
    console.log(`  existing matching poNumber: ${existing.length}`)
    console.log(`  safe to rewrite (source=${SOURCE_TAG}, DRAFT): ${toRewrite.length}`)
    console.log(`  blocked (status changed or different source): ${blocked.length}`)
    if (blocked.length) {
      for (const b of blocked) console.log(`    ${b.poNumber}  status=${b.status}  source=${b.source}`)
      throw new Error('Refusing to overwrite POs that have been modified outside this ETL. Resolve manually.')
    }

    // Log rounding deltas for visibility
    let fractionalLines = 0
    let qtyAdjustedAbove = 0
    for (const r of resolved) {
      if (!Number.isInteger(r.QtyToBuy)) {
        fractionalLines++
        qtyAdjustedAbove += Math.ceil(r.QtyToBuy) - r.QtyToBuy
      }
    }
    if (fractionalLines) {
      console.log(`\nQty rounding: ${fractionalLines} lines had fractional qty; ceil added ${qtyAdjustedAbove.toFixed(2)} units total across all lines.`)
    }

    if (DRY_RUN) {
      console.log('\n=== DRY-RUN — no writes performed. Re-run with --commit to apply. ===')
      return
    }

    // COMMIT — uses raw SQL for PurchaseOrder because the Prisma schema
    // declares a `category` column that doesn't exist in the DB (pending
    // migration). Prisma Client would auto-include it and fail.
    console.log('\n=== COMMIT ===')
    let createdPOs = 0
    let updatedPOs = 0
    let createdItems = 0

    // cuid-like generator — not real cuid but DB-unique and matches shape.
    // Prefix with 'amp' so these are obviously ETL-minted.
    function mkId(): string {
      return 'amp' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
    }

    await prisma.$transaction(async (tx) => {
      for (const plan of plans) {
        const subtotal = plan.items.reduce((s, i) => s + Math.ceil(i.QtyToBuy) * i.UnitCost, 0)
        const roundedSubtotal = Math.round(subtotal * 100) / 100
        const noteLines = [
          `AMP Material Planning — generated from ${path.basename(FILE)}`,
          `Plan date: ${PLAN_DATE}`,
          `Sheet: Company_NetBuy`,
          plan.earliestOrderBy ? `EarliestOrderBy: ${plan.earliestOrderBy.toISOString().slice(0, 10)}` : '',
          plan.earliestNeed ? `EarliestNeed: ${plan.earliestNeed.toISOString().slice(0, 10)}` : '',
          `DO NOT SEND — this is a planning draft.`,
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
                "source"   = ${SOURCE_TAG},
                "status"   = 'DRAFT'::"POStatus",
                "updatedAt" = NOW()
            WHERE "id" = ${existingPO.id}
          `
          poId = existingPO.id
          updatedPOs++
        } else {
          poId = mkId()
          await tx.$executeRaw`
            INSERT INTO "PurchaseOrder" (
              "id", "poNumber", "vendorId", "createdById",
              "status", "subtotal", "shippingCost", "total",
              "expectedDate", "notes", "source",
              "createdAt", "updatedAt"
            ) VALUES (
              ${poId}, ${plan.poNumber}, ${plan.vendorId}, ${creator.id},
              'DRAFT'::"POStatus", ${roundedSubtotal}, 0, ${roundedSubtotal},
              ${plan.earliestNeed}, ${notes}, ${SOURCE_TAG},
              NOW(), NOW()
            )
          `
          createdPOs++
        }

        for (const item of plan.items) {
          const qty = Math.ceil(item.QtyToBuy)
          const lineTotal = Math.round(qty * item.UnitCost * 100) / 100
          const descBits = [item.ProductName, item.Uom ? `(${item.Uom})` : '']
            .filter(Boolean)
            .join(' ')
          await tx.purchaseOrderItem.create({
            data: {
              purchaseOrderId: poId,
              productId: item.productId,
              vendorSku: item.SKU,
              description: descBits || item.SKU,
              quantity: qty,
              unitCost: item.UnitCost,
              lineTotal,
            },
          })
          createdItems++
        }
      }
    }, { timeout: 120_000, maxWait: 10_000 })

    console.log(`POs created:  ${createdPOs}`)
    console.log(`POs updated:  ${updatedPOs}`)
    console.log(`Items written: ${createdItems}`)
    console.log('Done.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
