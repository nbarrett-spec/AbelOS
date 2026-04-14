export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET  /api/ops/procurement/purchase-orders/[id] — PO detail with items
// PATCH /api/ops/procurement/purchase-orders/[id] — Update PO status/receive
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const pos = await prisma.$queryRawUnsafe(`
      SELECT po.*, s."name" as "supplierName", s."type" as "supplierType",
        s."contactName" as "supplierContact", s."contactEmail" as "supplierEmail",
        s."country" as "supplierCountry", s."avgLeadTimeDays" as "supplierLeadTime"
      FROM "PurchaseOrder" po
      JOIN "Supplier" s ON po."supplierId" = s."id"
      WHERE po."id" = $1
    `, id) as any[]

    if (!pos.length) return NextResponse.json({ error: 'PO not found' }, { status: 404 })

    const items = await prisma.$queryRawUnsafe(`
      SELECT poi.*, p."name" as "catalogName", p."category" as "productCategory"
      FROM "PurchaseOrderItem" poi
      LEFT JOIN "Product" p ON poi."productId" = p."id"
      WHERE poi."poId" = $1
      ORDER BY poi."createdAt" ASC
    `, id)

    return NextResponse.json({ purchaseOrder: pos[0], items })
  } catch (error) {
    console.error('PO detail error:', error)
    return NextResponse.json({ error: 'Failed to load PO' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()
    const staffId = request.headers.get('x-staff-id')
    const { action } = body

    // ── Approve PO ──────────────────────────────────────────────────────
    if (action === 'approve') {
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = 'APPROVED', "approvedById" = $1, "approvedAt" = NOW(), "updatedAt" = NOW()
        WHERE "id" = $2
      `, staffId, id)
      // Fire automation event (non-blocking)
      fireAutomationEvent('PO_APPROVED', id).catch(e => console.warn('[Automation] event fire failed:', e))
      await audit(request, 'APPROVE', 'PurchaseOrder', id, {})
      return NextResponse.json({ success: true, message: 'PO approved' })
    }

    // ── Send to Supplier ────────────────────────────────────────────────
    if (action === 'send') {
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = 'SENT', "updatedAt" = NOW()
        WHERE "id" = $1
      `, id)
      await audit(request, 'SEND', 'PurchaseOrder', id, {})
      return NextResponse.json({ success: true, message: 'PO sent to supplier' })
    }

    // ── Mark In Transit ─────────────────────────────────────────────────
    if (action === 'in_transit') {
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = 'IN_TRANSIT', "trackingNumber" = $1, "updatedAt" = NOW()
        WHERE "id" = $2
      `, body.trackingNumber || null, id)
      await audit(request, 'UPDATE', 'PurchaseOrder', id, { status: 'IN_TRANSIT', trackingNumber: body.trackingNumber })
      return NextResponse.json({ success: true, message: 'PO marked in transit' })
    }

    // ── Receive Items ───────────────────────────────────────────────────
    if (action === 'receive') {
      const { receivedItems } = body // [{ itemId, quantityReceived }]

      for (const ri of receivedItems || []) {
        // Update PO item received qty
        await prisma.$queryRawUnsafe(`
          UPDATE "PurchaseOrderItem"
          SET "quantityReceived" = "quantityReceived" + $1
          WHERE "id" = $2
        `, ri.quantityReceived, ri.itemId)

        // Update inventory
        const poItems = await prisma.$queryRawUnsafe(`
          SELECT "productId", "sku" FROM "PurchaseOrderItem" WHERE "id" = $1
        `, ri.itemId) as any[]

        if (poItems[0]?.productId) {
          await prisma.$queryRawUnsafe(`
            UPDATE "InventoryItem"
            SET "quantityOnHand" = "quantityOnHand" + $1,
                "quantityOnOrder" = GREATEST("quantityOnOrder" - $1, 0),
                "lastReceivedAt" = NOW(),
                "updatedAt" = NOW()
            WHERE "productId" = $2
          `, ri.quantityReceived, poItems[0].productId)
        }
      }

      // Check if fully received
      const check = await prisma.$queryRawUnsafe(`
        SELECT
          COALESCE(SUM("quantity"), 0)::int as "totalOrdered",
          COALESCE(SUM("quantityReceived"), 0)::int as "totalReceived"
        FROM "PurchaseOrderItem" WHERE "poId" = $1
      `, id) as any[]

      const fullyReceived = check[0].totalReceived >= check[0].totalOrdered
      const newStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'

      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = $1,
            "receivedById" = CASE WHEN $1 = 'RECEIVED' THEN $2 ELSE "receivedById" END,
            "receivedAt" = CASE WHEN $1 = 'RECEIVED' THEN NOW() ELSE "receivedAt" END,
            "actualDate" = CASE WHEN $1 = 'RECEIVED' THEN NOW() ELSE "actualDate" END,
            "updatedAt" = NOW()
        WHERE "id" = $3
      `, newStatus, staffId, id)

      // Fire automation event for RECEIVED status (non-blocking)
      if (fullyReceived) {
        fireAutomationEvent('PO_RECEIVED', id).catch(e => console.warn('[Automation] event fire failed:', e))
      }

      await audit(request, 'RECEIVE', 'PurchaseOrder', id, { status: newStatus, fullyReceived, itemCount: (receivedItems || []).length })

      return NextResponse.json({ success: true, status: newStatus, fullyReceived })
    }

    // ── Cancel PO ───────────────────────────────────────────────────────
    if (action === 'cancel') {
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET "status" = 'CANCELLED', "updatedAt" = NOW(), "notes" = COALESCE("notes", '') || E'\nCancelled: ' || $1
        WHERE "id" = $2
      `, body.reason || 'No reason given', id)
      await audit(request, 'CANCEL', 'PurchaseOrder', id, { reason: body.reason })
      return NextResponse.json({ success: true, message: 'PO cancelled' })
    }

    // ── Generic field update ────────────────────────────────────────────
    const { status, expectedDate, notes, trackingNumber, shippingMethod } = body
    const fields: string[] = []
    const values: any[] = []
    let idx = 1

    if (status) { fields.push(`"status" = $${idx}`); values.push(status); idx++ }
    if (expectedDate) { fields.push(`"expectedDate" = $${idx}`); values.push(expectedDate); idx++ }
    if (notes !== undefined) { fields.push(`"notes" = $${idx}`); values.push(notes); idx++ }
    if (trackingNumber) { fields.push(`"trackingNumber" = $${idx}`); values.push(trackingNumber); idx++ }
    if (shippingMethod) { fields.push(`"shippingMethod" = $${idx}`); values.push(shippingMethod); idx++ }

    if (fields.length > 0) {
      fields.push(`"updatedAt" = NOW()`)
      values.push(id)
      await prisma.$queryRawUnsafe(`
        UPDATE "PurchaseOrder" SET ${fields.join(', ')} WHERE "id" = $${idx}
      `, ...values)
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('PO update error:', error)
    return NextResponse.json({ error: 'Failed to update PO', details: String(error) }, { status: 500 })
  }
}
