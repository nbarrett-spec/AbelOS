export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

/**
 * GET /api/blueprints
 *
 * List all blueprints & takeoffs for the authenticated builder.
 * Spans all projects. Returns blueprints with their latest takeoff status.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status') // PENDING | PROCESSING | COMPLETE | FAILED
    const projectId = searchParams.get('projectId')
    const page = parseInt(searchParams.get('page') || '1')
    const pageSize = parseInt(searchParams.get('pageSize') || '20')

    // Build where clause — only this builder's projects
    const where: any = {
      project: { builderId: session.builderId },
    }
    if (status) where.processingStatus = status
    if (projectId) where.projectId = projectId

    const [blueprints, total] = await Promise.all([
      prisma.blueprint.findMany({
        where,
        include: {
          project: {
            select: { id: true, name: true, jobAddress: true },
          },
          takeoffs: {
            select: {
              id: true,
              status: true,
              confidence: true,
              createdAt: true,
              _count: { select: { items: true } },
            },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.blueprint.count({ where }),
    ])

    const mapped = blueprints.map((bp: any) => {
      const latestTakeoff = bp.takeoffs?.[0] || null
      return {
        id: bp.id,
        fileName: bp.fileName,
        fileUrl: bp.fileUrl,
        fileSize: bp.fileSize,
        fileType: bp.fileType,
        pageCount: bp.pageCount,
        processingStatus: bp.processingStatus,
        processedAt: bp.processedAt?.toISOString() || null,
        createdAt: bp.createdAt.toISOString(),
        project: {
          id: bp.project.id,
          name: bp.project.name,
          address: bp.project.jobAddress || '',
        },
        takeoff: latestTakeoff
          ? {
              id: latestTakeoff.id,
              status: latestTakeoff.status,
              confidence: latestTakeoff.confidence,
              itemCount: latestTakeoff._count?.items || 0,
              createdAt: latestTakeoff.createdAt.toISOString(),
            }
          : null,
      }
    })

    return NextResponse.json({
      blueprints: mapped,
      total,
      page,
      pageSize,
      hasMore: page * pageSize < total,
    })
  } catch (error: any) {
    console.error('GET /api/blueprints error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
