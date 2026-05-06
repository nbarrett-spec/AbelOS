export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/substitutions/audit
//
// Returns the recent substitution audit trail for the catalog browse page.
// Pulls from AuditLog rows with action IN ('APPLY_SUBSTITUTE',
// 'APPLY_SUBSTITUTE_REQUESTED', 'APPROVE_SUBSTITUTE_REQUEST',
// 'REJECT_SUBSTITUTE_REQUEST') and joins back to Product/Staff for display.
//
// Query params:
//   limit=<n>   default 20, max 100
// ──────────────────────────────────────────────────────────────────────────

interface AuditRow {
  id: string
  action: string
  createdAt: string
  staffId: string | null
  staffName: string | null
  jobId: string | null
  jobNumber: string | null
  originalProductId: string | null
  originalSku: string | null
  originalName: string | null
  substituteProductId: string | null
  substituteSku: string | null
  substituteName: string | null
  quantity: number | null
  compatibility: string | null
  severity: string | null
}

const ACTIONS = [
  'APPLY_SUBSTITUTE',
  'APPLY_SUBSTITUTE_REQUESTED',
  'APPROVE_SUBSTITUTE_REQUEST',
  'REJECT_SUBSTITUTE_REQUEST',
] as const

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const rawLimit = parseInt(searchParams.get('limit') || '20', 10)
  const limit = Number.isFinite(rawLimit)
    ? Math.max(1, Math.min(100, rawLimit))
    : 20

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
         a.id,
         a.action,
         a."createdAt",
         a."staffId",
         a.severity,
         a.details,
         s."firstName" AS "staffFirstName",
         s."lastName"  AS "staffLastName"
       FROM "AuditLog" a
       LEFT JOIN "Staff" s ON s.id = a."staffId"
       WHERE a.action = ANY($1::text[])
       ORDER BY a."createdAt" DESC
       LIMIT ${limit}`,
      ACTIONS as unknown as string[]
    )

    if (rows.length === 0) {
      return NextResponse.json({ count: 0, entries: [] })
    }

    // Pull product + job details for the IDs referenced in details JSON
    const productIds = new Set<string>()
    const jobIds = new Set<string>()
    for (const r of rows) {
      const d = r.details ?? {}
      if (d.originalProductId) productIds.add(d.originalProductId)
      if (d.substituteProductId) productIds.add(d.substituteProductId)
      if (d.jobId) jobIds.add(d.jobId)
    }

    const productMap = new Map<string, { sku: string; name: string }>()
    if (productIds.size > 0) {
      const productRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, sku, name FROM "Product" WHERE id = ANY($1::text[])`,
        Array.from(productIds)
      )
      for (const p of productRows) {
        productMap.set(p.id, { sku: p.sku, name: p.name })
      }
    }

    const jobMap = new Map<string, string>()
    if (jobIds.size > 0) {
      const jobRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, "jobNumber" FROM "Job" WHERE id = ANY($1::text[])`,
        Array.from(jobIds)
      )
      for (const j of jobRows) {
        jobMap.set(j.id, j.jobNumber ?? j.id.slice(0, 8))
      }
    }

    const entries: AuditRow[] = rows.map((r) => {
      const d = r.details ?? {}
      const op = d.originalProductId ? productMap.get(d.originalProductId) : null
      const sp = d.substituteProductId
        ? productMap.get(d.substituteProductId)
        : null
      const staffName =
        `${r.staffFirstName ?? ''} ${r.staffLastName ?? ''}`.trim() || null
      return {
        id: r.id,
        action: r.action,
        createdAt:
          r.createdAt instanceof Date
            ? r.createdAt.toISOString()
            : r.createdAt,
        staffId: r.staffId,
        staffName,
        jobId: d.jobId ?? null,
        jobNumber: d.jobNumber ?? (d.jobId ? jobMap.get(d.jobId) ?? null : null),
        originalProductId: d.originalProductId ?? null,
        originalSku: d.originalSku ?? op?.sku ?? null,
        originalName: op?.name ?? null,
        substituteProductId: d.substituteProductId ?? null,
        substituteSku: d.substituteSku ?? sp?.sku ?? null,
        substituteName: sp?.name ?? null,
        quantity: d.quantity == null ? null : Number(d.quantity),
        compatibility: d.compatibility ?? null,
        severity: r.severity ?? null,
      }
    })

    return NextResponse.json({ count: entries.length, entries })
  } catch (err: any) {
    logger.error('[api/ops/substitutions/audit GET] failed', err)
    return NextResponse.json(
      { error: 'Failed to load substitution audit trail', details: err?.message },
      { status: 500 }
    )
  }
}
