export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { analyzeBlueprint } from '@/lib/blueprint-ai'
import { audit } from '@/lib/audit'

/**
 * POST /api/blueprints/[id]/analyze
 *
 * Trigger AI analysis on a blueprint the builder has uploaded.
 * This is the customer-facing equivalent of /api/ops/blueprints/analyze.
 * Builder auth required — verifies ownership.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    audit(request, 'CREATE', 'BlueprintAnalysis', params.id).catch(() => {});

    // Fetch blueprint and verify ownership
    const blueprint = await prisma.blueprint.findUnique({
      where: { id: params.id },
      include: {
        project: { select: { id: true, builderId: true } },
      },
    })

    if (!blueprint) {
      return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
    }

    if (blueprint.project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Check for Anthropic API key before doing anything else
    if (!process.env.ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: 'AI analysis is not configured. Please contact support.' },
        { status: 503 }
      )
    }

    // Don't re-analyze if already complete — return cached result if available
    if (blueprint.processingStatus === 'COMPLETE') {
      // Try to return the stored analysis from rawAnalysis field
      const existingTakeoffs: any[] = await prisma.$queryRawUnsafe(
        `SELECT "rawResult" FROM "Takeoff" WHERE "blueprintId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
        blueprint.id
      )
      return NextResponse.json({
        message: 'Blueprint already analyzed',
        blueprintId: blueprint.id,
        status: 'COMPLETE',
        analysis: existingTakeoffs[0]?.rawResult || null,
      })
    }

    // Mark as processing
    await prisma.blueprint.update({
      where: { id: params.id },
      data: { processingStatus: 'PROCESSING' },
    })

    // Fetch the blueprint file and convert to base64
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 30000)
      const fileResponse = await fetch(blueprint.fileUrl, {
        signal: controller.signal,
      })
      clearTimeout(timeoutId)

      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch blueprint file: ${fileResponse.status}`)
      }

      const arrayBuffer = await fileResponse.arrayBuffer()
      const base64 = Buffer.from(arrayBuffer).toString('base64')
      const mediaType =
        blueprint.fileType === 'pdf' ? 'application/pdf' : `image/${blueprint.fileType}`

      // Run AI analysis
      const result = await analyzeBlueprint({
        type: 'base64',
        data: base64,
        mediaType,
      })

      if (result.error) {
        await prisma.blueprint.update({
          where: { id: params.id },
          data: { processingStatus: 'FAILED' },
        })
        return NextResponse.json(
          { error: `Analysis failed: ${result.error}` },
          { status: 500 }
        )
      }

      // Update blueprint status
      await prisma.blueprint.update({
        where: { id: params.id },
        data: {
          processingStatus: 'COMPLETE',
          processedAt: new Date(),
        },
      })

      return NextResponse.json({
        blueprintId: params.id,
        analysis: result.analysis,
        status: 'COMPLETE',
        timestamp: new Date().toISOString(),
      })
    } catch (fetchError: any) {
      // If the file can't be fetched (e.g. local upload path), read from disk
      const fs = await import('fs/promises')
      const path = await import('path')

      try {
        const filePath = path.join(process.cwd(), blueprint.fileUrl)
        const fileBuffer = await fs.readFile(filePath)
        const base64 = fileBuffer.toString('base64')
        const mediaType =
          blueprint.fileType === 'pdf' ? 'application/pdf' : `image/${blueprint.fileType}`

        const result = await analyzeBlueprint({
          type: 'base64',
          data: base64,
          mediaType,
        })

        if (result.error) {
          await prisma.blueprint.update({
            where: { id: params.id },
            data: { processingStatus: 'FAILED' },
          })
          return NextResponse.json(
            { error: `Analysis failed: ${result.error}` },
            { status: 500 }
          )
        }

        await prisma.blueprint.update({
          where: { id: params.id },
          data: {
            processingStatus: 'COMPLETE',
            processedAt: new Date(),
          },
        })

        return NextResponse.json({
          blueprintId: params.id,
          analysis: result.analysis,
          status: 'COMPLETE',
          timestamp: new Date().toISOString(),
        })
      } catch (diskError: any) {
        await prisma.blueprint.update({
          where: { id: params.id },
          data: { processingStatus: 'FAILED' },
        })
        return NextResponse.json(
          { error: `Could not read blueprint file: ${diskError.message}` },
          { status: 500 }
        )
      }
    }
  } catch (error: any) {
    console.error('POST /api/blueprints/[id]/analyze error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
