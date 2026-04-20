export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// GET /api/dashboard/reorder — Fetch reorderable items and recent orders
export async function GET(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const builderId = session.builderId
    if (!builderId) {
      return NextResponse.json({ error: 'No builder ID in session' }, { status: 400 })
    }

    // Verify builder exists
    const builderCheck: any[] = await prisma.$queryRawUnsafe(
      'SELECT id FROM "Builder" WHERE id = $1',
      builderId
    )
    if (builderCheck.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // ──────────────────────────────────────────────────────────────────
    // 1. Recent orders with line items (last 6 months)
    // ──────────────────────────────────────────────────────────────────
    const recentOrders: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        o."id" AS "orderId",
        o."orderNumber",
        o."createdAt" AS "orderDate",
        o."status"::text AS "orderStatus",
        o."total"::float AS "orderTotal",
        COALESCE(COUNT(oi.id), 0)::int AS "itemCount",
        JSON_AGG(
          JSON_BUILD_OBJECT(
            'lineId', oi."id",
            'productId', oi."productId",
            'quantity', oi."quantity",
            'unitPrice', oi."unitPrice"::float,
            'lineTotal', oi."lineTotal"::float,
            'productName', p."name",
            'sku', p."sku",
            'currentPrice', p."basePrice"::float,
            'currentStock', COALESCE(pi."quantity", 0)::int,
            'inStock', COALESCE(pi."quantity", 0) > 0
          ) ORDER BY oi."createdAt"
        ) FILTER (WHERE oi."id" IS NOT NULL) AS "items"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      LEFT JOIN "Product" p ON p."id" = oi."productId"
      LEFT JOIN "ProductInventory" pi ON pi."productId" = p."id"
      WHERE o."builderId" = $1
        AND o."status"::text IN ('DELIVERED', 'SHIPPED', 'PROCESSING', 'READY_TO_SHIP', 'COMPLETE')
        AND o."createdAt" >= NOW() - INTERVAL '6 months'
      GROUP BY o."id", o."orderNumber", o."createdAt", o."status", o."total"
      ORDER BY o."createdAt" DESC
      LIMIT 50
    `, builderId)

    // ──────────────────────────────────────────────────────────────────
    // 2. Frequently ordered items (top 10 by order count)
    // ──────────────────────────────────────────────────────────────────
    const frequentItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        p."id" AS "productId",
        p."name" AS "productName",
        p."sku",
        p."basePrice"::float AS "currentPrice",
        COALESCE(pi."quantity", 0)::int AS "currentStock",
        COUNT(DISTINCT o."id")::int AS "orderCount",
        SUM(oi."quantity")::int AS "totalQtyOrdered",
        MAX(o."createdAt") AS "lastOrdered",
        COALESCE(pi."quantity", 0) > 0 AS "inStock"
      FROM "OrderItem" oi
      JOIN "Order" o ON o."id" = oi."orderId"
      JOIN "Product" p ON p."id" = oi."productId"
      LEFT JOIN "ProductInventory" pi ON pi."productId" = p."id"
      WHERE o."builderId" = $1
        AND o."status"::text NOT IN ('CANCELLED')
      GROUP BY p."id", p."name", p."sku", p."basePrice", pi."quantity"
      ORDER BY "orderCount" DESC
      LIMIT 10
    `, builderId)

    return NextResponse.json({
      recentOrders: recentOrders.map(order => ({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        orderDate: order.orderDate,
        orderStatus: order.orderStatus,
        orderTotal: order.orderTotal,
        itemCount: order.itemCount,
        items: order.items || [],
      })),
      frequentItems: frequentItems.map(item => ({
        productId: item.productId,
        productName: item.productName,
        sku: item.sku,
        currentPrice: item.currentPrice,
        currentStock: item.currentStock,
        orderCount: item.orderCount,
        totalQtyOrdered: item.totalQtyOrdered,
        lastOrdered: item.lastOrdered,
        inStock: item.inStock,
      })),
    })
  } catch (error: any) {
    console.error('Error fetching reorder data:', error)
    return NextResponse.json({ error: 'Failed to load reorder data' }, { status: 500 })
  }
}

// POST /api/dashboard/reorder — Create a new reorder from selected items
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const builderId = session.builderId
    if (!builderId) {
      return NextResponse.json({ error: 'No builder ID in session' }, { status: 400 })
    }

    const body = await request.json()
    const { items, communityId, notes } = body

    // Validate input
    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Items array is required and must not be empty' },
        { status: 400 }
      )
    }

    if (!items.every(i => i.productId && typeof i.quantity === 'number' && i.quantity > 0)) {
      return NextResponse.json(
        { error: 'Each item must have productId and quantity > 0' },
        { status: 400 }
      )
    }

    // Verify builder exists
    const builderCheck: any[] = await prisma.$queryRawUnsafe(
      'SELECT id FROM "Builder" WHERE id = $1',
      builderId
    )
    if (builderCheck.length === 0) {
      return NextResponse.json({ error: 'Builder not found' }, { status: 404 })
    }

    // Fetch current product pricing
    const productIds = items.map(i => i.productId)
    const products: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "basePrice", "name" FROM "Product" WHERE id = ANY($1)`,
      productIds
    )

    const productMap = new Map(products.map(p => [p.id, p]))

    // Validate all products exist
    for (const item of items) {
      if (!productMap.has(item.productId)) {
        return NextResponse.json(
          { error: `Product ${item.productId} not found` },
          { status: 404 }
        )
      }
    }

    // Calculate totals
    let subtotal = 0
    const orderItems = items.map(item => {
      const product = productMap.get(item.productId)!
      const unitPrice = product.basePrice
      const lineTotal = unitPrice * item.quantity
      subtotal += lineTotal
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      }
    })

    const total = subtotal

    // Generate order ID and order number
    const orderId = `ord_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date()
    const dateStr = now.toISOString().split('T')[0].replace(/-/g, '')
    const randomSuffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
    const orderNumber = `RO-${dateStr}-${randomSuffix}`

    // Create order in a transaction
    await prisma.$transaction(async tx => {
      // Insert order
      await tx.$executeRawUnsafe(
        `INSERT INTO "Order" (
          id, "builderId", "orderNumber", "status", "subtotal", "taxAmount", "shippingCost", "total",
          "paymentTerm", "paymentStatus", "communityId", "notes", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())`,
        orderId,
        builderId,
        orderNumber,
        'PENDING_REVIEW',
        subtotal,
        0, // taxAmount
        0, // shippingCost
        total,
        'NET_30', // default payment term
        'PENDING',
        communityId || null,
        notes || null
      )

      // Insert order items
      for (const item of orderItems) {
        const itemId = `oi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const product = productMap.get(item.productId)!
        await tx.$executeRawUnsafe(
          `INSERT INTO "OrderItem" (
            id, "orderId", "productId", description, "quantity", "unitPrice", "lineTotal", "createdAt", "updatedAt"
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          itemId,
          orderId,
          item.productId,
          product.name,
          item.quantity,
          item.unitPrice,
          item.lineTotal
        )
      }
    })

    return NextResponse.json({
      orderId,
      orderNumber,
      itemCount: items.length,
      total,
      status: 'PENDING_REVIEW',
    })
  } catch (error: any) {
    console.error('Error creating reorder:', error)
    return NextResponse.json(
      { error: error.message || 'Failed to create reorder' },
      { status: 500 }
    )
  }
}
