export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface FileUploadRequest {
  file: File
  notes?: string
}

/**
 * Extract page count from a PDF buffer by scanning for /Count entries
 * in the page tree. Falls back to counting /Type /Page occurrences.
 */
function extractPdfPageCount(buffer: Buffer): number {
  const text = buffer.toString('latin1')

  // Method 1: Look for /Type /Pages with /Count N (the page tree root)
  // Match patterns like "/Type /Pages ... /Count 12" or "/Type/Pages.../Count 12"
  const pagesPattern = /\/Type\s*\/Pages[^>]*\/Count\s+(\d+)/g
  let maxCount = 0
  let match: RegExpExecArray | null
  while ((match = pagesPattern.exec(text)) !== null) {
    const count = parseInt(match[1], 10)
    if (count > maxCount) maxCount = count
  }

  if (maxCount > 0) return maxCount

  // Method 2: Count individual /Type /Page occurrences (not /Pages)
  const pageMatches = text.match(/\/Type\s*\/Page(?!\s*s)\b/g)
  if (pageMatches && pageMatches.length > 0) return pageMatches.length

  // Fallback: assume at least 1 page
  return 1
}

/**
 * GET /api/projects/[id]/blueprints
 *
 * List all blueprints for a project
 * Builder auth required.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { builderId: true },
    })

    if (!project || project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    const blueprints = await prisma.blueprint.findMany({
      where: { projectId },
      select: {
        id: true,
        fileName: true,
        fileSize: true,
        fileType: true,
        createdAt: true,
        processedAt: true,
        processingStatus: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    // Map processing status to display status
    const mappedBlueprints = blueprints.map((bp) => ({
      id: bp.id,
      fileName: bp.fileName,
      fileSize: bp.fileSize,
      fileType: bp.fileType,
      uploadedAt: bp.createdAt.toISOString(),
      processedAt: bp.processedAt?.toISOString(),
      status: mapProcessingStatus(bp.processingStatus),
    }))

    return NextResponse.json({
      blueprints: mappedBlueprints,
      count: blueprints.length,
    })
  } catch (error: any) {
    console.error('GET /api/projects/[id]/blueprints error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * POST /api/projects/[id]/blueprints
 *
 * Upload a new blueprint for a project
 * Builder auth required.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const projectId = params.id
    const formData = await request.formData()
    const file = formData.get('file') as File | null
    const notes = formData.get('notes') as string | null

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    }

    // Validate project access
    const project = await prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true, builderId: true },
    })

    if (!project || project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Validate file type
    const validTypes = ['image/png', 'image/jpeg', 'application/pdf']
    if (!validTypes.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type' }, { status: 400 })
    }

    // Check file size (max 50MB)
    if (file.size > 50 * 1024 * 1024) {
      return NextResponse.json({ error: 'File too large (max 50MB)' }, { status: 400 })
    }

    // Upload file to cloud storage (e.g., S3, R2, etc.)
    // For now, we'll assume file is stored and return a URL
    // In production, integrate with your storage service
    const fileBuffer = Buffer.from(await file.arrayBuffer())
    const base64Data = fileBuffer.toString('base64')

    // Generate a temporary/persistent URL for the file
    // This would typically be done by your storage provider
    const fileUrl = `data:${file.type};base64,${base64Data.substring(0, 100)}...` // Placeholder

    // Extract page count for PDFs
    const isPdf = file.type === 'application/pdf'
    const pageCount = isPdf ? extractPdfPageCount(fileBuffer) : 1

    // Create blueprint record in DB
    const blueprint = await prisma.blueprint.create({
      data: {
        projectId,
        fileName: file.name,
        fileUrl,
        fileSize: file.size,
        fileType: isPdf ? 'pdf' : file.name.endsWith('.png') ? 'png' : 'jpg',
        processingStatus: 'PENDING',
        pageCount,
      },
    })

    // Update project status if needed
    await prisma.project.update({
      where: { id: projectId },
      data: {
        status: 'BLUEPRINT_UPLOADED',
      },
    })

    return NextResponse.json({
      blueprint: {
        id: blueprint.id,
        fileName: blueprint.fileName,
        fileSize: blueprint.fileSize,
        fileType: blueprint.fileType,
        uploadedAt: blueprint.createdAt.toISOString(),
        status: 'UPLOADED',
      },
    })
  } catch (error: any) {
    console.error('POST /api/projects/[id]/blueprints error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Map ProcessingStatus enum to display status
 */
function mapProcessingStatus(status: string): string {
  switch (status) {
    case 'PENDING':
      return 'UPLOADED'
    case 'PROCESSING':
      return 'PROCESSING'
    case 'COMPLETE':
      return 'READY'
    case 'FAILED':
      return 'UPLOADED' // Show as uploaded with error in separate field
    default:
      return 'UPLOADED'
  }
}
