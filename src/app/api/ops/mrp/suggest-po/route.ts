export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/ops/mrp/suggest-po
 *
 * Body: { productId: string, quantity?: number, vendorId?: string }
 *
 * Creates a DRAFT PurchaseOrder for the requested product. Pulls the
 * preferred vendor from VendorProduct if vendorId omitted, and a reasonable
 * suggested quantity from InventoryItem.reorderQty / demand shortfall.
 *
 * Returns { poId, poNumber } — caller can redirect to /ops/purchasing/{poId}.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const productId: string | undefined = body?.productId
    let quantity: number | undefined = body?.quantity
    let vendorId: string | undefined = body?.vendorId

    if (!productId) return NextResponse.json({ error: 'productId required' }, { status: 400 })

    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { id: true, sku: true, name: true, cost: true },
    })
    if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 })

    if (!vendorId) {
      // Find preferred vendor by VendorProduct
      const vp = await prisma.vendorProduct.findFirst({
        where: { productId },
        orderBy: [{ preferred: 'desc' }, { updatedAt: 'desc' }],
        select: { vendorId: true, vendorCost: true, minOrderQty: true, leadTimeDays: true },
      })
      if (vp) {
        vendorId = vp.vendorId
      }
    }

    if (!vendorId) {
      return NextResponse.json(
        { error: 'No vendor found for product; supply vendorId' },
        { status: 400 }
      )
    }

    const vp = await prisma.vendorProduct.findFirst({
      where: { vendorId, productId },
      select: { vendorCost: true, minOrderQty: true, vendorSku: true },
    })

    if (!quantity || quantity <= 0) {
      const inv = await prisma.inventoryItem.findFirst({
        where: { productId },
        select: { reorderQty: true },
      })
      quantity = Math.max(vp?.minOrderQty ?? 1, inv?.reorderQty ?? 10)
    }

    const unitCost = vp?.vendorCost ?? product.cost ?? 0
    const lineTotal = unitCost * quantity

    // Find a staff id to satisfy createdBy — use the first ADMIN/OPS staff as a shim.
    const staff = await prisma.staff.findFirst({
      where: { active: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    })
    if (!staff) return NextResponse.json({ error: 'no active staff found to author PO' }, { status: 500 })

    const year = new Date().getFullYear()
    // PO number: MRP prefix so manual POs and MRP-suggested POs are visually separable
    const lastPO = await prisma.purchaseOrder.findFirst({
      where: { poNumber: { startsWith: `PO-MRP-${year}-` } },
      orderBy: { createdAt: 'desc' },
      select: { poNumber: true },
    })
    const lastSeq = lastPO?.poNumber ? parseInt(lastPO.poNumber.split('-').pop() || '0', 10) : 0
    const poNumber = `PO-MRP-${year}-${String(lastSeq + 1).padStart(4, '0')}`

    const po = await prisma.purchaseOrder.create({
      data: {
        poNumber,
        vendorId,
        createdById: staff.id,
        status: 'DRAFT',
        subtotal: lineTotal,
        total: lineTotal,
        notes: `Auto-suggested by MRP for ${product.sku}`,
        source: 'MRP_SUGGESTED',
        items: {
          create: [
            {
              productId: product.id,
              vendorSku: vp?.vendorSku || product.sku,
              description: product.name,
              quantity,
              unitCost,
              lineTotal,
            },
          ],
        },
      },
      select: { id: true, poNumber: true },
    })

    return NextResponse.json({ ok: true, po })
  } catch (err: any) {
    console.error('[mrp suggest-po] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
