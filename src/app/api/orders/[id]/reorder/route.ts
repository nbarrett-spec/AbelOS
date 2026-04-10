export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// POST /api/orders/[id]/reorder — Get order items formatted for cart addition
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Verify the order belongs to this builder
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT o."id", o."orderNumber"
       FROM "Order" o
       WHERE o."id" = $1 AND o."builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    // Get order items with product details
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT oi."productId", oi."description", oi."quantity", oi."unitPrice",
              p."sku", p."name" AS "productName", p."active", p."inStock",
              p."basePrice"
       FROM "OrderItem" oi
       LEFT JOIN "Product" p ON p."id" = oi."productId"
       WHERE oi."orderId" = $1
       ORDER BY oi."description" ASC`,
      params.id
    )

    // Build cart items — use current product price if available, fallback to order price
    const cartItems = items
      .filter(item => item.productId) // Only items with valid products
      .map(item => ({
        productId: item.productId,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.basePrice || item.unitPrice) || 0,
        description: item.productName || item.description || 'Product',
        sku: item.sku || 'N/A',
        active: item.active !== false,
        inStock: item.inStock !== false,
      }))

    // Get current cart from cookie
    const cartCookie = request.cookies.get('abel_quote_cart')
    let currentCart = { items: [] as any[] }
    if (cartCookie?.value) {
      try {
        currentCart = JSON.parse(cartCookie.value)
      } catch {}
    }

    // Merge items into cart (add quantities if already present)
    for (const newItem of cartItems) {
      const existing = currentCart.items.find((ci: any) => ci.productId === newItem.productId)
      if (existing) {
        existing.quantity += newItem.quantity
      } else {
        currentCart.items.push({
          productId: newItem.productId,
          quantity: newItem.quantity,
          unitPrice: newItem.unitPrice,
          description: newItem.description,
          sku: newItem.sku,
        })
      }
    }

    // Set updated cart cookie
    const response = NextResponse.json({
      success: true,
      orderNumber: orders[0].orderNumber,
      itemsAdded: cartItems.length,
      cart: currentCart,
    })

    response.cookies.set('abel_quote_cart', JSON.stringify(currentCart), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Error reordering:', error)
    return NextResponse.json({ error: 'Failed to reorder' }, { status: 500 })
  }
}
