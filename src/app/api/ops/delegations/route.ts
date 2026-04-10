export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const staffId = searchParams.get('staffId')
    const activeOnly = searchParams.get('active') === 'true'

    const delConditions: string[] = []
    const delParams: any[] = []
    let dIdx = 1

    if (status) {
      delConditions.push(`wd.status = $${dIdx}`)
      delParams.push(status)
      dIdx++
    }
    if (staffId) {
      delConditions.push(`(wd."delegatorId" = $${dIdx} OR wd."delegateId" = $${dIdx})`)
      delParams.push(staffId)
      dIdx++
    }
    if (activeOnly) {
      delConditions.push(`wd.status = 'ACTIVE' AND wd."startDate" <= NOW() AND wd."endDate" >= NOW()`)
    }

    const whereClause = delConditions.length > 0 ? 'WHERE ' + delConditions.join(' AND ') : ''

    const delegations = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        wd.*,
        CONCAT(del."firstName", ' ', del."lastName") as "delegatorName",
        del.role as "delegatorRole",
        del.department as "delegatorDepartment",
        del.email as "delegatorEmail",
        CONCAT(dgt."firstName", ' ', dgt."lastName") as "delegateName",
        dgt.role as "delegateRole",
        dgt.department as "delegateDepartment",
        dgt.email as "delegateEmail",
        CONCAT(cb."firstName", ' ', cb."lastName") as "createdByName"
      FROM "WorkloadDelegation" wd
      LEFT JOIN "Staff" del ON wd."delegatorId" = del.id
      LEFT JOIN "Staff" dgt ON wd."delegateId" = dgt.id
      LEFT JOIN "Staff" cb ON wd."createdById" = cb.id
      ${whereClause}
      ORDER BY wd."startDate" DESC
    `, ...delParams)

    // Stats
    const stats = await prisma.$queryRawUnsafe<any[]>(`
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN status = 'ACTIVE' THEN 1 END)::int as active,
        COUNT(CASE WHEN status = 'SCHEDULED' THEN 1 END)::int as scheduled,
        COUNT(CASE WHEN status = 'COMPLETED' THEN 1 END)::int as completed,
        COUNT(CASE WHEN status = 'CANCELLED' THEN 1 END)::int as cancelled
      FROM "WorkloadDelegation"
    `)

    // Auto-activate scheduled delegations that should be active now
    await prisma.$executeRawUnsafe(`
      UPDATE "WorkloadDelegation"
      SET status = 'ACTIVE', "updatedAt" = NOW()
      WHERE status = 'SCHEDULED' AND "startDate" <= NOW() AND "endDate" >= NOW()
    `)

    // Auto-complete active delegations that have ended
    await prisma.$executeRawUnsafe(`
      UPDATE "WorkloadDelegation"
      SET status = 'COMPLETED', "updatedAt" = NOW()
      WHERE status = 'ACTIVE' AND "endDate" < NOW()
    `)

    // Get staff list for delegate picker
    const staffList = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id, "firstName", "lastName", role, department, email, title, active
      FROM "Staff"
      WHERE active = true
      ORDER BY "firstName", "lastName"
    `)

    return safeJson({
      delegations,
      stats: stats[0] || { total: 0, active: 0, scheduled: 0, completed: 0, cancelled: 0 },
      staffList,
    })
  } catch (error: any) {
    console.error('Delegation GET error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const staffId = request.headers.get('x-staff-id')!
    const { delegatorId, delegateId, startDate, endDate, reason, scope, notes } = body

    if (!delegatorId || !delegateId || !startDate || !endDate) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    if (delegatorId === delegateId) {
      return NextResponse.json({ error: 'Cannot delegate to yourself' }, { status: 400 })
    }

    // Check for overlapping active delegations
    const overlap = await prisma.$queryRawUnsafe<any[]>(`
      SELECT id FROM "WorkloadDelegation"
      WHERE "delegatorId" = $1
        AND status IN ('SCHEDULED', 'ACTIVE')
        AND "startDate" < $3
        AND "endDate" > $2
      LIMIT 1
    `, delegatorId, new Date(startDate), new Date(endDate))

    if (overlap.length > 0) {
      return NextResponse.json({ error: 'Overlapping delegation exists for this person in that date range' }, { status: 409 })
    }

    // Determine initial status
    const now = new Date()
    const start = new Date(startDate)
    const end = new Date(endDate)
    let initialStatus = 'SCHEDULED'
    if (start <= now && end >= now) initialStatus = 'ACTIVE'
    if (end < now) initialStatus = 'COMPLETED'

    const result = await prisma.$queryRawUnsafe<any[]>(`
      INSERT INTO "WorkloadDelegation" ("delegatorId", "delegateId", "startDate", "endDate", "reason", "scope", "notes", "status", "createdById")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, delegatorId, delegateId, start, end, reason || 'VACATION', scope || 'ALL', notes || null, initialStatus, staffId)

    return safeJson({ delegation: result[0], message: 'Delegation created' })
  } catch (error: any) {
    console.error('Delegation POST error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
