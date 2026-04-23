export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/portal/installer/jobs/[jobId]/photos
// Body: { photos: string[], phase?: 'before' | 'during' | 'after' }
//
// Accepts data URLs or storage URLs. Appends to Installation.beforePhotos
// (phase=before, default) or Installation.afterPhotos (phase=after|during).
// No JobPhoto table exists, so we persist on the Installation row — creating
// one if the job doesn't have one yet.
// ──────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  let body: { photos?: unknown; phase?: string } = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const photos = Array.isArray(body.photos)
    ? (body.photos as unknown[]).filter((p): p is string => typeof p === 'string' && p.length > 0)
    : []
  if (photos.length === 0) {
    return NextResponse.json({ error: 'No photos provided' }, { status: 400 })
  }
  const column = body.phase === 'after' || body.phase === 'during' ? 'afterPhotos' : 'beforePhotos'

  try {
    const exists: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Job" WHERE "id" = $1`, jobId,
    )
    if (exists.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    let installationId: string | null = null
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Installation" WHERE "jobId" = $1 LIMIT 1`,
      jobId,
    )
    if (rows.length > 0) {
      installationId = rows[0].id
    } else {
      const insCount: any[] = await prisma.$queryRawUnsafe(
        `SELECT COUNT(*)::int AS c FROM "Installation"`,
      )
      const seq = (insCount[0]?.c || 0) + 1
      const installNumber = `INS-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`
      installationId = 'ins' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Installation"
         ("id","jobId","installNumber","status","beforePhotos","afterPhotos","createdAt","updatedAt")
         VALUES ($1,$2,$3,'IN_PROGRESS'::"InstallationStatus','{}','{}',NOW(),NOW())`,
        installationId, jobId, installNumber,
      )
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "Installation"
       SET "${column}" = COALESCE("${column}",'{}') || $2::text[],
           "updatedAt" = NOW()
       WHERE "id" = $1`,
      installationId, photos,
    )

    await audit(request, 'INSTALL_PHOTO', 'Job', jobId, {
      phase: column,
      count: photos.length,
    })

    return NextResponse.json({ ok: true, stored: photos.length, installationId, phase: column })
  } catch (error: any) {
    console.error('[installer/photos] error:', error?.message)
    return NextResponse.json({ error: 'Failed to store photos' }, { status: 500 })
  }
}
