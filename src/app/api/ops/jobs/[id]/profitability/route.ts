export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

// ──────────────────────────────────────────────────────────────────────────
// JOB PROFITABILITY (single job) — FIX-23
//
// Lightweight margin calc for the Job Profile page card. The full
// reports-page Job Profitability tab lives at /api/ops/jobs/profitability.
// This route is per-job: revenue (invoice total), COGS (order-item cost),
// labor (order-item laborCost), gross margin $/%, and a green/yellow/red
// status pill driver.
//
// Path note: the task brief refers to this file as
// `src/app/api/ops/jobs/[jobId]/profitability/route.ts`. The repo uses `[id]`
// as the dynamic segment for /api/ops/jobs/* (see [id]/profile/route.ts).
// Adding a sibling `[jobId]` segment would crash Next.js routing, so this
// file is created at `[id]/profitability/route.ts` — the URL the page hits
// (/api/ops/jobs/${jobId}/profitability) is identical either way.
// ──────────────────────────────────────────────────────────────────────────

type ProfitabilityStatus = 'green' | 'yellow' | 'red' | 'empty'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const jobId = params.id
  if (!jobId) {
    return NextResponse.json({ error: 'jobId required' }, { status: 400 })
  }

  try {
    // ── 1. Resolve order linkage for this job ──
    const jobRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT j."id" AS "jobId", j."orderId"
         FROM "Job" j
        WHERE j."id" = $1
        LIMIT 1`,
      jobId
    )
    const job = jobRows[0]
    if (!job) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const orderId: string | null = job.orderId || null

    // ── 2. Revenue: sum of invoice totals tied to this job (or its order). ──
    const invoiceRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT
          COALESCE(SUM(i."total"::float), 0)::float    AS "revenue",
          COUNT(*)::int                                  AS "invoiceCount"
         FROM "Invoice" i
        WHERE (i."jobId" = $1 OR ($2 <> '' AND i."orderId" = $2))
          AND i."status"::text <> 'VOID'`,
      jobId,
      orderId || ''
    )
    const revenue: number = Number(invoiceRows[0]?.revenue || 0)
    const invoiceCount: number = Number(invoiceRows[0]?.invoiceCount || 0)

    // ── 3. COGS + labor: order-item rollup against the linked Order. ──
    let cogs = 0
    let laborCost = 0
    if (orderId) {
      const costRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT
            COALESCE(SUM(oi."quantity" * p."cost"), 0)::float                  AS "cogs",
            COALESCE(SUM(oi."quantity" * COALESCE(p."laborCost", 0)), 0)::float AS "laborCost"
           FROM "OrderItem" oi
           JOIN "Product"   p ON p."id" = oi."productId"
          WHERE oi."orderId" = $1`,
        orderId
      )
      cogs = Number(costRows[0]?.cogs || 0)
      laborCost = Number(costRows[0]?.laborCost || 0)
    }

    // ── 4. Gross margin + status pill. ──
    const totalCost = cogs + laborCost
    const grossMarginDollars = revenue - totalCost
    const grossMarginPercent =
      revenue > 0 ? (grossMarginDollars / revenue) * 100 : 0

    let status: ProfitabilityStatus
    if (invoiceCount === 0 || revenue <= 0) {
      status = 'empty'
    } else if (grossMarginPercent > 25) {
      status = 'green'
    } else if (grossMarginPercent >= 15) {
      status = 'yellow'
    } else {
      status = 'red'
    }

    return safeJson({
      jobId,
      orderId,
      revenue: Math.round(revenue * 100) / 100,
      cogs: Math.round(cogs * 100) / 100,
      laborCost: Math.round(laborCost * 100) / 100,
      grossMargin: {
        dollars: Math.round(grossMarginDollars * 100) / 100,
        percent: Math.round(grossMarginPercent * 10) / 10,
      },
      status,
      invoiceCount,
    })
  } catch (error) {
    console.error('[Job Profitability single] Error:', error)
    return NextResponse.json(
      { error: 'Profitability calculation failed' },
      { status: 500 }
    )
  }
}
