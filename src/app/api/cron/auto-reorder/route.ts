export const dynamic = 'force-dynamic'

import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { withCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'

interface AutoReorderResult {
  asOf: string
  productsTriggered: number // active inventory rows where available <= reorderPoint AND available > 0
  productsSkippedOpenPO: number // already on a non-CANCELLED, non-RECEIVED PO
  productsSkippedNoVendor: number // no preferred or fallback vendor available
  productsIncluded: number // ended up on a draft PO this run
  draftPOsCreated: number
  vendorsCovered: number
  errors: string[]
}

/**
 * GET  /api/cron/auto-reorder — cron trigger (requires CRON_SECRET)
 * POST /api/cron/auto-reorder — manual trigger (requires staff auth)
 *
 * A-BIZ-4: Auto-generate DRAFT POs when inventory hits reorder point.
 *
 * Daily 5am cron. Logic:
 *   1. Find InventoryItem rows where available <= reorderPoint AND available > 0.
 *      (Stocked-out items need expedited / split-vendor handling — out of scope.)
 *   2. For each product, skip if it already has an open PO (status NOT IN
 *      CANCELLED, RECEIVED, PARTIALLY_RECEIVED) — avoids duplicate orders.
 *      This is what makes the cron idempotent: a second run the same day
 *      finds the just-created DRAFTs and skips.
 *   3. Resolve vendor: prefer VendorProduct.preferred=true, then most-recently-
 *      updated VendorProduct, then vendor of last RECEIVED PO line for the
 *      product. (Product table has no preferredVendorId column — the canonical
 *      signal lives on VendorProduct, same source /api/ops/mrp/suggest-po uses.)
 *   4. Group products by resolved vendor, create one DRAFT PurchaseOrder per
 *      vendor with line items for each product needing reorder.
 *   5. Quantity per line: InventoryItem.reorderQty if > 0, else
 *      (reorderPoint - available) + safetyStock, with a min-order-qty floor
 *      from VendorProduct.minOrderQty.
 *
 * Stays as DRAFT — humans review on /ops/purchasing before approving/sending.
 */

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return withCronRun('auto-reorder', () => runAutoReorder())
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return withCronRun('auto-reorder', () => runAutoReorder(), { triggeredBy: 'manual' })
}

async function runAutoReorder(): Promise<NextResponse<AutoReorderResult>> {
  const result: AutoReorderResult = {
    asOf: new Date().toISOString(),
    productsTriggered: 0,
    productsSkippedOpenPO: 0,
    productsSkippedNoVendor: 0,
    productsIncluded: 0,
    draftPOsCreated: 0,
    vendorsCovered: 0,
    errors: [],
  }

  try {
    // Step 1 — find triggered inventory. Skip stocked-out (available <= 0) on
    // purpose: those are expedite-or-substitute decisions, not "draft a normal
    // PO" decisions. Bound the scan to PHYSICAL products via Product join.
    const triggered: Array<{
      productId: string
      sku: string
      productName: string
      available: number
      reorderPoint: number
      reorderQty: number
      safetyStock: number
      productCost: number
    }> = await prisma.$queryRawUnsafe(`
      SELECT
        ii."productId",
        COALESCE(ii."sku", p."sku") AS "sku",
        COALESCE(ii."productName", p."name") AS "productName",
        ii."available",
        ii."reorderPoint",
        ii."reorderQty",
        ii."safetyStock",
        COALESCE(p."cost", 0) AS "productCost"
      FROM "InventoryItem" ii
      JOIN "Product" p ON p."id" = ii."productId"
      WHERE p."active" = true
        AND COALESCE(p."productType", 'PHYSICAL') = 'PHYSICAL'
        AND ii."reorderPoint" > 0
        AND ii."available" <= ii."reorderPoint"
        AND ii."available" > 0
    `)

    result.productsTriggered = triggered.length
    if (triggered.length === 0) {
      return NextResponse.json(result)
    }

    // Step 2 — dedupe against open POs. One round-trip for all triggered
    // productIds is much cheaper than N per-product checks.
    const productIds = triggered.map((t) => t.productId)
    const openLines = await prisma.purchaseOrderItem.findMany({
      where: {
        productId: { in: productIds },
        purchaseOrder: {
          status: { notIn: ['CANCELLED', 'RECEIVED', 'PARTIALLY_RECEIVED'] },
        },
      },
      select: { productId: true },
    })
    const openProductIds = new Set(openLines.map((l) => l.productId).filter(Boolean) as string[])

    const eligible = triggered.filter((t) => !openProductIds.has(t.productId))
    result.productsSkippedOpenPO = triggered.length - eligible.length
    if (eligible.length === 0) {
      return NextResponse.json(result)
    }

    // Step 3 — resolve vendor per product. Strategy mirrors suggest-po:
    //   a. Preferred VendorProduct.
    //   b. Most-recent VendorProduct.
    //   c. Vendor on the most recent RECEIVED PO line for this product.
    const eligibleIds = eligible.map((e) => e.productId)
    const vendorProducts = await prisma.vendorProduct.findMany({
      where: { productId: { in: eligibleIds } },
      orderBy: [{ preferred: 'desc' }, { updatedAt: 'desc' }],
      select: {
        productId: true,
        vendorId: true,
        vendorCost: true,
        vendorSku: true,
        minOrderQty: true,
        preferred: true,
      },
    })
    const vpByProduct = new Map<string, (typeof vendorProducts)[number]>()
    for (const vp of vendorProducts) {
      // first hit wins because the orderBy is preferred-desc, updatedAt-desc
      if (!vpByProduct.has(vp.productId)) vpByProduct.set(vp.productId, vp)
    }

    // Fallback for products with no VendorProduct row at all: vendor of last PO
    const productsWithoutVp = eligibleIds.filter((id) => !vpByProduct.has(id))
    const fallbackVendorByProduct = new Map<string, { vendorId: string; vendorSku: string | null; unitCost: number | null }>()
    if (productsWithoutVp.length > 0) {
      const lastLines: Array<{ productId: string; vendorId: string; vendorSku: string; unitCost: number }> =
        await prisma.$queryRawUnsafe(
          `
          SELECT DISTINCT ON (poi."productId")
            poi."productId",
            po."vendorId",
            poi."vendorSku",
            poi."unitCost"
          FROM "PurchaseOrderItem" poi
          JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
          WHERE poi."productId" = ANY($1::text[])
            AND po."status" IN ('RECEIVED', 'PARTIALLY_RECEIVED', 'SENT_TO_VENDOR', 'APPROVED')
          ORDER BY poi."productId", po."createdAt" DESC
          `,
          productsWithoutVp
        )
      for (const row of lastLines) {
        fallbackVendorByProduct.set(row.productId, {
          vendorId: row.vendorId,
          vendorSku: row.vendorSku,
          unitCost: row.unitCost,
        })
      }
    }

    // Step 4 — group by vendor.
    type Line = {
      productId: string
      sku: string
      name: string
      vendorSku: string
      quantity: number
      unitCost: number
    }
    const linesByVendor = new Map<string, Line[]>()

    for (const t of eligible) {
      const vp = vpByProduct.get(t.productId)
      const fb = fallbackVendorByProduct.get(t.productId)

      let vendorId: string | null = null
      let vendorSku: string = t.sku
      let unitCost: number = t.productCost
      let minOrderQty = 1

      if (vp) {
        vendorId = vp.vendorId
        vendorSku = vp.vendorSku || t.sku
        unitCost = vp.vendorCost ?? t.productCost
        minOrderQty = vp.minOrderQty || 1
      } else if (fb) {
        vendorId = fb.vendorId
        vendorSku = fb.vendorSku || t.sku
        unitCost = fb.unitCost ?? t.productCost
      }

      if (!vendorId) {
        result.productsSkippedNoVendor += 1
        continue
      }

      // Quantity: prefer explicit reorderQty, else (gap to reorderPoint) +
      // safetyStock, with vendor MOQ floor and a minimum of 1.
      const gapQty = Math.max(0, t.reorderPoint - t.available) + (t.safetyStock || 0)
      const baseQty = t.reorderQty && t.reorderQty > 0 ? t.reorderQty : gapQty
      const quantity = Math.max(1, baseQty, minOrderQty)

      const line: Line = {
        productId: t.productId,
        sku: t.sku,
        name: t.productName,
        vendorSku,
        quantity,
        unitCost,
      }
      const arr = linesByVendor.get(vendorId)
      if (arr) arr.push(line)
      else linesByVendor.set(vendorId, [line])
    }

    result.productsIncluded = Array.from(linesByVendor.values()).reduce((s, l) => s + l.length, 0)
    result.vendorsCovered = linesByVendor.size

    if (linesByVendor.size === 0) {
      return NextResponse.json(result)
    }

    // Author lookup (createdBy is required) — use the first active staff,
    // matching the suggest-po fallback. The PO is DRAFT so a real human
    // approver overrides this on approval.
    const staff = await prisma.staff.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!staff) {
      result.errors.push('No active staff found to author auto-reorder POs')
      return NextResponse.json(result)
    }

    // Step 5 — create one DRAFT PO per vendor. PO numbers use AUTO prefix so
    // they're visually distinct from manual ('PO-YYYY-####') and MRP
    // ('PO-MRP-YYYY-####') POs on the purchasing list.
    const year = new Date().getFullYear()
    const lastPO = await prisma.purchaseOrder.findFirst({
      where: { poNumber: { startsWith: `PO-AUTO-${year}-` } },
      orderBy: { createdAt: 'desc' },
      select: { poNumber: true },
    })
    let seq = lastPO?.poNumber ? parseInt(lastPO.poNumber.split('-').pop() || '0', 10) : 0

    for (const [vendorId, lines] of linesByVendor.entries()) {
      try {
        seq += 1
        const poNumber = `PO-AUTO-${year}-${String(seq).padStart(4, '0')}`
        const subtotal = lines.reduce((s, l) => s + l.quantity * l.unitCost, 0)

        await prisma.purchaseOrder.create({
          data: {
            poNumber,
            vendorId,
            createdById: staff.id,
            status: 'DRAFT',
            subtotal,
            total: subtotal,
            source: 'AUTO_REORDER',
            notes: `Auto-reorder: ${lines.length} SKU(s) at/below reorder point`,
            items: {
              create: lines.map((l) => ({
                productId: l.productId,
                vendorSku: l.vendorSku,
                description: l.name,
                quantity: l.quantity,
                unitCost: l.unitCost,
                lineTotal: l.quantity * l.unitCost,
              })),
            },
          },
        })
        result.draftPOsCreated += 1
      } catch (e: any) {
        const msg = `vendor ${vendorId}: ${e?.message || String(e)}`
        result.errors.push(msg)
        logger.error('auto_reorder_po_create_failed', e, { vendorId, lineCount: lines.length })
        Sentry.captureException(e, {
          tags: { route: '/api/cron/auto-reorder', cron: 'auto-reorder', stage: 'po-create' },
          extra: { vendorId, lineCount: lines.length },
        })
      }
    }

    return NextResponse.json(result)
  } catch (e: any) {
    logger.error('auto_reorder_run_failed', e)
    Sentry.captureException(e, { tags: { route: '/api/cron/auto-reorder', cron: 'auto-reorder' } })
    result.errors.push(e?.message || String(e))
    return NextResponse.json(result, { status: 500 })
  }
}
