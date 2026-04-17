export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/ops/inventory/allocations/[id]
// Release an allocation and return inventory to available pool
// ──────────────────────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'DELETE', 'Inventory', undefined, { method: 'DELETE' }).catch(() => {})

    const allocationId = params.id

    if (!allocationId) {
      return NextResponse.json(
        { success: false, error: 'Allocation ID is required' },
        { status: 400 }
      )
    }

    // Step 1: Get allocation details
    const allocationResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT "productId", quantity, status FROM "InventoryAllocation"
       WHERE id = $1`,
      allocationId
    )

    if (!allocationResult || allocationResult.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Allocation not found' },
        { status: 404 }
      )
    }

    const allocation = allocationResult[0]
    const { productId, quantity, status } = allocation

    // Step 2: Check if status is RESERVED before releasing
    if (status !== 'RESERVED') {
      return NextResponse.json(
        {
          success: false,
          error: `Cannot release allocation with status "${status}". Only RESERVED allocations can be released.`,
        },
        { status: 400 }
      )
    }

    // Step 3: Update allocation - set status to RELEASED, set releasedAt
    await prisma.$queryRawUnsafe(
      `UPDATE "InventoryAllocation"
       SET status = $1, "releasedAt" = NOW(), "updatedAt" = NOW()
       WHERE id = $2`,
      'RELEASED',
      allocationId
    )

    // Step 4: Get current InventoryItem to calculate new committed and available
    const inventoryResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT "onHand", "committed", "onOrder"
       FROM "InventoryItem"
       WHERE "productId" = $1`,
      productId
    )

    const inventory = inventoryResult[0] || {
      onHand: 0,
      committed: 0,
      onOrder: 0,
    }

    // Step 5: Update InventoryItem - decrement committed, recalculate available
    const newCommitted = Math.max(0, inventory.committed - quantity)
    const newAvailable = inventory.onHand - newCommitted

    await prisma.$queryRawUnsafe(
      `UPDATE "InventoryItem"
       SET "committed" = $1, "available" = $2, "updatedAt" = NOW()
       WHERE "productId" = $3`,
      newCommitted,
      newAvailable,
      productId
    )

    // Fetch final inventory status
    const finalInventoryResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT "onHand", "committed", "onOrder", "available"
       FROM "InventoryItem"
       WHERE "productId" = $1`,
      productId
    )

    const finalInventory = finalInventoryResult[0] || inventory

    // Return updated stock levels
    return NextResponse.json({
      success: true,
      message: 'Allocation released successfully',
      allocationId,
      productId,
      releasedQuantity: quantity,
      updatedStockLevels: finalInventory,
    })
  } catch (error) {
    console.error('Error releasing allocation:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to release allocation' },
      { status: 500 }
    )
  }
}
