export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/inspections/[id]/photos
 *
 * Accepts base64 data URLs (for now) and stores them on Inspection.photos
 * (JSONB array). Object storage upgrade is tracked in the roadmap — this
 * is the simplest path that unblocks the queue UI and evidence capture.
 *
 * Body: { photos: string[] }  // array of data URLs, raw URLs, or base64 blobs
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const incoming: string[] = Array.isArray(body.photos) ? body.photos : []

    if (incoming.length === 0) {
      return NextResponse.json({ error: 'photos array required' }, { status: 400 })
    }

    // Size guard — keep the row sane.
    const MAX_PHOTOS = 20
    const MAX_BYTES = 8 * 1024 * 1024 // 8 MB per payload
    const totalBytes = incoming.reduce((n, s) => n + s.length, 0)
    if (totalBytes > MAX_BYTES) {
      return NextResponse.json(
        { error: `photo payload too large (${totalBytes} bytes > ${MAX_BYTES})` },
        { status: 413 }
      )
    }

    // Merge onto existing photos array.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "photos" FROM "Inspection" WHERE id = $1`,
      params.id
    )
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    const current: string[] = Array.isArray(existing[0].photos) ? existing[0].photos : []
    const merged = [...current, ...incoming].slice(-MAX_PHOTOS)

    await prisma.$executeRawUnsafe(
      `UPDATE "Inspection"
       SET "photos" = $1::jsonb, "updatedAt" = NOW()
       WHERE id = $2`,
      JSON.stringify(merged),
      params.id
    )

    await audit(request, 'UPLOAD_PHOTOS', 'Inspection', params.id, {
      added: incoming.length,
      total: merged.length,
    })

    return NextResponse.json({ photos: merged, added: incoming.length })
  } catch (error: any) {
    console.error('[Inspection photos POST]', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
