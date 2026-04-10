export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

/**
 * GET /api/blueprints/[id]
 *
 * Get a single blueprint with its takeoff and all items.
 * Builder auth required — verifies ownership via project.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const blueprint: any = await prisma.blueprint.findUnique({
      where: { id: params.id },
      include: {
        project: {
          select: { id: true, name: true, jobAddress: true, builderId: true },
        },
        takeoffs: {
          include: {
            items: {
              include: {
                product: {
                  select: {
                    id: true,
                    name: true,
                    sku: true,
                    basePrice: true,
                    category: true,
                  },
                },
              },
              orderBy: { createdAt: 'asc' },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!blueprint) {
      return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
    }

    // Verify ownership
    if (blueprint.project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const latestTakeoff = blueprint.takeoffs?.[0] || null

    // Calculate totals for the takeoff
    let estimatedTotal = 0
    let matchedCount = 0
    let totalItems = 0

    if (latestTakeoff) {
      totalItems = latestTakeoff.items.length
      for (const item of latestTakeoff.items) {
        if (item.product) {
          matchedCount++
          estimatedTotal += item.product.basePrice * item.quantity
        }
      }
    }

    return NextResponse.json({
      blueprint: {
        id: blueprint.id,
        fileName: blueprint.fileName,
        fileUrl: blueprint.fileUrl,
        fileSize: blueprint.fileSize,
        fileType: blueprint.fileType,
        pageCount: blueprint.pageCount,
        processingStatus: blueprint.processingStatus,
        processedAt: blueprint.processedAt?.toISOString() || null,
        createdAt: blueprint.createdAt.toISOString(),
        project: {
          id: blueprint.project.id,
          name: blueprint.project.name,
          address: blueprint.project.jobAddress || '',
        },
      },
      takeoff: latestTakeoff
        ? {
            id: latestTakeoff.id,
            status: latestTakeoff.status,
            confidence: latestTakeoff.confidence,
            rawResult: latestTakeoff.rawResult,
            createdAt: latestTakeoff.createdAt.toISOString(),
            items: latestTakeoff.items.map((item: any) => ({
              id: item.id,
              category: item.category,
              description: item.description,
              location: item.location,
              quantity: item.quantity,
              confidence: item.confidence,
              aiNotes: item.aiNotes,
              overridden: item.overridden,
              product: item.product
                ? {
                    id: item.product.id,
                    name: item.product.name,
                    sku: item.product.sku,
                    basePrice: item.product.basePrice,
                    category: item.product.category,
                  }
                : null,
            })),
            totalItems,
            matchedCount,
            estimatedTotal,
          }
        : null,
    })
  } catch (error: any) {
    console.error('GET /api/blueprints/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/blueprints/[id]
 *
 * Delete a blueprint and its associated takeoffs.
 * Builder auth required.
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const blueprint: any = await prisma.blueprint.findUnique({
      where: { id: params.id },
      include: { project: { select: { builderId: true } } },
    })

    if (!blueprint) {
      return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
    }

    if (blueprint.project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    await prisma.blueprint.delete({ where: { id: params.id } })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('DELETE /api/blueprints/[id] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
