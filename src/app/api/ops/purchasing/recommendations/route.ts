export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface RecommendedItem {
  productId: string
  sku: string
  productName: string
  onHand: number
  onOrder: number
  reorderPoint: number
  reorderQty: number
  unitCost: number
  recommendedQty: number
  estimatedCost: number
  daysOfSupply: number
}

interface RecommendationGroup {
  vendorId: string
  vendorName: string
  vendorCode: string
  itemCount: number
  estimatedTotal: number
  urgency: 'CRITICAL' | 'STANDARD'
  items: RecommendedItem[]
}

/**
 * GET /api/ops/purchasing/recommendations
 *
 * Returns MRP recommendations: products that need reordering grouped by preferred vendor.
 * Urgency = CRITICAL if stockout imminent (onHand + onOrder < reorderPoint)
 * Urgency = STANDARD if approaching reorder point
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Find all inventory items where (onHand + onOrder) < reorderPoint
    const query = `
      SELECT
        ii."productId",
        ii."sku",
        ii."productName",
        ii."onHand",
        ii."onOrder",
        ii."reorderPoint",
        ii."reorderQty",
        ii."unitCost",
        p."id",
        p."sku" as "productSku",
        p."name",
        (SELECT "code" FROM "Vendor" v
         WHERE LOWER(v."name") = LOWER(SPLIT_PART(p."category", ' ', 1)))::text as "vendorCode"
      FROM "InventoryItem" ii
      LEFT JOIN "Product" p ON ii."productId" = p."id"
      WHERE (ii."onHand" + ii."onOrder") < ii."reorderPoint"
        AND p."active" = true
      ORDER BY ii."reorderPoint" - (ii."onHand" + ii."onOrder") DESC
    `

    const inventoryItems = await prisma.$queryRawUnsafe<any[]>(query)

    // Get vendor preferences (simplified: use category to find preferred vendor)
    // In a real system, you'd have a ProductVendor junction table
    const vendorQuery = `
      SELECT DISTINCT
        v."id",
        v."name",
        v."code",
        v."active"
      FROM "Vendor" v
      WHERE v."active" = true
      ORDER BY v."name"
    `

    const vendors = await prisma.$queryRawUnsafe<any[]>(vendorQuery)
    const vendorMap = new Map(vendors.map(v => [v.code?.toLowerCase(), v]))

    // Group items by vendor (simplified grouping by first letter of product category)
    const groupedByVendor: Record<string, RecommendationGroup> = {}

    for (const item of inventoryItems) {
      // Default to first vendor if we can't determine preferred vendor
      const vendorCode = item.vendorCode || (vendors.length > 0 ? vendors[0].code : 'DEFAULT')
      const vendor = vendorMap.get(vendorCode?.toLowerCase()) || vendors[0]

      if (!vendor) continue

      const vendorKey = vendor.id

      if (!groupedByVendor[vendorKey]) {
        groupedByVendor[vendorKey] = {
          vendorId: vendor.id,
          vendorName: vendor.name,
          vendorCode: vendor.code,
          itemCount: 0,
          estimatedTotal: 0,
          urgency: 'STANDARD',
          items: [],
        }
      }

      const daysOfSupply = item.onHand > 0 && item.unitCost > 0
        ? Math.ceil(item.onHand / Math.max(1, item.unitCost))
        : 0

      const recommendedQty = item.reorderQty || Math.max(10, item.reorderPoint * 2)
      const estimatedCost = recommendedQty * item.unitCost

      const recommendedItem: RecommendedItem = {
        productId: item.productId,
        sku: item.sku || item.productSku || 'N/A',
        productName: item.productName || item.name || 'Unknown',
        onHand: item.onHand || 0,
        onOrder: item.onOrder || 0,
        reorderPoint: item.reorderPoint || 0,
        reorderQty: item.reorderQty || 0,
        unitCost: item.unitCost || 0,
        recommendedQty,
        estimatedCost,
        daysOfSupply,
      }

      groupedByVendor[vendorKey].items.push(recommendedItem)
      groupedByVendor[vendorKey].itemCount += 1
      groupedByVendor[vendorKey].estimatedTotal += estimatedCost

      // Determine urgency: CRITICAL if onHand < reorderPoint
      if (item.onHand < item.reorderPoint) {
        groupedByVendor[vendorKey].urgency = 'CRITICAL'
      }
    }

    // Sort by urgency then by vendor name
    const sorted = Object.values(groupedByVendor)
      .sort((a, b) => {
        if (a.urgency !== b.urgency) {
          return a.urgency === 'CRITICAL' ? -1 : 1
        }
        return a.vendorName.localeCompare(b.vendorName)
      })

    return NextResponse.json(sorted, { status: 200 })
  } catch (error) {
    console.error('GET /api/ops/purchasing/recommendations error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch recommendations' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/ops/purchasing/recommendations
 *
 * Converts a recommendation group into a draft PurchaseOrder.
 * Body: { vendorId, items: [{ productId, recommendedQty, unitCost }] }
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { vendorId, items, createdById } = body

    if (!vendorId || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: vendorId, items (non-empty array), createdById' },
        { status: 400 }
      )
    }

    // Verify vendor exists
    const vendorCheck = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "name" FROM "Vendor" WHERE "id" = $1`,
      vendorId
    )

    if (!vendorCheck || vendorCheck.length === 0) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      )
    }

    const vendor = vendorCheck[0]

    // Generate PO number
    const now = new Date()
    const year = now.getFullYear()
    const poNumberResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING("poNumber" FROM '[0-9]+$') AS INT)), 0) as "maxNumber"
       FROM "PurchaseOrder"
       WHERE "poNumber" LIKE 'PO-${year}-%'`
    )

    const nextNumber = (poNumberResult[0]?.maxNumber || 0) + 1
    const poNumber = `PO-${year}-${String(nextNumber).padStart(4, '0')}`

    // Calculate totals and validate items
    let subtotal = 0
    const validItems = []

    for (const item of items) {
      if (!item.productId || !item.recommendedQty || !item.unitCost) {
        continue
      }

      const lineTotal = item.recommendedQty * item.unitCost
      subtotal += lineTotal

      validItems.push({
        ...item,
        lineTotal,
      })
    }

    if (validItems.length === 0) {
      return NextResponse.json(
        { error: 'No valid items provided' },
        { status: 400 }
      )
    }

    const total = subtotal // No tax/shipping at draft stage

    // Create PO
    const poId = `po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "PurchaseOrder" ("id", "poNumber", "vendorId", "createdById", "status", "subtotal", "shippingCost", "total", "notes", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'DRAFT'::"POStatus", $5, 0, $6, $7, NOW(), NOW())`,
      poId,
      poNumber,
      vendorId,
      createdById,
      subtotal,
      total,
      `Auto-generated from MRP recommendations for ${vendor.name}`
    )

    // Create PO items
    for (const item of validItems) {
      const itemId = `poi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      await prisma.$executeRawUnsafe(
        `INSERT INTO "PurchaseOrderItem" ("id", "purchaseOrderId", "vendorSku", "description", "quantity", "unitCost", "lineTotal")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        itemId,
        poId,
        item.sku || `PROD-${item.productId.slice(0, 8)}`,
        item.productName || `Product ${item.productId}`,
        item.recommendedQty,
        item.unitCost,
        item.lineTotal
      )
    }

    // Audit
    await audit(request, 'CREATE', 'PurchaseOrder', poId, {
      vendorId,
      vendorName: vendor.name,
      itemCount: validItems.length,
      total,
      source: 'MRP_RECOMMENDATION'
    })

    return NextResponse.json(
      {
        id: poId,
        poNumber,
        vendorId,
        vendorName: vendor.name,
        status: 'DRAFT',
        total,
        itemCount: validItems.length,
        createdAt: new Date().toISOString(),
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/ops/purchasing/recommendations error:', error)
    return NextResponse.json(
      { error: 'Failed to create recommendation PO' },
      { status: 500 }
    )
  }
}
