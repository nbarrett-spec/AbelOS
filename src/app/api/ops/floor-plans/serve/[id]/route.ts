export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import path from 'path'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

const MIME_TYPES: Record<string, string> = {
  'application/pdf': 'application/pdf',
  'image/png': 'image/png',
  'image/jpeg': 'image/jpeg',
  'image/tiff': 'image/tiff',
  'image/webp': 'image/webp',
}

// GET /api/ops/floor-plans/serve/[id] — Serve the floor plan file
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const results: any[] = await prisma.$queryRawUnsafe(
      `SELECT "fileUrl", "fileType", "fileName" FROM "FloorPlan" WHERE "id" = $1 AND "active" = true`,
      params.id
    )

    if (results.length === 0) {
      return safeJson({ error: 'Floor plan not found' }, { status: 404 })
    }

    const { fileUrl, fileType, fileName } = results[0]

    // fileUrl is like /uploads/floor-plans/builderId/projectId/timestamp_filename.ext
    const filePath = path.join(process.cwd(), fileUrl)

    try {
      const fileBuffer = await readFile(filePath)
      const contentType = MIME_TYPES[fileType] || 'application/octet-stream'

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Disposition': `inline; filename="${fileName}"`,
          'Cache-Control': 'private, max-age=3600',
        },
      })
    } catch {
      return safeJson({ error: 'File not found on disk' }, { status: 404 })
    }
  } catch (error: any) {
    console.error('Floor plan serve error:', error)
    return safeJson({ error: error.message }, { status: 500 })
  }
}
