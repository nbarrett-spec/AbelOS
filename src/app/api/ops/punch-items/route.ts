export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────
// PUNCH ITEMS — Structured punch list CRUD
// ──────────────────────────────────────────────────────────────────
// GET ?jobId=xxx or ?installationId=xxx  — list punch items
// POST — create a punch item
// PATCH — update/resolve a punch item
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const jobId = request.nextUrl.searchParams.get('jobId')
  const installationId = request.nextUrl.searchParams.get('installationId')
  const status = request.nextUrl.searchParams.get('status')

  try {
    let query = `
      SELECT
        pi.*,
        i."installNumber",
        j."jobNumber",
        j."builderName",
        s1."firstName" || ' ' || s1."lastName" AS "assignedToName",
        s2."firstName" || ' ' || s2."lastName" AS "reportedByName"
      FROM "PunchItem" pi
      JOIN "Installation" i ON pi."installationId" = i."id"
      JOIN "Job" j ON pi."jobId" = j."id"
      LEFT JOIN "Staff" s1 ON pi."assignedToId" = s1."id"
      LEFT JOIN "Staff" s2 ON pi."reportedById" = s2."id"
      WHERE 1=1
    `
    const params: any[] = []
    let idx = 1

    if (jobId) { query += ` AND pi."jobId" = $${idx}`; params.push(jobId); idx++ }
    if (installationId) { query += ` AND pi."installationId" = $${idx}`; params.push(installationId); idx++ }
    if (status) { query += ` AND pi."status" = $${idx}`; params.push(status); idx++ }

    query += ` ORDER BY CASE pi."severity" WHEN 'CRITICAL' THEN 1 WHEN 'MAJOR' THEN 2 WHEN 'MINOR' THEN 3 ELSE 4 END, pi."createdAt" DESC LIMIT 200`

    const items: any[] = await prisma.$queryRawUnsafe(query, ...params)

    // Summary counts
    const openCount = items.filter((i: any) => i.status === 'OPEN').length
    const inProgressCount = items.filter((i: any) => i.status === 'IN_PROGRESS').length
    const resolvedCount = items.filter((i: any) => i.status === 'RESOLVED').length

    return safeJson({
      punchItems: items,
      count: items.length,
      summary: { open: openCount, inProgress: inProgressCount, resolved: resolvedCount },
    })
  } catch (error: any) {
    console.error('[Punch Items GET]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''

  try {
    const body = await request.json()
    const { installationId, jobId, location, description, severity, assignedToId, dueDate } = body

    if (!installationId || !jobId || !description) {
      return NextResponse.json({ error: 'installationId, jobId, and description are required' }, { status: 400 })
    }

    const id = 'pi' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Count existing items for this installation to generate punch number
    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS cnt FROM "PunchItem" WHERE "installationId" = $1`,
      installationId
    )
    const cnt = (countResult[0]?.cnt || 0) + 1
    const punchNumber = `P-${cnt}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "PunchItem" (
        id, "punchNumber", "installationId", "jobId", location, description,
        severity, status, "assignedToId", "reportedById", "dueDate",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'OPEN', $8, $9, $10, NOW(), NOW())
    `,
      id, punchNumber, installationId, jobId,
      location || null, description,
      severity || 'MINOR',
      assignedToId || null, staffId,
      dueDate ? new Date(dueDate) : null
    )

    return safeJson({ success: true, id, punchNumber })
  } catch (error: any) {
    console.error('[Punch Items POST]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || ''

  try {
    const body = await request.json()
    const { id, action, resolutionNotes, assignedToId, severity, description } = body

    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

    if (action === 'resolve') {
      await prisma.$executeRawUnsafe(`
        UPDATE "PunchItem"
        SET status = 'RESOLVED', "resolvedAt" = NOW(), "resolvedById" = $2,
            "resolutionNotes" = $3, "updatedAt" = NOW()
        WHERE id = $1
      `, id, staffId, resolutionNotes || null)
    } else if (action === 'start') {
      await prisma.$executeRawUnsafe(`
        UPDATE "PunchItem" SET status = 'IN_PROGRESS', "updatedAt" = NOW() WHERE id = $1
      `, id)
    } else if (action === 'reopen') {
      await prisma.$executeRawUnsafe(`
        UPDATE "PunchItem"
        SET status = 'OPEN', "resolvedAt" = NULL, "resolvedById" = NULL, "updatedAt" = NOW()
        WHERE id = $1
      `, id)
    } else if (action === 'update') {
      const updates: string[] = [`"updatedAt" = NOW()`]
      const params: any[] = [id]
      let pIdx = 2
      if (assignedToId !== undefined) { updates.push(`"assignedToId" = $${pIdx}`); params.push(assignedToId); pIdx++ }
      if (severity) { updates.push(`severity = $${pIdx}`); params.push(severity); pIdx++ }
      if (description) { updates.push(`description = $${pIdx}`); params.push(description); pIdx++ }

      await prisma.$executeRawUnsafe(`UPDATE "PunchItem" SET ${updates.join(', ')} WHERE id = $1`, ...params)
    } else {
      return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
    }

    return safeJson({ success: true, action })
  } catch (error: any) {
    console.error('[Punch Items PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
