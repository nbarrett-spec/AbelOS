export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/jobs/[id]/pm-signoff
//
// Body: { deliveryId?: string, installationId?: string, note?: string }
//
// Exactly ONE of deliveryId or installationId must be present. The PM stamps
// "I've verified this delivery/install" — we persist the sign-off on the
// existing `signedBy` (Delivery) / `notes` (Installation) columns so no
// migration is needed, and we also write a PM_SIGNOFF AuditLog row (the
// durable source of truth for sign-off history).
//
// Guardrails:
//   - Delivery must be in COMPLETE / UNLOADING / ARRIVED / PARTIAL_DELIVERY
//     (i.e. something was actually delivered) before PM sign-off is allowed.
//   - Installation must be in COMPLETE / PUNCH_LIST.
//   - Idempotent: re-signing the same row returns 200 with alreadySigned:true.
// ─────────────────────────────────────────────────────────────────────────────

const DELIVERY_SIGNABLE = new Set([
  'COMPLETE',
  'UNLOADING',
  'ARRIVED',
  'PARTIAL_DELIVERY',
])
const INSTALLATION_SIGNABLE = new Set(['COMPLETE', 'PUNCH_LIST'])

function pmSignoffTag(staffId: string): string {
  return `PM-SIGNOFF:${staffId}:${new Date().toISOString()}`
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const { session } = auth

  const jobId = params.id
  let body: {
    deliveryId?: string
    installationId?: string
    note?: string
  } = {}
  try {
    body = await request.json()
  } catch {
    // empty body is fine; treated as bad request below
  }

  const { deliveryId, installationId } = body
  if (!deliveryId && !installationId) {
    return NextResponse.json(
      { error: 'bad_request', message: 'deliveryId or installationId required' },
      { status: 400 },
    )
  }
  if (deliveryId && installationId) {
    return NextResponse.json(
      {
        error: 'bad_request',
        message: 'exactly one of deliveryId or installationId',
      },
      { status: 400 },
    )
  }

  const note = (body.note || '').trim().slice(0, 2000) || null
  const tag = pmSignoffTag(session.staffId)

  try {
    if (deliveryId) {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "id", "jobId", "deliveryNumber", "status"::text AS "status", "signedBy", "notes"
           FROM "Delivery" WHERE "id" = $1`,
        deliveryId,
      )
      if (rows.length === 0) {
        return NextResponse.json({ error: 'Delivery not found' }, { status: 404 })
      }
      const d = rows[0]
      if (d.jobId !== jobId) {
        return NextResponse.json(
          { error: 'Delivery does not belong to this Job' },
          { status: 409 },
        )
      }
      if (!DELIVERY_SIGNABLE.has(d.status)) {
        return NextResponse.json(
          {
            error: 'not_signable',
            message: `Delivery status ${d.status} is not PM-signable`,
          },
          { status: 409 },
        )
      }
      // Idempotency — if the notes column already contains a PM-SIGNOFF tag
      // for this staffId, no-op.
      const existing = String(d.notes || '')
      if (existing.includes(`PM-SIGNOFF:${session.staffId}:`)) {
        return NextResponse.json({
          ok: true,
          alreadySigned: true,
          deliveryId,
        })
      }

      const newNotes = [existing, tag, note].filter(Boolean).join('\n')
      await prisma.$executeRawUnsafe(
        `UPDATE "Delivery"
            SET "notes" = $2,
                "signedBy" = COALESCE("signedBy", $3),
                "updatedAt" = NOW()
          WHERE "id" = $1`,
        deliveryId,
        newNotes,
        session.staffId,
      )

      await audit(
        request,
        'PM_SIGNOFF',
        'delivery',
        deliveryId,
        {
          jobId,
          deliveryNumber: d.deliveryNumber,
          status: d.status,
          note,
          actor: session.staffId,
        },
        'WARN',
      )

      return NextResponse.json({ ok: true, deliveryId })
    }

    // Installation branch
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "jobId", "installNumber", "status"::text AS "status", "notes"
         FROM "Installation" WHERE "id" = $1`,
      installationId,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Installation not found' }, { status: 404 })
    }
    const i = rows[0]
    if (i.jobId !== jobId) {
      return NextResponse.json(
        { error: 'Installation does not belong to this Job' },
        { status: 409 },
      )
    }
    if (!INSTALLATION_SIGNABLE.has(i.status)) {
      return NextResponse.json(
        {
          error: 'not_signable',
          message: `Installation status ${i.status} is not PM-signable`,
        },
        { status: 409 },
      )
    }
    const existing = String(i.notes || '')
    if (existing.includes(`PM-SIGNOFF:${session.staffId}:`)) {
      return NextResponse.json({
        ok: true,
        alreadySigned: true,
        installationId,
      })
    }
    const newNotes = [existing, tag, note].filter(Boolean).join('\n')
    await prisma.$executeRawUnsafe(
      `UPDATE "Installation"
          SET "notes" = $2,
              "updatedAt" = NOW()
        WHERE "id" = $1`,
      installationId,
      newNotes,
    )

    await audit(
      request,
      'PM_SIGNOFF',
      'installation',
      installationId,
      {
        jobId,
        installNumber: i.installNumber,
        status: i.status,
        note,
        actor: session.staffId,
      },
      'WARN',
    )

    return NextResponse.json({ ok: true, installationId })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Server error' }, { status: 500 })
  }
}
