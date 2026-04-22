export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const transferId = params.id

  try {
    // Fetch transfer and items
    const transferQuery = `
      SELECT * FROM "StockTransfer" WHERE "id" = $1
    `
    const transferResult = await prisma.$queryRawUnsafe(transferQuery, transferId)
    const transfer = (transferResult as any[])[0]

    if (!transfer) {
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      )
    }

    if (transfer.status !== 'PENDING' && transfer.status !== 'IN_TRANSIT') {
      return NextResponse.json(
        { error: `Cannot complete a ${transfer.status} transfer` },
        { status: 400 }
      )
    }

    const itemsQuery = `
      SELECT * FROM "StockTransferItem" WHERE "transferId" = $1
    `
    const items = await prisma.$queryRawUnsafe(itemsQuery, transferId)

    // Process each item
    for (const item of items as any[]) {
      // Get product info for denormalization
      const productQuery = `SELECT "sku", "name" FROM "Product" WHERE "id" = $1`
      const productResult = await prisma.$queryRawUnsafe(productQuery, item.productId)
      const product = (productResult as any[])[0]

      // Decrement source location
      const decrementQuery = `
        UPDATE "InventoryItem"
        SET
          "onHand" = "onHand" - $1,
          "available" = GREATEST(0, "available" - $1),
          "updatedAt" = NOW()
        WHERE "productId" = $2 AND "location" = $3
      `
      await prisma.$executeRawUnsafe(
        decrementQuery,
        item.quantity,
        item.productId,
        transfer.fromLocation
      )

      // Increment destination location (or create if doesn't exist)
      const destCheckQuery = `
        SELECT "id" FROM "InventoryItem"
        WHERE "productId" = $1 AND "location" = $2
      `
      const destCheckResult = await prisma.$queryRawUnsafe(
        destCheckQuery,
        item.productId,
        transfer.toLocation
      )
      const destExists = (destCheckResult as any[])[0]

      if (destExists) {
        const incrementQuery = `
          UPDATE "InventoryItem"
          SET
            "onHand" = "onHand" + $1,
            "available" = "available" + $1,
            "updatedAt" = NOW()
          WHERE "productId" = $2 AND "location" = $3
        `
        await prisma.$executeRawUnsafe(
          incrementQuery,
          item.quantity,
          item.productId,
          transfer.toLocation
        )
      } else {
        const createQuery = `
          INSERT INTO "InventoryItem" (
            "id", "productId", "sku", "productName", "location",
            "onHand", "available", "status", "createdAt", "updatedAt"
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        `
        const newId = `inv_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(
          createQuery,
          newId,
          item.productId,
          product?.sku || null,
          product?.name || null,
          transfer.toLocation,
          item.quantity,
          item.quantity,
          'IN_STOCK'
        )
      }
    }

    // Update transfer status
    const updateTransferQuery = `
      UPDATE "StockTransfer"
      SET "status" = $1, "completedAt" = NOW(), "updatedAt" = NOW()
      WHERE "id" = $2
    `
    await prisma.$executeRawUnsafe(
      updateTransferQuery,
      'COMPLETED',
      transferId
    )

    await audit(request, 'UPDATE', 'StockTransfer', transferId, {
      action: 'completed',
      fromLocation: transfer.fromLocation,
      toLocation: transfer.toLocation,
      itemCount: (items as any[]).length,
    })

    return NextResponse.json(
      {
        success: true,
        message: `Transfer ${transfer.transferNumber} completed`,
        transferId,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('POST /api/ops/inventory/transfers/[id]/complete error:', error)
    return NextResponse.json(
      { error: 'Failed to complete transfer' },
      { status: 500 }
    )
  }
}
