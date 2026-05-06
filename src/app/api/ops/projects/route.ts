/**
 * GET /api/ops/projects — list Projects, optionally filtered by builder
 *
 * Created 2026-05-06 to back the builder-pre-fill flow on /ops/quotes/new
 * (Agent B BUG-17 wiring). The page calls `/api/ops/projects?builderId=X`
 * to populate the project dropdown after a builder is pre-selected.
 *
 * Query params:
 *   - builderId   filter to one builder (string, optional)
 *   - status      filter to one ProjectStatus enum value (optional)
 *   - search      ILIKE on name / jobAddress / lotNumber / planName (optional)
 *   - limit       default 50, max 500
 *
 * Response: { projects: Project[], pagination: { limit, total } }
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  try {
    const authError = checkStaffAuth(request)
    if (authError) return authError

    const url = new URL(request.url)
    const builderId = url.searchParams.get('builderId')?.trim() || undefined
    const status = url.searchParams.get('status')?.trim() || undefined
    const search = url.searchParams.get('search')?.trim() || undefined
    const limitRaw = parseInt(url.searchParams.get('limit') || '50', 10)
    const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 50, 1), 500)

    const where: any = {}
    if (builderId) where.builderId = builderId
    if (status) where.status = status
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { jobAddress: { contains: search, mode: 'insensitive' } },
        { lotNumber: { contains: search, mode: 'insensitive' } },
        { planName: { contains: search, mode: 'insensitive' } },
        { subdivision: { contains: search, mode: 'insensitive' } },
      ]
    }

    const [projects, total] = await Promise.all([
      prisma.project.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        take: limit,
        select: {
          id: true,
          builderId: true,
          name: true,
          jobAddress: true,
          city: true,
          state: true,
          lotNumber: true,
          subdivision: true,
          planName: true,
          sqFootage: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          builder: { select: { id: true, companyName: true } },
        },
      }),
      prisma.project.count({ where }),
    ])

    return NextResponse.json({
      projects,
      pagination: { limit, total },
    })
  } catch (err: any) {
    console.error('GET /api/ops/projects error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
