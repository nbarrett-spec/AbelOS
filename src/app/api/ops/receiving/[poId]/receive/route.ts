export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { sendMaterialArrivedEmail } from '@/lib/email/material-arrived'

// ───────────────────────────────────────────────────────────────────────────
// POST /api/ops/receiving/[poId]/receive
//
// Receive-against-PO workflow. For each line:
//   1. Increment InventoryItem.onHand by receivedQty (minus DAMAGED/SHORT).
//   2. Walk all BACKORDERED InventoryAllocation rows for that productId in
//      Job.scheduledDate order and flip them RESERVED in priority until the
//      receivedQty is exhausted. Surplus goes to available stock (no commit).
//   3. Recompute InventoryItem.committed / .available for touched products.
//   4. Detect jobs whose LAST backorder was just cleared — email their PM
//      that they're now GREEN.
//   5. Update PurchaseOrder.status → PARTIALLY_RECEIVED or RECEIVED based on
//      cumulative received vs. ordered.
//
// Body: { lines: [{ productId, receivedQty, condition: 'OK'|'DAMAGED'|'SHORT' }] }
// (productId maps to PurchaseOrderItem.productId; lines that don't map fall
//  through without inventory/allocation impact but still update receivedQty
//  on the PO line so the PO status moves forward.)
// ───────────────────────────────────────────────────────────────────────────

interface ReceiveLine {
  productId: string | null
  // allow caller to pass the PO line id directly when productId is null
  purchaseOrderItemId?: string
  receivedQty: number
  condition?: 'OK' | 'DAMAGED' | 'SHORT'
}

interface ClearedItem {
  productId: string
  sku: string | null
  description: string
  quantity: number
}

export async function POST(
  request: NextRequest,
  { params }: { params: { poId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { poId } = params
    if (!poId) {
      return NextResponse.json({ error: 'poId is required' }, { status: 400 })
    }

    const body = (await request.json().catch(() => ({}))) as { lines?: ReceiveLine[] }
    const lines = Array.isArray(body.lines) ? body.lines : []

    if (lines.length === 0) {
      return NextResponse.json({ error: 'lines[] is required' }, { status: 400 })
    }

    // ── Load the PO and its items up front ────────────────────────────────
    const poRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT po."id", po."poNumber", po."vendorId", po."status"::text AS status,
              v."name" AS "vendorName"
         FROM "PurchaseOrder" po
         LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
         WHERE po."id" = $1
         LIMIT 1`,
      poId,
    )
    if (poRows.length === 0) {
      return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
    }
    const po = poRows[0]
    const vendorName: string = po.vendorName || 'vendor'

    const poItems: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "productId", "vendorSku", "description",
              "quantity", "receivedQty", "damagedQty"
         FROM "PurchaseOrderItem"
         WHERE "purchaseOrderId" = $1`,
      poId,
    )

    // Index PO items by productId AND by id for lookups
    const poItemByProduct = new Map<string, any>()
    const poItemById = new Map<string, any>()
    for (const it of poItems) {
      if (it.productId) poItemByProduct.set(it.productId, it)
      poItemById.set(it.id, it)
    }

    const received: Array<{ productId: string | null; receivedQty: number; condition: string }> = []
    const backordersCleared: Array<{
      jobId: string
      jobNumber: string
      productId: string
      quantity: number
      allocationId: string
    }> = []
    const stillShort: Array<{ productId: string; shortBy: number }> = []

    // Track productIds touched → we'll recompute committed/available once.
    const touchedProducts = new Set<string>()

    // Track jobs that had at least one backorder cleared in this receive.
    // We'll check afterwards whether each still has any BACKORDERED rows
    // left — if not, the PM gets the "GREEN" email.
    const jobsWithCleared = new Map<string, Set<string>>() // jobId → productIds cleared

    // ── Process each line ────────────────────────────────────────────────
    for (const raw of lines) {
      const receivedQty = Math.max(0, Math.floor(Number(raw.receivedQty) || 0))
      const condition = (raw.condition as ReceiveLine['condition']) || 'OK'
      if (receivedQty <= 0) continue

      // Resolve PO item: prefer explicit id, else productId match
      let poItem = raw.purchaseOrderItemId ? poItemById.get(raw.purchaseOrderItemId) : null
      if (!poItem && raw.productId) poItem = poItemByProduct.get(raw.productId)
      if (!poItem) {
        // Not a line on this PO — record but skip
        received.push({
          productId: raw.productId ?? null,
          receivedQty,
          condition,
        })
        continue
      }

      const productId: string | null = poItem.productId || raw.productId || null

      // Bump receivedQty / damagedQty on the PO line. SHORT lines count as
      // received-but-physically-missing (the vendor shorted us) — we do NOT
      // add them to onHand or clear backorders.
      const damagedQty = condition === 'DAMAGED' ? receivedQty : 0
      await prisma.$executeRawUnsafe(
        `UPDATE "PurchaseOrderItem"
           SET "receivedQty" = "receivedQty" + $1,
               "damagedQty"  = "damagedQty"  + $2,
               "updatedAt"   = NOW()
         WHERE "id" = $3`,
        receivedQty,
        damagedQty,
        poItem.id,
      )

      received.push({ productId, receivedQty, condition })

      // Only usable qty feeds inventory + backorder release.
      const usableQty =
        condition === 'SHORT' ? 0 : condition === 'DAMAGED' ? 0 : receivedQty

      if (!productId || usableQty <= 0) continue

      // ── Bump onHand + decrement onOrder, create InventoryItem if missing ──
      const invExists: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "onHand", "onOrder" FROM "InventoryItem"
         WHERE "productId" = $1 LIMIT 1`,
        productId,
      )

      if (invExists.length > 0) {
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem"
             SET "onHand"         = "onHand" + $1,
                 "onOrder"        = GREATEST(0, COALESCE("onOrder",0) - $1),
                 "lastReceivedAt" = NOW(),
                 "updatedAt"      = NOW()
           WHERE "productId" = $2`,
          usableQty,
          productId,
        )
      } else {
        // Create a skeleton row so the recompute afterwards has something to
        // update. Use a cuid-style id via gen_random_uuid()::text to match
        // peers.
        await prisma.$executeRawUnsafe(
          `INSERT INTO "InventoryItem"
             ("id", "productId", "onHand", "committed", "onOrder", "available",
              "lastReceivedAt", "updatedAt")
           VALUES (gen_random_uuid()::text, $1, $2, 0, 0, $2, NOW(), NOW())`,
          productId,
          usableQty,
        )
      }
      touchedProducts.add(productId)

      // ── Walk BACKORDERED allocations in Job.scheduledDate ASC order ──
      // Oldest/soonest-due jobs get the material first.
      const backorders: any[] = await prisma.$queryRawUnsafe(
        `SELECT ia."id", ia."jobId", ia."quantity",
                j."jobNumber", j."scheduledDate"
           FROM "InventoryAllocation" ia
           LEFT JOIN "Job" j ON j."id" = ia."jobId"
          WHERE ia."productId" = $1
            AND ia."status" = 'BACKORDERED'
          ORDER BY j."scheduledDate" ASC NULLS LAST,
                   ia."allocatedAt" ASC NULLS LAST`,
        productId,
      )

      let remainder = usableQty
      for (const bo of backorders) {
        if (remainder <= 0) break

        const need = Number(bo.quantity) || 0
        if (need <= 0) continue

        if (remainder >= need) {
          // Flip the whole row RESERVED
          await prisma.$executeRawUnsafe(
            `UPDATE "InventoryAllocation"
               SET "status" = 'RESERVED',
                   "allocatedAt" = COALESCE("allocatedAt", NOW()),
                   "notes" = COALESCE("notes", '') || ' | released from BACKORDERED on PO ' || $2,
                   "updatedAt" = NOW()
             WHERE "id" = $1`,
            bo.id,
            po.poNumber,
          )
          remainder -= need
          backordersCleared.push({
            jobId: bo.jobId,
            jobNumber: bo.jobNumber || '',
            productId,
            quantity: need,
            allocationId: bo.id,
          })
          if (bo.jobId) {
            if (!jobsWithCleared.has(bo.jobId))
              jobsWithCleared.set(bo.jobId, new Set())
            jobsWithCleared.get(bo.jobId)!.add(productId)
          }
        } else {
          // Partial: split the row. Shrink the existing BACKORDERED row to
          // the shortfall and create a sibling RESERVED row for the portion
          // we just covered.
          const partialQty = remainder
          const stillOwed = need - remainder
          await prisma.$executeRawUnsafe(
            `UPDATE "InventoryAllocation"
               SET "quantity" = $1,
                   "notes" = COALESCE("notes", '') || ' | partial release on PO ' || $3 || ' — still short ' || $1,
                   "updatedAt" = NOW()
             WHERE "id" = $2`,
            stillOwed,
            bo.id,
            po.poNumber,
          )
          // Insert companion RESERVED row for the partial release.
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InventoryAllocation"
               ("id", "productId", "orderId", "jobId", "quantity",
                "allocationType", "status", "allocatedBy",
                "notes", "allocatedAt", "createdAt", "updatedAt")
             SELECT gen_random_uuid()::text, ia."productId", ia."orderId", ia."jobId",
                    $2, ia."allocationType", 'RESERVED', 'receiving',
                    'partial release on PO ' || $3, NOW(), NOW(), NOW()
               FROM "InventoryAllocation" ia
              WHERE ia."id" = $1`,
            bo.id,
            partialQty,
            po.poNumber,
          )
          remainder = 0
          backordersCleared.push({
            jobId: bo.jobId,
            jobNumber: bo.jobNumber || '',
            productId,
            quantity: partialQty,
            allocationId: bo.id,
          })
          if (bo.jobId) {
            if (!jobsWithCleared.has(bo.jobId))
              jobsWithCleared.set(bo.jobId, new Set())
            jobsWithCleared.get(bo.jobId)!.add(productId)
          }
        }
      }

      // If any backorders still open after this receipt, surface them.
      const leftover: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(SUM("quantity"), 0)::int AS "short"
           FROM "InventoryAllocation"
          WHERE "productId" = $1 AND "status" = 'BACKORDERED'`,
        productId,
      )
      const short = Number(leftover[0]?.short || 0)
      if (short > 0) {
        stillShort.push({ productId, shortBy: short })
      }
    }

    // ── Recompute committed/available for every touched product ───────────
    for (const pid of touchedProducts) {
      try {
        await prisma.$executeRawUnsafe(
          `SELECT recompute_inventory_committed($1)`,
          pid,
        )
      } catch {
        await prisma.$executeRawUnsafe(
          `UPDATE "InventoryItem" ii
             SET "committed" = COALESCE((
                   SELECT SUM(ia."quantity")
                   FROM "InventoryAllocation" ia
                   WHERE ia."productId" = ii."productId"
                     AND ia."status" IN ('RESERVED', 'PICKED')
                 ), 0),
                 "available" = GREATEST(COALESCE(ii."onHand", 0) - COALESCE((
                   SELECT SUM(ia."quantity")
                   FROM "InventoryAllocation" ia
                   WHERE ia."productId" = ii."productId"
                     AND ia."status" IN ('RESERVED', 'PICKED')
                 ), 0), 0),
                 "updatedAt" = NOW()
           WHERE ii."productId" = $1`,
          pid,
        )
      }
    }

    // ── PO status update: RECEIVED if every line is filled, else PARTIAL ──
    const summary: any[] = await prisma.$queryRawUnsafe(
      `SELECT COALESCE(SUM("quantity"), 0)::int   AS "ordered",
              COALESCE(SUM("receivedQty"), 0)::int AS "received"
         FROM "PurchaseOrderItem"
        WHERE "purchaseOrderId" = $1`,
      poId,
    )
    const ordered = Number(summary[0]?.ordered || 0)
    const receivedTotal = Number(summary[0]?.received || 0)
    const fullyReceived = ordered > 0 && receivedTotal >= ordered
    const nextStatus = fullyReceived ? 'RECEIVED' : 'PARTIALLY_RECEIVED'

    if (fullyReceived) {
      await prisma.$executeRawUnsafe(
        `UPDATE "PurchaseOrder"
           SET "status" = 'RECEIVED'::"POStatus",
               "receivedAt" = NOW(),
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        poId,
      )
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "PurchaseOrder"
           SET "status" = 'PARTIALLY_RECEIVED'::"POStatus",
               "updatedAt" = NOW()
         WHERE "id" = $1`,
        poId,
      )
    }

    // ── Figure out which jobs just went from RED to GREEN ────────────────
    // A job flipped to GREEN if (a) it had allocations cleared in this call
    // and (b) it has zero BACKORDERED allocations remaining.
    const greenedJobIds: string[] = []
    for (const jobId of jobsWithCleared.keys()) {
      const r: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c
           FROM "InventoryAllocation"
          WHERE "jobId" = $1 AND "status" = 'BACKORDERED'`,
        jobId,
      )
      if (Number(r[0]?.c || 0) === 0) greenedJobIds.push(jobId)
    }

    // Flip Job.allMaterialsAllocated = true on greened jobs.
    if (greenedJobIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
           SET "allMaterialsAllocated" = true,
               "updatedAt" = NOW()
         WHERE "id" = ANY($1::text[])`,
        greenedJobIds,
      )
    }

    // ── Email PMs on greened jobs ─────────────────────────────────────────
    const emailedPMs: Array<{ jobId: string; jobNumber: string; to: string }> = []
    if (greenedJobIds.length > 0) {
      const jobs: any[] = await prisma.$queryRawUnsafe(
        `SELECT j."id", j."jobNumber", j."builderName", j."jobAddress",
                j."community", j."scheduledDate",
                s."email" AS "pmEmail", s."firstName" AS "pmFirstName"
           FROM "Job" j
           LEFT JOIN "Staff" s ON s."id" = j."assignedPMId"
          WHERE j."id" = ANY($1::text[])`,
        greenedJobIds,
      )

      for (const j of jobs) {
        if (!j.pmEmail) continue

        const productIdsForJob = jobsWithCleared.get(j.id) || new Set<string>()
        const clearedItems: ClearedItem[] = backordersCleared
          .filter((c) => c.jobId === j.id && productIdsForJob.has(c.productId))
          .map((c) => {
            const poLine = poItemByProduct.get(c.productId)
            return {
              productId: c.productId,
              sku: poLine?.vendorSku ?? null,
              description: poLine?.description ?? c.productId,
              quantity: c.quantity,
            }
          })

        try {
          await sendMaterialArrivedEmail({
            to: j.pmEmail,
            pmFirstName: j.pmFirstName || 'there',
            jobId: j.id,
            jobNumber: j.jobNumber,
            builderName: j.builderName || 'builder',
            jobAddress: j.jobAddress ?? null,
            community: j.community ?? null,
            scheduledDate: j.scheduledDate ? new Date(j.scheduledDate) : null,
            poNumber: po.poNumber,
            vendorName,
            clearedItems,
          })
          emailedPMs.push({ jobId: j.id, jobNumber: j.jobNumber, to: j.pmEmail })
        } catch (e) {
          // Don't fail the receipt if email blows up — log and continue.
          // eslint-disable-next-line no-console
          console.warn(
            '[receiving] material-arrived email failed for job',
            j.jobNumber,
            e,
          )
        }

        // Drop a Notification row too so the PM sees it in-app even if email
        // is mis-configured.
        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Notification"
               ("id", "staffId", "type", "title", "body", "link", "read", "createdAt")
             SELECT gen_random_uuid()::text, j."assignedPMId",
                    'JOB_UPDATE'::"NotificationType",
                    'Materials arrived — ' || j."jobNumber",
                    'PO ' || $2 || ' was received and cleared all backorders. Job ' || j."jobNumber" || ' is now GREEN.',
                    '/ops/jobs/' || j."id",
                    false, NOW()
               FROM "Job" j
              WHERE j."id" = $1 AND j."assignedPMId" IS NOT NULL`,
            j.id,
            po.poNumber,
          )
        } catch {}
      }
    }

    // ── Audit log ─────────────────────────────────────────────────────────
    audit(
      request,
      'RECEIVE',
      'PurchaseOrder',
      poId,
      {
        poNumber: po.poNumber,
        linesReceived: received.length,
        backordersCleared: backordersCleared.length,
        greenedJobs: greenedJobIds,
        fullyReceived,
      },
    ).catch(() => {})

    return NextResponse.json({
      success: true,
      poId,
      poNumber: po.poNumber,
      poStatus: nextStatus,
      fullyReceived,
      received,
      backordersCleared,
      stillShort,
      greenedJobs: greenedJobIds,
      emailedPMs,
    })
  } catch (error: any) {
    console.error('[POST /api/ops/receiving/[poId]/receive] Error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to process receipt' },
      { status: 500 },
    )
  }
}
