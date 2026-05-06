// /api/admin/prospects — list view backing the /admin/prospects page.
//
// Returns a paginated, filterable list of Prospects with their enrichment
// metadata. Used by Dalton (SALES_REP) to triage outreach and by Nate to
// review enrichment health.
//
// Query params:
//   q            — case-insensitive match against companyName, contactName,
//                  email, founderName, domain
//   confidence   — CONFIRMED | LIKELY | UNVERIFIED  (filters by enrichmentConfidence)
//   status       — Prospect.status (NEW | IN_PROGRESS | CONVERTED | DEAD ...)
//   limit        — page size (default 50, max 200)
//   offset       — pagination offset
//
// New Prospect enrichment columns + the PitchContext / PitchRun joins are
// not in the generated Prisma client yet, so this route uses raw SQL.
//
// Auth: SALES_REP+ (ADMIN auto-allowed via requireStaffAuth's role union).

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

interface ProspectRow {
  id: string
  companyName: string
  contactName: string | null
  email: string | null
  phone: string | null
  city: string | null
  state: string | null
  status: string
  domain: string | null
  founderName: string | null
  emailPattern: string | null
  enrichmentRunAt: Date | null
  enrichmentConfidence: string | null
  enrichmentSourceUrls: string[] | null
  bouncedAt: Date | null
  icpTier: string | null
  estimatedAnnualVolume: string | number | null
  createdAt: Date | null
  updatedAt: Date | null
  pitchRunCount: number
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error

  try {
    const url = new URL(request.url)
    const q = (url.searchParams.get('q') || '').trim()
    const confidence = url.searchParams.get('confidence') || ''
    const status = url.searchParams.get('status') || ''
    const limit = Math.min(
      Math.max(parseInt(url.searchParams.get('limit') || '50', 10) || 50, 1),
      200
    )
    const offset = Math.max(
      parseInt(url.searchParams.get('offset') || '0', 10) || 0,
      0
    )

    const conditions: string[] = []
    const params: any[] = []
    let p = 1

    if (q) {
      conditions.push(
        `(p."companyName" ILIKE $${p} OR p."contactName" ILIKE $${p} OR p.email ILIKE $${p} OR p."founderName" ILIKE $${p} OR p.domain ILIKE $${p})`
      )
      params.push(`%${q}%`)
      p++
    }
    if (confidence) {
      // Allow "NULL" sentinel to filter for not-yet-enriched rows
      if (confidence === 'NULL') {
        conditions.push(`p."enrichmentConfidence" IS NULL`)
      } else {
        conditions.push(`p."enrichmentConfidence" = $${p}`)
        params.push(confidence)
        p++
      }
    }
    if (status) {
      conditions.push(`p.status = $${p}`)
      params.push(status)
      p++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const totalResult = await prisma.$queryRawUnsafe<Array<{ total: number }>>(
      `SELECT COUNT(*)::int AS total FROM "Prospect" p ${where}`,
      ...params
    )
    const total = totalResult[0]?.total || 0

    const rows = await prisma.$queryRawUnsafe<ProspectRow[]>(
      `SELECT
         p.id,
         p."companyName",
         p."contactName",
         p.email,
         p.phone,
         p.city,
         p.state,
         p.status,
         p.domain,
         p."founderName",
         p."emailPattern",
         p."enrichmentRunAt",
         p."enrichmentConfidence",
         p."enrichmentSourceUrls",
         p."bouncedAt",
         p."icpTier",
         p."estimatedAnnualVolume",
         p."createdAt",
         p."updatedAt",
         COALESCE((SELECT COUNT(*)::int FROM "PitchRun" pr WHERE pr."prospectId" = p.id), 0) AS "pitchRunCount"
       FROM "Prospect" p
       ${where}
       ORDER BY p."enrichmentRunAt" DESC NULLS LAST, p."createdAt" DESC
       LIMIT ${limit} OFFSET ${offset}`,
      ...params
    )

    return NextResponse.json({
      prospects: rows.map((r) => ({
        ...r,
        estimatedAnnualVolume:
          r.estimatedAnnualVolume == null ? null : Number(r.estimatedAnnualVolume),
      })),
      total,
      limit,
      offset,
      page: Math.floor(offset / limit) + 1,
    })
  } catch (error: any) {
    console.error('[Admin Prospects GET]', error?.message || error)
    return NextResponse.json(
      { error: 'Failed to load prospects' },
      { status: 500 }
    )
  }
}
