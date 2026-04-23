/**
 * POST /api/v1/engine/inbox/[inboxItemId]/ack
 *
 * NUC coordinator calls this after it has retrieved the resolution payload
 * for an InboxItem. Stamps `brainAcknowledgedAt = now()` so the loop is
 * provably closed on both sides.
 *
 * Optional body:
 *   {
 *     note?: string,
 *     brainLearnings?: object  // arbitrary JSON — stored on InboxItem.brainLearnings
 *   }
 *
 * brainLearnings shape is owned by the NUC (confidence, applied rules, model
 * version, reasoning summary, next-watch signals). We store the object as-is
 * and merge with any prior value on re-ack.
 *
 * Idempotent — a second ack is a no-op for the timestamp (we preserve the
 * original). brainLearnings, if provided on re-ack, shallow-merges on top of
 * the prior value so the engine can progressively enrich it.
 *
 * Auth: Bearer ENGINE_BRIDGE_TOKEN via verifyEngineToken().
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyEngineToken } from '@/lib/engine-auth'
import { prisma } from '@/lib/prisma'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Params {
  params: { inboxItemId: string }
}

// Runtime guard: ensure the brainAcknowledgedAt + brainLearnings columns
// exist. The additive migration at prisma/migrations/2026_04_22_inbox_brain_ack.sql
// adds them idempotently; we replay the column-add so local/dev DBs that
// haven't applied the migration still work. Safe because of IF NOT EXISTS.
let columnsEnsured = false
async function ensureAckColumns() {
  if (columnsEnsured) return
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "brainAcknowledgedAt" TIMESTAMP(3)`
    )
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "brainLearnings" JSONB`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "InboxItem_brainAcknowledgedAt_idx" ON "InboxItem" ("brainAcknowledgedAt")`
    )
    columnsEnsured = true
  } catch {
    columnsEnsured = true // don't retry on error
  }
}

// Cap the stored learnings payload so a runaway NUC can't fill the column.
const MAX_LEARNINGS_BYTES = 64 * 1024 // 64 KB

function sanitizeLearnings(input: unknown): Record<string, any> | null {
  if (input === null || input === undefined) return null
  if (typeof input !== 'object' || Array.isArray(input)) {
    // Wrap scalars / arrays so the column is always a keyed object for merge.
    return { value: input as any }
  }
  try {
    const serialized = JSON.stringify(input)
    if (serialized.length > MAX_LEARNINGS_BYTES) {
      return { truncated: true, bytes: serialized.length }
    }
    return input as Record<string, any>
  } catch {
    return null
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = await verifyEngineToken(req)
  if (!auth.ok) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const { inboxItemId } = params
  if (!inboxItemId) {
    return NextResponse.json(
      { error: 'bad_request', message: 'missing inboxItemId' },
      { status: 400 }
    )
  }

  try {
    await ensureAckColumns()

    // Best-effort body parse. The ack can be a bare POST; optional metadata
    // includes `note` and `brainLearnings` (free-form JSON the NUC attaches).
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    const noteInput = typeof body?.note === 'string' ? body.note : null
    const learningsInput = sanitizeLearnings(body?.brainLearnings)

    // Confirm item exists and pull prior learnings so we can merge.
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "brainAcknowledgedAt", "brainLearnings"
         FROM "InboxItem"
        WHERE "id" = $1
        LIMIT 1`,
      inboxItemId
    )
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: `InboxItem ${inboxItemId} not found` },
        { status: 404 }
      )
    }

    const alreadyAcknowledged = !!existing[0].brainAcknowledgedAt

    // Merge: new learnings win on key collision; prior keys are preserved.
    // If no new learnings are supplied we leave the column untouched.
    let mergedLearnings: Record<string, any> | null = null
    let learningsWritten = false
    if (learningsInput) {
      const prior =
        existing[0].brainLearnings && typeof existing[0].brainLearnings === 'object'
          ? (existing[0].brainLearnings as Record<string, any>)
          : {}
      mergedLearnings = { ...prior, ...learningsInput }
      learningsWritten = true
    }

    // Idempotent timestamp (COALESCE keeps the first ack time). brainLearnings
    // is only written when new learnings are supplied — otherwise keep prior.
    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "InboxItem"
         SET "brainAcknowledgedAt" = COALESCE("brainAcknowledgedAt", NOW()),
             "brainLearnings"      = COALESCE($2::jsonb, "brainLearnings"),
             "updatedAt"           = NOW()
       WHERE "id" = $1
       RETURNING "id", "brainAcknowledgedAt", "brainLearnings"`,
      inboxItemId,
      mergedLearnings ? JSON.stringify(mergedLearnings) : null
    )

    return NextResponse.json({
      ok: true,
      inboxItemId,
      brainAcknowledgedAt: updated[0]?.brainAcknowledgedAt ?? null,
      brainLearnings: updated[0]?.brainLearnings ?? null,
      learningsWritten,
      alreadyAcknowledged,
      workspaceId: auth.workspaceId || null,
      source: auth.source || 'nuc-engine',
      note: noteInput,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: String(e?.message || e) },
      { status: 500 }
    )
  }
}
