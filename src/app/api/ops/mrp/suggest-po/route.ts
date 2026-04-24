export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { getForecastDemand } from '@/lib/mrp/forecast'

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
      select: { id: true, sku: true, name: true, cost: true, productType: true },
    })
    if (!product) return NextResponse.json({ error: 'product not found' }, { status: 404 })

    // MRP suggestions only apply to physical inventory. Labor / service / overhead products
    // are excluded — there's no PO to draft for them.
    if (product.productType && product.productType !== 'PHYSICAL') {
      return NextResponse.json(
        { error: `MRP cannot draft a PO for ${product.productType} product (${product.sku}). Only physical inventory is eligible.` },
        { status: 400 }
      )
    }

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

    // Forecast-aware sizing: if the caller didn't pin a quantity, roll the
    // shortfall/reorderQty floor forward by 1 month of forecast demand so
    // we're not back here next week. DemandForecast may be empty (first
    // cron hasn't run yet) — in that case we fall back to the old behavior.
    let forecastUsed: number | null = null
    if (!quantity || quantity <= 0) {
      const inv = await prisma.inventoryItem.findFirst({
        where: { productId },
        select: { reorderQty: true },
      })
      const baseQty = Math.max(vp?.minOrderQty ?? 1, inv?.reorderQty ?? 10)

      try {
        forecastUsed = await getForecastDemand(productId, 1)
      } catch {
        forecastUsed = null
      }

      quantity = forecastUsed != null && forecastUsed > 0
        ? Math.max(baseQty + Math.round(forecastUsed), baseQty)
        : baseQty
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
        notes: forecastUsed != null && forecastUsed > 0
          ? `Auto-suggested by MRP for ${product.sku} (includes +${Math.round(forecastUsed)} forward-month forecast)`
          : `Auto-suggested by MRP for ${product.sku}`,
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

    await audit(request, 'CREATE', 'PurchaseOrder', po.id, {
      poNumber: po.poNumber,
      productId,
      quantity,
      forecastUsed,
      source: 'MRP_SUGGESTED',
    })

    return NextResponse.json({ ok: true, po, forecastUsed })
  } catch (err: any) {
    console.error('[mrp suggest-po] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
