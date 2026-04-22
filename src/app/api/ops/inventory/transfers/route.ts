export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const status = searchParams.get('status')
    const skip = (page - 1) * limit

    const whereConditions: string[] = []
    const params: any[] = []

    if (status) {
      whereConditions.push(`st."status" = $${params.length + 1}`)
      params.push(status)
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : ''

    // Get total count
    const countQuery = `SELECT COUNT(*)::int as "total" FROM "StockTransfer" st ${whereClause}`
    const countResult = await prisma.$queryRawUnsafe(countQuery, ...params)
    const total = (countResult as any[])[0]?.total || 0

    // Get transfers with item counts
    const transfersQuery = `
      SELECT
        st."id", st."transferNumber", st."fromLocation", st."toLocation",
        st."status", st."notes", st."createdById", st."completedAt",
        st."createdAt", st."updatedAt",
        COUNT(sti."id")::int as "itemCount"
      FROM "StockTransfer" st
      LEFT JOIN "StockTransferItem" sti ON st."id" = sti."transferId"
      ${whereClause}
      GROUP BY st."id"
      ORDER BY st."createdAt" DESC
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `
    const transfers = await prisma.$queryRawUnsafe(transfersQuery, ...params, limit, skip)

    return NextResponse.json(
      {
        data: transfers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('GET /api/ops/inventory/transfers error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch transfers' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  const staffId = request.headers.get('x-staff-id')

  try {
    const body = await request.json()
    const { fromLocation, toLocation, items, notes } = body

    if (!fromLocation || !toLocation) {
      return NextResponse.json(
        { error: 'Missing required fields: fromLocation, toLocation' },
        { status: 400 }
      )
    }

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'At least one item is required' },
        { status: 400 }
      )
    }

    // Validate quantities available at source location
    for (const item of items) {
      const inventoryQuery = `
        SELECT "onHand" FROM "InventoryItem"
        WHERE "productId" = $1 AND "location" = $2
      `
      const inventoryResult = await prisma.$queryRawUnsafe(inventoryQuery, item.productId, fromLocation)
      const inventory = (inventoryResult as any[])[0]

      if (!inventory || inventory.onHand < item.quantity) {
        return NextResponse.json(
          {
            error: `Insufficient stock for product ${item.productId} at ${fromLocation}. Available: ${inventory?.onHand || 0}, Requested: ${item.quantity}`,
            productId: item.productId,
          },
          { status: 400 }
        )
      }
    }

    // Generate transfer number: TRF-YYYY-NNNN
    const year = new Date().getFullYear()
    const lastTransferQuery = `
      SELECT "transferNumber"
      FROM "StockTransfer"
      WHERE "transferNumber" LIKE $1
      ORDER BY "transferNumber" DESC
      LIMIT 1
    `
    const lastTransferResult = await prisma.$queryRawUnsafe(
      lastTransferQuery,
      `TRF-${year}-%`
    )
    const lastTransfer = (lastTransferResult as any[])[0]

    let nextNumber = 1
    if (lastTransfer) {
      const lastNumber = parseInt(lastTransfer.transferNumber.split('-')[2])
      nextNumber = lastNumber + 1
    }

    const transferNumber = `TRF-${year}-${String(nextNumber).padStart(4, '0')}`

    // Create transfer
    const transferId = `trf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const insertTransferQuery = `
      INSERT INTO "StockTransfer" (
        "id", "transferNumber", "fromLocation", "toLocation", "status", "notes",
        "createdById", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    `
    await prisma.$executeRawUnsafe(
      insertTransferQuery,
      transferId,
      transferNumber,
      fromLocation,
      toLocation,
      'PENDING',
      notes || null,
      staffId,
      new Date().toISOString(),
      new Date().toISOString()
    )

    // Create transfer items
    for (const item of items) {
      const itemId = `tfi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const insertItemQuery = `
        INSERT INTO "StockTransferItem" (
          "id", "transferId", "productId", "sku", "productName", "quantity",
          "damagedQty", "notes", "createdAt"
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `
      await prisma.$executeRawUnsafe(
        insertItemQuery,
        itemId,
        transferId,
        item.productId,
        item.sku || null,
        item.productName || null,
        item.quantity,
        item.damagedQty || 0,
        item.notes || null,
        new Date().toISOString()
      )
    }

    await audit(request, 'CREATE', 'StockTransfer', transferId, {
      transferNumber,
      fromLocation,
      toLocation,
      itemCount: items.length,
    })

    return NextResponse.json(
      {
        id: transferId,
        transferNumber,
        fromLocation,
        toLocation,
        status: 'PENDING',
        items: items.length,
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/ops/inventory/transfers error:', error)
    return NextResponse.json(
      { error: 'Failed to create transfer' },
      { status: 500 }
    )
  }
}
