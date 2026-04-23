export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Reliability Scorecard
// ─────────────────────────────────────────────────────────────────────────────
// Clint looks at this to know who's slipping. Feeds MRP safety-stock math.
//
// GET /api/ops/vendors/scorecard?days=90
//
// Per-vendor metrics (rolling window, default 90 days):
//   • totalPOs            — # of POs ordered in window
//   • totalSpend          — $ of PO.total in window
//   • onTimeRate          — % of received POs where receivedAt <= expectedDate
//   • avgLeadDays         — actual days from orderedAt → receivedAt
//   • promisedLeadDays    — avg days from orderedAt → expectedDate
//   • leadTimeSlipDays    — avg(actual - promised), negative = faster than promised
//   • fillRate            — % of POs fully RECEIVED vs PARTIALLY_RECEIVED
//   • reliabilityGrade    — A (>=95% on-time) / B (>=85%) / C (>=70%) / D (<70%)
//
// A single CTE does all the math in one round-trip.
// ─────────────────────────────────────────────────────────────────────────────

export interface VendorScorecardRow {
  vendorId: string
  vendorName: string
  vendorCode: string
  totalPOs: number
  totalSpend: number
  onTimeRate: number | null          // 0-100, null if no received-with-expected samples
  avgLeadDays: number | null
  promisedLeadDays: number | null
  leadTimeSlipDays: number | null    // avg(actual - promised); null if no overlap
  fillRate: number | null            // 0-100, null if no terminal POs
  reliabilityGrade: 'A' | 'B' | 'C' | 'D' | null
  lastPoAt: string | null
  // Denominators, so the UI can show "24 of 28 on time"
  receivedWithExpected: number
  onTimeCount: number
  fullyReceived: number
  partiallyReceived: number
}

function gradeFor(onTimeRate: number | null): 'A' | 'B' | 'C' | 'D' | null {
  if (onTimeRate === null || onTimeRate === undefined) return null
  if (onTimeRate >= 95) return 'A'
  if (onTimeRate >= 85) return 'B'
  if (onTimeRate >= 70) return 'C'
  return 'D'
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const daysParam = parseInt(searchParams.get('days') || '90', 10)
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 730 ? daysParam : 90
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

    const rows = await prisma.$queryRawUnsafe<Array<{
      vendorId: string
      vendorName: string
      vendorCode: string
      totalPOs: number
      totalSpend: number
      onTimeRate: number | null
      avgLeadDays: number | null
      promisedLeadDays: number | null
      leadTimeSlipDays: number | null
      fillRate: number | null
      lastPoAt: Date | null
      receivedWithExpected: number
      onTimeCount: number
      fullyReceived: number
      partiallyReceived: number
    }>>(
      `
      WITH window_pos AS (
        SELECT
          po."id",
          po."vendorId",
          po."total",
          po."status",
          po."orderedAt",
          po."expectedDate",
          po."receivedAt",
          po."createdAt"
        FROM "PurchaseOrder" po
        WHERE po."orderedAt" >= $1 OR (po."orderedAt" IS NULL AND po."createdAt" >= $1)
      ),
      metrics AS (
        SELECT
          wp."vendorId",
          COUNT(*)::int AS total_pos,
          COALESCE(SUM(wp."total"), 0)::float AS total_spend,
          -- Received & promised-dated denominator (for on-time rate)
          COUNT(*) FILTER (
            WHERE wp."receivedAt" IS NOT NULL AND wp."expectedDate" IS NOT NULL
          )::int AS received_w_expected,
          COUNT(*) FILTER (
            WHERE wp."receivedAt" IS NOT NULL AND wp."expectedDate" IS NOT NULL
              AND wp."receivedAt" <= wp."expectedDate"
          )::int AS on_time_count,
          -- Actual lead (order → receive)
          AVG(EXTRACT(EPOCH FROM (wp."receivedAt" - wp."orderedAt")) / 86400.0)
            FILTER (WHERE wp."receivedAt" IS NOT NULL AND wp."orderedAt" IS NOT NULL) AS avg_lead_days,
          -- Promised lead (order → expected)
          AVG(EXTRACT(EPOCH FROM (wp."expectedDate" - wp."orderedAt")) / 86400.0)
            FILTER (WHERE wp."expectedDate" IS NOT NULL AND wp."orderedAt" IS NOT NULL) AS avg_promised_days,
          -- Slip: average of (actual - promised) per-PO, only where both dates exist
          AVG(
            EXTRACT(EPOCH FROM (wp."receivedAt" - wp."expectedDate")) / 86400.0
          ) FILTER (
            WHERE wp."receivedAt" IS NOT NULL AND wp."expectedDate" IS NOT NULL
          ) AS avg_slip_days,
          -- Fill rate
          COUNT(*) FILTER (WHERE wp."status" = 'RECEIVED')::int AS fully_received,
          COUNT(*) FILTER (WHERE wp."status" = 'PARTIALLY_RECEIVED')::int AS partially_received,
          MAX(COALESCE(wp."orderedAt", wp."createdAt")) AS last_po_at
        FROM window_pos wp
        GROUP BY wp."vendorId"
      )
      SELECT
        v."id"   AS "vendorId",
        v."name" AS "vendorName",
        v."code" AS "vendorCode",
        m.total_pos            AS "totalPOs",
        m.total_spend          AS "totalSpend",
        CASE WHEN m.received_w_expected > 0
             THEN ROUND((m.on_time_count::numeric / m.received_w_expected::numeric) * 100, 2)::float
             ELSE NULL END     AS "onTimeRate",
        CASE WHEN m.avg_lead_days IS NOT NULL
             THEN ROUND(m.avg_lead_days::numeric, 1)::float
             ELSE NULL END     AS "avgLeadDays",
        CASE WHEN m.avg_promised_days IS NOT NULL
             THEN ROUND(m.avg_promised_days::numeric, 1)::float
             ELSE NULL END     AS "promisedLeadDays",
        CASE WHEN m.avg_slip_days IS NOT NULL
             THEN ROUND(m.avg_slip_days::numeric, 1)::float
             ELSE NULL END     AS "leadTimeSlipDays",
        CASE WHEN (m.fully_received + m.partially_received) > 0
             THEN ROUND(
               (m.fully_received::numeric / (m.fully_received + m.partially_received)::numeric) * 100,
               1
             )::float
             ELSE NULL END     AS "fillRate",
        m.last_po_at           AS "lastPoAt",
        m.received_w_expected  AS "receivedWithExpected",
        m.on_time_count        AS "onTimeCount",
        m.fully_received       AS "fullyReceived",
        m.partially_received   AS "partiallyReceived"
      FROM metrics m
      JOIN "Vendor" v ON v."id" = m."vendorId"
      WHERE m.total_pos > 0
      ORDER BY m.total_spend DESC
      `,
      since,
    )

    const scorecards: VendorScorecardRow[] = rows.map((r) => ({
      vendorId: r.vendorId,
      vendorName: r.vendorName,
      vendorCode: r.vendorCode,
      totalPOs: Number(r.totalPOs || 0),
      totalSpend: Number(r.totalSpend || 0),
      onTimeRate: r.onTimeRate === null || r.onTimeRate === undefined ? null : Number(r.onTimeRate),
      avgLeadDays: r.avgLeadDays === null || r.avgLeadDays === undefined ? null : Number(r.avgLeadDays),
      promisedLeadDays: r.promisedLeadDays === null || r.promisedLeadDays === undefined ? null : Number(r.promisedLeadDays),
      leadTimeSlipDays: r.leadTimeSlipDays === null || r.leadTimeSlipDays === undefined ? null : Number(r.leadTimeSlipDays),
      fillRate: r.fillRate === null || r.fillRate === undefined ? null : Number(r.fillRate),
      reliabilityGrade: gradeFor(
        r.onTimeRate === null || r.onTimeRate === undefined ? null : Number(r.onTimeRate),
      ),
      lastPoAt: r.lastPoAt ? new Date(r.lastPoAt).toISOString() : null,
      receivedWithExpected: Number(r.receivedWithExpected || 0),
      onTimeCount: Number(r.onTimeCount || 0),
      fullyReceived: Number(r.fullyReceived || 0),
      partiallyReceived: Number(r.partiallyReceived || 0),
    }))

    return NextResponse.json({ windowDays: days, since: since.toISOString(), scorecards }, { status: 200 })
  } catch (error) {
    console.error('GET /api/ops/vendors/scorecard error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendor scorecard' },
      { status: 500 },
    )
  }
}
