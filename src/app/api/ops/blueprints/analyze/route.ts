export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { analyzeBlueprint, BlueprintAnalysis } from '@/lib/blueprint-ai'
import { audit } from '@/lib/audit'

interface AnalyzeRequest {
  blueprintId?: string
  imageBase64?: string
  mediaType?: string
}

/**
 * POST /api/ops/blueprints/analyze
 *
 * Analyze a blueprint using Claude Vision API
 * Accepts either blueprintId (looks up existing blueprint) or inline image data
 *
 * Staff auth required.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Blueprints', undefined, { method: 'POST' }).catch(() => {})

    const body: AnalyzeRequest = await request.json()

    if (!body.blueprintId && (!body.imageBase64 || !body.mediaType)) {
      return NextResponse.json(
        { error: 'Must provide either blueprintId or imageBase64 + mediaType' },
        { status: 400 }
      )
    }

    let analysis: BlueprintAnalysis | null = null
    let blueprintRecord: any = null

    // If blueprintId provided, fetch blueprint from DB and analyze
    if (body.blueprintId) {
      blueprintRecord = await prisma.blueprint.findUnique({
        where: { id: body.blueprintId },
        include: { project: true },
      })

      if (!blueprintRecord) {
        return NextResponse.json({ error: 'Blueprint not found' }, { status: 404 })
      }

      // Update status to PROCESSING
      await prisma.blueprint.update({
        where: { id: body.blueprintId },
        data: { processingStatus: 'PROCESSING' },
      })

      // Fetch blueprint file from URL
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 30000)
        const fileResponse = await fetch(blueprintRecord.fileUrl, {
          signal: controller.signal,
        })
        clearTimeout(timeoutId)
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch blueprint: ${fileResponse.status}`)
        }

        const arrayBuffer = await fileResponse.arrayBuffer()
        const base64 = Buffer.from(arrayBuffer).toString('base64')
        const mediaType = blueprintRecord.fileType === 'pdf' ? 'application/pdf' : 'image/jpeg'

        const result = await analyzeBlueprint({
          type: 'base64',
          data: base64,
          mediaType,
        })

        if (result.error) {
          // Update status to FAILED
          await prisma.blueprint.update({
            where: { id: body.blueprintId },
            data: {
              processingStatus: 'FAILED',
            },
          })
          return NextResponse.json({ error: result.error }, { status: 500 })
        }

        analysis = result.analysis
      } catch (error: any) {
        await prisma.blueprint.update({
          where: { id: body.blueprintId },
          data: { processingStatus: 'FAILED' },
        })
        return NextResponse.json(
          { error: 'Internal server error' },
          { status: 500 }
        )
      }
    } else {
      // Analyze provided image directly
      const result = await analyzeBlueprint({
        type: 'base64',
        data: body.imageBase64!,
        mediaType: body.mediaType!,
      })

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 500 })
      }

      analysis = result.analysis
    }

    // If we have a blueprint record, update it with analysis results
    if (blueprintRecord) {
      await prisma.blueprint.update({
        where: { id: body.blueprintId! },
        data: {
          processingStatus: 'COMPLETE',
          processedAt: new Date(),
        },
      })
    }

    return NextResponse.json({
      analysis,
      blueprintId: body.blueprintId,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    console.error('POST /api/ops/blueprints/analyze error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
