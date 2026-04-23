export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/ops/qc/metrics
 *
 * Unified QC metrics across both inspection stores (Inspection + QualityCheck).
 *
 *   {
 *     passRate: { d7, d30, d90 },
 *     topFailureReasons: [{ reason, count }],
 *     perOperator: [{ inspectorId, name, total, passed, failed, passRate }],
 *     totals: { d7, d30, d90 }
 *   }
 *
 * "Pass" counts PASS + PASS_WITH_NOTES + CONDITIONAL_PASS (anything that
 * does not actively block the job).
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const [d7, d30, d90] = await Promise.all([
      passRateForWindow(7),
      passRateForWindow(30),
      passRateForWindow(90),
    ])

    const topFailureReasons = await topFailureReasonsLast(90)
    const perOperator = await perOperatorMetrics(90)

    return NextResponse.json({
      passRate: {
        d7: d7.passRate,
        d30: d30.passRate,
        d90: d90.passRate,
      },
      totals: {
        d7: d7.total,
        d30: d30.total,
        d90: d90.total,
      },
      pass: {
        d7: d7.pass,
        d30: d30.pass,
        d90: d90.pass,
      },
      fail: {
        d7: d7.fail,
        d30: d30.fail,
        d90: d90.fail,
      },
      topFailureReasons,
      perOperator,
    })
  } catch (error: any) {
    console.error('[QC Metrics] Error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

interface WindowStats {
  pass: number
  fail: number
  total: number
  passRate: number
}

async function passRateForWindow(days: number): Promise<WindowStats> {
  let pass = 0
  let fail = 0

  // Inspection table
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) FILTER (WHERE "status" IN ('PASS','PASS_WITH_NOTES','PASSED'))::int as "pass",
        COUNT(*) FILTER (WHERE "status" IN ('FAIL','FAILED'))::int as "fail"
       FROM "Inspection"
       WHERE COALESCE("completedDate", "updatedAt", "createdAt") >= NOW() - ($1 || ' days')::interval
         AND "status" IN ('PASS','PASS_WITH_NOTES','PASSED','FAIL','FAILED')`,
      String(days)
    )
    pass += rows[0]?.pass || 0
    fail += rows[0]?.fail || 0
  } catch { /* table may not exist in early dev envs */ }

  // QualityCheck table
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) FILTER (WHERE result::text IN ('PASS','CONDITIONAL_PASS'))::int as "pass",
        COUNT(*) FILTER (WHERE result::text = 'FAIL')::int as "fail"
       FROM "QualityCheck"
       WHERE "createdAt" >= NOW() - ($1 || ' days')::interval`,
      String(days)
    )
    pass += rows[0]?.pass || 0
    fail += rows[0]?.fail || 0
  } catch { /* ignore */ }

  const total = pass + fail
  const passRate = total > 0 ? Math.round((pass / total) * 1000) / 10 : 0
  return { pass, fail, total, passRate }
}

async function topFailureReasonsLast(days: number) {
  const reasons: Record<string, number> = {}

  // From PunchItem descriptions on jobs that had a FAIL in the window.
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT description FROM "PunchItem"
       WHERE "createdAt" >= NOW() - ($1 || ' days')::interval
         AND description IS NOT NULL`,
      String(days)
    )
    for (const r of rows) {
      const key = normalizeReason(String(r.description || ''))
      if (!key) continue
      reasons[key] = (reasons[key] || 0) + 1
    }
  } catch { /* ignore */ }

  // Also pull from Inspection.notes on FAIL rows.
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT notes FROM "Inspection"
       WHERE "status" IN ('FAIL','FAILED')
         AND COALESCE("completedDate", "updatedAt", "createdAt")
             >= NOW() - ($1 || ' days')::interval
         AND notes IS NOT NULL AND notes <> ''`,
      String(days)
    )
    for (const r of rows) {
      const key = normalizeReason(String(r.notes || ''))
      if (!key) continue
      reasons[key] = (reasons[key] || 0) + 1
    }
  } catch { /* ignore */ }

  return Object.entries(reasons)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([reason, count]) => ({ reason, count }))
}

// Group by a few common defect substrings — matches the checklist options
// in the QC queue modal for consistency.
const COMMON_DEFECT_KEYS = [
  'Door sticks',
  'Scratched finish',
  'Hardware misaligned',
  'Wrong handing',
  'Damaged frame',
  'Short-ship',
  'Trim piece missing',
  'Customer request discrepancy',
]

function normalizeReason(s: string): string {
  const low = s.toLowerCase()
  for (const k of COMMON_DEFECT_KEYS) {
    if (low.includes(k.toLowerCase())) return k
  }
  // Fallback: trim to first sentence.
  const firstLine = s.split(/[.!?\n]/)[0]?.trim() || ''
  return firstLine.slice(0, 80)
}

async function perOperatorMetrics(days: number) {
  const agg: Record<string, { name: string; pass: number; fail: number }> = {}

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT i."inspectorId" as "id",
              COALESCE(s."firstName" || ' ' || s."lastName", 'Unknown') as "name",
              COUNT(*) FILTER (WHERE i."status" IN ('PASS','PASS_WITH_NOTES','PASSED'))::int as "pass",
              COUNT(*) FILTER (WHERE i."status" IN ('FAIL','FAILED'))::int as "fail"
       FROM "Inspection" i
       LEFT JOIN "Staff" s ON s.id = i."inspectorId"
       WHERE COALESCE(i."completedDate", i."updatedAt", i."createdAt")
             >= NOW() - ($1 || ' days')::interval
         AND i."status" IN ('PASS','PASS_WITH_NOTES','PASSED','FAIL','FAILED')
       GROUP BY i."inspectorId", s."firstName", s."lastName"`,
      String(days)
    )
    for (const r of rows) {
      if (!r.id) continue
      agg[r.id] = agg[r.id] || { name: r.name, pass: 0, fail: 0 }
      agg[r.id].pass += r.pass || 0
      agg[r.id].fail += r.fail || 0
    }
  } catch { /* ignore */ }

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT q."inspectorId" as "id",
              COALESCE(s."firstName" || ' ' || s."lastName", 'Unknown') as "name",
              COUNT(*) FILTER (WHERE q.result::text IN ('PASS','CONDITIONAL_PASS'))::int as "pass",
              COUNT(*) FILTER (WHERE q.result::text = 'FAIL')::int as "fail"
       FROM "QualityCheck" q
       LEFT JOIN "Staff" s ON s.id = q."inspectorId"
       WHERE q."createdAt" >= NOW() - ($1 || ' days')::interval
       GROUP BY q."inspectorId", s."firstName", s."lastName"`,
      String(days)
    )
    for (const r of rows) {
      if (!r.id) continue
      agg[r.id] = agg[r.id] || { name: r.name, pass: 0, fail: 0 }
      agg[r.id].pass += r.pass || 0
      agg[r.id].fail += r.fail || 0
    }
  } catch { /* ignore */ }

  return Object.entries(agg)
    .map(([inspectorId, v]) => {
      const total = v.pass + v.fail
      const passRate = total > 0 ? Math.round((v.pass / total) * 1000) / 10 : 0
      return {
        inspectorId,
        name: v.name,
        total,
        passed: v.pass,
        failed: v.fail,
        passRate,
      }
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 20)
}
