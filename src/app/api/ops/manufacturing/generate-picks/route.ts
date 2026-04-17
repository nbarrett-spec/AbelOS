export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/manufacturing/generate-picks
 *
 * Core pick list generation engine:
 * 1. Takes a jobId
 * 2. Looks up the linked Order's OrderItems
 * 3. For each OrderItem, expands through BOM (if parent product has components)
 * 4. Creates MaterialPick records for each component
 * 5. If no BOM exists, creates a direct pick for the product itself
 * 6. Checks inventory availability and creates allocation records
 * 7. Marks job.pickListGenerated = true
 *
 * Body: { jobId, force?: boolean }
 *   force=true regenerates even if picks already exist (deletes old ones first)
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Manufacturing', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { jobId, force } = body
    const staffId = request.headers.get('x-staff-id') || 'system'

    if (!jobId) {
      return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
    }

    // ── 1. Get the job and linked order ────────────────────────────────
    const jobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT j.id, j."jobNumber", j."orderId", j."pickListGenerated", j.status::text as status
      FROM "Job" j
      WHERE j.id = $1
    `, jobId)

    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobs[0]

    // Guard: only generate picks for jobs in appropriate status
    const allowedStatuses = ['CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED', 'IN_PRODUCTION']
    if (!allowedStatuses.includes(job.status)) {
      return NextResponse.json(
        { error: `Cannot generate picks for job in ${job.status} status` },
        { status: 400 }
      )
    }

    // Guard: picks already exist
    if (job.pickListGenerated && !force) {
      return NextResponse.json(
        { error: 'Pick list already generated. Use force=true to regenerate.' },
        { status: 400 }
      )
    }

    if (!job.orderId) {
      return NextResponse.json(
        { error: 'Job has no linked order. Cannot generate picks without order items.' },
        { status: 400 }
      )
    }

    // ── 2. Get order items ─────────────────────────────────────────────
    const orderItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        oi.id as "orderItemId",
        oi."productId",
        oi.description,
        oi.quantity,
        p.sku,
        p.name as "productName",
        p.category
      FROM "OrderItem" oi
      JOIN "Product" p ON oi."productId" = p.id
      WHERE oi."orderId" = $1
      ORDER BY oi.id
    `, job.orderId)

    if (orderItems.length === 0) {
      return NextResponse.json(
        { error: 'Order has no line items' },
        { status: 400 }
      )
    }

    // ── 3. If force, delete existing picks and allocations ─────────────
    if (force && job.pickListGenerated) {
      // Release allocations first
      await prisma.$executeRawUnsafe(`
        UPDATE "InventoryItem" ii
        SET
          "committed" = "committed" - COALESCE(sub.total_qty, 0),
          "available" = "onHand" - ("committed" - COALESCE(sub.total_qty, 0))
        FROM (
          SELECT "productId", SUM(quantity)::int as total_qty
          FROM "InventoryAllocation"
          WHERE "jobId" = $1 AND status = 'RESERVED'
          GROUP BY "productId"
        ) sub
        WHERE ii."productId" = sub."productId"
      `, jobId)

      await prisma.$executeRawUnsafe(`
        DELETE FROM "InventoryAllocation" WHERE "jobId" = $1
      `, jobId)

      await prisma.$executeRawUnsafe(`
        DELETE FROM "MaterialPick" WHERE "jobId" = $1
      `, jobId)
    }

    // ── 4. Expand BOMs and create picks ────────────────────────────────
    const picksCreated: any[] = []
    const allocationsCreated: any[] = []
    const shortages: any[] = []

    for (const item of orderItems) {
      // Check if this product has a BOM (is an assembled unit)
      const bomComponents: any[] = await prisma.$queryRawUnsafe(`
        SELECT
          be.id as "bomEntryId",
          be."componentId",
          be.quantity as "bomQty",
          be."componentType",
          cp.sku as "componentSku",
          cp.name as "componentName",
          cp.category as "componentCategory"
        FROM "BomEntry" be
        JOIN "Product" cp ON be."componentId" = cp.id
        WHERE be."parentId" = $1
        ORDER BY
          CASE be."componentType"
            WHEN 'Slab' THEN 1
            WHEN 'Jamb' THEN 2
            WHEN 'Casing' THEN 3
            WHEN 'Hinge' THEN 4
            WHEN 'Lockset' THEN 5
            WHEN 'Strike' THEN 6
            WHEN 'Stop' THEN 7
            ELSE 99
          END
      `, item.productId)

      if (bomComponents.length > 0) {
        // This is an assembled product (e.g., prehung door unit)
        // Create a pick for EACH component × order quantity
        for (const comp of bomComponents) {
          const pickQty = comp.bomQty * item.quantity
          const pick = await createPickAndAllocate({
            jobId,
            productId: comp.componentId,
            sku: comp.componentSku,
            description: `${comp.componentType || comp.componentCategory}: ${comp.componentName}`,
            quantity: pickQty,
            orderItemId: item.orderItemId,
            bomEntryId: comp.bomEntryId,
            parentProductId: item.productId,
            staffId,
          })
          picksCreated.push(pick.pick)
          if (pick.allocation) allocationsCreated.push(pick.allocation)
          if (pick.shortage) shortages.push(pick.shortage)
        }
      } else {
        // No BOM — direct pick for the product itself
        const pick = await createPickAndAllocate({
          jobId,
          productId: item.productId,
          sku: item.sku,
          description: item.description || item.productName,
          quantity: item.quantity,
          orderItemId: item.orderItemId,
          bomEntryId: null,
          parentProductId: null,
          staffId,
        })
        picksCreated.push(pick.pick)
        if (pick.allocation) allocationsCreated.push(pick.allocation)
        if (pick.shortage) shortages.push(pick.shortage)
      }
    }

    // ── 5. Mark job as pick list generated ─────────────────────────────
    const allAllocated = shortages.length === 0
    await prisma.$executeRawUnsafe(`
      UPDATE "Job"
      SET
        "pickListGenerated" = true,
        "allMaterialsAllocated" = $1,
        "updatedAt" = NOW()
      WHERE id = $2
    `, allAllocated, jobId)

    // ── 6. If all materials allocated, auto-advance to MATERIALS_LOCKED ─
    if (allAllocated && (job.status === 'CREATED' || job.status === 'READINESS_CHECK')) {
      await prisma.$executeRawUnsafe(`
        UPDATE "Job"
        SET
          status = 'MATERIALS_LOCKED'::"JobStatus",
          "materialsLocked" = true,
          "updatedAt" = NOW()
        WHERE id = $1
      `, jobId)
    }

    // ── 7. Notify PM if shortages ──────────────────────────────────────
    if (shortages.length > 0 && job.assignedPMId) {
      const shortageList = shortages.map(s => `${s.sku}: need ${s.needed}, have ${s.available}`).join('; ')
      await prisma.$executeRawUnsafe(`
        INSERT INTO "Notification" (id, "staffId", type, title, body, link, read, "createdAt")
        VALUES (
          gen_random_uuid()::text,
          $1,
          'JOB_UPDATE'::"NotificationType",
          $2,
          $3,
          $4,
          false,
          NOW()
        )
      `,
        job.assignedPMId || staffId,
        `Material Shortage — ${job.jobNumber}`,
        `${shortages.length} item(s) short: ${shortageList}`,
        `/ops/jobs/${jobId}`
      )
    }

    return NextResponse.json({
      success: true,
      jobNumber: job.jobNumber,
      picksCreated: picksCreated.length,
      allocationsCreated: allocationsCreated.length,
      shortages,
      allMaterialsAllocated: allAllocated,
      statusAdvanced: allAllocated && (job.status === 'CREATED' || job.status === 'READINESS_CHECK'),
      picks: picksCreated,
    })
  } catch (error: any) {
    console.error('[Generate Picks] Error:', error)
    return NextResponse.json(
      { error: 'Failed to generate pick list', details: error.message },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Create a MaterialPick + attempt InventoryAllocation
// ──────────────────────────────────────────────────────────────────────────
async function createPickAndAllocate(params: {
  jobId: string
  productId: string
  sku: string
  description: string
  quantity: number
  orderItemId: string
  bomEntryId: string | null
  parentProductId: string | null
  staffId: string
}) {
  const { jobId, productId, sku, description, quantity, orderItemId, bomEntryId, parentProductId, staffId } = params

  // Check inventory
  const inv: any[] = await prisma.$queryRawUnsafe(`
    SELECT "onHand", "committed", "available", "warehouseZone"
    FROM "InventoryItem"
    WHERE "productId" = $1
  `, productId)

  const inventory = inv[0] || { onHand: 0, committed: 0, available: 0, warehouseZone: null }
  const hasStock = inventory.available >= quantity

  // Create MaterialPick
  const pickStatus = hasStock ? 'PENDING' : 'SHORT'
  const picks: any[] = await prisma.$queryRawUnsafe(`
    INSERT INTO "MaterialPick"
    (id, "jobId", "productId", sku, description, quantity, "pickedQty", status, zone, "orderItemId", "bomEntryId", "parentProductId", "createdAt")
    VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, 0, $6::"PickStatus", $7, $8, $9, $10, NOW())
    RETURNING *
  `,
    jobId, productId, sku, description, quantity,
    pickStatus, inventory.warehouseZone || null,
    orderItemId, bomEntryId || null, parentProductId || null
  )

  const pick = picks[0]
  let allocation = null
  let shortage = null

  if (hasStock) {
    // Create allocation and decrement available
    const allocs: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO "InventoryAllocation"
      (id, "productId", "jobId", "orderItemId", quantity, "allocationType", status, "allocatedBy", "allocatedAt", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, 'HARD', 'RESERVED', $5, NOW(), NOW(), NOW())
      RETURNING *
    `, productId, jobId, orderItemId, quantity, staffId)

    allocation = allocs[0]

    // Update inventory: increment committed, recalculate available
    await prisma.$executeRawUnsafe(`
      UPDATE "InventoryItem"
      SET
        "committed" = "committed" + $1,
        "available" = "onHand" - ("committed" + $1),
        "updatedAt" = NOW()
      WHERE "productId" = $2
    `, quantity, productId)

    // Link allocation to pick
    if (allocation) {
      await prisma.$executeRawUnsafe(`
        UPDATE "MaterialPick" SET "allocationId" = $1 WHERE id = $2
      `, allocation.id, pick.id)
    }
  } else {
    shortage = {
      productId,
      sku,
      description,
      needed: quantity,
      available: inventory.available,
      shortfall: quantity - inventory.available,
    }
  }

  return { pick, allocation, shortage }
}
