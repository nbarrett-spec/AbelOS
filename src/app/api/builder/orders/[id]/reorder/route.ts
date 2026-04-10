export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface ReorderItem {
  productId: string
  productName: string
  sku: string
  quantity: number
  originalUnitPrice: number
  currentUnitPrice: number
  priceChanged: boolean
  inStock: boolean
  discontinued: boolean
}

interface ReorderResponse {
  orderId: string
  orderNumber: string
  items: ReorderItem[]
  warnings: string[]
  unavailableItems: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    const orderId = params.id

    // Verify order belongs to this builder
    const orderCheck: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "orderNumber" FROM "Order" WHERE id = $1 AND "builderId" = $2 LIMIT 1`,
      orderId,
      session.builderId
    )

    if (orderCheck.length === 0) {
      return NextResponse.json(
        { error: 'Order not found or you do not have access' },
        { status: 404 }
      )
    }

    const order = orderCheck[0]

    // Fetch order items with original pricing
    const items: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        oi."productId",
        oi.quantity,
        oi."unitPrice" as "originalUnitPrice",
        p.name as "productName",
        p.sku,
        p."basePrice",
        p.active,
        p."inStock",
        COALESCE(bp."customPrice", p."basePrice") as "currentPrice"
      FROM "OrderItem" oi
      JOIN "Product" p ON p.id = oi."productId"
      LEFT JOIN "BuilderPricing" bp ON bp."productId" = p.id AND bp."builderId" = $2
      WHERE oi."orderId" = $1
    `, orderId, session.builderId)

    const reorderItems: ReorderItem[] = []
    const warnings: string[] = []
    let unavailableItems = 0

    for (const item of items) {
      const isDiscontinued = !item.active
      const isOutOfStock = !item.inStock

      const currentUnitPrice = Number(item.currentPrice)
      const originalUnitPrice = Number(item.originalUnitPrice)
      const priceChanged = Math.abs(currentUnitPrice - originalUnitPrice) > 0.01

      if (isDiscontinued) {
        unavailableItems++
        warnings.push(`${item.productName} (SKU: ${item.sku}) is no longer available`)
      } else if (isOutOfStock) {
        unavailableItems++
        warnings.push(`${item.productName} (SKU: ${item.sku}) is currently out of stock`)
      }

      reorderItems.push({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        quantity: item.quantity,
        originalUnitPrice,
        currentUnitPrice,
        priceChanged,
        inStock: item.inStock,
        discontinued: isDiscontinued,
      })
    }

    const response: ReorderResponse = {
      orderId,
      orderNumber: order.orderNumber,
      items: reorderItems,
      warnings,
      unavailableItems,
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('POST /api/builder/orders/[id]/reorder error:', error)
    return NextResponse.json(
      { error: 'Failed to prepare reorder' },
      { status: 500 }
    )
  }
}
