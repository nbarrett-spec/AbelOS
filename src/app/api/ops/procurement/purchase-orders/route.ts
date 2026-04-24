export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { audit } from '@/lib/audit'
import { toCsv } from '@/lib/csv'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/procurement/purchase-orders — List POs
//
// Query params:
//   ?status=DRAFT|SENT_TO_VENDOR|... | 'ALL'   filter by PO status
//   ?vendorId=... (alias supplierId)           filter by vendor
//   ?builderId=...                             filter by linked builder
//                                              (PO -> MaterialWatch -> Order.builderId)
//   ?pmId=...                                  filter by job's assigned PM
//                                              (PO -> MaterialWatch.jobId -> Job.assignedPMId)
//   ?search=...                                PO# / vendor / builder ILIKE
//   ?sortBy=poNumber|total|status|createdAt    sort key (default createdAt)
//   ?sortDir=asc|desc                          sort direction (default desc)
//   ?format=csv                                CSV export of current filter set
//
// Returns:  { orders: PO[], stats: POStats } or text/csv when format=csv.
// Empty result -> { orders: [], stats: {...} } (NOT 404).
//
// POST /api/ops/procurement/purchase-orders — Create PO
// ──────────────────────────────────────────────────────────────────────────

const SORTABLE_COLUMNS: Record<string, string> = {
  poNumber: 'po."poNumber"',
  total: 'po."total"',
  status: 'po."status"::text',
  createdAt: 'po."createdAt"',
  expectedDate: 'po."expectedDate"',
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const vendorId = searchParams.get('vendorId') || searchParams.get('supplierId')
    const builderId = searchParams.get('builderId')
    const pmId = searchParams.get('pmId')
    const search = searchParams.get('search')
    const format = searchParams.get('format')
    const sortByRaw = searchParams.get('sortBy') || 'createdAt'
    const sortDirRaw = (searchParams.get('sortDir') || 'desc').toLowerCase()

    // Whitelist sort to avoid SQL injection
    const sortColumn = SORTABLE_COLUMNS[sortByRaw] || SORTABLE_COLUMNS.createdAt
    const sortDir = sortDirRaw === 'asc' ? 'ASC' : 'DESC'

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status && status !== 'ALL') {
      conditions.push(`po."status"::text = $${idx}`)
      params.push(status)
      idx++
    }
    if (vendorId) {
      conditions.push(`po."vendorId" = $${idx}`)
      params.push(vendorId)
      idx++
    }
    if (search) {
      conditions.push(`(po."poNumber" ILIKE $${idx} OR v."name" ILIKE $${idx})`)
      params.push(`%${search}%`)
      idx++
    }

    // PM filter: PO is linked through MaterialWatch -> Job.assignedPMId.
    // No direct PO->Job FK exists on the schema, so we go through the watch table.
    if (pmId) {
      conditions.push(`po."id" IN (
        SELECT DISTINCT mw."purchaseOrderId"
          FROM "MaterialWatch" mw
          JOIN "Job" j ON j."id" = mw."jobId"
         WHERE mw."purchaseOrderId" IS NOT NULL
           AND j."assignedPMId" = $${idx}
      )`)
      params.push(pmId)
      idx++
    }

    // Builder filter: similar path — PO -> MaterialWatch.orderId -> Order.builderId.
    if (builderId) {
      conditions.push(`po."id" IN (
        SELECT DISTINCT mw."purchaseOrderId"
          FROM "MaterialWatch" mw
          JOIN "Order" o ON o."id" = mw."orderId"
         WHERE mw."purchaseOrderId" IS NOT NULL
           AND o."builderId" = $${idx}
      )`)
      params.push(builderId)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const ordersRaw = (await prisma.$queryRawUnsafe(
      `
      SELECT po.id, po."poNumber", po."vendorId", po."createdById", po."approvedById",
        po.status::text as status,
        po."category"::text as category,
        po.subtotal, po."shippingCost", po.total,
        po."orderedAt", po."expectedDate", po."receivedAt", po.notes,
        po."aiGenerated", po."recommendationId",
        po."createdAt", po."updatedAt",
        v."name" as "vendorName",
        v."code" as "vendorCode",
        (SELECT COUNT(*)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") as "itemCount",
        (SELECT COALESCE(SUM(poi."receivedQty"), 0)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") as "totalReceived",
        (SELECT COALESCE(SUM(poi."quantity"), 0)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po."id") as "totalOrdered",
        (
          SELECT b."companyName"
            FROM "MaterialWatch" mw
            JOIN "Order" o ON o."id" = mw."orderId"
            JOIN "Builder" b ON b."id" = o."builderId"
           WHERE mw."purchaseOrderId" = po."id"
           LIMIT 1
        ) as "builderName",
        (
          SELECT o."builderId"
            FROM "MaterialWatch" mw
            JOIN "Order" o ON o."id" = mw."orderId"
           WHERE mw."purchaseOrderId" = po."id"
           LIMIT 1
        ) as "builderId",
        (
          SELECT j."assignedPMId"
            FROM "MaterialWatch" mw
            JOIN "Job" j ON j."id" = mw."jobId"
           WHERE mw."purchaseOrderId" = po."id"
             AND j."assignedPMId" IS NOT NULL
           LIMIT 1
        ) as "pmId"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON po."vendorId" = v."id"
      ${where}
      ORDER BY ${sortColumn} ${sortDir}, po."createdAt" DESC
    `,
      ...params,
    )) as any[]

    // Surface PM display name (best-effort, single extra query)
    const pmIds = Array.from(
      new Set(ordersRaw.map((o) => o.pmId).filter((x: string | null) => !!x)),
    ) as string[]
    const pmNames = new Map<string, string>()
    if (pmIds.length > 0) {
      const staff = await prisma.staff.findMany({
        where: { id: { in: pmIds } },
        select: { id: true, firstName: true, lastName: true },
      })
      for (const s of staff) {
        pmNames.set(s.id, `${s.firstName || ''} ${s.lastName || ''}`.trim() || s.id)
      }
    }

    // Reshape to the field names the page expects (supplierName/totalCost) while
    // also keeping the raw fields for any other consumer.
    const orders = ordersRaw.map((o: any) => ({
      ...o,
      // Aliases the page reads
      supplierName: o.vendorName,
      supplierType: o.category || '',
      supplierCountry: '',
      priority: 'STANDARD',
      totalCost: Number(o.total) || 0,
      subtotal: Number(o.subtotal) || 0,
      shippingCost: Number(o.shippingCost) || 0,
      dutyCost: 0,
      actualDate: o.receivedAt,
      trackingNumber: '',
      aiReason: '',
      pmName: o.pmId ? pmNames.get(o.pmId) || '' : '',
    }))

    // Summary stats — global across all POs (not filter-scoped, so the kanban
    // header counts always reflect the whole pipeline like before).
    const stats = (await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalPOs",
        COUNT(*) FILTER (WHERE "status"::text = 'DRAFT')::int as "draftCount",
        COUNT(*) FILTER (WHERE "status"::text IN ('SENT_TO_VENDOR', 'APPROVED'))::int as "openCount",
        COUNT(*) FILTER (WHERE "status"::text = 'PENDING_APPROVAL')::int as "pendingApproval",
        COALESCE(SUM("total") FILTER (WHERE "status"::text NOT IN ('CANCELLED', 'DRAFT')), 0) as "totalSpend",
        COALESCE(SUM("total") FILTER (WHERE "status"::text IN ('SENT_TO_VENDOR', 'APPROVED')), 0) as "openValue",
        COUNT(*) FILTER (WHERE "expectedDate" < NOW() AND "status"::text IN ('SENT_TO_VENDOR', 'APPROVED'))::int as "overdueCount"
      FROM "PurchaseOrder"
    `)) as any[]

    // ── CSV export ─────────────────────────────────────────────────────────
    if (format === 'csv') {
      // Pull line-item summary for every PO in the result set in one round trip.
      const poIds = orders.map((o) => o.id)
      const lineRows: Array<{
        purchaseOrderId: string
        sku: string | null
        quantity: number | null
      }> = poIds.length
        ? ((await prisma.$queryRawUnsafe(
            `
          SELECT poi."purchaseOrderId",
                 COALESCE(p."sku", poi."vendorSku") as sku,
                 poi."quantity"
            FROM "PurchaseOrderItem" poi
            LEFT JOIN "Product" p ON p."id" = poi."productId"
           WHERE poi."purchaseOrderId" = ANY($1::text[])
           ORDER BY poi."createdAt" ASC
        `,
            poIds,
          )) as any[])
        : []
      const lineByPo = new Map<string, string[]>()
      for (const l of lineRows) {
        const arr = lineByPo.get(l.purchaseOrderId) || []
        arr.push(`${l.sku || '?'} x ${l.quantity ?? 0}`)
        lineByPo.set(l.purchaseOrderId, arr)
      }

      const rows = orders.map((o: any) => ({
        poNumber: o.poNumber,
        vendor: o.vendorName || '',
        builder: o.builderName || '',
        status: o.status,
        total: typeof o.totalCost === 'number' ? o.totalCost.toFixed(2) : o.totalCost,
        createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : '',
        expectedDate: o.expectedDate ? new Date(o.expectedDate).toISOString() : '',
        itemsCount: o.itemCount ?? 0,
        lineItems: (lineByPo.get(o.id) || []).join(', '),
      }))
      const csv = toCsv(rows, [
        { key: 'poNumber', label: 'PO Number' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'builder', label: 'Builder' },
        { key: 'status', label: 'Status' },
        { key: 'total', label: 'Total' },
        { key: 'createdAt', label: 'Created At' },
        { key: 'expectedDate', label: 'Expected Date' },
        { key: 'itemsCount', label: 'Items Count' },
        { key: 'lineItems', label: 'Line Items' },
      ])
      const today = new Date().toISOString().split('T')[0]
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="purchase-orders-${today}.csv"`,
        },
      })
    }

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
