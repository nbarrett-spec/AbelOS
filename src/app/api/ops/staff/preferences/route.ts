/**
 * POST /api/ops/staff/preferences
 *
 * Merge a partial preferences blob onto the current staff user's
 * Staff.preferences JSON column. Used by DensityToggle + feature flag UI.
 *
 * NOTE: the `preferences` column is added by
 *   prisma/migrations/pending_staff_preferences.sql
 * which is deliberately not auto-applied. Until it's run we degrade
 * gracefully: the call returns 200 { persisted: false } so the client
 * can keep working off localStorage alone.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'

type Density = 'comfortable' | 'default' | 'compact'

interface Body {
  density?: Density
  featureFlags?: Record<string, boolean>
  hasSeen?: Record<string, boolean>
}

function sanitize(body: unknown): Body | null {
  if (!body || typeof body !== 'object') return null
  const out: Body = {}
  const b = body as Record<string, unknown>

  if (b.density === 'comfortable' || b.density === 'default' || b.density === 'compact') {
    out.density = b.density
  }
  if (b.featureFlags && typeof b.featureFlags === 'object' && !Array.isArray(b.featureFlags)) {
    const ff: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(b.featureFlags as Record<string, unknown>)) {
      if (typeof v === 'boolean' && /^[A-Z0-9_]+$/.test(k) && k.length < 64) ff[k] = v
    }
    out.featureFlags = ff
  }
  if (b.hasSeen && typeof b.hasSeen === 'object' && !Array.isArray(b.hasSeen)) {
    const hs: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(b.hasSeen as Record<string, unknown>)) {
      if (typeof v === 'boolean' && /^[a-zA-Z0-9_-]+$/.test(k) && k.length < 64) hs[k] = v
    }
    out.hasSeen = hs
  }
  return out
}

export async function POST(req: NextRequest) {
  const session = await getStaffSession()
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null)
  const clean = sanitize(body)
  if (!clean) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })

  try {
    // Read existing prefs and shallow-merge. We access `preferences` via
    // a loosely-typed cast so this compiles even before the migration
    // regenerates the Prisma client.
    const staffModel = (prisma as unknown as {
      staff: {
        findUnique: (args: unknown) => Promise<{ preferences?: unknown } | null>
        update: (args: unknown) => Promise<unknown>
      }
    }).staff

    const existing = await staffModel.findUnique({
      where: { id: session.staffId },
      select: { preferences: true },
    })

    const current = (existing?.preferences && typeof existing.preferences === 'object'
      ? (existing.preferences as Record<string, unknown>)
      : {}) as Record<string, unknown>

    const merged: Record<string, unknown> = { ...current }
    if (clean.density) merged.density = clean.density
    if (clean.featureFlags) {
      merged.featureFlags = {
        ...(current.featureFlags as Record<string, boolean> | undefined),
        ...clean.featureFlags,
      }
    }
    if (clean.hasSeen) {
      merged.hasSeen = {
        ...(current.hasSeen as Record<string, boolean> | undefined),
        ...clean.hasSeen,
      }
    }

    await staffModel.update({
      where: { id: session.staffId },
      data: { preferences: merged },
    })

    await audit(req, 'UPDATE', 'Staff', session.staffId, { density: clean.density, featureFlags: clean.featureFlags, hasSeen: clean.hasSeen })

    return NextResponse.json({ persisted: true, preferences: merged })
  } catch (err) {
    // Most likely cause: migration hasn't run yet. The client still holds the
    // value in localStorage so UX is unaffected — just flag persistence off.
    return NextResponse.json(
      {
        persisted: false,
        reason: err instanceof Error ? err.message : 'unknown',
      },
      { status: 200 },
    )
  }
}
