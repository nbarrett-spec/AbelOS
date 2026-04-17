export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// AI ORDER PROCESSING API
// Analyzes pending orders, inventory, and credit lines to generate smart
// purchasing and fulfillment recommendations
// ──────────────────────────────────────────────────────────────────────────

interface PORecommendation {
  vendorId: string
  vendorName: string
  items: Array<{
    productId: string
    productName: string
    requiredQty: number
    availableQty: number
    shortfall: number
    vendorSku: string
    unitCost: number
  }>
  estimatedTotal: number
  suggestedOrderDate: string
  urgency: 'IMMEDIATE' | 'STANDARD' | 'FLEXIBLE'
  creditImpact: {
    limit: number
    used: number
    available: number
    afterPO: number
  }
}

interface SORecommendation {
  orderId: string
  orderNumber: string
  builderName: string
  status: string
  allItemsAvailable: boolean
  shortItems: Array<{
    productId: string
    productName: string
    required: number
    available: number
    shortfall: number
  }>
}

interface CreditAlert {
  vendorId: string
  vendorName: string
  limit: number
  used: number
  available: number
  utilization: number
  projectedUtilization: number
}

interface DashboardResponse {
  poRecommendations: PORecommendation[]
  soRecommendations: SORecommendation[]
  creditAlerts: CreditAlert[]
  summary: {
    pendingOrders: number
    poRecommendations: number
    autoConfirmable: number
    creditWarnings: number
  }
}

// Helper: Generate PO number (PO-YYYY-NNNN)
function generatePONumber(year: number, sequence: number): string {
  return `PO-${year}-${String(sequence).padStart(4, '0')}`
}

// Helper: Format date to YYYY-MM-DD
function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

// ──────────────────────────────────────────────────────────────────────────
// GET ENDPOINT: AI Order Intelligence Dashboard
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // 1. Get all CONFIRMED orders awaiting PO creation
    const confirmedOrders = await prisma.$queryRawUnsafe<
      Array<{
        orderId: string
        orderNumber: string
        builderId: string
        builderName: string
        jobId: string
        scheduledDate: Date | null
      }>
    >(
      `SELECT DISTINCT o.id as "orderId", o."orderNumber", o."builderId",
              b."companyName" as "builderName", j.id as "jobId", j."scheduledDate"
       FROM "Order" o
       LEFT JOIN "Builder" b ON o."builderId" = b.id
       LEFT JOIN "Job" j ON j."orderId" = o.id
       WHERE o.status = 'CONFIRMED'
       ORDER BY j."scheduledDate" ASC NULLS LAST`
    )

    // 2. Get all RECEIVED orders (awaiting confirmation)
    const receivedOrders = await prisma.$queryRawUnsafe<
      Array<{
        orderId: string
        orderNumber: string
        builderId: string
        builderName: string
      }>
    >(
      `SELECT o.id as "orderId", o."orderNumber", o."builderId", b."companyName" as "builderName"
       FROM "Order" o
       LEFT JOIN "Builder" b ON o."builderId" = b.id
       WHERE o.status = 'RECEIVED'`
    )

    // 3. Build PO recommendations for confirmed orders
    const poRecommendations: PORecommendation[] = []
    const vendorAggregate = new Map<string, PORecommendation>()

    for (const order of confirmedOrders) {
      // Get all items in this order with inventory details
      const orderItems = await prisma.$queryRawUnsafe<
        Array<{
          productId: string
          productName: string
          orderQuantity: number
          onHand: number
          committed: number
          available: number
        }>
      >(
        `SELECT p.id as "productId", p.name as "productName",
                oi.quantity as "orderQuantity",
                COALESCE(ii."onHand", 0) as "onHand",
                COALESCE(ii.committed, 0) as "committed",
                COALESCE(ii.available, 0) as "available"
         FROM "OrderItem" oi
         JOIN "Product" p ON oi."productId" = p.id
         LEFT JOIN "InventoryItem" ii ON p.id = ii."productId"
         WHERE oi."orderId" = $1`,
        order.orderId
      )

      for (const item of orderItems) {
        const shortfall = Math.max(0, item.orderQuantity - item.available)

        if (shortfall > 0) {
          // Get preferred vendor for this product
          const vendor = await prisma.$queryRawUnsafe<
            Array<{
              vendorId: string
              vendorName: string
              vendorSku: string
              vendorCost: number | null
              avgLeadDays: number | null
            }>
          >(
            `SELECT v.id as "vendorId", v.name as "vendorName",
                    vp."vendorSku", vp."vendorCost", v."avgLeadDays"
             FROM "VendorProduct" vp
             JOIN "Vendor" v ON vp."vendorId" = v.id
             WHERE vp."productId" = $1 AND vp.preferred = true
             LIMIT 1`,
            item.productId
          )

          if (vendor && vendor.length > 0) {
            const v = vendor[0]
            const vendorKey = v.vendorId

            // Calculate smart order date: scheduledDate - avgLeadDays - 1 day
            let suggestedOrderDate = new Date()
            if (order.scheduledDate) {
              suggestedOrderDate = new Date(order.scheduledDate)
              const leadDays = v.avgLeadDays || 5
              suggestedOrderDate.setDate(
                suggestedOrderDate.getDate() - leadDays - 1
              )
            }

            const lineTotal = shortfall * (v.vendorCost || 0)
            const urgency =
              suggestedOrderDate <= new Date()
                ? 'IMMEDIATE'
                : suggestedOrderDate <=
                    new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                  ? 'STANDARD'
                  : 'FLEXIBLE'

            if (!vendorAggregate.has(vendorKey)) {
              vendorAggregate.set(vendorKey, {
                vendorId: v.vendorId,
                vendorName: v.vendorName,
                items: [],
                estimatedTotal: 0,
                suggestedOrderDate: formatDate(suggestedOrderDate),
                urgency,
                creditImpact: { limit: 0, used: 0, available: 0, afterPO: 0 },
              })
            }

            const rec = vendorAggregate.get(vendorKey)!
            rec.items.push({
              productId: item.productId,
              productName: item.productName,
              requiredQty: item.orderQuantity,
              availableQty: item.available,
              shortfall,
              vendorSku: v.vendorSku,
              unitCost: v.vendorCost || 0,
            })
            rec.estimatedTotal += lineTotal
            rec.suggestedOrderDate = formatDate(
              new Date(
                Math.min(
                  new Date(rec.suggestedOrderDate).getTime(),
                  suggestedOrderDate.getTime()
                )
              )
            )
          }
        }
      }
    }

    // 4. Fetch vendor credit information and populate credit impact
    for (const [, rec] of vendorAggregate) {
      const vendorCredit = await prisma.$queryRawUnsafe<
        Array<{
          creditLimit: number | null
          creditUsed: number
        }>
      >(
        `SELECT COALESCE("creditLimit", 0) as "creditLimit",
                COALESCE("creditUsed", 0) as "creditUsed"
         FROM "Vendor"
         WHERE id = $1`,
        rec.vendorId
      )

      if (vendorCredit && vendorCredit.length > 0) {
        const vc = vendorCredit[0]
        const creditLimit = vc.creditLimit || 0
        const creditUsed = vc.creditUsed || 0
        const available = creditLimit - creditUsed
        const afterPO = creditLimit - (creditUsed + rec.estimatedTotal)

        rec.creditImpact = {
          limit: creditLimit,
          used: creditUsed,
          available,
          afterPO: Math.max(0, afterPO),
        }
      }

      poRecommendations.push(rec)
    }

    // 5. Build SO recommendations for received orders
    const soRecommendations: SORecommendation[] = []

    for (const order of receivedOrders) {
      const orderItems = await prisma.$queryRawUnsafe<
        Array<{
          productId: string
          productName: string
          orderQuantity: number
          available: number
        }>
      >(
        `SELECT p.id as "productId", p.name as "productName",
                oi.quantity as "orderQuantity",
                COALESCE(ii.available, 0) as "available"
         FROM "OrderItem" oi
         JOIN "Product" p ON oi."productId" = p.id
         LEFT JOIN "InventoryItem" ii ON p.id = ii."productId"
         WHERE oi."orderId" = $1`,
        order.orderId
      )

      let allAvailable = true
      const shortItems: SORecommendation['shortItems'] = []

      for (const item of orderItems) {
        if (item.orderQuantity > item.available) {
          allAvailable = false
          shortItems.push({
            productId: item.productId,
            productName: item.productName,
            required: item.orderQuantity,
            available: item.available,
            shortfall: item.orderQuantity - item.available,
          })
        }
      }

      soRecommendations.push({
        orderId: order.orderId,
        orderNumber: order.orderNumber,
        builderName: order.builderName,
        status: 'RECEIVED',
        allItemsAvailable: allAvailable,
        shortItems,
      })
    }

    // 6. Build credit alerts (vendors over threshold)
    const creditAlerts: CreditAlert[] = []
    const vendors = await prisma.$queryRawUnsafe<
      Array<{
        vendorId: string
        vendorName: string
        creditLimit: number | null
        creditUsed: number
      }>
    >(
      `SELECT id as "vendorId", name as "vendorName",
              COALESCE("creditLimit", 0) as "creditLimit",
              COALESCE("creditUsed", 0) as "creditUsed"
       FROM "Vendor" WHERE active = true`
    )

    for (const v of vendors) {
      const limit = v.creditLimit || 0
      const used = v.creditUsed || 0
      const available = limit - used
      const utilization = limit > 0 ? (used / limit) * 100 : 0

      // Project utilization if all POs are created
      let projectedUsed = used
      const vendorPOs = poRecommendations.filter(
        (po) => po.vendorId === v.vendorId
      )
      for (const po of vendorPOs) {
        projectedUsed += po.estimatedTotal
      }
      const projectedUtilization =
        limit > 0 ? (projectedUsed / limit) * 100 : 0

      // Alert if utilization > 80%
      if (utilization > 80 || projectedUtilization > 100) {
        creditAlerts.push({
          vendorId: v.vendorId,
          vendorName: v.vendorName,
          limit,
          used,
          available: Math.max(0, available),
          utilization: Math.round(utilization),
          projectedUtilization: Math.round(projectedUtilization),
        })
      }
    }

    const summary = {
      pendingOrders: confirmedOrders.length + receivedOrders.length,
      poRecommendations: poRecommendations.length,
      autoConfirmable: soRecommendations.filter(
        (so) => so.allItemsAvailable
      ).length,
      creditWarnings: creditAlerts.length,
    }

    return NextResponse.json({
      poRecommendations,
      soRecommendations,
      creditAlerts,
      summary,
    } as DashboardResponse)
  } catch (error) {
    console.error('AI Order Dashboard error:', error)
    return NextResponse.json(
      { error: 'Failed to generate recommendations' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST ENDPOINT: Execute AI Recommendation
// ──────────────────────────────────────────────────────────────────────────

interface ExecuteRequest {
  action: 'create_po' | 'confirm_order' | 'create_all_pos'
  recommendationIndex?: number
  orderId?: string
}

interface ExecuteResponse {
  success: boolean
  message: string
  created?: {
    poId: string
    poNumber: string
  }[]
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<ExecuteResponse>> {
  const authError = checkStaffAuth(request)
  if (authError) return authError as any

  try {
    const body = (await request.json()) as ExecuteRequest
    const { action, recommendationIndex, orderId } = body

    // Get staff ID from request headers
    const staffId = request.headers.get('x-staff-id') || 'system'

    if (action === 'create_po' && recommendationIndex !== undefined) {
      // Get the recommendation from GET data
      const dashboardResponse = await GET(request)
      const dashData = await dashboardResponse.json() as DashboardResponse
      const rec = dashData.poRecommendations[recommendationIndex]

      if (!rec) {
        return NextResponse.json(
          { success: false, message: 'Recommendation not found' },
          { status: 404 }
        )
      }

      // Determine PO status based on total
      const poStatus =
        rec.estimatedTotal > 5000 ? 'PENDING_APPROVAL' : 'DRAFT'

      // Generate PO number
      const lastPO = await prisma.$queryRawUnsafe<Array<{ maxSeq: number }>>(
        `SELECT COALESCE(MAX(CAST(SUBSTRING("poNumber", 10) AS INT)), 0) as "maxSeq"
         FROM "PurchaseOrder"
         WHERE "poNumber" LIKE $1`,
        `PO-${new Date().getFullYear()}-%`
      )
      const nextSeq = (lastPO[0]?.maxSeq || 0) + 1
      const poNumber = generatePONumber(new Date().getFullYear(), nextSeq)

      // Create PurchaseOrder
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PurchaseOrder"
         (id, "poNumber", "vendorId", "createdById", status, subtotal, total, "expectedDate", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
        `po-${Date.now()}`,
        poNumber,
        rec.vendorId,
        staffId,
        poStatus,
        rec.estimatedTotal,
        rec.estimatedTotal,
        rec.suggestedOrderDate
      )

      // Get the PO ID we just created
      const newPO = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "PurchaseOrder" WHERE "poNumber" = $1 LIMIT 1`,
        poNumber
      )
      const poId = newPO[0]?.id || ''

      // Create PurchaseOrderItems
      for (const item of rec.items) {
        const lineTotal = item.shortfall * item.unitCost
        await prisma.$executeRawUnsafe(
          `INSERT INTO "PurchaseOrderItem"
           (id, "purchaseOrderId", "productId", "vendorSku", description, quantity, "unitCost", "lineTotal", "createdAt", "updatedAt")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          `poi-${Date.now()}-${Math.random()}`,
          poId,
          item.productId,
          item.vendorSku,
          item.productName,
          item.shortfall,
          item.unitCost,
          lineTotal
        )
      }

      // Update InventoryItem onOrder
      for (const item of rec.items) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem" SET "onOrder" = "onOrder" + $1 WHERE "productId" = $2`,
          item.shortfall,
          item.productId
        )
      }

      // Update Vendor creditUsed
      await prisma.$executeRawUnsafe(
        `UPDATE "Vendor" SET "creditUsed" = "creditUsed" + $1 WHERE id = $2`,
        rec.estimatedTotal,
        rec.vendorId
      )

      return NextResponse.json({
        success: true,
        message: `PO ${poNumber} created with status ${poStatus}`,
        created: [{ poId, poNumber }],
      })
    } else if (action === 'confirm_order' && orderId) {
      // Update order status to CONFIRMED
      await prisma.$executeRawUnsafe(
        `UPDATE "Order" SET status = 'CONFIRMED', "updatedAt" = NOW() WHERE id = $1`,
        orderId
      )

      // Get all items in order
      const items = await prisma.$queryRawUnsafe<
        Array<{
          productId: string
          quantity: number
        }>
      >(
        `SELECT "productId", quantity FROM "OrderItem" WHERE "orderId" = $1`,
        orderId
      )

      // Create inventory allocations (committed)
      for (const item of items) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem"
           SET committed = committed + $1, available = available - $1
           WHERE "productId" = $2`,
          item.quantity,
          item.productId
        )
      }

      return NextResponse.json({
        success: true,
        message: `Order ${orderId} confirmed and inventory allocated`,
      })
    } else if (action === 'create_all_pos') {
      // Get all recommendations
      const dashboardResponse = await GET(request)
      const dashData = await dashboardResponse.json() as DashboardResponse
      const created = []

      for (let i = 0; i < dashData.poRecommendations.length; i++) {
        const result = await POST(
          new NextRequest(request.url, {
            method: 'POST',
            headers: request.headers,
            body: JSON.stringify({
              action: 'create_po',
              recommendationIndex: i,
            }),
          })
        )
        const resultData = (await result.json()) as ExecuteResponse
        if (resultData.created) {
          created.push(...resultData.created)
        }
      }

      return NextResponse.json({
        success: true,
        message: `Created ${created.length} purchase orders`,
        created,
      })
    }

    return NextResponse.json(
      { success: false, message: 'Invalid action or missing parameters' },
      { status: 400 }
    )
  } catch (error) {
    console.error('Order execution error:', error)
    return NextResponse.json(
      { success: false, message: 'Failed to execute action' },
      { status: 500 }
    )
  }
}
