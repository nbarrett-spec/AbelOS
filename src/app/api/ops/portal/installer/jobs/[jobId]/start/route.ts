export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/portal/installer/jobs/[jobId]/start
// Transitions Job → INSTALLING and stamps Job.actualDate as the install-start
// timestamp. Creates an Installation row if one doesn't exist (so we have a
// stable anchor for startedAt, photos, and completion).
// ──────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "status"::text AS "status" FROM "Job" WHERE "id" = $1`,
      jobId,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const current = rows[0]

    // Idempotent: if already INSTALLING, return current state.
    if (current.status !== 'INSTALLING') {
      try {
        requireValidTransition('job', current.status, 'INSTALLING')
      } catch (e) {
        const res = transitionErrorResponse(e)
        if (res) return res
        throw e
      }
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
         SET "status" = 'INSTALLING'::"JobStatus",
             "actualDate" = COALESCE("actualDate", NOW()),
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        jobId,
      )
    }

    // Ensure an Installation row exists so we can anchor startedAt + photos
    try {
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "startedAt" FROM "Installation" WHERE "jobId" = $1 LIMIT 1`,
        jobId,
      )
      if (existing.length === 0) {
        const insCount: any[] = await prisma.$queryRawUnsafe(
          `SELECT COUNT(*)::int AS c FROM "Installation"`,
        )
        const seq = (insCount[0]?.c || 0) + 1
        const installNumber = `INS-${new Date().getFullYear()}-${String(seq).padStart(4, '0')}`
        const id = 'ins' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Installation"
           ("id","jobId","installNumber","status","startedAt","beforePhotos","afterPhotos","createdAt","updatedAt")
           VALUES ($1,$2,$3,'IN_PROGRESS'::"InstallationStatus",NOW(),'{}','{}',NOW(),NOW())`,
          id, jobId, installNumber,
        )
      } else if (!existing[0].startedAt) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Installation"
           SET "status" = 'IN_PROGRESS'::"InstallationStatus",
               "startedAt" = NOW(),
               "updatedAt" = NOW()
           WHERE "id" = $1`,
          existing[0].id,
        )
      }
    } catch (e: any) {
      console.warn('[installer/start] installation upsert failed:', e?.message)
    }

    await audit(request, 'INSTALL_START', 'Job', jobId, { previousStatus: current.status })

    return NextResponse.json({ ok: true, status: 'INSTALLING' })
  } catch (error: any) {
    console.error('[installer/start] error:', error?.message)
    return NextResponse.json({ error: 'Failed to start install' }, { status: 500 })
  }
}
