export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse, InvalidTransitionError } from '@/lib/status-guard'

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

    // ── AUTO-ALLOCATE: Check if any jobs are waiting for these products ──
    const autoAllocations: any[] = []
    const jobsAdvanced: string[] = []
    const pmNotifications: string[] = []

    for (const item of items) {
      const poItem = poItems.find((i) => i.id === item.purchaseOrderItemId)
      if (!poItem?.productId) continue

      const productId = poItem.productId
      const netReceived = item.receivedQty - (item.damagedQty || 0)
      if (netReceived <= 0) continue

      // Find SHORT picks waiting for this product
      const shortPicks: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          mp.id as "pickId",
          mp."jobId",
          mp.quantity,
          mp."pickedQty",
          mp.sku,
          j."jobNumber",
          j."assignedPMId",
          j.status::text as "jobStatus"
        FROM "MaterialPick" mp
        JOIN "Job" j ON mp."jobId" = j.id
        WHERE mp."productId" = $1
          AND mp.status::text = 'SHORT'
        ORDER BY j."scheduledDate" ASC NULLS LAST
      `, productId)

      // Get current available inventory for this product
      const invResult: any[] = await prisma.$queryRawUnsafe(`
        SELECT "onHand", "committed", "available" FROM "InventoryItem" WHERE "productId" = $1
      `, productId)
      let currentAvailable = invResult[0]?.available || 0

      for (const sp of shortPicks) {
        if (currentAvailable <= 0) break
        const needed = sp.quantity - sp.pickedQty
        if (needed <= 0) continue

        const canAllocate = Math.min(needed, currentAvailable)

        // Create allocation
        await prisma.$executeRawUnsafe(`
          INSERT INTO "InventoryAllocation"
          (id, "productId", "jobId", quantity, "allocationType", status, "allocatedBy", "allocatedAt", "createdAt", "updatedAt")
          VALUES (gen_random_uuid()::text, $1, $2, $3, 'HARD', 'RESERVED', $4, NOW(), NOW(), NOW())
        `, productId, sp.jobId, canAllocate, receivedBy || 'system')

        // Update inventory committed/available
        await prisma.$executeRawUnsafe(`
          UPDATE "InventoryItem"
          SET "committed" = "committed" + $1, "available" = "available" - $1, "updatedAt" = NOW()
          WHERE "productId" = $2
        `, canAllocate, productId)

        currentAvailable -= canAllocate

        // If fully allocated, change pick status from SHORT to PENDING
        if (canAllocate >= needed) {
          await prisma.$executeRawUnsafe(`
            UPDATE "MaterialPick" SET status = 'PENDING'::"PickStatus" WHERE id = $1
          `, sp.pickId)

          autoAllocations.push({
            jobNumber: sp.jobNumber,
            sku: sp.sku,
            allocated: canAllocate,
            status: 'FULLY_ALLOCATED',
          })

          // Check if ALL picks for this job are now non-SHORT
          const remainingShort: any[] = await prisma.$queryRawUnsafe(`
            SELECT COUNT(*)::int as count FROM "MaterialPick"
            WHERE "jobId" = $1 AND status::text = 'SHORT'
          `, sp.jobId)

          if (remainingShort[0]?.count === 0) {
            // All materials now available — update job flags
            await prisma.$executeRawUnsafe(`
              UPDATE "Job"
              SET "allMaterialsAllocated" = true, "updatedAt" = NOW()
              WHERE id = $1
            `, sp.jobId)

            // Auto-advance job status if in early stage — guard the transition.
            // CREATED → MATERIALS_LOCKED is NOT a valid direct edge in
            // JOB_TRANSITIONS (must pass through READINESS_CHECK); skip with a
            // warning when it would fail rather than bypass the state machine.
            if (sp.jobStatus === 'CREATED' || sp.jobStatus === 'READINESS_CHECK') {
              try {
                requireValidTransition('job', sp.jobStatus, 'MATERIALS_LOCKED')
                await prisma.$executeRawUnsafe(`
                  UPDATE "Job"
                  SET status = 'MATERIALS_LOCKED'::"JobStatus", "materialsLocked" = true, "updatedAt" = NOW()
                  WHERE id = $1
                `, sp.jobId)
                jobsAdvanced.push(sp.jobNumber)
              } catch (jobGuardErr) {
                if (jobGuardErr instanceof InvalidTransitionError) {
                  console.warn(
                    `[receiving] skipped Job→MATERIALS_LOCKED auto-advance for ${sp.jobNumber} — invalid from ${sp.jobStatus}`,
                  )
                } else {
                  throw jobGuardErr
                }
              }
            }

            // Notify PM
            if (sp.assignedPMId) {
              await prisma.$executeRawUnsafe(`
                INSERT INTO "Notification" (id, "staffId", type, title, body, link, read, "createdAt")
                VALUES (
                  gen_random_uuid()::text, $1,
                  'JOB_UPDATE'::"NotificationType",
                  $2, $3, $4, false, NOW()
                )
              `,
                sp.assignedPMId,
                `Materials Ready — ${sp.jobNumber}`,
                `All materials for ${sp.jobNumber} are now in stock and allocated. Job advanced to MATERIALS_LOCKED.`,
                `/ops/jobs/${sp.jobId}`
              )
              pmNotifications.push(sp.jobNumber)
            }
          }
        } else {
          // Partially allocated — update pick but leave as SHORT
          autoAllocations.push({
            jobNumber: sp.jobNumber,
            sku: sp.sku,
            allocated: canAllocate,
            remaining: needed - canAllocate,
            status: 'PARTIAL',
          })
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
