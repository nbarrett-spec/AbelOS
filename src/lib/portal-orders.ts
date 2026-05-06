/**
 * Builder Portal — shared "create order from line items" helper.
 *
 * A-BIZ-14. The portal's reorder + reorder-from-template endpoints both
 * need to:
 *   1. Resolve the source line items
 *   2. Apply per-builder pricing (BuilderPricing override → Product.basePrice)
 *   3. Apply optional `qtyOverrides` from the modal
 *   4. Run the same `enforceCreditHold` guard the rest of the order flow uses
 *   5. Insert Order + OrderItems
 *   6. Reserve inventory via `reserveForOrder` so concurrent orders can't
 *      double-claim stock (A-BIZ-3) and per-line backorder fields get
 *      stamped (A-BIZ-6)
 *
 * Centralising it here keeps the two endpoints from drifting; either flow
 * looks like:
 *
 *   const result = await createOrderFromLines({ builderId, lines, request, source })
 *   if ('errorResponse' in result) return result.errorResponse
 *   return NextResponse.json({ orderId: result.orderId, ... })
 */

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { enforceCreditHold } from '@/lib/credit-hold'
import { reserveForOrder, type ReserveResult } from '@/lib/allocation'

export interface SourceLine {
  productId: string
  quantity: number
  /** Free-text description override; defaults to product.name. */
  description?: string | null
}

export interface CreateOrderFromLinesArgs {
  builderId: string
  lines: SourceLine[]
  /** Used by enforceCreditHold for per-request audit context. */
  request: NextRequest
  /** Free-form note attached to the new Order. */
  notes?: string | null
  /** Audit / log marker — e.g. "POST /api/portal/orders/from-order". */
  source: string
  /** Order-number prefix; default "RO" (reorder). Templates pass "OT". */
  orderNumberPrefix?: string
}

export interface CreateOrderFromLinesSuccess {
  orderId: string
  orderNumber: string
  itemCount: number
  total: number
  status: 'PENDING_REVIEW'
  reserveResult: ReserveResult | null
}

export interface CreateOrderFromLinesError {
  errorResponse: NextResponse
}

export type CreateOrderFromLinesResult =
  | CreateOrderFromLinesSuccess
  | CreateOrderFromLinesError

export async function createOrderFromLines(
  args: CreateOrderFromLinesArgs
): Promise<CreateOrderFromLinesResult> {
  const {
    builderId,
    lines,
    request,
    notes,
    source,
    orderNumberPrefix = 'RO',
  } = args

  // 1. De-duplicate + filter input
  const filtered = lines
    .map((l) => ({
      productId: String(l.productId || ''),
      quantity: Math.max(1, Math.floor(Number(l.quantity) || 0)),
      description: l.description ? String(l.description).slice(0, 500) : null,
    }))
    .filter((l) => l.productId && l.quantity > 0)

  if (filtered.length === 0) {
    return {
      errorResponse: NextResponse.json(
        { error: 'At least one line item with quantity > 0 is required' },
        { status: 400 }
      ),
    }
  }

  // 2. Resolve current pricing — BuilderPricing override → Product.basePrice.
  const productIds = Array.from(new Set(filtered.map((l) => l.productId)))
  const productRows: any[] = await prisma.$queryRawUnsafe(
    `
    SELECT p."id", p."name", p."basePrice"::float AS "basePrice",
           COALESCE(bp."customPrice", p."basePrice")::float AS "effectivePrice"
    FROM "Product" p
    LEFT JOIN "BuilderPricing" bp
      ON bp."productId" = p."id" AND bp."builderId" = $2
    WHERE p."id" = ANY($1)
    `,
    productIds,
    builderId
  )
  const productMap = new Map(productRows.map((p) => [p.id, p]))

  // Confirm every line has a real product
  for (const line of filtered) {
    if (!productMap.has(line.productId)) {
      return {
        errorResponse: NextResponse.json(
          { error: `Product ${line.productId} not found` },
          { status: 404 }
        ),
      }
    }
  }

  // 3. Compute totals
  let subtotal = 0
  const orderItems = filtered.map((l) => {
    const p = productMap.get(l.productId)!
    const unitPrice = Number(p.effectivePrice ?? p.basePrice ?? 0)
    const lineTotal = unitPrice * l.quantity
    subtotal += lineTotal
    return {
      productId: l.productId,
      description: l.description || p.name || 'Product',
      quantity: l.quantity,
      unitPrice,
      lineTotal,
    }
  })
  const total = subtotal

  // 4. Credit hold gate — same as POST /api/orders + /api/dashboard/reorder.
  const blocked = await enforceCreditHold(builderId, total, request, { source })
  if (blocked) return { errorResponse: blocked }

  // 5. Generate IDs
  const orderId = `ord${Date.now().toString(36)}${Math.random()
    .toString(36)
    .slice(2, 8)}`
  const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
  const randomSuffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
  const orderNumber = `${orderNumberPrefix}-${dateStr}-${randomSuffix}`

  // 6. Insert Order + OrderItems + reserve in a single transaction.
  const reserveBox: ReserveResult[] = []
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(
      `INSERT INTO "Order" (
        "id", "builderId", "orderNumber", "status", "subtotal",
        "taxAmount", "shippingCost", "total", "paymentTerm",
        "paymentStatus", "notes", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'PENDING_REVIEW'::"OrderStatus", $4,
        0, 0, $5, 'NET_30',
        'PENDING'::"PaymentStatus", $6, NOW(), NOW()
      )`,
      orderId,
      builderId,
      orderNumber,
      subtotal,
      total,
      notes || null
    )

    const orderItemIdByIndex: string[] = []
    for (const item of orderItems) {
      const itemId = `oi_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 8)}`
      orderItemIdByIndex.push(itemId)
      await tx.$executeRawUnsafe(
        `INSERT INTO "OrderItem" (
          "id", "orderId", "productId", "description", "quantity",
          "unitPrice", "lineTotal", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        itemId,
        orderId,
        item.productId,
        item.description,
        item.quantity,
        item.unitPrice,
        item.lineTotal
      )
    }

    // A-BIZ-3 + A-BIZ-6: reserve inventory at order create.
    reserveBox.push(
      await reserveForOrder(
        tx,
        orderId,
        orderItems.map((it, idx) => ({
          id: orderItemIdByIndex[idx],
          productId: it.productId,
          quantity: it.quantity,
        }))
      )
    )
  }, { timeout: 15000 })

  return {
    orderId,
    orderNumber,
    itemCount: orderItems.length,
    total,
    status: 'PENDING_REVIEW' as const,
    reserveResult: reserveBox[0] ?? null,
  }
}
