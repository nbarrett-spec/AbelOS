export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/portal/installer/jobs/[jobId]/complete
// Body:
//   {
//     signatureDataUrl?: string        // base64 PNG
//     photos?: string[]                // additional final photos (data URLs or URLs)
//     punchItems?: { title: string, description?: string, priority?: string }[]
//                                      // new punch items discovered at install
//     punchItemsResolved?: string[]    // IDs of already-open Task punch items to mark DONE
//     notes?: string
//   }
// Transitions:
//   - If any open punch items remain (or new ones created) → PUNCH_LIST
//   - Otherwise → COMPLETE
// Persists signature + photos on the Delivery row (notes + sitePhotos) and
// Installation row (afterPhotos + completedAt).
// ──────────────────────────────────────────────────────────────────────────

interface CompleteBody {
  signatureDataUrl?: string
  photos?: string[]
  punchItems?: { title: string; description?: string; priority?: string }[]
  punchItemsResolved?: string[]
  notes?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params
  if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 })

  const staffId = request.headers.get('x-staff-id') || 'system'

  let body: CompleteBody = {}
  try {
    body = await request.json()
  } catch {
    body = {}
  }

  const signature = typeof body.signatureDataUrl === 'string' ? body.signatureDataUrl : null
  const photos = Array.isArray(body.photos) ? body.photos.filter((p) => typeof p === 'string') : []
  const newPunchItems = Array.isArray(body.punchItems) ? body.punchItems : []
  const resolvedIds = Array.isArray(body.punchItemsResolved) ? body.punchItemsResolved.filter((v) => typeof v === 'string') : []
  const notes = typeof body.notes === 'string' ? body.notes : ''

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "status"::text AS "status" FROM "Job" WHERE "id" = $1`,
      jobId,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    // 1. Resolve existing punch items marked done
    if (resolvedIds.length > 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Task" SET "status" = 'DONE', "updatedAt" = NOW()
         WHERE "jobId" = $1 AND "id" = ANY($2::text[])`,
        jobId,
        resolvedIds,
      )
    }

    // 2. Create new punch items (backed by Task rows in PUNCH_LIST category)
    for (const p of newPunchItems) {
      if (!p?.title) continue
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Task" ("id","assigneeId","creatorId","jobId","title","description",
          "category","priority","status","createdAt","updatedAt")
         VALUES (gen_random_uuid()::text, $1, $1, $2, $3, $4, 'PUNCH_LIST', $5, 'TODO', NOW(), NOW())`,
        staffId,
        jobId,
        p.title,
        p.description || '',
        (p.priority || 'MEDIUM').toUpperCase(),
      ).catch((e) => { console.warn('[installer/complete] task insert failed:', e?.message) })
    }

    // 3. Count remaining open punch items for this job
    const openCountRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS c FROM "Task"
       WHERE "jobId" = $1
         AND "category" = 'PUNCH_LIST'
         AND "status" NOT IN ('DONE','CANCELLED')`,
      jobId,
    ).catch(() => [{ c: 0 }] as any[]) as any[]
    const openPunchCount = openCountRows[0]?.c ?? 0

    const nextStatus = openPunchCount > 0 ? 'PUNCH_LIST' : 'COMPLETE'

    // Guard: enforce JobStatus state machine before writing.
    const currentJobStatus: string = rows[0].status
    try {
      requireValidTransition('job', currentJobStatus, nextStatus)
    } catch (e) {
      const res = transitionErrorResponse(e)
      if (res) return res
      throw e
    }

    // 4. Update Job status
    if (nextStatus === 'COMPLETE') {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
         SET "status" = 'COMPLETE'::"JobStatus",
             "completedAt" = NOW(),
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        jobId,
      )
    } else {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
         SET "status" = 'PUNCH_LIST'::"JobStatus",
             "updatedAt" = NOW()
         WHERE "id" = $1`,
        jobId,
      )
    }

    // 5. Update or create Installation row with photos + completedAt
    try {
      const existing: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "afterPhotos" FROM "Installation" WHERE "jobId" = $1 LIMIT 1`,
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
           ("id","jobId","installNumber","status","completedAt","passedQC","beforePhotos","afterPhotos","punchItems","notes","createdAt","updatedAt")
           VALUES ($1,$2,$3,$4::"InstallationStatus",NOW(),$5,'{}',$6,$7,$8,NOW(),NOW())`,
          id, jobId, installNumber,
          nextStatus === 'COMPLETE' ? 'COMPLETE' : 'PUNCH_LIST',
          nextStatus === 'COMPLETE',
          photos,
          openPunchCount > 0 ? String(openPunchCount) : null,
          notes || null,
        )
      } else {
        await prisma.$executeRawUnsafe(
          `UPDATE "Installation"
           SET "status" = $2::"InstallationStatus",
               "completedAt" = NOW(),
               "passedQC" = $3,
               "afterPhotos" = COALESCE("afterPhotos",'{}') || $4::text[],
               "punchItems" = $5,
               "notes" = COALESCE("notes",'') || CASE WHEN $6::text <> '' THEN E'\\n' || $6::text ELSE '' END,
               "updatedAt" = NOW()
           WHERE "id" = $1`,
          existing[0].id,
          nextStatus === 'COMPLETE' ? 'COMPLETE' : 'PUNCH_LIST',
          nextStatus === 'COMPLETE',
          photos,
          openPunchCount > 0 ? String(openPunchCount) : null,
          notes || '',
        )
      }
    } catch (e: any) {
      console.warn('[installer/complete] installation persist failed:', e?.message)
    }

    // 6. Persist signature on the latest Delivery row (if any) — notes field is text
    if (signature) {
      try {
        const dels: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id", "status"::text AS "status" FROM "Delivery" WHERE "jobId" = $1
           ORDER BY "createdAt" DESC LIMIT 1`,
          jobId,
        )
        if (dels.length > 0) {
          // Guard: Delivery → COMPLETE must be a valid transition. Skip the
          // status flip (but still persist signature/photos) if disallowed.
          let flipStatus = true
          try {
            requireValidTransition('delivery', dels[0].status, 'COMPLETE')
          } catch {
            flipStatus = false
            console.warn(
              `[installer/complete] skipping Delivery→COMPLETE flip — invalid transition from ${dels[0].status}`,
            )
          }
          if (flipStatus) {
            await prisma.$executeRawUnsafe(
              `UPDATE "Delivery"
               SET "signedBy" = COALESCE("signedBy",'customer'),
                   "sitePhotos" = COALESCE("sitePhotos",'{}') || $2::text[],
                   "notes" = CASE WHEN "notes" IS NULL THEN $3::text ELSE "notes" || E'\\n' || $3::text END,
                   "completedAt" = COALESCE("completedAt", NOW()),
                   "status" = 'COMPLETE'::"DeliveryStatus",
                   "updatedAt" = NOW()
               WHERE "id" = $1`,
              dels[0].id,
              photos,
              `[INSTALL SIGNATURE] ${signature.substring(0, 160)}...`,
            )
          } else {
            // No status flip — still persist signature, photos, notes.
            await prisma.$executeRawUnsafe(
              `UPDATE "Delivery"
               SET "signedBy" = COALESCE("signedBy",'customer'),
                   "sitePhotos" = COALESCE("sitePhotos",'{}') || $2::text[],
                   "notes" = CASE WHEN "notes" IS NULL THEN $3::text ELSE "notes" || E'\\n' || $3::text END,
                   "updatedAt" = NOW()
               WHERE "id" = $1`,
              dels[0].id,
              photos,
              `[INSTALL SIGNATURE] ${signature.substring(0, 160)}...`,
            )
          }
        }
      } catch (e: any) {
        console.warn('[installer/complete] signature persist failed:', e?.message)
      }
    }

    // 7. Create a DecisionNote capturing completion summary
    try {
      const noteId = 'dn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "DecisionNote" ("id","jobId","authorId","noteType","subject","body","priority","createdAt")
         VALUES ($1,$2,$3,$4::"DecisionNoteType",$5,$6,$7::"NotePriority",NOW())`,
        noteId, jobId, staffId,
        nextStatus === 'COMPLETE' ? 'COMPLETE' : 'EXCEPTION',
        nextStatus === 'COMPLETE' ? 'Install complete' : 'Install complete — punch list open',
        [
          `Install ${nextStatus === 'COMPLETE' ? 'complete' : 'passed with punch list'}.`,
          signature ? 'Customer signature captured.' : 'No signature captured.',
          `Photos uploaded: ${photos.length}`,
          `Open punch items: ${openPunchCount}`,
          notes ? `Notes: ${notes}` : '',
        ].filter(Boolean).join('\n'),
        nextStatus === 'COMPLETE' ? 'NORMAL' : 'HIGH',
      )
    } catch (e: any) {
      console.warn('[installer/complete] decision note insert failed:', e?.message)
    }

    await audit(request, 'INSTALL_COMPLETE', 'Job', jobId, {
      nextStatus,
      openPunchCount,
      photosCount: photos.length,
      signed: !!signature,
    })

    return NextResponse.json({
      ok: true,
      status: nextStatus,
      openPunchCount,
    })
  } catch (error: any) {
    console.error('[installer/complete] error:', error?.message)
    return NextResponse.json({ error: 'Failed to complete install' }, { status: 500 })
  }
}
