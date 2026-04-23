/**
 * Digest preferences endpoint
 *
 * GET  → { digestOptOut: boolean }         — current opt-out state for session staff
 * POST { digestOptOut: boolean } → merged  — update opt-out flag
 *
 * Kept separate from /api/ops/staff/preferences (which only handles density
 * + featureFlags + hasSeen) so the digest flag doesn't require loosening
 * the sanitizer there. Same underlying Staff.preferences JSON column.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'
import { prisma } from '@/lib/prisma'

function getPreferencesShape(val: unknown): Record<string, unknown> {
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    return val as Record<string, unknown>
  }
  return {}
}

const staffModel = () =>
  (prisma as unknown as {
    staff: {
      findUnique: (args: unknown) => Promise<any>
      update: (args: unknown) => Promise<any>
    }
  }).staff

export async function GET() {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    const row = await staffModel().findUnique({
      where: { id: session.staffId },
      select: { preferences: true },
    })
    const prefs = getPreferencesShape(row?.preferences)
    return NextResponse.json({
      digestOptOut: prefs.digestOptOut === true,
    })
  } catch {
    // If the migration for `preferences` hasn't landed, return safe defaults
    // so the settings UI still renders (same pattern as the other endpoint).
    return NextResponse.json({ digestOptOut: false, persisted: false })
  }
}

export async function POST(req: NextRequest) {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  if (!body || typeof body.digestOptOut !== 'boolean') {
    return NextResponse.json({ error: 'digestOptOut (boolean) is required' }, { status: 400 })
  }

  try {
    const existing = await staffModel().findUnique({
      where: { id: session.staffId },
      select: { preferences: true },
    })
    const current = getPreferencesShape(existing?.preferences)
    const merged = { ...current, digestOptOut: body.digestOptOut }

    await staffModel().update({
      where: { id: session.staffId },
      data: { preferences: merged },
    })

    return NextResponse.json({ digestOptOut: body.digestOptOut, persisted: true })
  } catch (err) {
    return NextResponse.json(
      {
        digestOptOut: body.digestOptOut,
        persisted: false,
        reason: err instanceof Error ? err.message : 'unknown',
      },
      { status: 200 },
    )
  }
}
