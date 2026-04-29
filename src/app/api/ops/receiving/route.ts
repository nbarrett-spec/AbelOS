export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse, InvalidTransitionError } from '@/lib/status-guard'

/**
 * GAP-11: Enhanced receiving → inventory → allocation cascade
 * After receiving items:
 * 1. Update InventoryItem: onHand += receivedQty, onOrder -= receivedQty
 * 2. Find BACKORDERED allocations for same productId, ordered by Job.scheduledDate
 * 3. For each BACKORDERED: if onHand >= qty, flip to RESERVED
 * 4. For partial: split allocation — RESERVED for available, BACKORDERED for remainder
 * 5. Create InboxItem for PM when material arrives
 * 6. Update MaterialWatch status when all backorders satisfied
 */

interface BackorderAllocation {
  id: string
  jobId: string
  quantity: number
  jobNumber: string | null
  scheduledDate: Date | null
  assignedPMId: string | null
}

// ───────────────────────────────────────────────────────────────────────────
// GET /api/ops/receiving — List POs awaiting receiving
// ───────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Extract search params
    const searchParams = new URL(request.url).searchParams
    const search = searchParams.get('search')?.trim()

    // Build WHERE clause
    let whereClause = `WHERE po.status IN ('SENT_TO_VENDOR'::"POStatus", 'APPROVED'::"POStatus", 'PARTIALLY_RECEIVED'::"POStatus")`
    const queryParams: any[] = []

    if (search) {
      // Search by PO number or vendor name (case-insensitive) using parameterized query
      queryParams.push(`%${search}%`)
      whereClause += ` AND po."poNumber" ILIKE $${queryParams.length}`
      queryParams.push(`%${search}%`)
      whereClause += ` OR v.name ILIKE $${queryParams.length}`
    }

    // Fetch POs with vendor, item count, and amounts
    const query = `
      SELECT
        po.id,
        po."poNumber",
        v.id as "vendorId",
        v.name as "vendorName",
        po."expectedDate",
        po.total,
        po.status,
        po."createdAt",
        COUNT(poi.id)::int as "totalItems",
        COALESCE(SUM(CASE WHEN poi."receivedQty" > 0 THEN 1 ELSE 0 END), 0)::int as "itemsStarted",
        COALESCE(SUM(poi."receivedQty"), 0)::float as "totalReceivedQty",
        COALESCE(SUM(poi.quantity), 0)::float as "totalOrderedQty"
      FROM "PurchaseOrder" po
      JOIN "Vendor" v ON v.id = po."vendorId"
      LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      ${whereClause}
      GROUP BY po.id, v.id, v.name, po."poNumber", po."expectedDate", po.total, po.status, po."createdAt"
      ORDER BY po."expectedDate" ASC NULLS LAST, po."createdAt" DESC
    `
    const pos: any[] = await prisma.$queryRawUnsafe(query, ...queryParams)

    // Transform the results
    const result = pos.map((po) => ({
      id: po.id,
      poNumber: po.poNumber,
      vendorId: po.vendorId,
      vendorName: po.vendorName,
      status: po.status,
      expectedDate: po.expectedDate ? new Date(po.expectedDate).toISOString() : null,
      totalAmount: parseFloat(po.total),
      createdAt: new Date(po.createdAt).toISOString(),
      items: {
        total: po.totalItems,
        started: po.itemsStarted,
        totalReceivedQty: po.totalReceivedQty,
        totalOrderedQty: po.totalOrderedQty,
      },
      progress: {
        fullyReceived: po.totalReceivedQty >= po.totalOrderedQty,
        percentComplete: po.totalOrderedQty > 0
          ? Math.round((po.totalReceivedQty / po.totalOrderedQty) * 100)
          : 0,
      },
    }))

    return NextResponse.json({
      success: true,
      count: result.length,
      pos: result,
    })
  } catch (error) {
    console.error('[GET /api/ops/receiving] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch POs awaiting receiving' },
      { status: 500 }
    )
  }
}

// ───────────────────────────────────────────────────────────────────────────
// POST /api/ops/receiving — Process a receiving check-in
// ───────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Receiving', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const {
      purchaseOrderId,
      items,
      receivedBy,
      notes,
    } = body as {
      purchaseOrderId: string
      items: Array<{
        purchaseOrderItemId: string
        receivedQty: number
        damagedQty: number
        notes?: string
      }>
      receivedBy: string
      notes?: string
    }

    // Validation
    if (!purchaseOrderId || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'purchaseOrderId and items are required' },
        { status: 400 }
      )
    }

    // Get the PO to verify it exists
    const po: any = await prisma.$queryRawUnsafe(`
      SELECT po.id, po."poNumber", po.total, po.status
      FROM "PurchaseOrder" po
      WHERE po.id = $1
    `, purchaseOrderId)

    if (!po || po.length === 0) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      )
    }

    const purchaseOrder = po[0]

    // Get all items for this PO
    const poItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        id,
        "productId",
        quantity,
        "receivedQty",
        "damagedQty"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = $1
    `, purchaseOrderId)

    let totalReceivedQty = 0
    let totalDamagedQty = 0
    let itemsProcessed = 0

    // Process each item
    for (const item of items) {
      const { purchaseOrderItemId, receivedQty, damagedQty } = item

      // Validate received item exists
      const poItem = poItems.find((i) => i.id === purchaseOrderItemId)
      if (!poItem) {
        return NextResponse.json(
          { error: `Item ${purchaseOrderItemId} not found in this PO` },
          { status: 404 }
        )
      }

      const productId = poItem.productId

      // Update PurchaseOrderItem with received and damaged quantities
      await prisma.$executeRawUnsafe(`
        UPDATE "PurchaseOrderItem"
        SET
          "receivedQty" = "receivedQty" + $1,
          "damagedQty" = "damagedQty" + $2
        WHERE id = $3
      `, receivedQty, damagedQty, purchaseOrderItemId)

      if (productId) {
        // Check if InventoryItem exists for this product
        const inventoryExists: any = await prisma.$queryRawUnsafe(`
          SELECT id FROM "InventoryItem" WHERE "productId" = $1
        `, productId)

        if (inventoryExists && inventoryExists.length > 0) {
          // Update existing inventory
          const netReceived = receivedQty - damagedQty
          await prisma.$executeRawUnsafe(`
            UPDATE "InventoryItem"
            SET
              "onHand" = "onHand" + $1,
              "onOrder" = "onOrder" - $2,
              "available" = ("onHand" + $1) - "committed",
              "lastReceivedAt" = NOW()
            WHERE "productId" = $3
          `, netReceived, receivedQty, productId)
        } else {
          // Create new inventory item
          const netReceived = receivedQty - damagedQty
          await prisma.$executeRawUnsafe(`
            INSERT INTO "InventoryItem"
            (id, "productId", "onHand", "committed", "onOrder", "available", "lastReceivedAt", "updatedAt")
            VALUES (
              gen_random_uuid()::text,
              $1,
              $2,
              0,
              -$3,
              $2,
              NOW(),
              NOW()
            )
          `, productId, netReceived, receivedQty)
        }
      }

      totalReceivedQty += receivedQty
      totalDamagedQty += damagedQty
      itemsProcessed++
    }

    // Check if PO is fully received
    const updatedPoItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        SUM(quantity) as "totalQuantity",
        SUM("receivedQty") as "totalReceivedQty"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = $1
    `, purchaseOrderId)

    const itemSummary = updatedPoItems[0]
    const isFullyReceived = itemSummary.totalReceivedQty >= itemSummary.totalQuantity

    // Determine new PO status
    const newStatus = isFullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'

    // Guard: enforce POStatus state machine before advancing.
    try {
      requireValidTransition('po', purchaseOrder.status, newStatus)
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // Update PO status and receivedAt if fully received
    if (isFullyReceived) {
      await prisma.$executeRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET
          status = 'RECEIVED'::"POStatus",
          "receivedAt" = NOW()
        WHERE id = $1
      `, purchaseOrderId)
    } else {
      await prisma.$executeRawUnsafe(`
        UPDATE "PurchaseOrder"
        SET status = 'PARTIALLY_RECEIVED'::"POStatus"
        WHERE id = $1
      `, purchaseOrderId)
    }

    // ── AUTO-ALLOCATE: Check if any jobs are waiting for these products (GAP-11) ──
    const autoAllocations: any[] = []
    const jobsAdvanced: string[] = []
    const pmNotifications: string[] = []

    for (const item of items) {
      const poItem = poItems.find((i) => i.id === item.purchaseOrderItemId)
      if (!poItem?.productId) continue

      const productId = poItem.productId
      const netReceived = item.receivedQty - (item.damagedQty || 0)
      if (netReceived <= 0) continue

      // Get product details for notification
      const productInfo = await prisma.$queryRawUnsafe<Array<{ sku: string | null; name: string | null }>>(
        `SELECT "sku", "name" FROM "Product" WHERE "id" = $1 LIMIT 1`,
        productId
      )
      const productName = productInfo.length > 0 ? (productInfo[0].name || productInfo[0].sku || productId) : productId

      // Find BACKORDERED InventoryAllocations for this product
      const backorders = await prisma.$queryRawUnsafe<Array<BackorderAllocation>>(
        `
        SELECT
          ia."id",
          ia."jobId",
          ia.quantity,
          j."jobNumber",
          j."scheduledDate",
          j."assignedPMId"
        FROM "InventoryAllocation" ia
        JOIN "Job" j ON ia."jobId" = j.id
        WHERE ia."productId" = $1
          AND ia.status = 'BACKORDERED'
        ORDER BY j."scheduledDate" ASC NULLS LAST
        `,
        productId
      )

      // Get current available inventory
      const invResult = await prisma.$queryRawUnsafe<Array<{ onHand: number; committed: number }>>(
        `SELECT "onHand", "committed" FROM "InventoryItem" WHERE "productId" = $1`,
        productId
      )
      let currentAvailable = invResult.length > 0 ? (invResult[0].onHand - invResult[0].committed) : 0

      // Process backorders in priority order (by scheduledDate)
      const fullyReservedJobs = new Set<string>()

      for (const backorder of backorders) {
        if (currentAvailable <= 0) break

        const canReserve = Math.min(backorder.quantity, currentAvailable)

        // If we can fully satisfy this backorder
        if (canReserve >= backorder.quantity) {
          // Update allocation to RESERVED
          await prisma.$executeRawUnsafe(
            `
            UPDATE "InventoryAllocation"
            SET status = 'RESERVED', "updatedAt" = NOW()
            WHERE "id" = $1
            `,
            backorder.id
          )

          // Update inventory committed
          await prisma.$executeRawUnsafe(
            `
            UPDATE "InventoryItem"
            SET "committed" = "committed" + $1, "updatedAt" = NOW()
            WHERE "productId" = $2
            `,
            backorder.quantity,
            productId
          )

          currentAvailable -= backorder.quantity
          fullyReservedJobs.add(backorder.jobId)

          autoAllocations.push({
            jobNumber: backorder.jobNumber,
            productName,
            allocated: backorder.quantity,
            status: 'FULLY_RESERVED',
          })
        } else {
          // Partially satisfy: split the allocation
          // 1. Update existing allocation to RESERVED with partial quantity
          await prisma.$executeRawUnsafe(
            `
            UPDATE "InventoryAllocation"
            SET quantity = $1, status = 'RESERVED', "updatedAt" = NOW()
            WHERE "id" = $2
            `,
            canReserve,
            backorder.id
          )

          // 2. Create new BACKORDERED allocation for the remainder
          const remainingQty = backorder.quantity - canReserve
          const newAllocId = `allo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(
            `
            INSERT INTO "InventoryAllocation"
            (id, "productId", "jobId", quantity, "allocationType", status, "allocatedBy", "allocatedAt", "createdAt", "updatedAt")
            VALUES ($1, $2, $3, $4, 'HARD', 'BACKORDERED', $5, NOW(), NOW(), NOW())
            `,
            newAllocId,
            productId,
            backorder.jobId,
            remainingQty,
            receivedBy || 'system'
          )

          // 3. Update inventory committed for the reserved portion
          await prisma.$executeRawUnsafe(
            `
            UPDATE "InventoryItem"
            SET "committed" = "committed" + $1, "updatedAt" = NOW()
            WHERE "productId" = $2
            `,
            canReserve,
            productId
          )

          currentAvailable = 0

          autoAllocations.push({
            jobNumber: backorder.jobNumber,
            productName,
            allocated: canReserve,
            remaining: remainingQty,
            status: 'PARTIAL_RESERVED',
          })
        }
      }

      // Create inbox notifications for PMs
      for (const jobId of fullyReservedJobs) {
        const job = backorders.find((b) => b.jobId === jobId)
        if (!job) continue

        // Create InboxItem for PM: material arrived and ready to pick
        const notifId = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "InboxItem" (
            "id", "type", "source", "title", "description", "priority", "status",
            "entityType", "entityId", "actionData", "createdAt", "updatedAt"
          ) VALUES (
            $1, 'MATERIAL_ARRIVED', 'receiving-cascade', $2, $3, 'HIGH', 'PENDING',
            'Job', $4, $5::jsonb, NOW(), NOW()
          )
          `,
          notifId,
          `Material In Stock: ${productName} (${job.jobNumber})`,
          `${productName} has arrived and is reserved for ${job.jobNumber}. Ready to pick.`,
          jobId,
          JSON.stringify({ productId, jobId, productName })
        )

        // Check if ALL backordered items for this job are now satisfied
        const remainingBackorders = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
          `
          SELECT COUNT(*)::int as count
          FROM "InventoryAllocation"
          WHERE "jobId" = $1 AND status = 'BACKORDERED'
          `,
          jobId
        )

        if (remainingBackorders.length === 0 || remainingBackorders[0].count === 0) {
          // Update MaterialWatch status if exists
          await prisma.$executeRawUnsafe(
            `
            UPDATE "MaterialWatch"
            SET status = 'AVAILABLE', "updatedAt" = NOW()
            WHERE "jobId" = $1 AND status IN ('AWAITING', 'PARTIAL')
            `,
            jobId
          )

          // Notify PM via Notification
          if (job.assignedPMId) {
            await prisma.$executeRawUnsafe(
              `
              INSERT INTO "Notification" (id, "staffId", type, title, body, link, read, "createdAt")
              VALUES (
                gen_random_uuid()::text, $1,
                'JOB_UPDATE'::"NotificationType",
                $2, $3, $4, false, NOW()
              )
              `,
              job.assignedPMId,
              `Materials Ready — ${job.jobNumber}`,
              `All backorders for ${job.jobNumber} are now satisfied. Materials are in stock and ready to pick.`,
              `/ops/jobs/${jobId}`
            )
            pmNotifications.push(job.jobNumber || jobId)
          }
        }
      }
    }

    return NextResponse.json({
      success: true,
      poStatus: newStatus,
      poNumber: purchaseOrder.poNumber,
      itemsProcessed,
      summary: {
        totalReceived: totalReceivedQty,
        totalDamaged: totalDamagedQty,
        fullyReceived: isFullyReceived,
      },
      autoAllocations: autoAllocations.length > 0 ? autoAllocations : undefined,
      jobsAdvanced: jobsAdvanced.length > 0 ? jobsAdvanced : undefined,
      pmNotifications: pmNotifications.length > 0 ? pmNotifications : undefined,
    })
  } catch (error) {
    console.error('[POST /api/ops/receiving] Error:', error)
    return NextResponse.json(
      { error: 'Failed to process receiving check-in' },
      { status: 500 }
    )
  }
}
