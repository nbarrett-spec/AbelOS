export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/pm/material-confirm-pending
//
// Returns a lightweight count of jobs this PM needs to act on for the T-7
// Material Confirm Checkpoint. Powers the "Material Confirms Pending: N" row
// on the PM portal index.
//
// MANAGER/ADMIN: returns the org-wide count (everyone's queue).
// PROJECT_MANAGER: only their own jobs.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error
  const { session } = auth

  try {
    const roles = (session.roles || session.role).split(',').map((r) => r.trim().toUpperCase())
    const isManagerOrAbove = roles.includes('ADMIN') || roles.includes('MANAGER')

    // Scoped count — jobs within 7 days, not yet confirmed/escalated.
    // "Active" per brief: CREATED..PUNCH_LIST. COMPLETE/INVOICED/CLOSED are out.
    const params: any[] = []
    let pmFilter = ''
    if (!isManagerOrAbove) {
      pmFilter = `AND j."assignedPMId" = $1`
      params.push(session.staffId)
    }

    const rows = await prisma
      .$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int AS "count"
           FROM "Job" j
          WHERE j."scheduledDate" IS NOT NULL
            AND j."scheduledDate" BETWEEN NOW() AND NOW() + INTERVAL '7 days'
            AND j."status"::text IN ('CREATED','READINESS_CHECK','MATERIALS_LOCKED','IN_PRODUCTION','STAGED','LOADED','IN_TRANSIT','INSTALLING','PUNCH_LIST')
            AND j."materialConfirmedAt" IS NULL
            AND j."materialEscalatedAt" IS NULL
            ${pmFilter}`,
        ...params
      )
      .catch<any[]>((e: any) => {
        // Column may not exist yet in very old snapshots — return 0 quietly.
        if (String(e?.message || '').includes('materialConfirmedAt')) return [{ count: 0 }]
        throw e
      })

    return NextResponse.json({
      count: rows[0]?.count || 0,
      scope: isManagerOrAbove ? 'org' : 'pm',
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
