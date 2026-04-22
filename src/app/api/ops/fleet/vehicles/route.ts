export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Since no Vehicle model exists, aggregate from Crew records
    // Each crew can have a vehicleId and vehiclePlate
    const crews: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        c."id",
        c."vehicleId",
        c."vehiclePlate",
        c."name" AS "crewName",
        c."crewType",
        c."active",
        c."updatedAt" AS "lastUpdated"
      FROM "Crew" c
      WHERE c."vehicleId" IS NOT NULL OR c."vehiclePlate" IS NOT NULL
      ORDER BY c."vehiclePlate" ASC NULLS LAST
    `)

    // Build vehicle list from crew data
    // Group by vehicleId/vehiclePlate to deduplicate vehicles assigned to multiple crews
    const vehicleMap = new Map<string, any>()

    for (const crew of crews) {
      const vehicleKey = crew.vehiclePlate || crew.vehicleId || `crew-${crew.id}`

      if (!vehicleMap.has(vehicleKey)) {
        vehicleMap.set(vehicleKey, {
          id: crew.vehicleId || `vehicle-${crew.vehiclePlate}`,
          plate: crew.vehiclePlate || 'N/A',
          make: null,
          model: null,
          assignedCrew: {
            id: crew.id,
            name: crew.crewName,
            type: crew.crewType,
            active: crew.active,
          },
          status: crew.active ? 'ACTIVE' : 'INACTIVE',
          lastInspectionDate: null,
          lastUpdated: crew.lastUpdated,
        })
      } else {
        // If multiple crews share a vehicle, update assignedCrew to reflect most recent
        const existing = vehicleMap.get(vehicleKey)
        if (new Date(crew.lastUpdated) > new Date(existing.lastUpdated)) {
          existing.assignedCrew = {
            id: crew.id,
            name: crew.crewName,
            type: crew.crewType,
            active: crew.active,
          }
          existing.lastUpdated = crew.lastUpdated
        }
      }
    }

    const vehicles = Array.from(vehicleMap.values())

    return NextResponse.json({
      data: vehicles,
      total: vehicles.length,
      message: 'Vehicle data aggregated from Crew assignments. No dedicated Vehicle model exists.',
    })
  } catch (error) {
    console.error('GET /api/ops/fleet/vehicles error:', error)
    return NextResponse.json({ error: 'Failed to fetch vehicles' }, { status: 500 })
  }
}
