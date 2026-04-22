export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// Unified Dispatch API
//
// GET  — Dispatch board: fleet capacity, pending deliveries, Curri recommendation
// POST — Assign a delivery: either internal crew or auto-book Curri
//
// Logic:
//   1. Check fleet capacity for target date
//   2. If internal crews available → assign crew + route order
//   3. If fleet at capacity → auto-quote Curri, present cost comparison
//   4. One-click Curri booking from dispatch board
// ──────────────────────────────────────────────────────────────────────────

const CURRI_API_URL = process.env.CURRI_API_URL || 'https://api.curri.com/v1'
const CURRI_API_KEY = process.env.CURRI_API_KEY
const MAX_DELIVERIES_PER_CREW = 8 // Max stops per crew per day

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

    // 1. Fleet capacity for the date
    const crewCapacity: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        c."id" AS "crewId", c."name" AS "crewName", c."vehiclePlate",
        c."crewType", c."active",
        COUNT(d."id")::int AS "assignedDeliveries",
        ${MAX_DELIVERIES_PER_CREW} - COUNT(d."id")::int AS "remainingCapacity",
        ARRAY_AGG(DISTINCT d."id") FILTER (WHERE d."id" IS NOT NULL) AS "deliveryIds"
      FROM "Crew" c
      LEFT JOIN "Delivery" d ON c."id" = d."crewId"
        AND d."status"::text NOT IN ('COMPLETE', 'REFUSED', 'RESCHEDULED')
        AND COALESCE(
          (SELECT se."scheduledDate" FROM "ScheduleEntry" se WHERE se."jobId" = d."jobId" AND se."entryType" = 'DELIVERY' LIMIT 1),
          d."createdAt"
        )::date = $1::date
      WHERE c."active" = true AND c."crewType" IN ('DELIVERY', 'DELIVERY_AND_INSTALL')
      GROUP BY c."id", c."name", c."vehiclePlate", c."crewType", c."active"
      ORDER BY "remainingCapacity" DESC
    `, date)

    const totalCapacity = crewCapacity.reduce((sum, c) => sum + Math.max(0, c.remainingCapacity), 0)
    const totalAssigned = crewCapacity.reduce((sum, c) => sum + c.assignedDeliveries, 0)

    // 2. Unassigned deliveries for the date
    const unassigned: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
             j."jobNumber", j."builderName", j."community", j."jobAddress",
             COALESCE(d."crewId", '') AS "crewId"
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j."id"
      WHERE d."crewId" IS NULL
        AND d."status"::text NOT IN ('COMPLETE', 'REFUSED', 'RESCHEDULED')
        AND COALESCE(j."scheduledDate", d."createdAt")::date = $1::date
      ORDER BY d."routeOrder" ASC NULLS LAST, d."createdAt" ASC
    `, date)

    // 3. Curri deliveries for the date
    let curriDeliveries: any[] = []
    try {
      curriDeliveries = await prisma.$queryRawUnsafe(`
        SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
               d."curriBookingId", d."curriTrackingUrl", d."curriCost",
               j."jobNumber", j."builderName"
        FROM "Delivery" d
        JOIN "Job" j ON d."jobId" = j."id"
        WHERE d."provider" = 'CURRI'
          AND COALESCE(j."scheduledDate", d."createdAt")::date = $1::date
        ORDER BY d."curriBookedAt" DESC NULLS LAST
      `, date)
    } catch {
      // provider column may not exist yet
    }

    // 4. Recommendation
    const recommendation = buildDispatchRecommendation(
      crewCapacity, unassigned, totalCapacity, curriDeliveries
    )

    return safeJson({
      date,
      fleet: {
        crews: crewCapacity,
        totalCapacity,
        totalAssigned,
        maxPerCrew: MAX_DELIVERIES_PER_CREW,
        atCapacity: totalCapacity <= 0,
      },
      unassigned: {
        deliveries: unassigned,
        count: unassigned.length,
      },
      curri: {
        deliveries: curriDeliveries,
        count: curriDeliveries.length,
        configured: !!CURRI_API_KEY,
      },
      recommendation,
    })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

/**
 * POST /api/ops/delivery/dispatch
 * Assign a delivery to a crew or book via Curri
 *
 * Body: {
 *   deliveryId: string,
 *   action: 'ASSIGN_CREW' | 'BOOK_CURRI' | 'AUTO',
 *   crewId?: string,          // Required for ASSIGN_CREW
 *   vehicleType?: string,     // For Curri bookings
 *   scheduledAt?: string,     // ISO date for Curri scheduling
 *   contactName?: string,
 *   contactPhone?: string,
 * }
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { deliveryId, action, crewId, vehicleType, scheduledAt, contactName, contactPhone } = body

    if (!deliveryId || !action) {
      return NextResponse.json({ error: 'deliveryId and action required' }, { status: 400 })
    }

    // Get delivery details
    const deliveries: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status", d."crewId",
             j."jobNumber", j."builderName", j."jobAddress",
             j."scheduledDate"
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j."id"
      WHERE d."id" = $1
    `, deliveryId)

    if (deliveries.length === 0) {
      return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
    }

    const delivery = deliveries[0]

    if (action === 'ASSIGN_CREW') {
      if (!crewId) {
        return NextResponse.json({ error: 'crewId required for ASSIGN_CREW' }, { status: 400 })
      }

      // Get next route order for this crew on this date
      const routeOrders: any[] = await prisma.$queryRawUnsafe(`
        SELECT MAX(d."routeOrder")::int AS "maxOrder"
        FROM "Delivery" d
        WHERE d."crewId" = $1
          AND d."status"::text NOT IN ('COMPLETE', 'REFUSED', 'RESCHEDULED')
      `, crewId)
      const nextOrder = (routeOrders[0]?.maxOrder || 0) + 1

      await prisma.$executeRawUnsafe(`
        UPDATE "Delivery"
        SET "crewId" = $2, "routeOrder" = $3, "updatedAt" = NOW()
        WHERE "id" = $1
      `, deliveryId, crewId, nextOrder)

      await audit(request, 'UPDATE', 'Delivery', deliveryId, {
        action: 'DISPATCH_ASSIGN_CREW', crewId, routeOrder: nextOrder,
      })

      return safeJson({
        success: true,
        action: 'ASSIGN_CREW',
        deliveryId,
        crewId,
        routeOrder: nextOrder,
      })
    }

    if (action === 'BOOK_CURRI' || action === 'AUTO') {
      // For AUTO: check fleet capacity first
      if (action === 'AUTO') {
        const capacity: any[] = await prisma.$queryRawUnsafe(`
          SELECT c."id", c."name",
            ${MAX_DELIVERIES_PER_CREW} - COUNT(d."id")::int AS "remaining"
          FROM "Crew" c
          LEFT JOIN "Delivery" d ON c."id" = d."crewId"
            AND d."status"::text NOT IN ('COMPLETE', 'REFUSED', 'RESCHEDULED')
          WHERE c."active" = true AND c."crewType" IN ('DELIVERY', 'DELIVERY_AND_INSTALL')
          GROUP BY c."id", c."name"
          HAVING ${MAX_DELIVERIES_PER_CREW} - COUNT(d."id")::int > 0
          ORDER BY "remaining" DESC
          LIMIT 1
        `)

        if (capacity.length > 0) {
          // Fleet has capacity — assign to best crew
          const bestCrew = capacity[0]
          const routeOrders: any[] = await prisma.$queryRawUnsafe(`
            SELECT MAX(d."routeOrder")::int AS "maxOrder"
            FROM "Delivery" d WHERE d."crewId" = $1
          `, bestCrew.id)
          const nextOrder = (routeOrders[0]?.maxOrder || 0) + 1

          await prisma.$executeRawUnsafe(`
            UPDATE "Delivery"
            SET "crewId" = $2, "routeOrder" = $3, "updatedAt" = NOW()
            WHERE "id" = $1
          `, deliveryId, bestCrew.id, nextOrder)

          await audit(request, 'UPDATE', 'Delivery', deliveryId, {
            action: 'AUTO_DISPATCH_CREW', crewId: bestCrew.id, crewName: bestCrew.name,
          })

          return safeJson({
            success: true,
            action: 'AUTO_ASSIGN_CREW',
            deliveryId,
            crewId: bestCrew.id,
            crewName: bestCrew.name,
            routeOrder: nextOrder,
            message: `Auto-assigned to ${bestCrew.name} (${bestCrew.remaining - 1} slots remaining)`,
          })
        }
        // No capacity — fall through to Curri
      }

      // Book Curri
      const pickupAddress = '1401 E Division St, Arlington, TX 76011' // Abel Lumber HQ
      let curriBookingId: string | null = null
      let curriTrackingUrl: string | null = null
      let curriCost: number | null = null

      if (CURRI_API_KEY) {
        try {
          const curriRes = await fetch(`${CURRI_API_URL}/deliveries`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${CURRI_API_KEY}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              pickup: {
                address: pickupAddress,
                contact: { name: 'Abel Lumber Warehouse', phone: '(817) 261-4141' },
              },
              dropoff: {
                address: delivery.address || delivery.jobAddress,
                contact: contactName && contactPhone
                  ? { name: contactName, phone: contactPhone }
                  : undefined,
              },
              vehicle_type: vehicleType || 'flatbed',
              scheduled_at: scheduledAt || delivery.scheduledDate || undefined,
              notes: `Abel Lumber dispatch - ${delivery.deliveryNumber}`,
            }),
          })

          if (curriRes.ok) {
            const data = await curriRes.json()
            curriBookingId = data.id || data.delivery_id
            curriTrackingUrl = data.tracking_url || `https://app.curri.com/track/${curriBookingId}`
            curriCost = data.price?.amount || data.estimated_cost || null
          }
        } catch {
          // API failed — fall through to manual booking
        }
      }

      if (!curriBookingId) {
        curriBookingId = `manual-${Date.now().toString(36)}`
      }

      // Update delivery with Curri info
      try {
        await prisma.$executeRawUnsafe(`
          UPDATE "Delivery"
          SET "provider" = 'CURRI',
              "curriBookingId" = $2,
              "curriTrackingUrl" = $3,
              "curriCost" = $4,
              "curriVehicleType" = $5,
              "curriBookedAt" = NOW(),
              "updatedAt" = NOW()
          WHERE "id" = $1
        `, deliveryId, curriBookingId, curriTrackingUrl, curriCost, vehicleType || 'flatbed')
      } catch {
        // Curri columns may not exist — basic update
        await prisma.$executeRawUnsafe(
          `UPDATE "Delivery" SET "updatedAt" = NOW() WHERE "id" = $1`,
          deliveryId
        )
      }

      await audit(request, 'CREATE', 'CurriDispatch', deliveryId, {
        action: action === 'AUTO' ? 'AUTO_DISPATCH_CURRI' : 'MANUAL_DISPATCH_CURRI',
        curriBookingId, curriCost, vehicleType,
      })

      return safeJson({
        success: true,
        action: action === 'AUTO' ? 'AUTO_BOOK_CURRI' : 'BOOK_CURRI',
        deliveryId,
        curriBookingId,
        curriTrackingUrl,
        estimatedCost: curriCost,
        apiBooking: !!CURRI_API_KEY && !curriBookingId.startsWith('manual-'),
        message: curriBookingId.startsWith('manual-')
          ? 'Fleet at capacity. Marked for Curri — book manually at app.curri.com.'
          : 'Fleet at capacity. Auto-booked through Curri API.',
      }, { status: 201 })
    }

    return NextResponse.json({ error: 'Invalid action. Use ASSIGN_CREW, BOOK_CURRI, or AUTO.' }, { status: 400 })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

function buildDispatchRecommendation(
  crews: any[],
  unassigned: any[],
  totalCapacity: number,
  curriDeliveries: any[]
) {
  if (unassigned.length === 0) {
    return {
      status: 'ALL_ASSIGNED',
      message: 'All deliveries are assigned.',
      suggestCurri: false,
    }
  }

  if (totalCapacity >= unassigned.length) {
    // Enough capacity
    const bestCrew = crews.find(c => c.remainingCapacity > 0)
    return {
      status: 'CAPACITY_AVAILABLE',
      message: `${totalCapacity} slots available across ${crews.filter(c => c.remainingCapacity > 0).length} crews. ${unassigned.length} unassigned.`,
      suggestCurri: false,
      suggestedCrew: bestCrew ? { id: bestCrew.crewId, name: bestCrew.crewName } : null,
    }
  }

  // Over capacity
  const overflow = unassigned.length - totalCapacity
  return {
    status: 'OVER_CAPACITY',
    message: `Fleet can handle ${totalCapacity} more but ${unassigned.length} are unassigned. ${overflow} delivery(s) need Curri or rescheduling.`,
    suggestCurri: true,
    overflowCount: overflow,
    curriConfigured: !!CURRI_API_KEY,
  }
}
