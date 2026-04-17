export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/locations — List all locations
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const locations: any[] = await prisma.$queryRawUnsafe(
      `SELECT l.*,
              s."firstName" || ' ' || s."lastName" as "managerName",
              (SELECT COUNT(*)::int FROM "Staff" st WHERE st."locationId" = l.id) as "staffCount",
              (SELECT COUNT(*)::int FROM "Job" j WHERE j."locationId" = l.id AND j."status"::text NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')) as "activeJobs"
       FROM "Location" l
       LEFT JOIN "Staff" s ON s.id = l."managerId"
       ORDER BY l."isPrimary" DESC, l."name" ASC`
    )
    return NextResponse.json({ locations })
  } catch (error: any) {
    console.error('[Locations GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// POST /api/ops/locations — Create a new location
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Locations', undefined, { method: 'POST' }).catch(() => {})

    const { name, code, type, address, city, state, zip, phone, managerId, timezone } = await request.json()
    if (!name || !code) {
      return NextResponse.json({ error: 'name and code are required' }, { status: 400 })
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Location" ("id", "name", "code", "type", "address", "city", "state", "zip", "phone", "managerId", "timezone")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      name, code, type || 'WAREHOUSE', address || null, city || null, state || null,
      zip || null, phone || null, managerId || null, timezone || 'America/Chicago'
    )

    return NextResponse.json({ location: result[0] }, { status: 201 })
  } catch (error: any) {
    console.error('[Locations POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
