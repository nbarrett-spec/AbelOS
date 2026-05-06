export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { auditBuilder } from '@/lib/audit'

/**
 * POST /api/builders/warranty/[claimId]/photos
 *
 * Accepts base64 data-URL photos and appends them to
 * WarrantyClaim.photoUrls (JSONB array).  Object-storage is roadmapped;
 * this is the simplest path that unblocks the builder portal evidence
 * capture flow without standing up a vault component for warranty.
 *
 * Mirrors /api/ops/inspections/[id]/photos in shape and guards.
 *
 * Auth: builder cookie (abel_session). The claim row must belong to the
 * authenticated builder — otherwise 404 (no info leak).
 *
 * Body: { photos: string[] }   // base64 data URLs or raw URLs
 *
 * Response: { photos, added, total }
 */
const MAX_PHOTOS = 20
const MAX_BYTES = 8 * 1024 * 1024 // 8 MB total payload

export async function POST(
  request: NextRequest,
  { params }: { params: { claimId: string } },
) {
  try {
    const session = await getSession()
    const builderId = session?.builderId
    if (!builderId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const claimId = params.claimId
    if (!claimId) {
      return NextResponse.json({ error: 'Claim id required' }, { status: 400 })
    }

    const body = await request.json().catch(() => ({}))
    const incoming: string[] = Array.isArray(body?.photos)
      ? body.photos.filter((s: any) => typeof s === 'string' && s.length > 0)
      : []
    if (incoming.length === 0) {
      return NextResponse.json({ error: 'photos array required' }, { status: 400 })
    }

    const totalBytes = incoming.reduce((n, s) => n + s.length, 0)
    if (totalBytes > MAX_BYTES) {
      return NextResponse.json(
        { error: `Photo payload too large (${totalBytes} bytes > ${MAX_BYTES})` },
        { status: 413 },
      )
    }

    // Ownership check + grab existing photos in one round trip
    const existing = (await prisma.$queryRawUnsafe(
      `SELECT "photoUrls" FROM "WarrantyClaim" WHERE "id" = $1 AND "builderId" = $2`,
      claimId,
      builderId,
    )) as any[]
    if (existing.length === 0) {
      return NextResponse.json({ error: 'Claim not found' }, { status: 404 })
    }

    const current: string[] = Array.isArray(existing[0].photoUrls)
      ? (existing[0].photoUrls as string[])
      : []
    const merged = [...current, ...incoming].slice(-MAX_PHOTOS)

    await prisma.$executeRawUnsafe(
      `UPDATE "WarrantyClaim"
       SET "photoUrls" = $1::jsonb, "updatedAt" = NOW()
       WHERE "id" = $2 AND "builderId" = $3`,
      JSON.stringify(merged),
      claimId,
      builderId,
    )

    auditBuilder(
      builderId,
      session.companyName || session.email,
      'BUILDER_UPLOAD_WARRANTY_PHOTOS',
      'WarrantyClaim',
      claimId,
      { added: incoming.length, total: merged.length },
    ).catch(() => {})

    return NextResponse.json({
      photos: merged,
      added: incoming.length,
      total: merged.length,
    })
  } catch (error: any) {
    console.error('POST /api/builders/warranty/[claimId]/photos error:', error)
    return NextResponse.json({ error: 'Failed to upload photos' }, { status: 500 })
  }
}
