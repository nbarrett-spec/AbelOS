export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/auto-po
 * Returns auto-PO candidates (products below reorder point) and recent auto-generated POs.
 * Uses InventoryItem + VendorProduct (preferred vendor) — same data as /api/ops/inventory/auto-reorder.
 */
export async function GET(req: NextRequest) {
  try {
    await checkStaffAuthWithFallback(req)

    // Products below reorder point from InventoryItem, joined to preferred VendorProduct
    const candidates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ii.id,
        ii."productId",
        ii."productName" as name,
        ii.sku,
        ii."onHand" as "currentStock",
        ii."reorderPoint",
        ii."reorderQty",
        ii."unitCost",
        vp."vendorId",
        v.name as "vendorName"
      FROM "InventoryItem" ii
      LEFT JOIN "VendorProduct" vp ON vp."productId" = ii."productId" AND vp.preferred = TRUE
      LEFT JOIN "Vendor" v ON v.id = vp."vendorId" AND v.active = TRUE
      WHERE (ii."onHand" + COALESCE(ii."onOrder", 0)) <= ii."reorderPoint"
        AND ii."reorderQty" > 0
      ORDER BY (ii."onHand"::float / NULLIF(ii."reorderPoint", 0)::float) ASC
    `)

    // Recent auto-generated POs (last 30 days)
    const recentPOs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po.id,
        po."poNumber",
        po.status::text as status,
        po.total::float as total,
        po."createdAt",
        v.name as "vendorName",
        (SELECT COUNT(*)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po.id) as "lineCount"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON v.id = po."vendorId"
      WHERE po."createdAt" >= NOW() - INTERVAL '30 days'
        AND po.notes ILIKE '%auto%'
      ORDER BY po."createdAt" DESC
      LIMIT 20
    `)

    // Summary stats
    const statsResult: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE WHEN (ii."onHand" + COALESCE(ii."onOrder", 0)) <= ii."reorderPoint" AND ii."reorderPoint" > 0 THEN 1 END)::int AS "needsReorder",
        COUNT(CASE WHEN ii."onHand" <= 0 THEN 1 END)::int AS "outOfStock",
        COUNT(*)::int AS "totalTracked"
      FROM "InventoryItem" ii
    `)

    const stats = statsResult[0] || { needsReorder: 0, outOfStock: 0, totalTracked: 0 }

    return NextResponse.json({ candidates, recentPOs, stats })
  } catch (error) {
    console.error('Error fetching auto-PO candidates:', error)
    return NextResponse.json({ error: 'Failed to fetch auto-PO candidates' }, { status: 500 })
  }
}

/**
 * POST /api/ops/auto-po
 * Generate draft POs grouped by vendor from auto-reorder candidates.
 * Body: { productIds?: string[] } or { all: true }
 */
export async function POST(req: NextRequest) {
  try {
    await checkStaffAuthWithFallback(req)

    const body = await req.json()
    const { productIds = [], all = false } = body as { productIds?: string[]; all?: boolean }
    const staffId = req.headers.get('x-staff-id') || 'system'

    audit(req, 'GENERATE_DRAFT_POS', 'PurchaseOrder', undefined, { productIds, all }).catch(() => {})

    // Fetch candidate items from InventoryItem + preferred vendor
    let candidates: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ii."productId",
        ii."productName" as name,
        ii.sku,
        ii."onHand" as "currentStock",
        ii."reorderPoint",
        ii."reorderQty",
        ii."unitCost",
        vp."vendorId",
        vp."vendorSku",
        vp."vendorCost",
        v.name as "vendorName"
      FROM "InventoryItem" ii
      LEFT JOIN "VendorProduct" vp ON vp."productId" = ii."productId" AND vp.preferred = TRUE
      LEFT JOIN "Vendor" v ON v.id = vp."vendorId" AND v.active = TRUE
      WHERE (ii."onHand" + COALESCE(ii."onOrder", 0)) <= ii."reorderPoint"
        AND ii."reorderQty" > 0
    `)

    // Filter to selected products if not "all"
    if (!all && productIds.length > 0) {
      candidates = candidates.filter(p => productIds.includes(p.productId))
    }

    if (candidates.length === 0) {
      return NextResponse.json({ created: 0, purchaseOrders: [] })
    }

    // Group by vendor
    const grouped: Record<string, any[]> = {}
    for (const c of candidates) {
      const key = c.vendorId || 'no-vendor'
      if (!grouped[key]) grouped[key] = []
      grouped[key].push(c)
    }

    // Get next PO sequence
    const currentYear = new Date().getFullYear()
    const lastPO: any[] = await prisma.$queryRawUnsafe(
      `SELECT "poNumber" FROM "PurchaseOrder" WHERE "poNumber" LIKE $1 ORDER BY "poNumber" DESC LIMIT 1`,
      `PO-${currentYear}-%`
    )
    let nextSeq = 1
    if (lastPO.length > 0) {
      const parts = lastPO[0].poNumber.split('-')
      if (parts.length === 3) { const n = parseInt(parts[2], 10); if (!isNaN(n)) nextSeq = n + 1 }
    }

    const createdPOs = []

    for (const vendorId of Object.keys(grouped)) {
      const items = grouped[vendorId]
      if (vendorId === 'no-vendor') continue // Skip items with no vendor

      let subtotal = 0
      const poItems: any[] = []
      for (const item of items) {
        const cost = item.vendorCost || item.unitCost || 0
        const lineTotal = item.reorderQty * cost
        subtotal += lineTotal
        poItems.push({ productId: item.productId, vendorSku: item.vendorSku || item.sku || '', description: item.name || '', quantity: item.reorderQty, unitCost: cost, lineTotal })
      }

      const poId = 'po_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      const poNumber = `PO-${currentYear}-${String(nextSeq).padStart(4, '0')}`
      nextSeq++

      await prisma.$executeRawUnsafe(
        `INSERT INTO "PurchaseOrder" (id, "poNumber", "vendorId", "createdById", status, subtotal, "shippingCost", total, notes, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, 'DRAFT', $5, 0, $6, $7, NOW(), NOW())`,
        poId, poNumber, vendorId, staffId, subtotal, subtotal, 'Auto-generated reorder PO'
      )

      for (const item of poItems) {
        const itemId = 'poi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "PurchaseOrderItem" (id, "purchaseOrderId", "productId", "vendorSku", description, quantity, "unitCost", "lineTotal", "receivedQty", "damagedQty", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, NOW(), NOW())`,
          itemId, poId, item.productId, item.vendorSku, item.description, item.quantity, item.unitCost, item.lineTotal
        )
      }

      createdPOs.push({ poId, poNumber, vendorName: items[0]?.vendorName || 'Unknown', lineCount: poItems.length, total: subtotal })
    }

    return NextResponse.json({ created: createdPOs.length, purchaseOrders: createdPOs })
  } catch (error) {
    console.error('Error generating auto-POs:', error)
    return NextResponse.json({ error: 'Failed to generate auto-POs' }, { status: 500 })
  }
}
