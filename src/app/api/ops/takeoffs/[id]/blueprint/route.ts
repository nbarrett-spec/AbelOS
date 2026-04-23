export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/takeoffs/[id]/blueprint
 *
 * Streams the blueprint PDF/image bytes for inline preview in the takeoff
 * review UI. Reads from Blueprint.fileBase64 (scaffold path) — a prod version
 * should redirect to a signed blob URL.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
  const rows = await prisma.$queryRawUnsafe<
    { fileBase64: string | null; fileType: string; fileName: string }[]
  >(
    `SELECT b."fileBase64", b."fileType", b."fileName"
     FROM "Takeoff" t
     JOIN "Blueprint" b ON b."id" = t."blueprintId"
     WHERE t."id" = $1
     LIMIT 1`,
    params.id,
  )

  if (!rows || rows.length === 0 || !rows[0].fileBase64) {
    return NextResponse.json({ error: 'Blueprint file not found' }, { status: 404 })
  }

  const { fileBase64, fileType, fileName } = rows[0]
  const mime = mimeFor(fileType)
  const buf = Buffer.from(fileBase64, 'base64')

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Disposition': `inline; filename="${encodeURIComponent(fileName)}"`,
      'Cache-Control': 'private, max-age=300',
    },
  })
  } catch (error: any) {
    console.error('[Blueprint] Error:', error)
    return NextResponse.json({ error: 'Failed to load blueprint' }, { status: 500 })
  }
}

function mimeFor(t: string): string {
  switch (t) {
    case 'pdf':
      return 'application/pdf'
    case 'png':
      return 'image/png'
    case 'webp':
      return 'image/webp'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    default:
      return 'application/octet-stream'
  }
}
