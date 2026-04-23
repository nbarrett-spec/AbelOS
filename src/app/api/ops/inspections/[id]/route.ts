export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// GET /api/ops/inspections/[id] — Get single inspection with template items
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i.*,
              t."name" as "templateName", t."code" as "templateCode", t."category", t."items" as "templateItems",
              j."jobNumber", j."builderName", j."jobAddress",
              s."firstName" || ' ' || s."lastName" as "inspectorName"
       FROM "Inspection" i
       LEFT JOIN "InspectionTemplate" t ON t.id = i."templateId"
       LEFT JOIN "Job" j ON j.id = i."jobId"
       LEFT JOIN "Staff" s ON s.id = i."inspectorId"
       WHERE i.id = $1`,
      params.id
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    return NextResponse.json({ inspection: rows[0] })
  } catch (error: any) {
    console.error('[Inspection GET]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// PATCH /api/ops/inspections/[id] — Update inspection (submit results, change status)
//
// Accepted status values: 'PENDING' | 'PASS' | 'PASS_WITH_NOTES' | 'FAIL'
// (Legacy 'PASSED' / 'FAILED' still accepted and normalized for back-compat.)
//
// Side effects on status transitions:
//   FAIL              → set Job to PUNCH_LIST; create PunchItems for each defect;
//                       inbox item (QC_FAIL) to PM; if severity=CRITICAL also
//                       raise an AlertIncident so ADMIN + MANAGER get notified.
//   PASS_WITH_NOTES   → create PunchItems for noted defects; inbox item
//                       (QC_NOTED) to PM. Allow advancement (does not block).
//   PASS              → audit PASS. Allow advancement.
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    let {
      status,
      results,
      passRate,
      notes,
      photos,
      signatureData,
      inspectorId,
      scheduledDate,
      completedDate,
      defects, // optional array of { description, severity?, location? }
      severity, // optional top-level severity for the failure
    } = body

    // Normalize legacy status values for back-compat with older UI posts.
    if (status === 'PASSED') status = 'PASS'
    if (status === 'FAILED') status = 'FAIL'

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const values: any[] = []
    let paramIdx = 1

    if (status !== undefined) { setClauses.push(`"status" = $${paramIdx++}`); values.push(status) }
    if (results !== undefined) { setClauses.push(`"results" = $${paramIdx++}::jsonb`); values.push(JSON.stringify(results)) }
    if (passRate !== undefined) { setClauses.push(`"passRate" = $${paramIdx++}`); values.push(passRate) }
    if (notes !== undefined) { setClauses.push(`"notes" = $${paramIdx++}`); values.push(notes) }
    if (photos !== undefined) { setClauses.push(`"photos" = $${paramIdx++}::jsonb`); values.push(JSON.stringify(photos)) }
    if (signatureData !== undefined) { setClauses.push(`"signatureData" = $${paramIdx++}`); values.push(signatureData) }
    if (inspectorId !== undefined) { setClauses.push(`"inspectorId" = $${paramIdx++}`); values.push(inspectorId) }
    if (scheduledDate !== undefined) { setClauses.push(`"scheduledDate" = $${paramIdx++}::timestamptz`); values.push(scheduledDate ? new Date(scheduledDate) : null) }
    if (completedDate !== undefined) { setClauses.push(`"completedDate" = $${paramIdx++}::timestamptz`); values.push(completedDate ? new Date(completedDate) : null) }

    // Auto-set completedDate when status terminal.
    const TERMINAL = ['PASS', 'PASS_WITH_NOTES', 'FAIL']
    if (status && TERMINAL.includes(status)) {
      setClauses.push(`"completedDate" = COALESCE("completedDate", NOW())`)
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "Inspection" SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      ...values, params.id
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Inspection not found' }, { status: 404 })
    }

    const inspection = result[0]
    await audit(request, 'UPDATE', 'Inspection', params.id, { status, passRate })

    // ── Side effects by terminal status ──────────────────────────────
    if (status && TERMINAL.includes(status)) {
      await applyInspectionSideEffects(
        request,
        {
          inspectionId: params.id,
          jobId: inspection.jobId,
          inspectorId: inspection.inspectorId,
          status,
          notes: notes ?? inspection.notes ?? null,
          defects: Array.isArray(defects) ? defects : [],
          severity: severity || null,
        }
      )
    }

    return NextResponse.json({ inspection })
  } catch (error: any) {
    console.error('[Inspection PATCH]', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

// ── Side effect dispatcher ────────────────────────────────────────────

interface SideEffectPayload {
  inspectionId: string
  jobId: string | null
  inspectorId: string | null
  status: 'PASS' | 'PASS_WITH_NOTES' | 'FAIL'
  notes: string | null
  defects: Array<{ description: string; severity?: string; location?: string }>
  severity: string | null
}

async function applyInspectionSideEffects(
  request: NextRequest,
  p: SideEffectPayload
): Promise<void> {
  const { inspectionId, jobId, status, notes, defects, severity } = p

  if (!jobId) {
    // Orphan inspection — only audit, nothing else to do.
    await audit(request, `QC_${status}`, 'Inspection', inspectionId, {
      orphan: true,
    })
    return
  }

  // Fetch job to resolve PM + job number.
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id", "jobNumber", "assignedPMId", "status"::text as status
     FROM "Job" WHERE id = $1`,
    jobId
  )
  const job = jobRows[0]
  if (!job) return

  if (status === 'FAIL') {
    // 1. Flip job to PUNCH_LIST (unless already in a terminal state).
    const blockStates = new Set(['COMPLETE', 'INVOICED', 'CLOSED'])
    if (!blockStates.has(job.status)) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET status = 'PUNCH_LIST'::"JobStatus", "updatedAt" = NOW() WHERE id = $1`,
        jobId
      ).catch((e: any) => console.warn('[qc fail → PUNCH_LIST]', e?.message))
    }

    // 2. Create PunchItems.
    await createPunchItemsForJob(jobId, defects, severity, p.inspectorId, inspectionId)

    // 3. Inbox item for PM.
    await createInboxItem({
      type: 'QC_FAIL',
      source: 'qc-inspection',
      title: `QC FAIL — ${job.jobNumber}`,
      description: notes || `Inspection ${inspectionId} failed. ${defects.length} defect(s) logged.`,
      priority: severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
      entityType: 'Job',
      entityId: jobId,
      assignedTo: job.assignedPMId,
    })

    // 4. Critical: also raise AlertIncident (admin + manager notification path).
    if (severity === 'CRITICAL') {
      await raiseCriticalAlert(jobId, job.jobNumber, notes)
    }

    await audit(request, 'QC_FAIL', 'Inspection', inspectionId, {
      jobId,
      jobNumber: job.jobNumber,
      defectCount: defects.length,
      severity,
    }, 'WARN')
  } else if (status === 'PASS_WITH_NOTES') {
    // Create punch items for noted defects.
    await createPunchItemsForJob(jobId, defects, severity || 'MINOR', p.inspectorId, inspectionId)

    await createInboxItem({
      type: 'QC_NOTED',
      source: 'qc-inspection',
      title: `QC passed with notes — ${job.jobNumber}`,
      description: notes || `Inspection ${inspectionId} passed with ${defects.length} noted item(s).`,
      priority: 'MEDIUM',
      entityType: 'Job',
      entityId: jobId,
      assignedTo: job.assignedPMId,
    })

    await audit(request, 'QC_PASS_WITH_NOTES', 'Inspection', inspectionId, {
      jobId,
      jobNumber: job.jobNumber,
      defectCount: defects.length,
    })
  } else if (status === 'PASS') {
    await audit(request, 'QC_PASS', 'Inspection', inspectionId, {
      jobId,
      jobNumber: job.jobNumber,
    })
  }
}

// ── PunchItem creation ────────────────────────────────────────────────

async function createPunchItemsForJob(
  jobId: string,
  defects: Array<{ description: string; severity?: string; location?: string }>,
  fallbackSeverity: string | null,
  inspectorId: string | null,
  inspectionId: string,
): Promise<void> {
  if (defects.length === 0) return

  // Make installationId nullable — historically NOT NULL. Safe to re-run.
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "PunchItem" ALTER COLUMN "installationId" DROP NOT NULL`
    )
  } catch { /* table may not exist yet or column already nullable */ }

  // Ensure table exists with QC-friendly shape.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PunchItem" (
        id TEXT PRIMARY KEY,
        "punchNumber" TEXT NOT NULL,
        "installationId" TEXT,
        "jobId" TEXT NOT NULL,
        "inspectionId" TEXT,
        location TEXT,
        description TEXT NOT NULL,
        severity TEXT NOT NULL DEFAULT 'MINOR',
        status TEXT NOT NULL DEFAULT 'OPEN',
        "assignedToId" TEXT,
        "reportedById" TEXT,
        "photoUrls" TEXT[] DEFAULT '{}',
        "fixPhotoUrls" TEXT[] DEFAULT '{}',
        "dueDate" TIMESTAMP WITH TIME ZONE,
        "resolvedAt" TIMESTAMP WITH TIME ZONE,
        "resolvedById" TEXT,
        "resolutionNotes" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "PunchItem" ADD COLUMN IF NOT EXISTS "inspectionId" TEXT`
    )
  } catch { /* ignore */ }

  // Count existing to compute punchNumber.
  const countRes: any[] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS cnt FROM "PunchItem" WHERE "jobId" = $1`,
    jobId
  )
  let cnt = (countRes[0]?.cnt || 0)

  for (const d of defects) {
    cnt += 1
    const id = 'pi_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    const sev = (d.severity || fallbackSeverity || 'MINOR').toUpperCase()
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PunchItem" (
          id, "punchNumber", "installationId", "jobId", "inspectionId",
          location, description, severity, status, "reportedById",
          "createdAt", "updatedAt"
        ) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7, 'OPEN', $8, NOW(), NOW())`,
        id, `P-${cnt}`, jobId, inspectionId,
        d.location || null, d.description, sev, inspectorId || null
      )
    } catch (e: any) {
      console.warn('[createPunchItemsForJob]', e?.message)
    }
  }
}

// ── InboxItem ─────────────────────────────────────────────────────────

async function createInboxItem(p: {
  type: string
  source: string
  title: string
  description?: string | null
  priority: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  entityType?: string
  entityId?: string
  assignedTo?: string | null
}): Promise<void> {
  try {
    const id = 'ibx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (
        id, type, source, title, description, priority, status,
        "entityType", "entityId", "assignedTo", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', $7, $8, $9, NOW(), NOW())`,
      id,
      p.type, p.source, p.title,
      p.description || null,
      p.priority,
      p.entityType || null,
      p.entityId || null,
      p.assignedTo || null
    )
  } catch (e: any) {
    console.warn('[createInboxItem]', e?.message)
  }
}

// ── Critical AlertIncident ────────────────────────────────────────────
// Using the AlertIncident table (same shape used by system-alerts) so the
// existing notification escalation picks this up and emails ADMIN/MANAGER.

async function raiseCriticalAlert(
  jobId: string,
  jobNumber: string,
  notes: string | null,
): Promise<void> {
  try {
    const alertId = `qc_critical_${jobId}`
    // Close any previous alert for this alertId first so notification resends.
    await prisma.$executeRawUnsafe(
      `UPDATE "AlertIncident"
       SET "endedAt" = NOW()
       WHERE "alertId" = $1 AND "endedAt" IS NULL`,
      alertId
    ).catch(() => {})

    await prisma.$executeRawUnsafe(
      `INSERT INTO "AlertIncident"
       ("alertId", "title", "href", "description",
        "peakCount", "peakSeverity", "lastSeverity", "lastCount")
       VALUES ($1, $2, $3, $4, 1, 'critical', 'critical', 1)
       ON CONFLICT DO NOTHING`,
      alertId,
      `Critical QC FAIL — ${jobNumber}`,
      `/ops/jobs/${jobId}`,
      (notes || 'Critical defect flagged on QC inspection').slice(0, 900)
    )
  } catch (e: any) {
    console.warn('[raiseCriticalAlert]', e?.message)
  }
}
