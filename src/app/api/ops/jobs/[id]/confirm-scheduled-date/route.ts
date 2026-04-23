export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ── POST /api/ops/jobs/[id]/confirm-scheduled-date ──────────────────────
// PM action: confirm (or edit) a scheduledDate that was auto-defaulted by
// scripts/backfill-scheduled-dates.mjs. Strips the
// [NEEDS_REVIEW | DEFAULT_LEAD_TIME] marker from buildSheetNotes and
// optionally overwrites scheduledDate with a PM-supplied value.
//
// Body:
//   { scheduledDate?: string (ISO) }    // optional; if absent, just clears marker
// ─────────────────────────────────────────────────────────────────────────

const REVIEW_MARKER = '[NEEDS_REVIEW | DEFAULT_LEAD_TIME]'
const DEFAULT_AUTO_NOTE =
  'Auto-backfilled to createdAt + 14d. Verify with builder.'

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json().catch(() => ({}))
    const { scheduledDate } = body as { scheduledDate?: string }

    // Load current job
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "buildSheetNotes", "scheduledDate"
       FROM "Job" WHERE "id" = $1`,
      id
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const current = rows[0]

    // Strip the marker + the default-backfill note if it's still the stock text.
    const existing: string = current.buildSheetNotes || ''
    let cleaned = existing
      .replace(REVIEW_MARKER, '')
      .replace(DEFAULT_AUTO_NOTE, '')
      .replace(/\s+/g, ' ')
      .trim()
    if (cleaned === '') cleaned = null as unknown as string

    // Build SET clauses
    const setClauses: string[] = ['"updatedAt" = NOW()']

    if (cleaned === null) {
      setClauses.push(`"buildSheetNotes" = NULL`)
    } else {
      const safe = cleaned.replace(/'/g, "''")
      setClauses.push(`"buildSheetNotes" = '${safe}'`)
    }

    if (scheduledDate) {
      const parsed = new Date(scheduledDate)
      if (isNaN(parsed.getTime())) {
        return NextResponse.json(
          { error: 'Invalid scheduledDate' },
          { status: 400 }
        )
      }
      setClauses.push(
        `"scheduledDate" = '${parsed.toISOString()}'::timestamptz`
      )
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "Job" SET ${setClauses.join(', ')} WHERE "id" = $1`,
      id
    )

    await audit(request, 'UPDATE', 'Job', id, {
      action: 'confirm-scheduled-date',
      scheduledDate: scheduledDate || current.scheduledDate,
      markerCleared: true,
    }).catch(() => {})

    // Return updated row
    const updated: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "scheduledDate", "buildSheetNotes", "status"::text AS "status"
       FROM "Job" WHERE "id" = $1`,
      id
    )

    return NextResponse.json(
      { success: true, job: updated[0] || null },
      { status: 200 }
    )
  } catch (error) {
    console.error('Error confirming scheduled date:', error)
    return NextResponse.json(
      { error: 'Failed to confirm scheduled date' },
      { status: 500 }
    )
  }
}
