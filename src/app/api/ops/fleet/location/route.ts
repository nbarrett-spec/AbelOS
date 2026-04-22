export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'
import crypto from 'crypto'

// ──────────────────────────────────────────────────────────────────────────
// Vehicle GPS Location API
//
// GET  — Fetch latest positions for all active crews (or a specific crew)
//        ?crewId=xxx — single crew   ?active=true — only crews with recent pings
// POST — Record a GPS position update from a driver's device
//        Body: { crewId, latitude, longitude, heading?, speed?, status?, activeDeliveryId? }
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false
async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VehicleLocation" (
        "id" TEXT PRIMARY KEY,
        "crewId" TEXT NOT NULL,
        "vehicleId" TEXT,
        "latitude" DOUBLE PRECISION NOT NULL,
        "longitude" DOUBLE PRECISION NOT NULL,
        "heading" DOUBLE PRECISION,
        "speed" DOUBLE PRECISION,
        "status" TEXT NOT NULL DEFAULT 'IDLE',
        "address" TEXT,
        "activeDeliveryId" TEXT,
        "timestamp" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleLocation_crewId_idx" ON "VehicleLocation" ("crewId")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleLocation_timestamp_idx" ON "VehicleLocation" ("timestamp")`)
    await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "VehicleLocation_activeDeliveryId_idx" ON "VehicleLocation" ("activeDeliveryId")`)
    tableEnsured = true
  } catch {
    tableEnsured = true
  }
}

/**
 * GET /api/ops/fleet/location
 * Returns latest GPS position for each active crew
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const { searchParams } = new URL(request.url)
    const crewId = searchParams.get('crewId')
    const activeOnly = searchParams.get('active') === 'true'
    const deliveryId = searchParams.get('deliveryId')

    // If requesting a specific delivery's vehicle location
    if (deliveryId) {
      const positions: any[] = await prisma.$queryRawUnsafe(`
        SELECT vl.*, c."name" AS "crewName", c."vehiclePlate"
        FROM "VehicleLocation" vl
        JOIN "Crew" c ON vl."crewId" = c."id"
        WHERE vl."activeDeliveryId" = $1
        ORDER BY vl."timestamp" DESC
        LIMIT 20
      `, deliveryId)

      return safeJson({ positions, deliveryId })
    }

    // Latest position per crew (using DISTINCT ON)
    let query = `
      SELECT DISTINCT ON (vl."crewId")
        vl."id", vl."crewId", vl."vehicleId",
        vl."latitude", vl."longitude", vl."heading", vl."speed",
        vl."status", vl."address", vl."activeDeliveryId",
        vl."timestamp",
        c."name" AS "crewName", c."vehiclePlate", c."crewType",
        c."active" AS "crewActive"
      FROM "VehicleLocation" vl
      JOIN "Crew" c ON vl."crewId" = c."id"
      WHERE 1=1
    `
    const params: any[] = []
    let paramIdx = 1

    if (crewId) {
      query += ` AND vl."crewId" = $${paramIdx}`
      params.push(crewId)
      paramIdx++
    }

    if (activeOnly) {
      // Only crews with a ping in the last 30 minutes
      query += ` AND vl."timestamp" > NOW() - INTERVAL '30 minutes'`
    }

    query += ` ORDER BY vl."crewId", vl."timestamp" DESC`

    const vehicles: any[] = await prisma.$queryRawUnsafe(query, ...params)

    // For each vehicle with an active delivery, compute ETA
    const enriched = await Promise.all(vehicles.map(async (v: any) => {
      let eta = null
      let deliveryInfo = null

      if (v.activeDeliveryId) {
        const deliveries: any[] = await prisma.$queryRawUnsafe(`
          SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
                 j."jobNumber", j."builderName", j."community"
          FROM "Delivery" d
          JOIN "Job" j ON d."jobId" = j."id"
          WHERE d."id" = $1
        `, v.activeDeliveryId)

        if (deliveries.length > 0) {
          deliveryInfo = deliveries[0]
          // Estimate ETA based on speed and approximate distance
          const speedMph = v.speed || 35 // default DFW average
          // Simple heuristic: use remaining route distance estimate
          // In production, this would call a routing API (Google, Mapbox)
          const estimatedMilesRemaining = estimateRemainingDistance(
            v.latitude, v.longitude, deliveryInfo.address
          )
          const minutesRemaining = (estimatedMilesRemaining / speedMph) * 60
          eta = new Date(new Date(v.timestamp).getTime() + minutesRemaining * 60000).toISOString()
        }
      }

      return {
        ...v,
        eta,
        deliveryInfo,
        minutesSinceUpdate: Math.round((Date.now() - new Date(v.timestamp).getTime()) / 60000),
        isStale: (Date.now() - new Date(v.timestamp).getTime()) > 15 * 60000, // >15 min old
      }
    }))

    return safeJson({
      vehicles: enriched,
      count: enriched.length,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

/**
 * POST /api/ops/fleet/location
 * Record a GPS ping from a driver device
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await ensureTable()

    const body = await request.json()
    const { crewId, latitude, longitude, heading, speed, status, activeDeliveryId, vehicleId, address } = body

    audit(request, 'CREATE', 'FleetLocation', undefined, { method: 'POST' }).catch(() => {})

    if (!crewId || latitude == null || longitude == null) {
      return NextResponse.json(
        { error: 'crewId, latitude, and longitude are required' },
        { status: 400 }
      )
    }

    // Validate coordinates (DFW metro area: roughly 32.0-33.5 lat, -97.8 to -96.0 lng)
    if (latitude < 25 || latitude > 50 || longitude < -130 || longitude > -60) {
      return NextResponse.json(
        { error: 'Coordinates outside continental US bounds' },
        { status: 400 }
      )
    }

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    // Look up vehicle plate from crew if not provided
    let resolvedVehicleId = vehicleId
    if (!resolvedVehicleId) {
      const crews: any[] = await prisma.$queryRawUnsafe(
        `SELECT "vehiclePlate" FROM "Crew" WHERE "id" = $1 LIMIT 1`,
        crewId
      )
      resolvedVehicleId = crews[0]?.vehiclePlate || null
    }

    await prisma.$executeRawUnsafe(`
      INSERT INTO "VehicleLocation" ("id", "crewId", "vehicleId", "latitude", "longitude",
        "heading", "speed", "status", "address", "activeDeliveryId", "timestamp")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)
    `,
      id, crewId, resolvedVehicleId,
      latitude, longitude,
      heading || null, speed || null,
      status || 'EN_ROUTE',
      address || null,
      activeDeliveryId || null,
      now
    )

    // If there's an active delivery and status indicates arrival, update ETA on delivery tracking
    if (activeDeliveryId && (status === 'NEARBY' || status === 'ARRIVED')) {
      await prisma.$executeRawUnsafe(`
        INSERT INTO "DeliveryTracking" ("id", "deliveryId", "status", "location", "notes", "updatedBy", "timestamp")
        VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz)
      `,
        crypto.randomUUID(),
        activeDeliveryId,
        status,
        address || `${latitude},${longitude}`,
        `GPS auto-update: ${status}`,
        request.headers.get('x-staff-id') || 'gps-system',
        now
      )
    }

    // Prune old location records (keep last 7 days)
    await prisma.$executeRawUnsafe(
      `DELETE FROM "VehicleLocation" WHERE "timestamp" < NOW() - INTERVAL '7 days'`
    ).catch(() => {})

    return safeJson({
      success: true,
      id,
      crewId,
      position: { latitude, longitude, heading, speed },
      status: status || 'EN_ROUTE',
      timestamp: now,
    }, { status: 201 })
  } catch (error: any) {
    return safeJson({ error: 'Internal server error'}, { status: 500 })
  }
}

/**
 * Estimate remaining distance in miles from GPS position to a delivery address.
 * Uses a simple DFW-area heuristic. In production, integrate Google Directions or Mapbox.
 */
function estimateRemainingDistance(lat: number, lng: number, address: string): number {
  // DFW center coordinates for reference
  const DFW_CENTER = { lat: 32.78, lng: -96.80 }
  const ABEL_HQ = { lat: 32.7357, lng: -97.1081 } // Arlington

  // Very rough haversine approximation (1 degree lat ≈ 69 miles in TX)
  // For a proper implementation, call a geocoding/routing API
  const latDiff = Math.abs(lat - ABEL_HQ.lat)
  const lngDiff = Math.abs(lng - ABEL_HQ.lng)
  const roughMiles = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff) * 69

  // Clamp to reasonable DFW delivery range
  return Math.min(Math.max(roughMiles, 2), 60)
}
