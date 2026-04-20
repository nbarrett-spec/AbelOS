export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ────────────────────────────────────────────────────────────────────────────
// Data Quality Dashboard API
// GET: dashboard data, rules, recent issues
// POST: create custom rule
// PATCH: update issue status
// ────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const entityFilter = searchParams.get('entity')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = parseInt(searchParams.get('limit') || '20', 10)
    const offset = (page - 1) * limit

    // Summary stats via raw SQL
    const totalRulesResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "DataQualityRule" WHERE "isActive" = true`
    )
    const totalRules = totalRulesResult[0]?.count || 0

    const totalOpenResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "DataQualityIssue" WHERE status = 'OPEN'`
    )
    const totalOpen = totalOpenResult[0]?.count || 0

    // Severity counts by joining issues to rules
    const severityCounts = await prisma.$queryRawUnsafe<Array<{ severity: string; count: number }>>(
      `SELECT r.severity, COUNT(i.id)::int AS count
       FROM "DataQualityIssue" i
       JOIN "DataQualityRule" r ON i."ruleId" = r.id
       WHERE i.status = 'OPEN'
       GROUP BY r.severity`
    )
    const criticalCount = severityCounts.find((s: any) => s.severity === 'CRITICAL')?.count || 0
    const warningCount = severityCounts.find((s: any) => s.severity === 'WARNING')?.count || 0
    const infoCount = severityCounts.find((s: any) => s.severity === 'INFO')?.count || 0

    // Auto-fixed last 7d
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
    const autoFixedResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
      `SELECT COUNT(*)::int AS count FROM "DataQualityIssue" WHERE status = 'FIXED' AND "fixedAt" >= $1`,
      sevenDaysAgo
    )
    const autoFixedLast7d = autoFixedResult[0]?.count || 0

    // Health score: 100 - (critical*10 + warning*3 + info*1)
    const healthScore = Math.max(0, 100 - (criticalCount * 10 + warningCount * 3 + infoCount * 1))

    // Rules with issue counts
    const rules = await prisma.$queryRawUnsafe<any[]>(
      `SELECT r.*,
              COALESCE(ic.open_count, 0)::int AS "openIssuesCount"
       FROM "DataQualityRule" r
       LEFT JOIN (
         SELECT "ruleId", COUNT(*)::int AS open_count
         FROM "DataQualityIssue"
         WHERE status = 'OPEN'
         GROUP BY "ruleId"
       ) ic ON ic."ruleId" = r.id
       WHERE r."isActive" = true
       ORDER BY r."createdAt"`
    )

    // Recent issues with pagination
    const entityWhere = entityFilter ? `AND i."entityType" = '${entityFilter.replace(/'/g, "''")}'` : ''
    const issues = await prisma.$queryRawUnsafe<any[]>(
      `SELECT i.*, r.name AS "ruleName", r.severity AS "ruleSeverity", r.entity AS "ruleEntity"
       FROM "DataQualityIssue" i
       JOIN "DataQualityRule" r ON i."ruleId" = r.id
       WHERE i.status = 'OPEN' ${entityWhere}
       ORDER BY i."createdAt" DESC
       LIMIT $1 OFFSET $2`,
      limit, offset
    )

    const totalForFilter = entityFilter
      ? (await prisma.$queryRawUnsafe<Array<{ count: number }>>(
          `SELECT COUNT(*)::int AS count FROM "DataQualityIssue" WHERE status = 'OPEN' AND "entityType" = $1`,
          entityFilter
        ))[0]?.count || 0
      : totalOpen

    return NextResponse.json({
      summary: {
        totalRules,
        criticalIssues: criticalCount,
        warningIssues: warningCount,
        infoIssues: infoCount,
        autoFixedLast7d,
        healthScore,
      },
      rules,
      issues,
      pagination: {
        page,
        limit,
        total: totalForFilter,
        pages: Math.ceil(totalForFilter / limit),
      },
    })
  } catch (error: any) {
    console.error('[data-quality] GET error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to load data quality' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { name, description, entity, severity, query, fixUrl } = body

    if (!name || !entity || !query) {
      return NextResponse.json(
        { error: 'Missing required fields: name, entity, query' },
        { status: 400 }
      )
    }

    const id = `dqr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "DataQualityRule" (id, name, description, entity, severity, query, "fixUrl", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $8)`,
      id, name, description || null, entity, severity || 'WARNING', query, fixUrl || null, now
    )

    audit(request, 'CREATE', 'DataQualityRule', id, { name })

    return NextResponse.json({ id, name, entity, severity: severity || 'WARNING' }, { status: 201 })
  } catch (error: any) {
    console.error('[data-quality] POST error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to create rule' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { issueId, status, notes } = body

    if (!issueId || !status) {
      return NextResponse.json({ error: 'Missing issueId or status' }, { status: 400 })
    }

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, status FROM "DataQualityIssue" WHERE id = $1`, issueId
    )
    if (!existing.length) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    }

    const now = new Date().toISOString()
    const fixedAt = status === 'FIXED' ? now : null

    await prisma.$executeRawUnsafe(
      `UPDATE "DataQualityIssue" SET status = $1, "fixedAt" = $2 WHERE id = $3`,
      status, fixedAt, issueId
    )

    audit(request, 'UPDATE', 'DataQualityIssue', issueId, { oldStatus: existing[0].status, newStatus: status, notes })

    return NextResponse.json({ id: issueId, status, fixedAt })
  } catch (error: any) {
    console.error('[data-quality] PATCH error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to update issue' }, { status: 500 })
  }
}
