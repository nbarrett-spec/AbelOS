export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/ops/mrp/bom-explode/[orderId]
 *
 * Walks every OrderItem of the given Order through BomEntry (up to 4 levels)
 * and returns the rolled-up terminal component requirements.
 *
 * A terminal component is one that has NO BomEntry rows where it appears as
 * the parent — in other words a raw material that cannot be broken down further.
 */
const MAX_DEPTH = 4

export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const orderId = params.orderId
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNumber: true,
        status: true,
        deliveryDate: true,
        builder: { select: { companyName: true } },
        items: {
          select: {
            id: true,
            quantity: true,
            description: true,
            product: {
              select: {
                id: true,
                sku: true,
                name: true,
                category: true,
                cost: true,
              },
            },
          },
        },
      },
    })

    if (!order) {
      return NextResponse.json({ error: 'order not found' }, { status: 404 })
    }

    // Pre-load all BomEntry rows whose parent is in play. We do an iterative BFS.
    const productStack: Array<{ productId: string; qty: number; depth: number; rootOrderItemId: string }> = []
    for (const it of order.items) {
      if (!it.product) continue
      productStack.push({ productId: it.product.id, qty: it.quantity, depth: 0, rootOrderItemId: it.id })
    }

    // Collect all parent IDs we need to resolve up front (batched fetch)
    const terminals = new Map<
      string,
      { productId: string; sku: string; name: string; category: string | null; quantity: number; unitCost: number }
    >()

    const visitedParents = new Set<string>()
    let sweep = 0
    while (productStack.length && sweep < 50) {
      sweep++
      const parentIds = Array.from(new Set(productStack.map((p) => p.productId)))
      // Fetch all BomEntry rows in one query
      const boms = await prisma.bomEntry.findMany({
        where: { parentId: { in: parentIds } },
        select: {
          parentId: true,
          componentId: true,
          quantity: true,
          component: {
            select: { id: true, sku: true, name: true, category: true, cost: true },
          },
        },
      })

      const bomByParent = new Map<string, typeof boms>()
      for (const b of boms) {
        const arr = bomByParent.get(b.parentId) || []
        arr.push(b)
        bomByParent.set(b.parentId, arr)
      }

      const nextStack: typeof productStack = []
      for (const cur of productStack) {
        const children = bomByParent.get(cur.productId)
        if (!children || children.length === 0 || cur.depth >= MAX_DEPTH) {
          // terminal
          const existing = terminals.get(cur.productId)
          // Need product record if not already available — look up once via any visited BOM
          let sku = existing?.sku
          let name = existing?.name
          let category = existing?.category ?? null
          let unitCost = existing?.unitCost ?? 0
          if (!existing) {
            // fetch product detail
            const prod = await prisma.product.findUnique({
              where: { id: cur.productId },
              select: { sku: true, name: true, category: true, cost: true },
            })
            sku = prod?.sku || cur.productId.slice(-6)
            name = prod?.name || '—'
            category = prod?.category ?? null
            unitCost = prod?.cost ?? 0
          }
          terminals.set(cur.productId, {
            productId: cur.productId,
            sku: sku!,
            name: name!,
            category: category ?? null,
            quantity: (existing?.quantity ?? 0) + cur.qty,
            unitCost: unitCost!,
          })
          continue
        }
        visitedParents.add(cur.productId)
        for (const c of children) {
          nextStack.push({
            productId: c.componentId,
            qty: cur.qty * c.quantity,
            depth: cur.depth + 1,
            rootOrderItemId: cur.rootOrderItemId,
          })
        }
      }

      productStack.length = 0
      productStack.push(...nextStack)
    }

    // Roll inventory status for the terminals in one pass
    const termIds = Array.from(terminals.keys())
    const inv = await prisma.inventoryItem.findMany({
      where: { productId: { in: termIds } },
      select: { productId: true, onHand: true, committed: true, available: true, reorderPoint: true },
    })
    const invByProd = new Map(inv.map((i) => [i.productId, i]))

    const rows = Array.from(terminals.values())
      .map((t) => {
        const i = invByProd.get(t.productId)
        const onHand = i?.onHand ?? 0
        const available = i?.available ?? onHand
        const shortfall = Math.max(0, t.quantity - available)
        return {
          ...t,
          extendedCost: Math.round(t.unitCost * t.quantity * 100) / 100,
          onHand,
          available,
          shortfall,
          fullyAvailable: shortfall === 0,
        }
      })
      .sort((a, b) => b.extendedCost - a.extendedCost)

    return NextResponse.json({
      order: {
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        deliveryDate: order.deliveryDate,
        builderName: order.builder?.companyName,
      },
      summary: {
        lineCount: order.items.length,
        terminalCount: rows.length,
        totalExtendedCost: rows.reduce((s, r) => s + r.extendedCost, 0),
        shortfallCount: rows.filter((r) => r.shortfall > 0).length,
      },
      components: rows,
    })
  } catch (err: any) {
    console.error('[mrp bom-explode] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
