export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

/**
 * GET /api/ops/warehouse/daily-plan
 *
 * Single endpoint powering the 8 AM warehouse standup dashboard. Returns five
 * sections in one round-trip so the wall screen loads instantly:
 *
 *   1. todayDeliveries — trucks going out today, jobs + material + load status
 *   2. productionQueue — jobs needing manufacturing in next 1-2 days
 *   3. incomingPOs     — POs expected today + next 48h (with cross-dock flag)
 *   4. exceptions      — shortages, gold-stock low, active cycle counts, T-7 inbox
 *   5. teamQueue       — today's drivers + warehouse team
 *
 * Schema references "sibling wave" tables that may not exist yet:
 *   - GoldStockKit (not live)          → skipped defensively
 *   - CycleCountBatch (not live)       → skipped defensively
 *   - CrossDockFlag on PO lines (not live) → skipped defensively
 * Each block is wrapped in a try/catch so partial data still renders.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // ── 1) TODAY DELIVERIES ─────────────────────────────────────────────
    // Trucks going out today — read from Delivery scheduled for today joined
    // through Job + Crew. Load status is derived from delivery status.
    const deliveryRows: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        d.id                    AS "deliveryId",
        d."deliveryNumber"      AS "deliveryNumber",
        d.status::text          AS "deliveryStatus",
        d."departedAt"          AS "departedAt",
        d."routeOrder"          AS "routeOrder",
        j.id                    AS "jobId",
        j."jobNumber"           AS "jobNumber",
        j."builderName"         AS "builderName",
        j."jobAddress"          AS "jobAddress",
        j.community             AS "community",
        j."scheduledDate"       AS "scheduledDate",
        j.status::text          AS "jobStatus",
        j."loadConfirmed"       AS "loadConfirmed",
        c.id                    AS "crewId",
        c.name                  AS "crewName",
        c."vehiclePlate"        AS "vehiclePlate"
      FROM "Delivery" d
      LEFT JOIN "Job" j  ON j.id = d."jobId"
      LEFT JOIN "Crew" c ON c.id = d."crewId"
      WHERE
        (
          (j."scheduledDate" IS NOT NULL
            AND j."scheduledDate" >= (NOW() AT TIME ZONE 'America/Chicago')::date
            AND j."scheduledDate" < ((NOW() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day'))
          OR d.status IN ('SCHEDULED','LOADING','IN_TRANSIT')
        )
        AND d.status NOT IN ('COMPLETE','REFUSED','RESCHEDULED')
      ORDER BY c.name NULLS LAST, d."routeOrder" ASC, j."scheduledDate" ASC
    `)

    const deliveryJobIds = deliveryRows.map((r: any) => r.jobId).filter(Boolean)

    // Material status per job on today's trucks
    let matStatusByJob = new Map<string, { reserved: number; picked: number; short: number }>()
    if (deliveryJobIds.length > 0) {
      const matRows: any[] = await prisma.$queryRawUnsafe(
        `
        SELECT
          ia."jobId"   AS "jobId",
          ia.status    AS "status",
          COUNT(*)::int AS "count"
        FROM "InventoryAllocation" ia
        WHERE ia."jobId" = ANY($1::text[])
          AND ia.status IN ('RESERVED','PICKED','BACKORDERED','SHORT')
        GROUP BY ia."jobId", ia.status
        `,
        deliveryJobIds
      )
      for (const m of matRows) {
        const b = matStatusByJob.get(m.jobId) ?? { reserved: 0, picked: 0, short: 0 }
        if (m.status === 'RESERVED') b.reserved += Number(m.count)
        else if (m.status === 'PICKED') b.picked += Number(m.count)
        else if (m.status === 'BACKORDERED' || m.status === 'SHORT') b.short += Number(m.count)
        matStatusByJob.set(m.jobId, b)
      }
    }

    // Group deliveries by truck/crew so one card = one truck
    const trucksMap = new Map<string, any>()
    for (const r of deliveryRows) {
      const key = r.crewId || `__unassigned_${r.deliveryId}`
      const existing = trucksMap.get(key)
      const mat = matStatusByJob.get(r.jobId) || { reserved: 0, picked: 0, short: 0 }
      const jobCard = {
        jobId: r.jobId,
        jobNumber: r.jobNumber,
        builderName: r.builderName,
        jobAddress: r.jobAddress,
        community: r.community,
        jobStatus: r.jobStatus,
        loadConfirmed: !!r.loadConfirmed,
        deliveryNumber: r.deliveryNumber,
        deliveryStatus: r.deliveryStatus,
        materialStatus:
          mat.short > 0 ? 'SHORT' :
          mat.reserved === 0 && mat.picked > 0 ? 'READY' :
          mat.picked > 0 ? 'PARTIAL' : 'PENDING',
        materialCounts: mat,
      }

      // Derive load status from delivery statuses. Worst status wins
      // (PENDING < LOADING < LOADED < DEPARTED).
      const rank: Record<string, number> = { PENDING: 0, LOADING: 1, LOADED: 2, DEPARTED: 3 }
      const mapStatus = (ds: string): 'PENDING' | 'LOADING' | 'LOADED' | 'DEPARTED' => {
        if (ds === 'SCHEDULED') return 'PENDING'
        if (ds === 'LOADING') return 'LOADING'
        if (ds === 'IN_TRANSIT' || ds === 'ARRIVED' || ds === 'UNLOADING') return 'DEPARTED'
        if (ds === 'PARTIAL_DELIVERY' || ds === 'COMPLETE') return 'DEPARTED'
        return 'PENDING'
      }
      const thisStatus = mapStatus(r.deliveryStatus)

      if (!existing) {
        trucksMap.set(key, {
          truckId: r.crewId || null,
          truckName: r.crewName || 'Unassigned',
          vehiclePlate: r.vehiclePlate || null,
          scheduledDeparture: r.scheduledDate || null,
          loadStatus: thisStatus,
          jobs: [jobCard],
          departedAt: r.departedAt || null,
        })
      } else {
        existing.jobs.push(jobCard)
        if ((rank[thisStatus] ?? 0) < (rank[existing.loadStatus] ?? 0)) {
          existing.loadStatus = thisStatus
        }
        if (!existing.scheduledDeparture && r.scheduledDate) {
          existing.scheduledDeparture = r.scheduledDate
        }
      }
    }
    const todayDeliveries = Array.from(trucksMap.values())

    // ── 2) PRODUCTION QUEUE (tomorrow + day after) ──────────────────────
    const productionQueue: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j.id                 AS "jobId",
        j."jobNumber"        AS "jobNumber",
        j."builderName"      AS "builderName",
        j.community          AS "community",
        j."jobAddress"       AS "jobAddress",
        j."scheduledDate"    AS "scheduledDate",
        j.status::text       AS "status",
        j."pickListGenerated" AS "pickListGenerated",
        j."materialsLocked"  AS "materialsLocked",
        j."dropPlan"         AS "dropPlan",
        j."buildSheetNotes"  AS "buildSheetNotes",
        COALESCE(NULLIF(TRIM(pm."firstName" || ' ' || pm."lastName"),''), NULL) AS "pmName",
        (SELECT COUNT(*)::int FROM "MaterialPick" mp WHERE mp."jobId" = j.id) AS "pickCount"
      FROM "Job" j
      LEFT JOIN "Staff" pm ON pm.id = j."assignedPMId"
      WHERE j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" >= ((NOW() AT TIME ZONE 'America/Chicago')::date + INTERVAL '1 day')
        AND j."scheduledDate" <  ((NOW() AT TIME ZONE 'America/Chicago')::date + INTERVAL '3 days')
        AND j.status IN (
          'CREATED'::"JobStatus",
          'READINESS_CHECK'::"JobStatus",
          'MATERIALS_LOCKED'::"JobStatus",
          'IN_PRODUCTION'::"JobStatus"
        )
      ORDER BY j."scheduledDate" ASC, j."jobNumber" ASC
      LIMIT 40
    `)

    // ── 3) INCOMING POs (today + 48h) ───────────────────────────────────
    const incomingPOs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        po.id               AS "poId",
        po."poNumber"       AS "poNumber",
        po."expectedDate"   AS "expectedDate",
        po.status::text     AS "status",
        po.total            AS "total",
        v.id                AS "vendorId",
        v.name              AS "vendorName",
        (SELECT COUNT(*)::int FROM "PurchaseOrderItem" poi WHERE poi."purchaseOrderId" = po.id) AS "lineCount"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON v.id = po."vendorId"
      WHERE po."expectedDate" IS NOT NULL
        AND po."expectedDate" >= (NOW() AT TIME ZONE 'America/Chicago')::date
        AND po."expectedDate" <  ((NOW() AT TIME ZONE 'America/Chicago')::date + INTERVAL '2 days')
        AND po.status IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED')
      ORDER BY po."expectedDate" ASC, po."poNumber" ASC
      LIMIT 40
    `)

    // Cross-dock flags — sibling agent not landed yet. Guard with try/catch so
    // missing table doesn't blow up the whole dashboard.
    const crossDockByPO = new Map<string, number>()
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(`
        SELECT "purchaseOrderId" AS "poId", COUNT(*)::int AS "flagCount"
        FROM "CrossDockFlag"
        WHERE status IN ('FLAGGED','URGENT','PENDING')
        GROUP BY "purchaseOrderId"
      `)
      for (const r of rows) crossDockByPO.set(r.poId, Number(r.flagCount))
    } catch { /* table not live yet */ }

    const incomingPOsEnriched = incomingPOs.map((po: any) => ({
      ...po,
      crossDockFlags: crossDockByPO.get(po.poId) || 0,
    }))

    // ── 4) EXCEPTIONS ───────────────────────────────────────────────────
    // Jobs with unresolved shortages: InventoryAllocation where requested qty
    // exceeds inventory onHand. We surface the job card, not each SKU line.
    const shortageJobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT
        j.id              AS "jobId",
        j."jobNumber"     AS "jobNumber",
        j."builderName"   AS "builderName",
        j."scheduledDate" AS "scheduledDate",
        j.status::text    AS "status",
        COUNT(ia.id)::int AS "shortCount"
      FROM "Job" j
      INNER JOIN "InventoryAllocation" ia ON ia."jobId" = j.id
      LEFT JOIN "InventoryItem" ii ON ii."productId" = ia."productId"
      WHERE ia.status = 'RESERVED'
        AND COALESCE(ii."onHand", 0) < ia.quantity
        AND j."scheduledDate" IS NOT NULL
        AND j."scheduledDate" < ((NOW() AT TIME ZONE 'America/Chicago')::date + INTERVAL '7 days')
      GROUP BY j.id, j."jobNumber", j."builderName", j."scheduledDate", j.status
      ORDER BY j."scheduledDate" ASC
      LIMIT 20
    `)

    // Gold Stock low-stock (sibling agent, guarded)
    let goldStockLow: any[] = []
    try {
      goldStockLow = await prisma.$queryRawUnsafe(`
        SELECT id, name, "minQty", "currentQty"
        FROM "GoldStockKit"
        WHERE "currentQty" < "minQty"
        ORDER BY name ASC
        LIMIT 20
      `)
    } catch { /* table not live yet */ }

    // Active cycle count batches (sibling agent, guarded)
    let cycleCounts: any[] = []
    try {
      cycleCounts = await prisma.$queryRawUnsafe(`
        SELECT id, "batchNumber", status, "startedAt",
          (SELECT COUNT(*)::int FROM "CycleCountLine" ccl WHERE ccl."batchId" = ccb.id) AS "lineCount",
          (SELECT COUNT(*)::int FROM "CycleCountLine" ccl WHERE ccl."batchId" = ccb.id AND ccl."countedAt" IS NOT NULL) AS "countedCount"
        FROM "CycleCountBatch" ccb
        WHERE status IN ('OPEN','IN_PROGRESS','ACTIVE')
        ORDER BY "startedAt" DESC
        LIMIT 10
      `)
    } catch { /* table not live yet */ }

    // T-7 Material-Confirm-Required InboxItems
    const materialConfirmItems: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, title, description, priority, "dueBy", "entityId", "createdAt"
      FROM "InboxItem"
      WHERE type IN ('MATERIAL_ARRIVAL','MRP_RECOMMENDATION')
        AND status IN ('PENDING','SNOOZED')
        AND (priority = 'CRITICAL' OR priority = 'HIGH')
        AND "createdAt" >= (NOW() - INTERVAL '7 days')
      ORDER BY
        CASE priority WHEN 'CRITICAL' THEN 0 WHEN 'HIGH' THEN 1 ELSE 2 END,
        "dueBy" ASC NULLS LAST
      LIMIT 15
    `)

    // ── 5) TEAM QUEUE ───────────────────────────────────────────────────
    // Drivers + today's route summary
    const driversToday: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        s.id,
        s."firstName" AS "firstName",
        s."lastName"  AS "lastName",
        s.role::text  AS "role",
        c.id          AS "crewId",
        c.name        AS "crewName",
        c."vehiclePlate" AS "vehiclePlate",
        (
          SELECT COUNT(*)::int FROM "Delivery" d2
          WHERE d2."crewId" = c.id
            AND d2.status NOT IN ('COMPLETE','REFUSED','RESCHEDULED')
        ) AS "stopsToday"
      FROM "Staff" s
      LEFT JOIN "CrewMember" cm ON cm."staffId" = s.id
      LEFT JOIN "Crew" c        ON c.id = cm."crewId" AND c.active = true
      WHERE s.active = true
        AND (
          s.role = 'DRIVER'::"StaffRole"
          OR s.roles LIKE '%DRIVER%'
        )
      ORDER BY s."firstName", s."lastName"
    `)

    const warehouseTeam: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        s.id,
        s."firstName" AS "firstName",
        s."lastName"  AS "lastName",
        s.role::text  AS "role",
        s.title       AS "title"
      FROM "Staff" s
      WHERE s.active = true
        AND (
          s.role IN (
            'WAREHOUSE_LEAD'::"StaffRole",
            'WAREHOUSE_TECH'::"StaffRole",
            'INSTALLER'::"StaffRole"
          )
          OR s.roles LIKE '%WAREHOUSE_LEAD%'
          OR s.roles LIKE '%WAREHOUSE_TECH%'
          OR s.roles LIKE '%INSTALLER%'
        )
      ORDER BY
        CASE s.role
          WHEN 'WAREHOUSE_LEAD' THEN 0
          WHEN 'WAREHOUSE_TECH' THEN 1
          WHEN 'INSTALLER'      THEN 2
          ELSE 9
        END,
        s."firstName"
      LIMIT 40
    `)

    // ── SUMMARY ─────────────────────────────────────────────────────────
    const summary = {
      trucksOut: todayDeliveries.length,
      productionJobs: productionQueue.length,
      incomingPOs: incomingPOsEnriched.length,
      exceptionCount:
        shortageJobs.length + goldStockLow.length + cycleCounts.length + materialConfirmItems.length,
      teamOnShift: driversToday.length + warehouseTeam.length,
    }

    return safeJson({
      generatedAt: new Date().toISOString(),
      summary,
      sections: {
        todayDeliveries,
        productionQueue,
        incomingPOs: incomingPOsEnriched,
        exceptions: {
          shortageJobs,
          goldStockLow,
          cycleCounts,
          materialConfirmItems,
        },
        teamQueue: {
          drivers: driversToday,
          warehouseTeam,
        },
      },
    })
  } catch (error: any) {
    console.error('[daily-plan] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch daily plan', detail: error?.message || String(error) },
      { status: 500 }
    )
  }
}
