export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/delivery/[deliveryId]/assign-driver
 *
 * Dispatch assigns a crew (driver) to a SCHEDULED delivery and optionally
 * locks in a scheduled run time. Status stays SCHEDULED — now "ready to
 * load" rather than "needs dispatch."
 *
 * Body: {
 *   crewId:        string    // required — Crew to run this stop
 *   scheduledFor?: string    // ISO datetime — pushed to the paired ScheduleEntry
 * }
 *
 * Rules:
 *  - Delivery must exist and be in SCHEDULED (pre-load) state.
 *  - If already has a crew, this reassigns — reusable.
 *  - routeOrder is computed as MAX(routeOrder) + 1 for the target crew when
 *    the delivery is newly assigned (no churn on reassigns to the same crew).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { deliveryId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const { crewId, scheduledFor } = body as {
      crewId?: string
      scheduledFor?: string
    }

    if (!crewId) {
      return NextResponse.json({ error: 'crewId is required' }, { status: 400 })
    }

    // Fetch the delivery and current state
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT d."id", d."deliveryNumber", d."jobId", d."crewId",
              d."status"::text AS "status", d."routeOrder"
       FROM "Delivery" d
       WHERE d."id" = $1`,
      params.deliveryId
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }
    const d = rows[0]

    // Only allow assign on SCHEDULED state (before load starts).
    if (d.status !== 'SCHEDULED') {
      return NextResponse.json(
        {
          error: `Cannot assign driver on delivery in status ${d.status}. Only SCHEDULED deliveries accept driver assignment.`,
        },
        { status: 409 }
      )
    }

    // Validate crew exists and is an active delivery crew.
    const crews: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "name", "crewType"::text AS "crewType", "active"
       FROM "Crew" WHERE "id" = $1`,
      crewId
    )
    if (crews.length === 0) {
      return NextResponse.json({ error: 'Crew not found' }, { status: 404 })
    }
    if (!crews[0].active) {
      return NextResponse.json({ error: 'Crew is not active' }, { status: 400 })
    }
    if (!['DELIVERY', 'DELIVERY_AND_INSTALL'].includes(crews[0].crewType)) {
      return NextResponse.json(
        { error: `Crew type ${crews[0].crewType} cannot run deliveries` },
        { status: 400 }
      )
    }

    // Compute a routeOrder — if already on this crew, keep; otherwise append.
    let nextRouteOrder = d.routeOrder
    if (d.crewId !== crewId) {
      const maxRow: any[] = await prisma.$queryRawUnsafe(
        `SELECT COALESCE(MAX("routeOrder"), 0)::int AS "maxOrder"
         FROM "Delivery"
         WHERE "crewId" = $1
           AND "status"::text NOT IN ('COMPLETE', 'REFUSED', 'RESCHEDULED')`,
        crewId
      )
      nextRouteOrder = (Number(maxRow[0]?.maxOrder) || 0) + 1
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "Delivery"
       SET "crewId" = $2,
           "routeOrder" = $3,
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      params.deliveryId, crewId, nextRouteOrder
    )

    // If scheduledFor provided, update the paired ScheduleEntry for the job.
    if (scheduledFor) {
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "ScheduleEntry"
           SET "scheduledDate" = $2::timestamptz,
               "updatedAt" = NOW()
           WHERE "jobId" = $1
             AND "entryType" = 'DELIVERY'
             AND "title" ILIKE $3`,
          d.jobId, scheduledFor, `%${d.deliveryNumber}%`
        )
      } catch {
        // ScheduleEntry may not exist yet — not fatal.
      }
    }

    await audit(request, 'UPDATE', 'Delivery', params.deliveryId, {
      action: 'ASSIGN_DRIVER',
      crewId,
      crewName: crews[0].name,
      routeOrder: nextRouteOrder,
      scheduledFor: scheduledFor || null,
    })

    return NextResponse.json({
      ok: true,
      deliveryId: params.deliveryId,
      deliveryNumber: d.deliveryNumber,
      status: 'SCHEDULED',
      crewId,
      crewName: crews[0].name,
      routeOrder: nextRouteOrder,
      scheduledFor: scheduledFor || null,
    })
  } catch (err: any) {
    console.error('[delivery assign-driver] error', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}
