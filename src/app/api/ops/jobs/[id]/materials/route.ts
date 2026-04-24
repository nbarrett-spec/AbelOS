export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * Materials snapshot for a single Job — used by the right-slide
 * MaterialDrawer on the Job detail page.
 *
 * Shape:
 *   { jobId, asOf, items: [{ sku, description, needed, onHand, incoming,
 *     short, openPOs: [{ poId, qty, expectedDate }] }],
 *     summary: { totalSkus, shortSkus, shortageDollars } }
 *
 * Derivation:
 *   - needed     = SUM(InventoryAllocation.quantity) WHERE jobId AND
 *                  status IN ('RESERVED','PICKED','BACKORDERED') per product.
 *   - onHand     = InventoryItem.onHand for the product.
 *   - incoming   = SUM(PurchaseOrderItem.quantity - receivedQty) across open
 *                  POs (status NOT IN ('RECEIVED','CANCELLED')), per product.
 *   - short      = max(needed - onHand - incoming, 0)
 *   - shortageDollars = sum(short * product.cost) across SKUs.
 *
 * Read-only. No mutations → no audit entries.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id: jobId } = params
  if (!jobId) {
    return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })
  }

  try {
    // 1. Needed per product (BoM from allocations).
    //    BACKORDERED rows still count as "needed" — they're the shortage.
    //    RELEASED and CONSUMED rows do not count toward current need.
    const needed: Array<{
      productId: string
      sku: string | null
      productName: string | null
      needed: number
      cost: number | null
    }> = await prisma.$queryRawUnsafe(
      `SELECT ia."productId",
              p."sku",
              p."name" AS "productName",
              p."cost",
              SUM(ia."quantity")::int AS "needed"
         FROM "InventoryAllocation" ia
         LEFT JOIN "Product" p ON p."id" = ia."productId"
        WHERE ia."jobId" = $1
          AND ia."status" IN ('RESERVED','PICKED','BACKORDERED')
        GROUP BY ia."productId", p."sku", p."name", p."cost"
        ORDER BY p."sku" NULLS LAST`,
      jobId
    )

    if (needed.length === 0) {
      return NextResponse.json({
        jobId,
        asOf: new Date().toISOString(),
        items: [],
        summary: { totalSkus: 0, shortSkus: 0, shortageDollars: 0 },
      })
    }

    const productIds = needed.map((n) => n.productId)

    // 2. InventoryItem.onHand per product.
    const onHandRows: Array<{ productId: string; onHand: number }> =
      await prisma.$queryRawUnsafe(
        `SELECT "productId", "onHand"
           FROM "InventoryItem"
          WHERE "productId" = ANY($1::text[])`,
        productIds
      )
    const onHandMap = new Map(onHandRows.map((r) => [r.productId, r.onHand]))

    // 3. Open POs — items per product with expected date + PO id.
    //    "Open" = status not in terminal states.
    const openPoItems: Array<{
      productId: string
      poId: string
      poNumber: string
      qty: number
      receivedQty: number
      expectedDate: Date | null
    }> = await prisma.$queryRawUnsafe(
      `SELECT poi."productId",
              po."id"          AS "poId",
              po."poNumber"    AS "poNumber",
              poi."quantity"   AS "qty",
              poi."receivedQty" AS "receivedQty",
              po."expectedDate"
         FROM "PurchaseOrderItem" poi
         JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
        WHERE poi."productId" = ANY($1::text[])
          AND po."status" NOT IN ('RECEIVED','CANCELLED')
        ORDER BY po."expectedDate" ASC NULLS LAST`,
      productIds
    )

    // Group open-PO rows by productId.
    const openPoByProduct = new Map<
      string,
      Array<{ poId: string; poNumber: string; qty: number; expectedDate: string | null }>
    >()
    for (const r of openPoItems) {
      const remaining = Math.max(0, (r.qty ?? 0) - (r.receivedQty ?? 0))
      if (remaining <= 0) continue
      const arr = openPoByProduct.get(r.productId) ?? []
      arr.push({
        poId: r.poId,
        poNumber: r.poNumber,
        qty: remaining,
        expectedDate: r.expectedDate ? new Date(r.expectedDate).toISOString() : null,
      })
      openPoByProduct.set(r.productId, arr)
    }

    // 4. Assemble items.
    const items = needed.map((n) => {
      const onHand = onHandMap.get(n.productId) ?? 0
      const openPOs = openPoByProduct.get(n.productId) ?? []
      const incoming = openPOs.reduce((s, p) => s + (p.qty ?? 0), 0)
      const short = Math.max(0, (n.needed ?? 0) - onHand - incoming)
      // Earliest expected date across open POs for this product.
      const expectedDate =
        openPOs
          .map((p) => p.expectedDate)
          .filter((d): d is string => !!d)
          .sort()[0] ?? null
      return {
        productId: n.productId,
        sku: n.sku ?? null,
        description: n.productName ?? null,
        needed: n.needed ?? 0,
        onHand,
        incoming,
        short,
        expectedDate,
        unitCost: n.cost ?? 0,
        openPOs,
      }
    })

    // 5. Sort: short desc, then SKU asc (null SKUs last).
    items.sort((a, b) => {
      if (b.short !== a.short) return b.short - a.short
      if (a.sku == null && b.sku == null) return 0
      if (a.sku == null) return 1
      if (b.sku == null) return -1
      return a.sku.localeCompare(b.sku)
    })

    const shortSkus = items.filter((i) => i.short > 0).length
    const shortageDollars = items.reduce(
      (s, i) => s + i.short * (i.unitCost ?? 0),
      0
    )

    return NextResponse.json({
      jobId,
      asOf: new Date().toISOString(),
      items,
      summary: {
        totalSkus: items.length,
        shortSkus,
        shortageDollars: Math.round(shortageDollars * 100) / 100,
      },
    })
  } catch (err: any) {
    console.error('[materials GET]', err)
    return NextResponse.json(
      { error: 'Failed to load materials', details: err?.message },
      { status: 500 }
    )
  }
}
