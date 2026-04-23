/**
 * Inspection Event Helpers
 *
 * The QC portal renders from the `Inspection` table, but the current QC POST
 * endpoint only writes to `QualityCheck`. These helpers mirror a QualityCheck
 * row into Inspection so the portal sees live queue data, and — on FAIL —
 * additionally emit a PunchItem plus a Task so nothing falls off the board.
 *
 * All helpers:
 *  - are non-throwing (return a result object)
 *  - should be called AFTER the primary QualityCheck insert succeeds
 *  - are idempotent — re-calling for the same qualityCheckId is a no-op
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { createTaskForQCFailure } from './task'

export type InspectionEmitResult = {
  ok: boolean
  action: string
  detail?: string
  inspectionId?: string
  punchItemId?: string
  taskId?: string
}

/**
 * Map QualityCheck → Inspection. Idempotent via notes tag `[qc:<id>]`
 * embedded in the mirrored row. If a row with that tag already exists we
 * short-circuit. We avoid a schema change because Inspection is a legacy
 * table (uuid ids, timestamptz) whose migrations are fragile.
 *
 * @param qualityCheckId The ID of the QualityCheck just inserted
 */
export async function mirrorQualityCheckToInspection(qualityCheckId: string): Promise<InspectionEmitResult> {
  try {
    // Look up the source QualityCheck
    const qcRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT qc."id", qc."jobId", qc."checkType"::text AS "checkType",
              qc."result"::text AS "result", qc."notes", qc."inspectorId",
              qc."createdAt",
              j."jobNumber"
         FROM "QualityCheck" qc
         LEFT JOIN "Job" j ON j."id" = qc."jobId"
        WHERE qc."id" = $1
        LIMIT 1`,
      qualityCheckId,
    )
    if (qcRows.length === 0) return { ok: false, action: 'mirrorQualityCheckToInspection', detail: 'qc_not_found' }
    const qc = qcRows[0]

    // Idempotency: has an Inspection already been mirrored for this QC?
    const dedupeTag = `[qc:${qualityCheckId}]`
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Inspection" WHERE "notes" LIKE $1 LIMIT 1`,
      `%${dedupeTag}%`,
    )
    if (existing.length > 0) {
      return {
        ok: true,
        action: 'mirrorQualityCheckToInspection',
        detail: 'already_mirrored',
        inspectionId: existing[0].id,
      }
    }

    // Map QCResult → Inspection.status. Inspection.status is String (free-form),
    // so we use a stable uppercase vocabulary: PASSED | FAILED | CONDITIONAL.
    const statusMap: Record<string, string> = {
      PASS: 'PASSED',
      FAIL: 'FAILED',
      CONDITIONAL_PASS: 'CONDITIONAL',
    }
    const status = statusMap[qc.result] || 'COMPLETED'
    const passRate = qc.result === 'PASS' ? 1 : qc.result === 'FAIL' ? 0 : 0.5
    const combinedNotes = `${qc.notes ? qc.notes + ' ' : ''}${dedupeTag}`

    // Insert the mirrored Inspection row. Inspection.id uses dbgenerated uuid.
    const inserted: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "Inspection" (
         "templateId", "jobId", "inspectorId", "status",
         "scheduledDate", "completedDate", "results", "passRate",
         "notes", "photos", "signatureData",
         "createdAt", "updatedAt"
       ) VALUES (
         NULL, $1, $2, $3,
         $4, $4, $5, $6,
         $7, '[]'::jsonb, NULL,
         NOW(), NOW()
       )
       RETURNING "id"`,
      qc.jobId,
      qc.inspectorId,
      status,
      qc.createdAt,
      JSON.stringify({ checkType: qc.checkType, result: qc.result, source: 'QualityCheck', sourceId: qualityCheckId }),
      passRate,
      combinedNotes,
    )

    const inspectionId = inserted[0]?.id as string
    let punchItemId: string | undefined
    let taskId: string | undefined

    // On FAIL: punch item + task so PM gets paged.
    if (qc.result === 'FAIL') {
      const punchRes = await emitPunchItemForFailure({
        inspectionId,
        jobId: qc.jobId,
        notes: qc.notes,
        reportedById: qc.inspectorId,
      })
      if (punchRes.punchItemId) punchItemId = punchRes.punchItemId

      const taskRes = await createTaskForQCFailure({
        inspectionId,
        jobId: qc.jobId,
        jobNumber: qc.jobNumber,
        notes: qc.notes,
      })
      if (taskRes.taskId) taskId = taskRes.taskId
    }

    return {
      ok: true,
      action: 'mirrorQualityCheckToInspection',
      detail: 'mirrored',
      inspectionId,
      punchItemId,
      taskId,
    }
  } catch (e: any) {
    logger.error('mirrorQualityCheckToInspection_failed', e, { qualityCheckId })
    return { ok: false, action: 'mirrorQualityCheckToInspection', detail: e?.message?.slice(0, 200) }
  }
}

/**
 * Emit a PunchItem for a failed Inspection. Idempotent — we dedupe by
 * `punchNumber` = "PI-<inspectionId>", which is unique per inspection.
 */
export async function emitPunchItemForFailure(params: {
  inspectionId: string
  jobId: string | null
  notes?: string | null
  reportedById?: string | null
  location?: string | null
}): Promise<{ ok: boolean; punchItemId?: string; detail?: string }> {
  try {
    const { inspectionId, jobId, notes, reportedById, location } = params
    if (!jobId) {
      return { ok: false, detail: 'no_job_linked' }
    }
    const punchNumber = `PI-${inspectionId.slice(0, 12)}`

    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "PunchItem" WHERE "punchNumber" = $1 LIMIT 1`,
      punchNumber,
    )
    if (existing.length > 0) {
      return { ok: true, punchItemId: existing[0].id, detail: 'already_emitted' }
    }

    // PunchItem.installationId is NOT NULL but has no DB-level FK.
    // Reuse the latest Installation on this job; if none exists, create a
    // stub placeholder Installation so the punch still lands.
    const installRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Installation" WHERE "jobId" = $1 ORDER BY "createdAt" DESC LIMIT 1`,
      jobId,
    )
    let installationId = installRows[0]?.id
    if (!installationId) {
      installationId = `inst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      const installNumber = `INS-QC-${inspectionId.slice(0, 8)}`
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "Installation" (
             "id", "jobId", "installNumber", "scopeNotes", "status",
             "passedQC", "beforePhotos", "afterPhotos",
             "createdAt", "updatedAt"
           ) VALUES (
             $1, $2, $3, $4, 'SCHEDULED'::"InstallationStatus",
             false, ARRAY[]::text[], ARRAY[]::text[],
             NOW(), NOW()
           )
           ON CONFLICT ("installNumber") DO NOTHING`,
          installationId,
          jobId,
          installNumber,
          'Auto-created by QC failure cascade — no prior installation on file.',
        )
        // Re-resolve in case a conflict stole the id
        const postInstall: any[] = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "Installation" WHERE "installNumber" = $1 LIMIT 1`,
          installNumber,
        )
        if (postInstall[0]?.id) installationId = postInstall[0].id
      } catch (installErr: any) {
        logger.error('punch_install_stub_failed', installErr, { jobId })
        // swallow and let PunchItem INSERT fail naturally
      }
    }

    const id = `pun_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
    const description = notes ? `QC failure: ${notes}` : 'QC failure — see inspection notes'

    await prisma.$executeRawUnsafe(
      `INSERT INTO "PunchItem" (
         "id", "punchNumber", "installationId", "jobId", "location", "description",
         "severity", "status", "reportedById", "photoUrls", "fixPhotoUrls",
         "createdAt", "updatedAt"
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         'MAJOR', 'OPEN', $7, ARRAY[]::text[], ARRAY[]::text[],
         NOW(), NOW()
       )`,
      id,
      punchNumber,
      installationId,
      jobId,
      location ?? null,
      description,
      reportedById ?? null,
    )

    return { ok: true, punchItemId: id, detail: 'inserted' }
  } catch (e: any) {
    logger.error('emitPunchItemForFailure_failed', e, { inspectionId: params.inspectionId })
    return { ok: false, detail: e?.message?.slice(0, 200) }
  }
}
