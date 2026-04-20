export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { projectSchema } from '@/lib/validations'
import { audit } from '@/lib/audit'

// GET all projects for logged-in builder
export async function GET() {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Get projects with orders and delivery counts
    const projectRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        p.id,
        p."builderId",
        p.name,
        p.address,
        p.community,
        p.status,
        p."planName",
        p."createdAt",
        p."updatedAt",
        COUNT(DISTINCT o.id)::int as "orderCount",
        COALESCE(SUM(o.total), 0)::numeric as "totalSpend",
        COUNT(DISTINCT CASE WHEN j."scheduledDate" > NOW() THEN d.id END)::int as "upcomingDeliveryCount",
        MIN(CASE WHEN j."scheduledDate" > NOW() THEN j."scheduledDate" END) as "nextDeliveryDate"
       FROM "Project" p
       LEFT JOIN "Quote" q ON q."projectId" = p.id
       LEFT JOIN "Order" o ON o."quoteId" = q.id
       LEFT JOIN "Job" j ON j."orderId" = o.id
       LEFT JOIN "Delivery" d ON d."jobId" = j.id
       WHERE p."builderId" = $1
       GROUP BY p.id, p."builderId", p.name, p.address, p.community, p.status, p."planName", p."createdAt", p."updatedAt"
       ORDER BY p."updatedAt" DESC`,
      session.builderId
    )

    // Get counts and related data for each project
    const projects = await Promise.all(
      projectRows.map(async (p: any) => {
        const [blueprintRows, takeoffRows, quoteRows, blueprintCountRows, takeoffCountRows, quoteCountRows] =
          await Promise.all([
            prisma.$queryRawUnsafe<any[]>(
              `SELECT id, "fileName", "processingStatus" FROM "Blueprint" WHERE "projectId" = $1`,
              p.id
            ),
            prisma.$queryRawUnsafe<any[]>(
              `SELECT id, status, confidence FROM "Takeoff" WHERE "projectId" = $1`,
              p.id
            ),
            prisma.$queryRawUnsafe<any[]>(
              `SELECT id, "quoteNumber", status, total FROM "Quote" WHERE "projectId" = $1`,
              p.id
            ),
            prisma.$queryRawUnsafe<any[]>(
              `SELECT COUNT(*)::int as count FROM "Blueprint" WHERE "projectId" = $1`,
              p.id
            ),
            prisma.$queryRawUnsafe<any[]>(
              `SELECT COUNT(*)::int as count FROM "Takeoff" WHERE "projectId" = $1`,
              p.id
            ),
            prisma.$queryRawUnsafe<any[]>(
              `SELECT COUNT(*)::int as count FROM "Quote" WHERE "projectId" = $1`,
              p.id
            ),
          ])

        return {
          id: p.id,
          builderId: p.builderId,
          name: p.name,
          address: p.address,
          community: p.community,
          status: p.status,
          planName: p.planName,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          orderCount: p.orderCount || 0,
          totalSpend: Number(p.totalSpend || 0),
          upcomingDeliveryCount: p.upcomingDeliveryCount || 0,
          nextDeliveryDate: p.nextDeliveryDate ? new Date(p.nextDeliveryDate).toISOString() : null,
          blueprints: blueprintRows,
          takeoffs: takeoffRows,
          quotes: quoteRows,
          _count: {
            blueprints: blueprintCountRows[0]?.count || 0,
            takeoffs: takeoffCountRows[0]?.count || 0,
            quotes: quoteCountRows[0]?.count || 0,
          },
        }
      })
    )

    return NextResponse.json({ projects })
  } catch (error) {
    console.error('Get projects error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST create a new project
export async function POST(request: NextRequest) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    audit(request, 'CREATE', 'Project').catch(() => {});

    const body = await request.json()
    const parsed = projectSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const projectId = crypto.randomUUID()
    const { name, status, planName, jobAddress, city, state, lotNumber, subdivision, sqFootage } = parsed.data

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Project" (id, "builderId", name, status, "planName", "jobAddress", city, state, "lotNumber", subdivision, "sqFootage", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      projectId,
      session.builderId,
      name,
      status || 'ACTIVE',
      planName || null,
      jobAddress || null,
      city || null,
      state || null,
      lotNumber || null,
      subdivision || null,
      sqFootage || null
    )

    const projectRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "builderId", name, status, "planName", "jobAddress", city, state, "lotNumber", subdivision, "sqFootage", "createdAt", "updatedAt"
       FROM "Project" WHERE id = $1`,
      projectId
    )

    if (projectRows.length === 0) {
      return NextResponse.json(
        { error: 'Failed to retrieve created project' },
        { status: 500 }
      )
    }

    return NextResponse.json({ project: projectRows[0] }, { status: 201 })
  } catch (error) {
    console.error('Create project error:', error)
    return NextResponse.json(
      { error: 'Failed to create project' },
      { status: 500 }
    )
  }
}
