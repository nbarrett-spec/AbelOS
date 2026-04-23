/**
 * POST /api/v1/engine/inbox/[inboxItemId]/ack
 *
 * NUC coordinator calls this after it has retrieved the resolution payload
 * for an InboxItem. Stamps `brainAcknowledgedAt = now()` so the loop is
 * provably closed on both sides.
 *
 * Idempotent — a second ack is a no-op (we preserve the original timestamp).
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

// Runtime guard: ensure the brainAcknowledgedAt column exists. The additive
// migration at prisma/migrations/2026_04_22_inbox_brain_ack.sql adds it
// idempotently; we replay the column-add so local/dev DBs that haven't
// applied the migration still work. Safe because we use IF NOT EXISTS.
let columnEnsured = false
async function ensureAckColumn() {
  if (columnEnsured) return
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "InboxItem" ADD COLUMN IF NOT EXISTS "brainAcknowledgedAt" TIMESTAMP(3)`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "InboxItem_brainAcknowledgedAt_idx" ON "InboxItem" ("brainAcknowledgedAt")`
    )
    columnEnsured = true
  } catch {
    columnEnsured = true // don't retry on error
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
    await ensureAckColumn()

    // Best-effort body parse — the ack is a bare POST but the NUC may include
    // optional metadata (workspaceId, note, brain run id). We don't persist it
    // beyond the timestamp today; Phase 2 can route it into an ack_log table.
    let body: any = {}
    try {
      body = await req.json()
    } catch {
      body = {}
    }

    // Confirm item exists.
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id", "brainAcknowledgedAt" FROM "InboxItem" WHERE "id" = $1 LIMIT 1`,
      inboxItemId
    )
    if (existing.length === 0) {
      return NextResponse.json(
        { error: 'not_found', message: `InboxItem ${inboxItemId} not found` },
        { status: 404 }
      )
    }

    const alreadyAcknowledged = !!existing[0].brainAcknowledgedAt

    // Idempotent: only set if null.
    const updated = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "InboxItem"
       SET "brainAcknowledgedAt" = COALESCE("brainAcknowledgedAt", NOW()),
           "updatedAt" = NOW()
       WHERE "id" = $1
       RETURNING "id", "brainAcknowledgedAt"`,
      inboxItemId
    )

    return NextResponse.json({
      ok: true,
      inboxItemId,
      brainAcknowledgedAt: updated[0]?.brainAcknowledgedAt ?? null,
      alreadyAcknowledged,
      workspaceId: auth.workspaceId || null,
      source: auth.source || 'nuc-engine',
      note: body?.note ?? null,
    })
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: 'internal_error', message: String(e?.message || e) },
      { status: 500 }
    )
  }
}
