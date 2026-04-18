export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────────────
// Delivery ETA API — Real-time ETA using GPS vehicle positions
//
// GET /api/ops/delivery/eta?deliveryId=xxx
//   Returns live ETA computed from latest vehicle GPS ping + route estimate
//
// GET /api/ops/delivery/eta?date=2026-04-17
//   Returns ETAs for all active deliveries on a given date
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const deliveryId = searchParams.get('deliveryId')
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0]

    if (deliveryId) {
      return await getSingleDeliveryEta(deliveryId)
    }
    return await getDayEtas(date)
  } catch (error: any) {
    return safeJson({ error: error.message }, { status: 500 })
  }
}

async function getSingleDeliveryEta(deliveryId: string) {
  // Get delivery + assigned crew
  const deliveries: any[] = await prisma.$queryRawUnsafe(`
    SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
           d."crewId", d."routeOrder", d."departedAt",
           j."jobNumber", j."builderName", j."jobAddress", j."community",
           c."name" AS "crewName", c."vehiclePlate"
    FROM "Delivery" d
    JOIN "Job" j ON d."jobId" = j."id"
    LEFT JOIN "Crew" c ON d."crewId" = c."id"
    WHERE d."id" = $1
  `, deliveryId)

  if (deliveries.length === 0) {
    return safeJson({ error: 'Delivery not found' }, { status: 404 })
  }

  const delivery = deliveries[0]
  const eta = await computeEta(delivery)

  return safeJson({
    deliveryId: delivery.id,
    deliveryNumber: delivery.deliveryNumber,
    status: delivery.status,
    ...eta,
  })
}

async function getDayEtas(date: string) {
  // All active (non-completed) deliveries for a date
  const deliveries: any[] = await prisma.$queryRawUnsafe(`
    SELECT d."id", d."deliveryNumber", d."address", d."status"::text AS "status",
           d."crewId", d."routeOrder", d."departedAt",
           j."jobNumber", j."builderName", j."jobAddress", j."community",
           c."name" AS "crewName", c."vehiclePlate"
    FROM "Delivery" d
    JOIN "Job" j ON d."jobId" = j."id"
    LEFT JOIN "Crew" c ON d."crewId" = c."id"
    WHERE d."status"::text NOT IN ('COMPLETE', 'REFUSED', 'RESCHEDULED')
      AND COALESCE(j."scheduledDate", d."createdAt")::date = $1::date
    ORDER BY d."routeOrder" ASC NULLS LAST
  `, date)

  const etas = await Promise.all(deliveries.map(async (d: any) => ({
    deliveryId: d.id,
    deliveryNumber: d.deliveryNumber,
    address: d.address,
    status: d.status,
    crewName: d.crewName,
    builderName: d.builderName,
    jobNumber: d.jobNumber,
    routeOrder: d.routeOrder,
    ...(await computeEta(d)),
  })))

  return safeJson({
    date,
    deliveries: etas,
    count: etas.length,
    timestamp: new Date().toISOString(),
  })
}

async function computeEta(delivery: any): Promise<{
  eta: string | null
  etaMinutes: number | null
  confidence: 'GPS' | 'SCHEDULE' | 'UNKNOWN'
  vehiclePosition: { lat: number; lng: number; speed: number; updatedAt: string } | null
  distanceRemaining: number | null
}> {
  // Try to get latest GPS position for the crew
  if (delivery.crewId) {
    try {
      const positions: any[] = await prisma.$queryRawUnsafe(`
        SELECT "latitude", "longitude", "speed", "heading", "status", "timestamp"
        FROM "VehicleLocation"
        WHERE "crewId" = $1
        ORDER BY "timestamp" DESC
        LIMIT 1
      `, delivery.crewId)

      if (positions.length > 0) {
        const pos = positions[0]
        const ageMinutes = (Date.now() - new Date(pos.timestamp).getTime()) / 60000

        // Only use GPS if ping is < 30 minutes old
        if (ageMinutes < 30) {
          const speedMph = Number(pos.speed) || 30 // DFW average
          const distanceMiles = estimateDistanceToDelivery(
            Number(pos.latitude), Number(pos.longitude), delivery.address
          )
          const minutesRemaining = (distanceMiles / speedMph) * 60
          // Add 5 min buffer for unloading approach
          const totalMinutes = Math.round(minutesRemaining + 5)
          const etaTime = new Date(Date.now() + totalMinutes * 60000)

          return {
            eta: etaTime.toISOString(),
            etaMinutes: totalMinutes,
            confidence: 'GPS',
            vehiclePosition: {
              lat: Number(pos.latitude),
              lng: Number(pos.longitude),
              speed: Number(pos.speed) || 0,
              updatedAt: pos.timestamp,
            },
            distanceRemaining: Math.round(distanceMiles * 10) / 10,
          }
        }
      }
    } catch {
      // VehicleLocation table may not exist yet — fall through
    }
  }

  // Fallback: schedule-based estimate
  if (delivery.departedAt) {
    // If departed, estimate based on average delivery time (45 min)
    const departedMs = new Date(delivery.departedAt).getTime()
    const estimatedArrival = new Date(departedMs + 45 * 60000)
    const minutesRemaining = Math.max(0, Math.round((estimatedArrival.getTime() - Date.now()) / 60000))

    return {
      eta: estimatedArrival.toISOString(),
      etaMinutes: minutesRemaining,
      confidence: 'SCHEDULE',
      vehiclePosition: null,
      distanceRemaining: null,
    }
  }

  return {
    eta: null,
    etaMinutes: null,
    confidence: 'UNKNOWN',
    vehiclePosition: null,
    distanceRemaining: null,
  }
}

/**
 * Estimate distance from a GPS point to a delivery address.
 * Simple heuristic for DFW — production would use Google Directions API.
 */
function estimateDistanceToDelivery(lat: number, lng: number, address: string): number {
  // Extract zip from address for rough distance estimation
  const zipMatch = address.match(/\b(\d{5})\b/)
  const zip = zipMatch ? zipMatch[1] : ''

  // DFW zip code to approximate centroid lat/lng
  const zipCentroids: Record<string, { lat: number; lng: number }> = {
    '760': { lat: 32.735, lng: -97.108 },  // Arlington
    '761': { lat: 32.95, lng: -96.73 },     // Plano/Richardson
    '750': { lat: 32.78, lng: -96.80 },     // Dallas central
    '751': { lat: 33.02, lng: -96.70 },     // North Dallas/Plano
    '752': { lat: 32.96, lng: -96.84 },     // Addison/Carrollton
    '753': { lat: 32.73, lng: -97.32 },     // Fort Worth
    '754': { lat: 32.82, lng: -96.95 },     // Irving
    '755': { lat: 32.68, lng: -97.01 },     // Grand Prairie
    '756': { lat: 32.65, lng: -97.15 },     // Mansfield
    '757': { lat: 32.42, lng: -97.08 },     // Cleburne area
    '762': { lat: 33.21, lng: -96.63 },     // McKinney
    '763': { lat: 33.10, lng: -96.85 },     // Denton
  }

  const prefix = zip.substring(0, 3)
  const centroid = zipCentroids[prefix]

  if (centroid) {
    const latDiff = lat - centroid.lat
    const lngDiff = lng - centroid.lng
    // 1 deg lat ≈ 69 miles, 1 deg lng ≈ 59 miles at 32°N
    return Math.sqrt((latDiff * 69) ** 2 + (lngDiff * 59) ** 2)
  }

  // Fallback: assume moderate distance
  return 15
}
