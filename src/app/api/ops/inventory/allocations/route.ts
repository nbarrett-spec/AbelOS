export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/inventory/allocations
// View inventory allocations with filters and summary
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Parse query parameters
    const { searchParams } = new URL(request.url)
    const productId = searchParams.get('productId') || ''
    const orderId = searchParams.get('orderId') || ''
    const jobId = searchParams.get('jobId') || ''
    const status = searchParams.get('status') || ''
    const allocationType = searchParams.get('allocationType') || ''
    const limit = parseInt(searchParams.get('limit') || '100', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    // Build WHERE clause dynamically
    let whereConditions = '1=1'
    const params: any[] = []

    if (productId) {
      whereConditions += ` AND ia."productId" = $${params.length + 1}`
      params.push(productId)
    }
    if (orderId) {
      whereConditions += ` AND ia."orderId" = $${params.length + 1}`
      params.push(orderId)
    }
    if (jobId) {
      whereConditions += ` AND ia."jobId" = $${params.length + 1}`
      params.push(jobId)
    }
    if (status) {
      whereConditions += ` AND ia.status = $${params.length + 1}`
      params.push(status)
    }
    if (allocationType) {
      whereConditions += ` AND ia."allocationType" = $${params.length + 1}`
      params.push(allocationType)
    }

    // Main query: Get allocations with product and order details
    const allocations = await prisma.$queryRawUnsafe(
      `SELECT
        ia.id,
        ia."productId",
        ia."orderId",
        ia."jobId",
        ia.quantity,
        ia."allocationType",
        ia.status,
        ia."allocatedBy",
        ia.notes,
        ia."allocatedAt",
        ia."releasedAt",
        ia."createdAt",
        ia."updatedAt",
        p.name AS "productName",
        p."sku",
        o."orderNumber",
        ii."onHand",
        ii."committed",
        ii."onOrder",
        ii."available"
       FROM "InventoryAllocation" ia
       LEFT JOIN "Product" p ON p.id = ia."productId"
       LEFT JOIN "Order" o ON o.id = ia."orderId"
       LEFT JOIN "InventoryItem" ii ON ii."productId" = ia."productId"
       WHERE ${whereConditions}
       ORDER BY ia."allocatedAt" DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      ...params,
      limit,
      offset
    )

    // Get total count for pagination
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS count
       FROM "InventoryAllocation" ia
       WHERE ${whereConditions}`,
      ...params
    )
    const totalCount = countResult[0]?.count || 0

    // Get summary stats
    const summaryResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COALESCE(SUM(ia.quantity), 0)::int AS "totalAllocated",
        COALESCE(SUM(CASE WHEN ii."available" > 0 THEN ii."available" ELSE 0 END), 0)::int AS "totalAvailable",
        COALESCE(SUM(ii."onHand"), 0)::int AS "totalOnHand"
       FROM "InventoryAllocation" ia
       LEFT JOIN "InventoryItem" ii ON ii."productId" = ia."productId"
       WHERE ${whereConditions}`,
      ...params
    )

    const summary = summaryResult[0] || {
      totalAllocated: 0,
      totalAvailable: 0,
      totalOnHand: 0,
    }

    return NextResponse.json({
      success: true,
      data: allocations,
      pagination: {
        total: totalCount,
        limit,
        offset,
        hasMore: offset + limit < totalCount,
      },
      summary,
    })
  } catch (error) {
    console.error('Error fetching allocations:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch allocations' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/inventory/allocations
// Create a new allocation (reserve inventory for SO or job)
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { productId, orderId, jobId, quantity, allocationType, notes } = body
    const staffId = request.headers.get('x-staff-id') || 'unknown'

    // Validate required fields
    if (!productId || !quantity || !allocationType) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: productId, quantity, allocationType' },
        { status: 400 }
      )
    }

    if (!orderId && !jobId) {
      return NextResponse.json(
        { success: false, error: 'Either orderId or jobId must be provided' },
        { status: 400 }
      )
    }

    // Step 1: Check available inventory
    const inventoryResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        "onHand",
        "committed",
        "onOrder",
        "available"
       FROM "InventoryItem"
       WHERE "productId" = $1`,
      productId
    )

    const inventory = inventoryResult[0] || {
      onHand: 0,
      committed: 0,
      onOrder: 0,
      available: 0,
    }

    let warning: string | null = null

    // Step 2-4: Check if allocation can proceed
    if (inventory.available >= quantity) {
      // Sufficient available inventory
    } else if (inventory.onHand + inventory.onOrder >= quantity) {
      // Allow with warning - inventory will be available from purchase orders
      warning = `Insufficient available inventory. Will be satisfied by pending purchase orders.`
    } else {
      // Insufficient inventory
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient inventory',
          currentStock: {
            onHand: inventory.onHand,
            committed: inventory.committed,
            onOrder: inventory.onOrder,
            available: inventory.available,
          },
          requested: quantity,
        },
        { status: 400 }
      )
    }

    // Step 5: Insert InventoryAllocation record
    const allocationResult: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "InventoryAllocation"
        ("productId", "orderId", "jobId", quantity, "allocationType", status, "allocatedBy", notes, "allocatedAt", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
       RETURNING *`,
      productId,
      orderId || null,
      jobId || null,
      quantity,
      allocationType,
      'RESERVED',
      staffId,
      notes || null
    )

    const allocation = allocationResult[0]

    // Step 6: Update InventoryItem - increment committed, recalculate available
    const newCommitted = inventory.committed + quantity
    const newAvailable = inventory.onHand - newCommitted

    await prisma.$queryRawUnsafe(
      `UPDATE "InventoryItem"
       SET "committed" = $1, "available" = $2, "updatedAt" = NOW()
       WHERE "productId" = $3`,
      newCommitted,
      newAvailable,
      productId
    )

    // Fetch updated inventory
    const updatedInventoryResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT "onHand", "committed", "onOrder", "available"
       FROM "InventoryItem"
       WHERE "productId" = $1`,
      productId
    )

    const updatedInventory = updatedInventoryResult[0] || inventory

    return NextResponse.json({
      success: true,
      data: allocation,
      warning,
      stockStatus: updatedInventory,
    })
  } catch (error) {
    console.error('Error creating allocation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to create allocation' },
      { status: 500 }
    )
  }
}
