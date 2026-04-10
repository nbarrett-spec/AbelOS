export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logAudit } from '@/lib/audit'
import { createNotification } from '@/lib/notifications'
import { checkStaffAuth } from '@/lib/api-auth'

function generateId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function generateClaimNumber(): string {
  const year = new Date().getFullYear()
  const seq = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `WC-${year}-${seq}`
}

// GET /api/ops/warranty/claims — List warranty claims (staff)
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const priority = searchParams.get('priority')
    const assignedTo = searchParams.get('assignedTo')
    const builderId = searchParams.get('builderId')
    const search = searchParams.get('search')
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '20')))
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status && status !== 'ALL') {
      conditions.push(`wc."status" = $${idx}`)
      params.push(status)
      idx++
    }
    if (type && type !== 'ALL') {
      conditions.push(`wc."type" = $${idx}`)
      params.push(type)
      idx++
    }
    if (priority && priority !== 'ALL') {
      conditions.push(`wc."priority" = $${idx}`)
      params.push(priority)
      idx++
    }
    if (assignedTo) {
      conditions.push(`wc."assignedTo" = $${idx}`)
      params.push(assignedTo)
      idx++
    }
    if (builderId) {
      conditions.push(`wc."builderId" = $${idx}`)
      params.push(builderId)
      idx++
    }
    if (search) {
      conditions.push(`(wc."claimNumber" ILIKE $${idx} OR wc."subject" ILIKE $${idx} OR wc."productName" ILIKE $${idx} OR wc."contactName" ILIKE $${idx})`)
      params.push(`%${search}%`)
      idx++
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''

    const countResult = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "WarrantyClaim" wc ${whereClause}`,
      ...params
    ) as Array<{ count: number }>
    const total = countResult[0]?.count || 0

    const claims = await prisma.$queryRawUnsafe(
      `SELECT wc.*,
              s."firstName" || ' ' || s."lastName" as "assignedToName",
              sb."firstName" || ' ' || sb."lastName" as "submittedByName"
       FROM "WarrantyClaim" wc
       LEFT JOIN "Staff" s ON wc."assignedTo" = s."id"
       LEFT JOIN "Staff" sb ON wc."submittedById" = sb."id"
       ${whereClause}
       ORDER BY
         CASE wc."priority" WHEN 'URGENT' THEN 0 WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
         wc."createdAt" DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      ...params,
      limit,
      offset
    )

    // Get summary stats
    const stats = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total,
        (COUNT(*) FILTER (WHERE "status" = 'SUBMITTED'))::int as submitted,
        (COUNT(*) FILTER (WHERE "status" = 'UNDER_REVIEW'))::int as under_review,
        (COUNT(*) FILTER (WHERE "status" = 'INSPECTION_SCHEDULED'))::int as inspection_scheduled,
        (COUNT(*) FILTER (WHERE "status" = 'APPROVED'))::int as approved,
        (COUNT(*) FILTER (WHERE "status" = 'IN_PROGRESS'))::int as in_progress,
        (COUNT(*) FILTER (WHERE "status" = 'RESOLVED'))::int as resolved,
        (COUNT(*) FILTER (WHERE "status" = 'DENIED'))::int as denied,
        (COUNT(*) FILTER (WHERE "status" = 'CLOSED'))::int as closed,
        (COUNT(*) FILTER (WHERE "priority" = 'URGENT'))::int as urgent,
        COALESCE(SUM("resolutionCost"), 0)::float as total_cost,
        COALESCE(SUM("creditAmount"), 0)::float as total_credits
      FROM "WarrantyClaim"
    `) as any[]

    return NextResponse.json({
      claims,
      stats: stats[0] || {},
      pagination: { page, limit, total, pages: Math.ceil(total / limit) }
    })
  } catch (error: any) {
    console.error('GET /api/ops/warranty/claims error:', error)
    return NextResponse.json({ error: 'Failed to fetch warranty claims' }, { status: 500 })
  }
}

// POST /api/ops/warranty/claims — Create a warranty claim (staff side)
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const staffId = request.headers.get('x-staff-id')
    if (!staffId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await request.json()
    const {
      policyId, builderId, orderId, projectId, type, priority,
      subject, description, productName, productSku, installDate, issueDate,
      contactName, contactEmail, contactPhone,
      siteAddress, siteCity, siteState, siteZip, assignedTo
    } = body

    if (!subject || !description || !type) {
      return NextResponse.json({ error: 'Subject, description, and type are required' }, { status: 400 })
    }

    const id = generateId('wcl')
    const claimNumber = generateClaimNumber()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "WarrantyClaim" (
        "id", "claimNumber", "policyId", "builderId", "orderId", "projectId",
        "type", "status", "priority", "subject", "description",
        "productName", "productSku", "installDate", "issueDate",
        "contactName", "contactEmail", "contactPhone",
        "siteAddress", "siteCity", "siteState", "siteZip",
        "assignedTo", "submittedById", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, 'SUBMITTED', $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17,
        $18, $19, $20, $21,
        $22, $23, NOW(), NOW()
      )`,
      id, claimNumber, policyId || null, builderId || null, orderId || null, projectId || null,
      type, priority || 'MEDIUM', subject, description,
      productName || null, productSku || null,
      installDate ? new Date(installDate) : null,
      issueDate ? new Date(issueDate) : null,
      contactName || null, contactEmail || null, contactPhone || null,
      siteAddress || null, siteCity || null, siteState || null, siteZip || null,
      assignedTo || null, staffId
    )

    // Notify assigned staff if set
    if (assignedTo) {
      createNotification({
        staffId: assignedTo,
        type: 'TASK_ASSIGNED',
        title: 'Warranty Claim Assigned',
        message: `Claim ${claimNumber}: ${subject}`,
        link: `/ops/warranty/claims?id=${id}`
      }).catch(() => {})
    }

    await logAudit({
      staffId,
      action: 'CREATE',
      entity: 'WarrantyClaim',
      entityId: id,
      details: { claimNumber, type, subject },
    }).catch(() => {})

    return NextResponse.json({ success: true, claimId: id, claimNumber }, { status: 201 })
  } catch (error: any) {
    console.error('POST /api/ops/warranty/claims error:', error)
    return NextResponse.json({ error: 'Failed to create warranty claim' }, { status: 500 })
  }
}
