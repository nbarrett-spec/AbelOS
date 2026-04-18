export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// Live Fleet API — enriched truck positions with crew + delivery details
// Used by the Live Operations Map
//
// GET /api/ops/fleet/live
//   Returns all vehicle positions from the last 2 hours with:
//   - Crew name, vehicle plate, crew members
//   - Active delivery details (address, builder, items, job number)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Get latest vehicle position per crew from the last 2 hours
    const locations: Array<Record<string, unknown>> = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON (vl."crewId")
        vl."id",
        vl."crewId",
        vl."vehicleId",
        vl."latitude",
        vl."longitude",
        vl."heading",
        vl."speed",
        vl."status",
        vl."address",
        vl."activeDeliveryId",
        vl."timestamp",
        c."name" as "crewName",
        c."vehiclePlate",
        d."deliveryNumber",
        d."address" as "deliveryAddress",
        d."status" as "deliveryStatus",
        j."jobNumber",
        j."builderName"
      FROM "VehicleLocation" vl
      LEFT JOIN "Crew" c ON c."id" = vl."crewId"
      LEFT JOIN "Delivery" d ON d."id" = vl."activeDeliveryId"
      LEFT JOIN "Job" j ON j."id" = d."jobId"
      WHERE vl."timestamp" > NOW() - INTERVAL '2 hours'
      ORDER BY vl."crewId", vl."timestamp" DESC
    `)

    // Get crew members for each crew
    const crewIds = [...new Set(locations.map((l) => l.crewId as string))]
    let crewMembers: Array<Record<string, unknown>> = []

    if (crewIds.length > 0) {
      const placeholders = crewIds.map((_, i) => `$${i + 1}`).join(',')
      crewMembers = await prisma.$queryRawUnsafe(`
        SELECT
          cm."crewId",
          s."firstName",
          s."lastName",
          s."id" as "staffId"
        FROM "CrewMember" cm
        JOIN "Staff" s ON s."id" = cm."staffId"
        WHERE cm."crewId" IN (${placeholders})
      `, ...crewIds)
    }

    // Group members by crew
    const membersByCrewId: Record<string, Array<{ staff: { firstName: string; lastName: string; id: string } }>> = {}
    for (const m of crewMembers) {
      const cid = m.crewId as string
      if (!membersByCrewId[cid]) membersByCrewId[cid] = []
      membersByCrewId[cid].push({
        staff: {
          firstName: m.firstName as string,
          lastName: m.lastName as string,
          id: m.staffId as string,
        },
      })
    }

    // Assemble enriched response
    const enriched = locations.map((loc) => ({
      id: loc.id,
      crewId: loc.crewId,
      vehicleId: loc.vehicleId,
      latitude: Number(loc.latitude),
      longitude: Number(loc.longitude),
      heading: loc.heading != null ? Number(loc.heading) : undefined,
      speed: loc.speed != null ? Number(loc.speed) : undefined,
      status: loc.status || 'IDLE',
      address: loc.address,
      activeDeliveryId: loc.activeDeliveryId,
      timestamp: loc.timestamp,
      crewName: loc.crewName,
      crew: {
        name: loc.crewName || `Crew ${(loc.crewId as string).slice(-4)}`,
        vehiclePlate: loc.vehiclePlate,
        members: membersByCrewId[loc.crewId as string] || [],
      },
      delivery: loc.activeDeliveryId
        ? {
            id: loc.activeDeliveryId,
            deliveryNumber: loc.deliveryNumber || '—',
            address: loc.deliveryAddress || '—',
            status: loc.deliveryStatus || '—',
            jobNumber: loc.jobNumber,
            builderName: loc.builderName,
          }
        : undefined,
    }))

    return NextResponse.json({ locations: enriched, count: enriched.length })
  } catch (error) {
    console.error('Failed to get live fleet data:', error)
    // Return empty array rather than error — map should still work without trucks
    return NextResponse.json({ locations: [], count: 0 })
  }
}
