export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface AllocationResult {
  orderItemId: string
  productId: string
  productName: string
  quantity: number
  allocationId?: string
  status: 'allocated' | 'insufficient' | 'error'
  message?: string
  error?: string
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/inventory/allocations/bulk
// Allocate all items from an order at once
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { orderId } = body
    const staffId = request.headers.get('x-staff-id') || 'unknown'

    if (!orderId) {
      return NextResponse.json(
        { success: false, error: 'orderId is required' },
        { status: 400 }
      )
    }

    // Step 1: Get all OrderItems for this order
    const orderItemsResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        oi.id AS "orderItemId",
        oi."productId",
        p.name AS "productName",
        oi.quantity
       FROM "OrderItem" oi
       LEFT JOIN "Product" p ON p.id = oi."productId"
       WHERE oi."orderId" = $1`,
      orderId
    )

    if (!orderItemsResult || orderItemsResult.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'No order items found for this order',
          orderId,
        },
        { status: 404 }
      )
    }

    const allocated: AllocationResult[] = []
    const insufficient: AllocationResult[] = []
    let totalAllocated = 0
    let totalShort = 0

    // Step 2: Process each OrderItem
    for (const item of orderItemsResult) {
      const { orderItemId, productId, productName, quantity } = item

      try {
        // Get current inventory
        const inventoryResult: any[] = await prisma.$queryRawUnsafe(
          `SELECT "onHand", "committed", "onOrder", "available"
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

        // Check if we can allocate
        let canAllocate = false
        let allocatedQuantity = 0

        if (inventory.available >= quantity) {
          // Full allocation possible with available inventory
          canAllocate = true
          allocatedQuantity = quantity
        } else if (inventory.onHand + inventory.onOrder >= quantity) {
          // Full allocation possible but relies on pending orders
          canAllocate = true
          allocatedQuantity = quantity
        } else if (inventory.available > 0) {
          // Partial allocation possible
          allocatedQuantity = inventory.available
        }

        if (!canAllocate && allocatedQuantity === 0) {
          // No inventory available at all
          insufficient.push({
            orderItemId,
            productId,
            productName,
            quantity,
            status: 'insufficient',
            message: `No inventory available (need ${quantity}, have ${inventory.available})`,
          })
          totalShort += quantity
          continue
        }

        // Step 3: Create InventoryAllocation record
        const allocationResult: any[] = await prisma.$queryRawUnsafe(
          `INSERT INTO "InventoryAllocation"
            ("productId", "orderId", quantity, "allocationType", status, "allocatedBy", "allocatedAt", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW(), NOW())
           RETURNING id`,
          productId,
          orderId,
          allocatedQuantity,
          'SALES_ORDER',
          'RESERVED',
          staffId
        )

        const allocationId = allocationResult[0]?.id

        // Step 4: Update InventoryItem - increment committed, recalculate available
        const newCommitted = inventory.committed + allocatedQuantity
        const newAvailable = inventory.onHand - newCommitted

        await prisma.$queryRawUnsafe(
          `UPDATE "InventoryItem"
           SET "committed" = $1, "available" = $2, "updatedAt" = NOW()
           WHERE "productId" = $3`,
          newCommitted,
          newAvailable,
          productId
        )

        allocated.push({
          orderItemId,
          productId,
          productName,
          quantity,
          allocationId,
          status: canAllocate ? 'allocated' : 'allocated',
          message:
            allocatedQuantity < quantity
              ? `Partial allocation: ${allocatedQuantity} of ${quantity} units`
              : undefined,
        })

        totalAllocated += allocatedQuantity
        if (allocatedQuantity < quantity) {
          totalShort += quantity - allocatedQuantity
        }
      } catch (itemError) {
        console.error(`Error allocating item ${productId}:`, itemError)
        insufficient.push({
          orderItemId,
          productId,
          productName,
          quantity,
          status: 'error',
          error: itemError instanceof Error ? itemError.message : 'Unknown error',
        })
      }
    }

    // Return summary
    return NextResponse.json({
      success: true,
      orderId,
      summary: {
        totalAllocated,
        totalShort,
        fullyAllocatedCount: allocated.filter((a) => !a.message).length,
        partiallyAllocatedCount: allocated.filter((a) => !!a.message).length,
        insufficientCount: insufficient.length,
      },
      allocated,
      insufficient,
    })
  } catch (error) {
    console.error('Error in bulk allocation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to process bulk allocation' },
      { status: 500 }
    )
  }
}
