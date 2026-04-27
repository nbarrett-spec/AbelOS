export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { invalidateSystemAutomationCache } from '@/lib/system-automations'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/system-automations
// Phase 2 of AUTOMATIONS-HANDOFF.md.
//
// GET   — list every SystemAutomation row (grouped by category in response).
// PATCH — toggle a single row's `enabled` state. Audit-logged.
//
// Auth: ADMIN or MANAGER. Custom rules tab uses a different endpoint;
// this one controls hard-coded cascades and notification side effects.
// ──────────────────────────────────────────────────────────────────────────

interface SystemAutomationRow {
  id: string
  key: string
  name: string
  description: string | null
  category: string
  enabled: boolean
  triggerStatus: string | null
  updatedAt: string | null
  updatedBy: string | null
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    let rows: SystemAutomationRow[] = []
    try {
      rows = await prisma.$queryRawUnsafe<SystemAutomationRow[]>(
        `SELECT "id", "key", "name", "description", "category", "enabled",
                "triggerStatus", "updatedAt"::text AS "updatedAt", "updatedBy"
         FROM "SystemAutomation"
         ORDER BY "category" ASC, "triggerStatus" ASC NULLS LAST, "name" ASC`,
      )
    } catch (e: any) {
      // Table not seeded yet — return an empty list so the UI can prompt
      // the admin to run the seed endpoint.
      if (/relation .* does not exist/i.test(String(e?.message))) {
        return NextResponse.json({ rows: [], grouped: {}, seeded: false })
      }
      throw e
    }

    // Group by category for the UI's section headers.
    const grouped: Record<string, SystemAutomationRow[]> = {}
    for (const r of rows) {
      if (!grouped[r.category]) grouped[r.category] = []
      grouped[r.category].push(r)
    }

    return NextResponse.json({ rows, grouped, seeded: true })
  } catch (error: any) {
    console.error('GET /api/ops/system-automations error:', error)
    return NextResponse.json({ error: 'failed to load automations' }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const { key, enabled } = body as { key?: string; enabled?: boolean }

    if (typeof key !== 'string' || key.length === 0) {
      return NextResponse.json({ error: 'key is required' }, { status: 400 })
    }
    if (typeof enabled !== 'boolean') {
      return NextResponse.json({ error: 'enabled must be a boolean' }, { status: 400 })
    }

    const staffId = auth.session.staffId
    const updated: SystemAutomationRow[] = await prisma.$queryRawUnsafe<SystemAutomationRow[]>(
      `UPDATE "SystemAutomation"
       SET "enabled" = $1, "updatedAt" = NOW(), "updatedBy" = $2
       WHERE "key" = $3
       RETURNING "id", "key", "name", "description", "category", "enabled",
                 "triggerStatus", "updatedAt"::text AS "updatedAt", "updatedBy"`,
      enabled,
      staffId,
      key,
    )

    if (updated.length === 0) {
      return NextResponse.json({ error: `key not found: ${key}` }, { status: 404 })
    }

    // Invalidate the in-memory cache so subsequent isSystemAutomationEnabled()
    // calls on this instance pick up the change immediately.
    invalidateSystemAutomationCache()

    // Audit log so /ops/audit shows who toggled what.
    await audit(request, 'UPDATE', 'SystemAutomation', updated[0].id, {
      key,
      enabled,
      previousState: !enabled,
    })

    return NextResponse.json({ row: updated[0] })
  } catch (error: any) {
    console.error('PATCH /api/ops/system-automations error:', error)
    return NextResponse.json({ error: 'failed to toggle automation' }, { status: 500 })
  }
}
