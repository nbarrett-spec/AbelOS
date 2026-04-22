export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/procurement/purchase-orders — List POs
// POST /api/ops/procurement/purchase-orders — Create PO
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const vendorId = searchParams.get('vendorId') || searchParams.get('supplierId')
    const search = searchParams.get('search')

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status && status !== 'ALL') { conditions.push(`po."status"::text = $${idx}`); params.push(status); idx++ }
    if (vendorId) { conditions.push(`po."vendorId" = $${idx}`); params.push(vendorId); idx++ }
    if (search) { conditions.push(`(po."poNumber" ILIKE $${idx} OR v."name" ILIKE $${idx})`); params.push(`%${search}%`); idx++ }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const orders = await prisma.$queryRawUnsafe(`
      SELECT po.id, po."poNumber", po."vendorId", po."createdById", po."approvedById",
        po.status::text as status, po.subtotal, po."shippingCost", po.total,
        po."orderedAt", po."expectedDate", po."receivedAt", po.notes,
        po."createdAt", po."updatedAt",
        v."name" as "vendorName",
        v."code" as "vendorCode",
        (SELECT COUNT(*)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") as "itemCount",
        (SELECT COALESCE(SUM(poi."receivedQty"), 0)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") as "totalReceived",
        (SELECT COALESCE(SUM(poi."quantity"), 0)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") as "totalOrdered"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON po."vendorId" = v."id"
      ${where}
      ORDER BY
        CASE po."status"::text
          WHEN 'DRAFT' THEN 1 WHEN 'PENDING_APPROVAL' THEN 2 WHEN 'APPROVED' THEN 3
          WHEN 'SENT_TO_VENDOR' THEN 4 WHEN 'PARTIALLY_RECEIVED' THEN 5
          WHEN 'RECEIVED' THEN 6 WHEN 'CANCELLED' THEN 7
        END,
        po."createdAt" DESC
    `, ...params)

    // Summary stats
    const stats = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalPOs",
        COUNT(*) FILTER (WHERE "status"::text = 'DRAFT')::int as "draftCount",
        COUNT(*) FILTER (WHERE "status"::text IN ('SENT_TO_VENDOR', 'APPROVED'))::int as "openCount",
        COUNT(*) FILTER (WHERE "status"::text = 'PENDING_APPROVAL')::int as "pendingApproval",
        COALESCE(SUM("total") FILTER (WHERE "status"::text NOT IN ('CANCELLED', 'DRAFT')), 0) as "totalSpend",
        COALESCE(SUM("total") FILTER (WHERE "status"::text IN ('SENT_TO_VENDOR', 'APPROVED')), 0) as "openValue",
        COUNT(*) FILTER (WHERE "expectedDate" < NOW() AND "status"::text IN ('SENT_TO_VENDOR', 'APPROVED'))::int as "overdueCount"
      FROM "PurchaseOrder"
    `) as any[]

    return NextResponse.json({ orders, stats: stats[0] })
  } catch (error) {
    console.error('PO list error:', error)
    return NextResponse.json({ error: 'Failed to load purchase orders' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { vendorId, items, notes, expectedDate } = body
    const staffId = request.headers.get('x-staff-id')

    const supplierId = vendorId || body.supplierId
    if (!supplierId || !items?.length) {
      return NextResponse.json({ error: 'Vendor and at least one item required' }, { status: 400 })
    }

    // Generate PO number
    const poCount = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int as count FROM "PurchaseOrder"
    `) as any[]
    const poNum = `PO-${new Date().getFullYear()}-${String((poCount[0]?.count || 0) + 1).padStart(4, '0')}`

    // Calculate totals
    let subtotal = 0
    for (const item of items) {
      subtotal += (item.unitCost || 0) * (item.quantity || 0)
    }
    const total = subtotal

    const poId = `po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    // Create PO — use parameterized values, handle expectedDate carefully
    if (expectedDate) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PurchaseOrder" (
          "id", "poNumber", "vendorId", "createdById", "status", "subtotal", "shippingCost",
          "total", "expectedDate", "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, 0, $6, $7::timestamptz, $8, NOW(), NOW())
      `, poId, poNum, supplierId, staffId || 'system', subtotal, total, expectedDate, notes || null)
    } else {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PurchaseOrder" (
          "id", "poNumber", "vendorId", "createdById", "status", "subtotal", "shippingCost",
          "total", "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, 'DRAFT', $5, 0, $6, $7, NOW(), NOW())
      `, poId, poNum, supplierId, staffId || 'system', subtotal, total, notes || null)
    }

    // Create line items
    for (const item of items) {
      const itemId = `poi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(`
        INSERT INTO "PurchaseOrderItem" ("id", "purchaseOrderId", "productId", "vendorSku", "description", "quantity", "unitCost", "lineTotal", "receivedQty", "damagedQty", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, NOW(), NOW())
      `, itemId, poId, item.productId || null, item.vendorSku || item.sku || '', item.description || item.productName || 'Item',
         item.quantity || 1, item.unitCost || 0, (item.unitCost || 0) * (item.quantity || 0))
    }

    // Fetch created PO
    const pos = await prisma.$queryRawUnsafe(`
      SELECT po.*, v."name" as "vendorName"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON po."vendorId" = v.id
      WHERE po.id = $1
    `, poId) as any[]

    // Fire automation event (non-blocking)
    fireAutomationEvent('PO_CREATED', poId).catch(e => console.warn('[Automation] event fire failed:', e))

    await audit(request, 'CREATE', 'PurchaseOrder', poId, { poNumber: poNum, vendorId: supplierId, total, itemCount: items.length })

    return NextResponse.json({ purchaseOrder: pos[0], poNumber: poNum }, { status: 201 })
  } catch (error) {
    console.error('PO create error:', error)
    return NextResponse.json({ error: 'Failed to create purchase order', details: String(error) }, { status: 500 })
  }
}
