export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/returns
 * List vendor returns with filtering, pagination, and vendor/PO details
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const status = searchParams.get('status')
    const vendorId = searchParams.get('vendorId')
    const dateFrom = searchParams.get('dateFrom')
    const dateTo = searchParams.get('dateTo')

    const skip = (page - 1) * limit

    // Build WHERE clause dynamically
    let whereClause = ''
    if (status) {
      whereClause += ` AND vr."status" = '${status}'`
    }
    if (vendorId) {
      whereClause += ` AND vr."vendorId" = '${vendorId}'`
    }
    if (dateFrom) {
      whereClause += ` AND vr."createdAt" >= '${dateFrom}'::timestamptz`
    }
    if (dateTo) {
      whereClause += ` AND vr."createdAt" <= '${dateTo}T23:59:59.999Z'::timestamptz`
    }

    // Main query with vendor info and item counts
    const mainQuery = `
      SELECT
        vr."id",
        vr."returnNumber",
        vr."purchaseOrderId",
        vr."vendorId",
        vr."status",
        vr."reason",
        vr."returnType",
        vr."totalAmount",
        vr."creditReceived",
        vr."trackingNumber",
        vr."rmaNumber",
        vr."createdById",
        vr."approvedById",
        vr."shippedAt",
        vr."resolvedAt",
        vr."notes",
        vr."createdAt",
        vr."updatedAt",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code",
          'contactName', v."contactName",
          'email', v."email",
          'phone', v."phone"
        ) as "vendor",
        po."poNumber",
        (SELECT COUNT(*)::int FROM "VendorReturnItem" WHERE "vendorReturnId" = vr."id") as "itemCount"
      FROM "VendorReturn" vr
      LEFT JOIN "Vendor" v ON vr."vendorId" = v."id"
      LEFT JOIN "PurchaseOrder" po ON vr."purchaseOrderId" = po."id"
      WHERE 1=1 ${whereClause}
      ORDER BY vr."createdAt" DESC
      LIMIT ${limit} OFFSET ${skip}
    `

    // Count query for total
    const countQuery = `
      SELECT COUNT(*)::int as "total"
      FROM "VendorReturn" vr
      WHERE 1=1 ${whereClause}
    `

    // Status counts query
    const statusCountsQuery = `
      SELECT "status", COUNT(*)::int as "count"
      FROM "VendorReturn"
      GROUP BY "status"
    `

    const [returns, countResult, statusCountsResult] = await Promise.all([
      prisma.$queryRawUnsafe<Array<any>>(mainQuery),
      prisma.$queryRawUnsafe<Array<{ total: number }>>(countQuery),
      prisma.$queryRawUnsafe<Array<{ status: string; count: number }>>(statusCountsQuery),
    ])

    const total = countResult[0]?.total || 0
    const statusCounts = statusCountsResult.reduce(
      (acc, row) => {
        acc[row.status] = row.count
        return acc
      },
      {} as Record<string, number>
    )

    return NextResponse.json({
      returns,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
      statusCounts,
    })
  } catch (error) {
    console.error('Failed to fetch returns:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/ops/returns
 * Create a new vendor return
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      purchaseOrderId,
      reason,
      returnType,
      items,
      notes,
    } = body

    // Validate required fields
    if (!purchaseOrderId || !reason || !returnType || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing or invalid required fields' },
        { status: 400 }
      )
    }

    // Get PO info to find vendor
    const poQuery = `
      SELECT "vendorId" FROM "PurchaseOrder" WHERE "id" = $1
    `
    const [poResult] = await prisma.$queryRawUnsafe<Array<{ vendorId: string }>>(
      poQuery,
      purchaseOrderId
    )

    if (!poResult) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }

    const vendorId = poResult.vendorId

    // Get staff ID from headers
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Staff ID required' }, { status: 400 })
    }

    // Generate return number: RMA-YYYY-NNNN
    const yearStr = new Date().getFullYear().toString()
    const maxNumberQuery = `
      SELECT COALESCE(MAX(CAST(SUBSTRING("returnNumber", 8) AS INTEGER)), 0) as "maxNum"
      FROM "VendorReturn"
      WHERE "returnNumber" LIKE $1
    `
    const [maxResult] = await prisma.$queryRawUnsafe<Array<{ maxNum: number }>>(
      maxNumberQuery,
      `RMA-${yearStr}-%`
    )

    const nextNumber = (maxResult?.maxNum || 0) + 1
    const returnNumber = `RMA-${yearStr}-${nextNumber.toString().padStart(4, '0')}`

    // Calculate total amount
    const totalAmount = items.reduce((sum: number, item: any) => sum + (item.lineTotal || 0), 0)

    // Start transaction: create return and items
    const insertReturnQuery = `
      INSERT INTO "VendorReturn" (
        "id",
        "returnNumber",
        "purchaseOrderId",
        "vendorId",
        "status",
        "reason",
        "returnType",
        "totalAmount",
        "creditReceived",
        "createdById",
        "notes",
        "createdAt",
        "updatedAt"
      ) VALUES (
        gen_random_uuid()::text,
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        NOW(),
        NOW()
      )
      RETURNING "id"
    `

    const [newReturn] = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      insertReturnQuery,
      returnNumber,
      purchaseOrderId,
      vendorId,
      'PENDING',
      reason,
      returnType,
      totalAmount,
      0, // creditReceived starts at 0
      staffId,
      notes || null
    )

    const returnId = newReturn.id

    // Insert return items
    for (const item of items) {
      const insertItemQuery = `
        INSERT INTO "VendorReturnItem" (
          "id",
          "vendorReturnId",
          "purchaseOrderItemId",
          "productId",
          "description",
          "quantity",
          "unitCost",
          "lineTotal",
          "reason",
          "condition"
        ) VALUES (
          gen_random_uuid()::text,
          $1,
          $2,
          $3,
          $4,
          $5,
          $6,
          $7,
          $8,
          $9
        )
      `

      await prisma.$queryRawUnsafe(
        insertItemQuery,
        returnId,
        item.purchaseOrderItemId || null,
        item.productId || null,
        item.description,
        item.quantity,
        item.unitCost,
        item.lineTotal || item.quantity * item.unitCost,
        item.reason || null,
        item.condition || null
      )

      // Update inventory: decrement onHand if productId exists
      if (item.productId) {
        const updateInventoryQuery = `
          UPDATE "InventoryItem"
          SET
            "onHand" = GREATEST(0, "onHand" - $1),
            "available" = GREATEST(0, "onHand" - $1 - "committed"),
            "updatedAt" = NOW()
          WHERE "productId" = $2
        `
        await prisma.$queryRawUnsafe(updateInventoryQuery, item.quantity, item.productId)
      }
    }

    await audit(request, 'CREATE', 'Return', returnId, { returnNumber, totalAmount, itemCount: items.length })

    return NextResponse.json(
      {
        id: returnId,
        returnNumber,
        purchaseOrderId,
        vendorId,
        status: 'PENDING',
        totalAmount,
        itemCount: items.length,
        createdAt: new Date(),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('Failed to create return:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
