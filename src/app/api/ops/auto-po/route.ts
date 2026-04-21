export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/auto-po
 * Returns current auto-PO candidates and recent auto-generated POs
 */
export async function GET(req: NextRequest) {
  try {
    await checkStaffAuthWithFallback(req)

    // 1. Get products at or below reorder point
    const candidates = await prisma.$queryRaw`
      SELECT
        p."id",
        p."name",
        p."sku",
        p."currentStock"::int,
        p."reorderPoint"::int,
        p."reorderQty"::int,
        p."unitCost"::float,
        p."supplierId",
        s."name" AS "supplierName"
      FROM "Product" p
      LEFT JOIN "Supplier" s ON s."id" = p."supplierId"
      WHERE p."active" = true
        AND p."reorderPoint" > 0
        AND p."currentStock" <= p."reorderPoint"
      ORDER BY (p."currentStock"::float / NULLIF(p."reorderPoint", 0)::float) ASC
    ` as Array<{
      id: string
      name: string
      sku: string
      currentStock: number
      reorderPoint: number
      reorderQty: number
      unitCost: number
      supplierId: string | null
      supplierName: string | null
    }>

    // 2. Get recent auto-generated POs (last 30 days)
    const recentPOs = await prisma.$queryRaw`
      SELECT
        po."id",
        po."poNumber",
        po."status"::text,
        po."total"::float,
        po."createdAt",
        s."name" AS "supplierName",
        COUNT(pol."id")::int AS "lineCount"
      FROM "PurchaseOrder" po
      LEFT JOIN "Supplier" s ON s."id" = po."supplierId"
      LEFT JOIN "PurchaseOrderLine" pol ON pol."purchaseOrderId" = po."id"
      WHERE po."createdAt" >= NOW() - INTERVAL '30 days'
      GROUP BY po."id", po."poNumber", po."status", po."total", po."createdAt", s."name"
      ORDER BY po."createdAt" DESC
      LIMIT 20
    ` as Array<{
      id: string
      poNumber: string
      status: string
      total: number
      createdAt: Date
      supplierName: string | null
      lineCount: number
    }>

    // 3. Get summary stats
    const statsResult = await prisma.$queryRaw`
      SELECT
        COUNT(CASE WHEN p."currentStock" <= p."reorderPoint" AND p."reorderPoint" > 0 THEN 1 END)::int AS "needsReorder",
        COUNT(CASE WHEN p."currentStock" <= 0 THEN 1 END)::int AS "outOfStock",
        COUNT(*)::int AS "totalTracked"
      FROM "Product" p
      WHERE p."active" = true
    ` as Array<{
      needsReorder: number
      outOfStock: number
      totalTracked: number
    }>

    const stats = statsResult[0] || {
      needsReorder: 0,
      outOfStock: 0,
      totalTracked: 0,
    }

    return NextResponse.json({
      candidates,
      recentPOs,
      stats,
    })
  } catch (error) {
    console.error('Error fetching auto-PO candidates:', error)
    return NextResponse.json(
      { error: 'Failed to fetch auto-PO candidates' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/auto-po
 * Generate draft purchase orders from candidates
 * Body: { productIds?: string[] } or { all: true }
 */
export async function POST(req: NextRequest) {
  try {
    await checkStaffAuthWithFallback(req)

    const body = await req.json()
    const { productIds = [], all = false } = body as {
      productIds?: string[]
      all?: boolean
    }
    audit(req, 'GENERATE_DRAFT_POS', 'PurchaseOrder', undefined, { productIds, all }).catch(() => {})

    // Fetch candidate products
    let candidateProducts = await prisma.$queryRaw`
      SELECT
        p."id",
        p."name",
        p."sku",
        p."currentStock"::int,
        p."reorderPoint"::int,
        p."reorderQty"::int,
        p."unitCost"::float,
        p."supplierId"
      FROM "Product" p
      WHERE p."active" = true
        AND p."reorderPoint" > 0
        AND p."currentStock" <= p."reorderPoint"
    ` as Array<{
      id: string
      name: string
      sku: string
      currentStock: number
      reorderPoint: number
      reorderQty: number
      unitCost: number
      supplierId: string | null
    }>

    // Filter to selected products if not "all"
    if (!all && productIds.length > 0) {
      candidateProducts = candidateProducts.filter((p) =>
        productIds.includes(p.id)
      )
    }

    if (candidateProducts.length === 0) {
      return NextResponse.json({
        created: 0,
        purchaseOrders: [],
      })
    }

    // Group by supplier
    const groupedBySupplier = candidateProducts.reduce(
      (acc, product) => {
        const supplierId = product.supplierId || 'no-supplier'
        if (!acc[supplierId]) {
          acc[supplierId] = []
        }
        acc[supplierId].push(product)
        return acc
      },
      {} as Record<string, typeof candidateProducts>
    )

    const createdPOs = []
    const timestamp = Date.now()
    let poSequence = 0

    // Create a PO for each supplier group
    for (const supplierId in groupedBySupplier) {
      const products = groupedBySupplier[supplierId]
      const validSupplierId =
        supplierId !== 'no-supplier' ? supplierId : null

      // Calculate total
      let poTotal = 0
      for (const product of products) {
        const lineTotal = product.reorderQty * product.unitCost
        poTotal += lineTotal
      }

      // Generate PO ID and number
      const poId = `po_${timestamp}_${Math.random()
        .toString(36)
        .slice(2, 8)}`
      const dateStr = new Date().toISOString().split('T')[0].replace(/-/g, '')
      poSequence++
      const poNumber = `AUTO-${dateStr}-${String(poSequence).padStart(3, '0')}`

      // Create PO via raw SQL
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PurchaseOrder" (id, "poNumber", "supplierId", status, subtotal, "shippingCost", total, "createdAt", "updatedAt")
         VALUES ($1, $2, $3, 'DRAFT', $4, 0, $5, NOW(), NOW())`,
        poId, poNumber, validSupplierId, poTotal, poTotal
      )

      // Create PO lines
      let lineCount = 0
      for (const product of products) {
        const lineTotal = product.reorderQty * product.unitCost
        const lineId = `pol_${timestamp}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(
          `INSERT INTO "PurchaseOrderLine" (id, "purchaseOrderId", "productId", quantity, "unitCost", total, "createdAt")
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          lineId, poId, product.id, product.reorderQty, product.unitCost, lineTotal
        )
        lineCount++
      }

      // Get supplier name
      const supplierResult: any[] = validSupplierId
        ? await prisma.$queryRawUnsafe(`SELECT name FROM "Supplier" WHERE id = $1`, validSupplierId)
        : []

      createdPOs.push({
        poId,
        poNumber,
        supplierName: supplierResult[0]?.name || 'No Supplier',
        lineCount,
        total: poTotal,
      })
    }

    return NextResponse.json({
      created: createdPOs.length,
      purchaseOrders: createdPOs,
    })
  } catch (error) {
    console.error('Error generating auto-POs:', error)
    return NextResponse.json(
      { error: 'Failed to generate auto-POs' },
      { status: 500 }
    )
  }
}
