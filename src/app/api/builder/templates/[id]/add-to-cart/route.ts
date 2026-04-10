export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface CartItem {
  productId: string
  quantity: number
  unitPrice: number
  description: string
  sku: string
}

interface CartData {
  items: CartItem[]
}

const CART_COOKIE_NAME = 'abel_quote_cart'

// POST /api/builder/templates/[id]/add-to-cart — Add all template items to cart
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Verify template belongs to this builder
    const templates: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name FROM "OrderTemplate"
       WHERE id = $1 AND "builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (templates.length === 0) {
      return NextResponse.json(
        { error: 'Template not found' },
        { status: 404 }
      )
    }

    const templateName = templates[0].name

    // Fetch template items with product details
    const items: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        oti."productId",
        oti.quantity,
        p.name as "productName",
        p.sku,
        p."basePrice" as "unitPrice",
        p.active,
        p."inStock"
       FROM "OrderTemplateItem" oti
       LEFT JOIN "Product" p ON p.id = oti."productId"
       WHERE oti."templateId" = $1
       ORDER BY p.name ASC`,
      params.id
    )

    // Build cart items - use current product price if available
    const templateCartItems: CartItem[] = items
      .filter(item => item.productId) // Only items with valid products
      .map(item => ({
        productId: item.productId,
        quantity: Number(item.quantity) || 1,
        unitPrice: Number(item.unitPrice) || 0,
        description: item.productName || 'Product',
        sku: item.sku || 'N/A',
      }))

    if (templateCartItems.length === 0) {
      return NextResponse.json(
        { error: 'Template has no valid items to add' },
        { status: 400 }
      )
    }

    // Get current cart from cookie
    const cartCookie = request.cookies.get(CART_COOKIE_NAME)
    let currentCart: CartData = { items: [] }
    if (cartCookie?.value) {
      try {
        currentCart = JSON.parse(cartCookie.value)
        if (!Array.isArray(currentCart.items)) {
          currentCart.items = []
        }
      } catch {
        currentCart = { items: [] }
      }
    }

    // Merge items into cart (add quantities if already present)
    for (const newItem of templateCartItems) {
      const existingItem = currentCart.items.find(
        ci => ci.productId === newItem.productId
      )
      if (existingItem) {
        existingItem.quantity += newItem.quantity
      } else {
        currentCart.items.push(newItem)
      }
    }

    // Set updated cart cookie
    const response = NextResponse.json({
      success: true,
      templateName,
      itemsAdded: templateCartItems.length,
      cart: currentCart,
    })

    response.cookies.set(CART_COOKIE_NAME, JSON.stringify(currentCart), {
      httpOnly: false,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: '/',
    })

    return response
  } catch (error: any) {
    console.error('POST /api/builder/templates/[id]/add-to-cart error:', error)
    return NextResponse.json(
      { error: 'Failed to add template to cart' },
      { status: 500 }
    )
  }
}
