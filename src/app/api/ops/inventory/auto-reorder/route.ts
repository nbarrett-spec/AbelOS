export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ─── Auto-Reorder PO Generation System ──────────────────────────────
// GET: Scan inventory and return suggested reorders grouped by vendor
// POST: Create draft POs from suggested reorders

interface ReorderSuggestion {
  productId: string
  sku: string | null
  productName: string | null
  onHand: number
  reorderPoint: number
  reorderQty: number
  vendorSku: string
  vendorCost: number | null
  lineTotal: number
}

interface VendorGroup {
  vendorId: string
  vendorName: string
  items: ReorderSuggestion[]
  subtotal: number
  itemCount: number
}

interface GetResponse {
  belowReorderPoint: number
  suggestions: VendorGroup[]
  noVendorItems: Array<{
    productId: string
    sku: string | null
    productName: string | null
    onHand: number
    reorderPoint: number
    reorderQty: number
  }>
}

interface PostRequest {
  suggestions: Array<{
    vendorId: string
    items: Array<{
      productId: string
      vendorSku: string
      description: string
      quantity: number
      unitCost: number
    }>
  }>
}

interface PostResponse {
  created: Array<{
    poId: string
    poNumber: string
    vendorId: string
    vendorName: string
    itemCount: number
    total: number
  }>
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Scan inventory items below reorder point
    const belowReorderItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        ii.id,
        ii."productId",
        ii.sku,
        ii."productName",
        ii."onHand",
        ii."reorderPoint",
        ii."reorderQty",
        ii."unitCost"
      FROM "InventoryItem" ii
      WHERE (ii."onHand" + COALESCE(ii."onOrder", 0)) <= ii."reorderPoint"
        AND ii."reorderQty" > 0
      ORDER BY ii."productName"
    `)

    // Group items that have preferred vendors
    const vendorGroups = new Map<string, any>()
    const noVendorItems: any[] = []

    for (const item of belowReorderItems) {
      // Find preferred vendor for this product
      const vendorProduct: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          vp.id,
          vp."vendorId",
          vp."vendorSku",
          vp."vendorCost",
          v.name as "vendorName"
        FROM "VendorProduct" vp
        JOIN "Vendor" v ON vp."vendorId" = v.id
        WHERE vp."productId" = $1
          AND vp.preferred = TRUE
          AND v.active = TRUE
        LIMIT 1
      `, item.productId)

      if (vendorProduct.length === 0) {
        // No preferred vendor found
        noVendorItems.push({
          productId: item.productId,
          sku: item.sku,
          productName: item.productName,
          onHand: item.onHand,
          reorderPoint: item.reorderPoint,
          reorderQty: item.reorderQty,
        })
        continue
      }

      const vp = vendorProduct[0]
      const vendorId = vp.vendorId
      const lineTotal = (item.reorderQty * (vp.vendorCost || item.unitCost || 0))

      if (!vendorGroups.has(vendorId)) {
        vendorGroups.set(vendorId, {
          vendorId,
          vendorName: vp.vendorName,
          items: [],
          subtotal: 0,
          itemCount: 0,
        })
      }

      const group = vendorGroups.get(vendorId)
      group.items.push({
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        onHand: item.onHand,
        reorderPoint: item.reorderPoint,
        reorderQty: item.reorderQty,
        vendorSku: vp.vendorSku,
        vendorCost: vp.vendorCost,
        lineTotal,
      })
      group.subtotal += lineTotal
      group.itemCount += 1
    }

    const suggestions = Array.from(vendorGroups.values())

    return safeJson({
      belowReorderPoint: belowReorderItems.length,
      suggestions,
      noVendorItems,
    } as GetResponse)
  } catch (error: any) {
    console.error('Auto-reorder GET error:', error)
    return safeJson({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return safeJson({ error: 'x-staff-id header required' }, { status: 400 })
  }

  try {
    const body = (await request.json()) as PostRequest

    if (!body.suggestions || !Array.isArray(body.suggestions)) {
      return safeJson({ error: 'suggestions array required' }, { status: 400 })
    }

    // Audit log
    audit(request, 'CREATE', 'PurchaseOrder', undefined, {
      method: 'POST',
      action: 'auto-reorder',
      suggestionCount: body.suggestions.length,
    }).catch(() => {})

    const created: PostResponse['created'] = []

    // Generate next PO sequence number for this year
    const currentYear = new Date().getFullYear()
    const lastPO: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        "poNumber"
      FROM "PurchaseOrder"
      WHERE "poNumber" LIKE $1
      ORDER BY "poNumber" DESC
      LIMIT 1
    `, `PO-${currentYear}-%`)

    let nextSequence = 1
    if (lastPO.length > 0) {
      const lastNumber = lastPO[0].poNumber
      const parts = lastNumber.split('-')
      if (parts.length === 3) {
        const lastSeq = parseInt(parts[2], 10)
        if (!isNaN(lastSeq)) {
          nextSequence = lastSeq + 1
        }
      }
    }

    // Create draft POs per vendor group
    for (const suggestion of body.suggestions) {
      const { vendorId, items } = suggestion

      // Get vendor info
      const vendor: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, name FROM "Vendor"
        WHERE id = $1 AND active = TRUE
      `, vendorId)

      if (vendor.length === 0) {
        console.warn(`Vendor ${vendorId} not found or inactive`)
        continue
      }

      const vendorName = vendor[0].name

      // Calculate totals
      let subtotal = 0
      const poItems: any[] = []

      for (const item of items) {
        const lineTotal = item.quantity * item.unitCost
        subtotal += lineTotal

        poItems.push({
          productId: item.productId,
          vendorSku: item.vendorSku,
          description: item.description,
          quantity: item.quantity,
          unitCost: item.unitCost,
          lineTotal,
        })
      }

      const poTotal = subtotal
      const poNumber = `PO-${currentYear}-${String(nextSequence).padStart(4, '0')}`
      nextSequence++

      // Create PurchaseOrder
      const poId = 'po_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

      await prisma.$executeRawUnsafe(`
        INSERT INTO "PurchaseOrder"
          (id, "poNumber", "vendorId", "createdById", status, subtotal, "shippingCost", total, notes, "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, 'DRAFT', $5, 0, $6, $7, NOW(), NOW())
      `, poId, poNumber, vendorId, staffId, subtotal, poTotal, 'Auto-generated reorder PO')

      // Create PurchaseOrderItems
      for (const item of poItems) {
        const itemId = 'poi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        await prisma.$executeRawUnsafe(`
          INSERT INTO "PurchaseOrderItem"
            (id, "purchaseOrderId", "productId", "vendorSku", description, quantity, "unitCost", "lineTotal", "receivedQty", "damagedQty", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 0, 0, NOW(), NOW())
        `, itemId, poId, item.productId, item.vendorSku, item.description, item.quantity, item.unitCost, item.lineTotal)
      }

      created.push({
        poId,
        poNumber,
        vendorId,
        vendorName,
        itemCount: items.length,
        total: poTotal,
      })
    }

    return safeJson({
      created,
    } as PostResponse)
  } catch (error: any) {
    console.error('Auto-reorder POST error:', error)
    return safeJson({ error: 'Internal server error' }, { status: 500 })
  }
}
