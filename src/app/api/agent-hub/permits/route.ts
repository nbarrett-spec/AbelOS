export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/permits
 * List building permits with filtering by status, projectType, city.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const projectType = sp.get('projectType')
    const city = sp.get('city')
    const builderFound = sp.get('builderFound')
    const limit = parseInt(sp.get('limit') || '50', 10)
    const page = parseInt(sp.get('page') || '1', 10)
    const offset = (page - 1) * limit

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status) { conditions.push(`"status"::text = $${idx}`); params.push(status); idx++ }
    if (projectType) { conditions.push(`"projectType"::text = $${idx}`); params.push(projectType); idx++ }
    if (city) { conditions.push(`"city" ILIKE $${idx}`); params.push(`%${city}%`); idx++ }
    if (builderFound === 'true') conditions.push(`"builderFound" = true`)
    if (builderFound === 'false') conditions.push(`"builderFound" = false`)

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const permits: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "PermitLead"
      ${where}
      ORDER BY "filingDate" DESC NULLS LAST, "createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `, ...params)

    const countRes: any[] = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::int AS total FROM "PermitLead" ${where}
    `, ...params)

    // Pipeline summary
    const pipeline: any[] = await prisma.$queryRawUnsafe(`
      SELECT "status", COUNT(*)::int AS count,
             COALESCE(SUM("estimatedValue"), 0)::float AS value
      FROM "PermitLead"
      GROUP BY "status"
      ORDER BY CASE "status"
        WHEN 'NEW' THEN 1 WHEN 'RESEARCHED' THEN 2
        WHEN 'OUTREACH_SENT' THEN 3 WHEN 'CONVERTED' THEN 4
        WHEN 'DISQUALIFIED' THEN 5 ELSE 6 END
    `)

    return NextResponse.json({
      data: permits.map(p => ({ ...p, estimatedValue: Number(p.estimatedValue) })),
      pagination: {
        page, limit, total: countRes[0]?.total || 0,
        pages: Math.ceil((countRes[0]?.total || 0) / limit),
      },
      pipeline,
    })
  } catch (error) {
    console.error('GET /api/agent-hub/permits error:', error)
    return NextResponse.json({ error: 'Failed to fetch permits' }, { status: 500 })
  }
}

/**
 * POST /api/agent-hub/permits/import
 * Import permits — either single or batch.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const permits = Array.isArray(body) ? body : [body]
    const imported: any[] = []

    for (const permit of permits) {
      const { permitNumber, address, city, county, state, builderName, projectType, estimatedValue, filingDate, source } = permit

      if (!address) continue

      // Check for duplicate by address + permitNumber
      const existing: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id" FROM "PermitLead"
        WHERE "address" = $1 ${permitNumber ? `AND "permitNumber" = $2` : ''}
        LIMIT 1
      `, address, ...(permitNumber ? [permitNumber] : []))

      if (existing.length > 0) continue

      const id = `pmt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      // Try to match builder name to existing builders
      let matchedBuilderId: string | null = null
      let builderFound = false
      if (builderName) {
        const match: any[] = await prisma.$queryRawUnsafe(`
          SELECT "id" FROM "Builder"
          WHERE "companyName" ILIKE $1 OR "companyName" ILIKE $2
          LIMIT 1
        `, builderName, `%${builderName}%`)

        if (match.length > 0) {
          matchedBuilderId = match[0].id
          builderFound = true
        }
      }

      await prisma.$executeRawUnsafe(`
        INSERT INTO "PermitLead" (
          "id", "permitNumber", "address", "city", "county", "state",
          "builderName", "builderFound", "matchedBuilderId",
          "projectType", "estimatedValue", "filingDate", "source",
          "status", "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
      `,
        id,
        permitNumber || null,
        address,
        city || null,
        county || null,
        state || 'TX',
        builderName || null,
        builderFound,
        matchedBuilderId,
        projectType || 'RESIDENTIAL',
        estimatedValue || 0,
        filingDate ? new Date(filingDate) : null,
        source || 'MANUAL',
        builderFound ? 'RESEARCHED' : 'NEW'
      )

      imported.push({ id, address, builderName, builderFound, matchedBuilderId, status: builderFound ? 'RESEARCHED' : 'NEW' })
    }

    return NextResponse.json({
      message: `Imported ${imported.length} permits`,
      imported,
      skipped: permits.length - imported.length,
    }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/permits error:', error)
    return NextResponse.json({ error: 'Failed to import permits' }, { status: 500 })
  }
}
