export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'

// ═══════════════════════════════════════════════════════════════════════════
// /api/cron/cross-dock-scan
//
// Daily at 5 AM CT (10:00 UTC). Scans open POs with expectedDate in the next
// 7 days. For each line linked to a productId, checks if there are any
// BACKORDERED InventoryAllocations whose Job.scheduledDate ≤ NOW + 48h.
// If yes → flag the line (crossDockFlag=true + crossDockJobIds=[...]) and
// drop a HIGH-priority InboxItem on the warehouse lead for NEW flags only.
//
// Idempotent: re-running the same day updates existing flags without
// duplicating InboxItems (we only emit for lines that were previously
// unflagged OR that picked up a new urgent job).
// ═══════════════════════════════════════════════════════════════════════════

interface CrossDockLine {
  poItemId: string
  poId: string
  poNumber: string
  vendorName: string | null
  expectedDate: Date | null
  productId: string
  description: string
  vendorSku: string
  quantity: number
  previouslyFlagged: boolean
  previousJobIds: string[]
  matchingJobs: Array<{
    jobId: string
    jobNumber: string
    builderName: string | null
    scheduledDate: Date | null
    backorderedQty: number
  }>
}

interface CrossDockScanResult {
  asOf: string
  scannedPOs: number
  scannedLines: number
  flaggedLines: number
  newFlags: number
  clearedFlags: number
  inboxItemsCreated: number
  warehouseLeadId: string | null
  errors: string[]
}

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runCrossDockScan('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runCrossDockScan('manual')
}

async function runCrossDockScan(
  triggeredBy: 'schedule' | 'manual'
): Promise<NextResponse<CrossDockScanResult>> {
  const runId = await startCronRun('cross-dock-scan', triggeredBy)
  const started = Date.now()
  const result: CrossDockScanResult = {
    asOf: new Date().toISOString(),
    scannedPOs: 0,
    scannedLines: 0,
    flaggedLines: 0,
    newFlags: 0,
    clearedFlags: 0,
    inboxItemsCreated: 0,
    warehouseLeadId: null,
    errors: [],
  }

  try {
    // Ensure columns exist (idempotent — production migration already ran).
    await ensureSchema()

    // Resolve assignee: prefer Gunner (WAREHOUSE_LEAD) → any WAREHOUSE_LEAD → null.
    result.warehouseLeadId = await resolveWarehouseLead()

    // Pull candidate PO lines joined to urgent backordered allocations.
    const rows = await prisma.$queryRawUnsafe<
      Array<{
        poItemId: string
        poId: string
        poNumber: string
        vendorName: string | null
        expectedDate: Date | null
        productId: string
        description: string
        vendorSku: string
        quantity: number
        prevFlag: boolean | null
        prevJobIds: string[] | null
      }>
    >(
      `
      SELECT
        poi."id"             AS "poItemId",
        po."id"              AS "poId",
        po."poNumber"        AS "poNumber",
        v."name"             AS "vendorName",
        po."expectedDate"    AS "expectedDate",
        poi."productId"      AS "productId",
        poi."description"    AS "description",
        poi."vendorSku"      AS "vendorSku",
        poi."quantity"       AS "quantity",
        poi."crossDockFlag"  AS "prevFlag",
        poi."crossDockJobIds" AS "prevJobIds"
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      LEFT JOIN "Vendor" v ON v."id" = po."vendorId"
      WHERE po."status" IN ('SENT_TO_VENDOR','APPROVED','PARTIALLY_RECEIVED')
        AND po."expectedDate" IS NOT NULL
        AND po."expectedDate" <= NOW() + INTERVAL '7 days'
        AND poi."productId" IS NOT NULL
      `
    )

    result.scannedPOs = new Set(rows.map((r) => r.poId)).size
    result.scannedLines = rows.length

    if (rows.length === 0) {
      await clearStaleFlags(result)
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result })
      return NextResponse.json(result)
    }

    // Pull urgent backordered allocations by productId in one shot.
    const productIds = Array.from(new Set(rows.map((r) => r.productId)))
    const allocations = await prisma.$queryRawUnsafe<
      Array<{
        productId: string
        jobId: string
        jobNumber: string
        builderName: string | null
        scheduledDate: Date | null
        quantity: number
      }>
    >(
      `
      SELECT
        ia."productId",
        j."id"            AS "jobId",
        j."jobNumber",
        j."builderName",
        j."scheduledDate",
        ia."quantity"
      FROM "InventoryAllocation" ia
      JOIN "Job" j ON j."id" = ia."jobId"
      WHERE ia."status" = 'BACKORDERED'
        AND ia."productId" = ANY($1::text[])
        AND j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" <= NOW() + INTERVAL '48 hours'
      ORDER BY j."scheduledDate" ASC
      `,
      productIds
    )

    // Group allocations by productId.
    const byProduct = new Map<
      string,
      Array<{
        jobId: string
        jobNumber: string
        builderName: string | null
        scheduledDate: Date | null
        backorderedQty: number
      }>
    >()
    for (const a of allocations) {
      if (!byProduct.has(a.productId)) byProduct.set(a.productId, [])
      byProduct.get(a.productId)!.push({
        jobId: a.jobId,
        jobNumber: a.jobNumber,
        builderName: a.builderName,
        scheduledDate: a.scheduledDate,
        backorderedQty: a.quantity,
      })
    }

    // Build line-level decisions.
    const toFlag: CrossDockLine[] = []
    const toClear: string[] = []

    for (const r of rows) {
      const matches = byProduct.get(r.productId) || []
      if (matches.length === 0) {
        if (r.prevFlag) toClear.push(r.poItemId)
        continue
      }

      // Dedupe jobs (same job could have multiple alloc rows for one product).
      const seen = new Set<string>()
      const jobs = matches.filter((m) => {
        if (seen.has(m.jobId)) return false
        seen.add(m.jobId)
        return true
      })

      toFlag.push({
        poItemId: r.poItemId,
        poId: r.poId,
        poNumber: r.poNumber,
        vendorName: r.vendorName,
        expectedDate: r.expectedDate,
        productId: r.productId,
        description: r.description,
        vendorSku: r.vendorSku,
        quantity: r.quantity,
        previouslyFlagged: r.prevFlag === true,
        previousJobIds: Array.isArray(r.prevJobIds) ? r.prevJobIds : [],
        matchingJobs: jobs,
      })
    }

    result.flaggedLines = toFlag.length

    // Apply flags.
    for (const line of toFlag) {
      try {
        const jobIds = line.matchingJobs.map((j) => j.jobId)
        await prisma.$executeRawUnsafe(
          `
          UPDATE "PurchaseOrderItem"
          SET "crossDockFlag" = true,
              "crossDockJobIds" = $1::text[],
              "crossDockCheckedAt" = NOW()
          WHERE "id" = $2
          `,
          jobIds,
          line.poItemId
        )

        const isNewFlag = !line.previouslyFlagged
        const addedJobs = jobIds.filter((id) => !line.previousJobIds.includes(id))
        if (isNewFlag || addedJobs.length > 0) {
          result.newFlags++
          try {
            const created = await emitInboxItem(line, result.warehouseLeadId)
            if (created) result.inboxItemsCreated++
          } catch (err: any) {
            result.errors.push(
              `inbox ${line.poNumber}/${line.vendorSku}: ${err?.message || err}`
            )
          }
        }
      } catch (err: any) {
        result.errors.push(
          `flag ${line.poNumber}/${line.vendorSku}: ${err?.message || err}`
        )
      }
    }

    // Clear flags that no longer qualify.
    if (toClear.length > 0) {
      try {
        await prisma.$executeRawUnsafe(
          `
          UPDATE "PurchaseOrderItem"
          SET "crossDockFlag" = false,
              "crossDockJobIds" = NULL,
              "crossDockCheckedAt" = NOW()
          WHERE "id" = ANY($1::text[])
          `,
          toClear
        )
        result.clearedFlags = toClear.length
      } catch (err: any) {
        result.errors.push(`clear batch: ${err?.message || err}`)
      }
    }

    // Also clear any lines outside today's scan window (e.g. PO status flipped
    // to RECEIVED/CANCELLED, or expectedDate moved beyond 7d) so stale flags
    // don't linger. Scope: any POI flagged=true that we didn't touch above.
    await clearStaleFlags(result, new Set(toFlag.map((l) => l.poItemId).concat(toClear)))

    await finishCronRun(
      runId,
      result.errors.length > 0 ? 'FAILURE' : 'SUCCESS',
      Date.now() - started,
      { result, error: result.errors.length > 0 ? result.errors.join('; ') : undefined }
    )
    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[cross-dock-scan] fatal:', error)
    result.errors.push(`fatal: ${error?.message || error}`)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      result,
      error: error?.message || String(error),
    })
    return NextResponse.json(result, { status: 500 })
  }
}

// ─── helpers ───────────────────────────────────────────────────────────────

async function ensureSchema() {
  // Defence-in-depth: these already ran via migration script, but keep the
  // cron self-healing in case it's deployed to a fresh environment.
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "crossDockFlag" BOOLEAN DEFAULT false`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "crossDockJobIds" TEXT[]`
  )
  await prisma.$executeRawUnsafe(
    `ALTER TABLE "PurchaseOrderItem" ADD COLUMN IF NOT EXISTS "crossDockCheckedAt" TIMESTAMPTZ`
  )
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_poi_cross_dock_flag"
      ON "PurchaseOrderItem" ("crossDockFlag")
      WHERE "crossDockFlag" = true`
  )
}

async function resolveWarehouseLead(): Promise<string | null> {
  // Prefer Gunner (named in the spec) then any active WAREHOUSE_LEAD.
  const gunner = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Staff"
     WHERE "firstName" = 'Gunner'
       AND ("role" = 'WAREHOUSE_LEAD' OR "roles" ILIKE '%WAREHOUSE_LEAD%')
       AND "active" = true
     ORDER BY "createdAt" ASC
     LIMIT 1`
  )
  if (gunner.length > 0) return gunner[0].id

  const anyLead = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "Staff"
     WHERE ("role" = 'WAREHOUSE_LEAD' OR "roles" ILIKE '%WAREHOUSE_LEAD%')
       AND "active" = true
     ORDER BY "createdAt" ASC
     LIMIT 1`
  )
  return anyLead[0]?.id ?? null
}

async function emitInboxItem(
  line: CrossDockLine,
  assignedTo: string | null
): Promise<boolean> {
  // Idempotency: one PENDING CROSS_DOCK_ALERT per PO line. If one already
  // exists, skip (the flag update alone is enough to refresh the UI).
  const entityId = line.poItemId
  const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT "id" FROM "InboxItem"
      WHERE "type" = 'CROSS_DOCK_ALERT'
        AND "entityType" = 'PurchaseOrderItem'
        AND "entityId" = $1
        AND "status" = 'PENDING'
      LIMIT 1`,
    entityId
  )
  if (existing.length > 0) return false

  // Earliest urgent job drives the due-by.
  const earliest = [...line.matchingJobs].sort((a, b) => {
    const ta = a.scheduledDate ? new Date(a.scheduledDate).getTime() : Infinity
    const tb = b.scheduledDate ? new Date(b.scheduledDate).getTime() : Infinity
    return ta - tb
  })[0]

  const jobBlurb = earliest
    ? `${earliest.jobNumber}${earliest.builderName ? ` (${earliest.builderName})` : ''}`
    : 'an urgent job'
  const jobCount = line.matchingJobs.length
  const extra = jobCount > 1 ? ` + ${jobCount - 1} more` : ''

  const title = `CROSS-DOCK — ${line.vendorSku || line.description.slice(0, 40)} for ${jobBlurb}${extra}`
  const desc =
    `PO ${line.poNumber}${line.vendorName ? ` (${line.vendorName})` : ''} expected ` +
    `${line.expectedDate ? new Date(line.expectedDate).toISOString().slice(0, 10) : 'soon'}. ` +
    `DO NOT PUT AWAY — stage for immediate delivery. ` +
    `Urgent jobs: ${line.matchingJobs
      .map(
        (j) =>
          `${j.jobNumber}${j.scheduledDate ? ` @ ${new Date(j.scheduledDate).toISOString().slice(0, 10)}` : ''}`
      )
      .join(', ')}.`

  const id = `inb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
  await prisma.$executeRawUnsafe(
    `
    INSERT INTO "InboxItem" (
      "id", "type", "source", "title", "description", "priority", "status",
      "entityType", "entityId", "assignedTo", "actionData",
      "dueBy", "createdAt", "updatedAt"
    ) VALUES (
      $1, 'CROSS_DOCK_ALERT', 'cross-dock-scan', $2, $3, 'HIGH', 'PENDING',
      'PurchaseOrderItem', $4, $5, $6::jsonb,
      $7, NOW(), NOW()
    )
    `,
    id,
    title,
    desc,
    entityId,
    assignedTo,
    JSON.stringify({
      poId: line.poId,
      poNumber: line.poNumber,
      poItemId: line.poItemId,
      productId: line.productId,
      vendorSku: line.vendorSku,
      expectedDate: line.expectedDate,
      jobs: line.matchingJobs.map((j) => ({
        jobId: j.jobId,
        jobNumber: j.jobNumber,
        builderName: j.builderName,
        scheduledDate: j.scheduledDate,
        backorderedQty: j.backorderedQty,
      })),
    }),
    earliest?.scheduledDate ?? line.expectedDate ?? null
  )
  return true
}

async function clearStaleFlags(
  result: CrossDockScanResult,
  untouched?: Set<string>
) {
  // Any POI with crossDockFlag=true that wasn't touched this pass is stale —
  // its PO is no longer in an open, ≤7-day window OR its productId is null.
  const stale = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `
    SELECT poi."id"
    FROM "PurchaseOrderItem" poi
    LEFT JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"
    WHERE poi."crossDockFlag" = true
      AND (
        po."status" NOT IN ('SENT_TO_VENDOR','APPROVED','PARTIALLY_RECEIVED')
        OR po."expectedDate" IS NULL
        OR po."expectedDate" > NOW() + INTERVAL '7 days'
        OR poi."productId" IS NULL
      )
    `
  )
  const ids = stale
    .map((r) => r.id)
    .filter((id) => (untouched ? !untouched.has(id) : true))
  if (ids.length === 0) return
  await prisma.$executeRawUnsafe(
    `
    UPDATE "PurchaseOrderItem"
    SET "crossDockFlag" = false,
        "crossDockJobIds" = NULL,
        "crossDockCheckedAt" = NOW()
    WHERE "id" = ANY($1::text[])
    `,
    ids
  )
  result.clearedFlags += ids.length
}
