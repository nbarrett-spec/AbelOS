/**
 * GET  /api/admin/pitch-runs/[id]
 * POST /api/admin/pitch-runs/[id]
 *
 * GET — return the PitchRun row for inspection (Nate's review UI).
 *       Auth: ADMIN or SALES_REP.
 *
 * POST — approve or reject. Body: { action: 'approve' | 'reject', notes? }.
 *        Approve: PitchRun.status='APPROVED', approvedBy/At set;
 *                 ReviewQueue.status='APPROVED'.
 *        Reject:  PitchRun.status='FAILED' (terminal); ReviewQueue.status='REJECTED'.
 *        Auth: ADMIN only — only Nate approves external-facing pitches per
 *              CLAUDE.md hard rule.
 *
 * Feature flag: gated by FEATURE_PITCH_GENERATOR_ENABLED (503 when off).
 *
 * Note: this route's POST does NOT auto-send email. CLAUDE.md hard rule:
 * "Send any email to a real customer (DFW outreach approval required)" is
 * explicitly NOT auto-handled — Approval here marks the PitchRun ready and
 * the ReviewQueue resolved, but actual email send is a separate action
 * Agent E will wire on the admin UI side.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'

function isFeatureEnabled(): boolean {
  return process.env.FEATURE_PITCH_GENERATOR_ENABLED === 'true'
}

interface PitchRunRow {
  id: string
  prospectId: string
  style: string
  layout: string
  elements: string[]
  status: string
  previewUrl: string | null
  htmlContent: string | null
  emailDraft: string | null
  errorMessage: string | null
  costEstimate: number | null
  generatedBy: string | null
  approvedBy: string | null
  approvedAt: Date | null
  sentAt: Date | null
  createdAt: Date
  updatedAt: Date
}

async function loadPitchRun(id: string): Promise<PitchRunRow | null> {
  const rows = await prisma.$queryRawUnsafe<PitchRunRow[]>(
    `SELECT id, "prospectId", style, layout, elements, status, "previewUrl",
            "htmlContent", "emailDraft", "errorMessage", "costEstimate",
            "generatedBy", "approvedBy", "approvedAt", "sentAt",
            "createdAt", "updatedAt"
       FROM "PitchRun" WHERE id = $1 LIMIT 1`,
    id
  )
  return rows?.[0] ?? null
}

// ── GET ────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isFeatureEnabled()) {
    return NextResponse.json(
      { error: 'Pitch generator is not enabled in this environment' },
      { status: 503 }
    )
  }

  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'SALES_REP'],
  })
  if (auth.error) return auth.error

  const row = await loadPitchRun(params.id)
  if (!row) {
    return NextResponse.json({ error: 'PitchRun not found' }, { status: 404 })
  }
  return NextResponse.json({ pitchRun: row })
}

// ── POST (approve / reject) ────────────────────────────────────────────
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  if (!isFeatureEnabled()) {
    return NextResponse.json(
      { error: 'Pitch generator is not enabled in this environment' },
      { status: 503 }
    )
  }

  // Approval/rejection is ADMIN-only — Nate's call. CLAUDE.md hard rule:
  // "First production tenant creation for a real customer / first factoring
  //  advance / external-facing copy: Always Nate's call."
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN'] })
  if (auth.error) return auth.error
  const { session } = auth

  let body: { action?: unknown; notes?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Body is not valid JSON' }, { status: 400 })
  }

  const action = body.action
  if (action !== 'approve' && action !== 'reject') {
    return NextResponse.json(
      { error: "action must be 'approve' or 'reject'" },
      { status: 400 }
    )
  }
  const notes = typeof body.notes === 'string' ? body.notes : null

  const existing = await loadPitchRun(params.id)
  if (!existing) {
    return NextResponse.json({ error: 'PitchRun not found' }, { status: 404 })
  }

  // Only PREVIEW pitches can be approved. Already-approved or already-failed
  // runs can't be re-flipped from this endpoint.
  if (action === 'approve' && existing.status !== 'PREVIEW') {
    return NextResponse.json(
      {
        error: `Cannot approve a PitchRun in status ${existing.status} (must be PREVIEW)`,
      },
      { status: 409 }
    )
  }

  const now = new Date()

  if (action === 'approve') {
    await prisma.$executeRawUnsafe(
      `UPDATE "PitchRun"
         SET status = 'APPROVED', "approvedBy" = $2, "approvedAt" = NOW(),
             "updatedAt" = NOW()
       WHERE id = $1`,
      params.id,
      session.staffId
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "ReviewQueue"
         SET status = 'APPROVED', "reviewedBy" = $2, "reviewedAt" = NOW(),
             notes = COALESCE($3, notes)
       WHERE "entityType" = 'PITCH_RUN' AND "entityId" = $1 AND status = 'PENDING'`,
      params.id,
      session.staffId,
      notes
    )
  } else {
    // reject — terminal: PitchRun → FAILED, ReviewQueue → REJECTED
    await prisma.$executeRawUnsafe(
      `UPDATE "PitchRun"
         SET status = 'FAILED', "errorMessage" = COALESCE($2, "errorMessage"),
             "updatedAt" = NOW()
       WHERE id = $1`,
      params.id,
      notes ? `Rejected by reviewer: ${notes}` : 'Rejected by reviewer'
    )
    await prisma.$executeRawUnsafe(
      `UPDATE "ReviewQueue"
         SET status = 'REJECTED', "reviewedBy" = $2, "reviewedAt" = NOW(),
             notes = COALESCE($3, notes)
       WHERE "entityType" = 'PITCH_RUN' AND "entityId" = $1 AND status = 'PENDING'`,
      params.id,
      session.staffId,
      notes
    )
  }

  // Audit the approval/rejection. Severity WARN since this is a state change
  // gating external-facing customer outreach.
  await logAudit({
    staffId: session.staffId,
    action: action === 'approve' ? 'PITCH_APPROVE' : 'PITCH_REJECT',
    entity: 'PitchRun',
    entityId: params.id,
    details: {
      prospectId: existing.prospectId,
      previousStatus: existing.status,
      notes,
      reviewedAt: now.toISOString(),
    },
    severity: 'WARN',
  }).catch(() => {})

  const updated = await loadPitchRun(params.id)
  return NextResponse.json({ pitchRun: updated })
}
