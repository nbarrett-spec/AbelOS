export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { withCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Scorecard Daily Cron
// ─────────────────────────────────────────────────────────────────────────────
// Daily recompute — writes one VendorScorecardSnapshot row per vendor per day
// so grade / on-time / slip trends can be charted over time, and so MRP
// safety-stock math has a stable read-side source instead of hammering
// PurchaseOrder every evaluation.
//
// Table is created-if-missing (schema.prisma off-limits for this task).
// ─────────────────────────────────────────────────────────────────────────────

function getCronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  return secret && secret.length > 0 ? secret : null
}

async function ensureSnapshotTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "VendorScorecardSnapshot" (
      "id"                    TEXT PRIMARY KEY,
      "vendorId"              TEXT NOT NULL,
      "snapshotDate"          DATE NOT NULL,
      "windowDays"            INTEGER NOT NULL DEFAULT 90,
      "totalPOs"              INTEGER NOT NULL DEFAULT 0,
      "totalSpend"            NUMERIC(14,2) NOT NULL DEFAULT 0,
      "onTimeRate"            NUMERIC(5,2),
      "onTimeCount"           INTEGER NOT NULL DEFAULT 0,
      "receivedWithExpected"  INTEGER NOT NULL DEFAULT 0,
      "avgLeadDays"           NUMERIC(6,2),
      "promisedLeadDays"      NUMERIC(6,2),
      "leadTimeSlipDays"      NUMERIC(6,2),
      "fillRate"              NUMERIC(5,2),
      "fullyReceived"         INTEGER NOT NULL DEFAULT 0,
      "partiallyReceived"     INTEGER NOT NULL DEFAULT 0,
      "reliabilityGrade"      TEXT,
      "safetyStockMultiplier" NUMERIC(4,2) NOT NULL DEFAULT 1.0,
      "createdAt"             TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT "VendorScorecardSnapshot_vendor_date_unique" UNIQUE ("vendorId", "snapshotDate")
    )
  `)
  // Helpful indexes
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VendorScorecardSnapshot_vendorId_idx"
      ON "VendorScorecardSnapshot" ("vendorId")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VendorScorecardSnapshot_snapshotDate_idx"
      ON "VendorScorecardSnapshot" ("snapshotDate")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "VendorScorecardSnapshot_reliabilityGrade_idx"
      ON "VendorScorecardSnapshot" ("reliabilityGrade")
  `)
}

// MRP feedback: grade-A vendors can have leaner safety stock; grade-D inflate it.
function safetyStockMultiplier(grade: 'A' | 'B' | 'C' | 'D' | null): number {
  switch (grade) {
    case 'A': return 0.80  // trusted — 20% less buffer
    case 'B': return 0.90
    case 'C': return 1.10
    case 'D': return 1.50  // chronic slipper — 50% more buffer
    default:  return 1.00
  }
}

function gradeFor(onTimeRate: number | null): 'A' | 'B' | 'C' | 'D' | null {
  if (onTimeRate === null || onTimeRate === undefined) return null
  if (onTimeRate >= 95) return 'A'
  if (onTimeRate >= 85) return 'B'
  if (onTimeRate >= 70) return 'C'
  return 'D'
}

async function recomputeScorecards() {
  await ensureSnapshotTable()

  const windowDays = 90
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000)
  const snapshotDate = new Date()
  snapshotDate.setUTCHours(0, 0, 0, 0)

  const rows = await prisma.$queryRawUnsafe<Array<{
    vendorId: string
    totalPOs: number
    totalSpend: number
    onTimeRate: number | null
    onTimeCount: number
    receivedWithExpected: number
    avgLeadDays: number | null
    promisedLeadDays: number | null
    leadTimeSlipDays: number | null
    fillRate: number | null
    fullyReceived: number
    partiallyReceived: number
  }>>(
    `
    WITH window_pos AS (
      SELECT po."id", po."vendorId", po."total", po."status",
             po."orderedAt", po."expectedDate", po."receivedAt", po."createdAt"
      FROM "PurchaseOrder" po
      WHERE po."orderedAt" >= $1 OR (po."orderedAt" IS NULL AND po."createdAt" >= $1)
    ),
    metrics AS (
      SELECT
        wp."vendorId",
        COUNT(*)::int AS total_pos,
        COALESCE(SUM(wp."total"), 0)::float AS total_spend,
        COUNT(*) FILTER (
          WHERE wp."receivedAt" IS NOT NULL AND wp."expectedDate" IS NOT NULL
        )::int AS received_w_expected,
        COUNT(*) FILTER (
          WHERE wp."receivedAt" IS NOT NULL AND wp."expectedDate" IS NOT NULL
            AND wp."receivedAt" <= wp."expectedDate"
        )::int AS on_time_count,
        AVG(EXTRACT(EPOCH FROM (wp."receivedAt" - wp."orderedAt")) / 86400.0)
          FILTER (WHERE wp."receivedAt" IS NOT NULL AND wp."orderedAt" IS NOT NULL) AS avg_lead_days,
        AVG(EXTRACT(EPOCH FROM (wp."expectedDate" - wp."orderedAt")) / 86400.0)
          FILTER (WHERE wp."expectedDate" IS NOT NULL AND wp."orderedAt" IS NOT NULL) AS avg_promised_days,
        AVG(
          EXTRACT(EPOCH FROM (wp."receivedAt" - wp."expectedDate")) / 86400.0
        ) FILTER (
          WHERE wp."receivedAt" IS NOT NULL AND wp."expectedDate" IS NOT NULL
        ) AS avg_slip_days,
        COUNT(*) FILTER (WHERE wp."status" = 'RECEIVED')::int AS fully_received,
        COUNT(*) FILTER (WHERE wp."status" = 'PARTIALLY_RECEIVED')::int AS partially_received
      FROM window_pos wp
      GROUP BY wp."vendorId"
    )
    SELECT
      m."vendorId",
      m.total_pos AS "totalPOs",
      m.total_spend AS "totalSpend",
      CASE WHEN m.received_w_expected > 0
           THEN ROUND((m.on_time_count::numeric / m.received_w_expected::numeric) * 100, 2)::float
           ELSE NULL END AS "onTimeRate",
      m.on_time_count AS "onTimeCount",
      m.received_w_expected AS "receivedWithExpected",
      CASE WHEN m.avg_lead_days IS NOT NULL
           THEN ROUND(m.avg_lead_days::numeric, 2)::float
           ELSE NULL END AS "avgLeadDays",
      CASE WHEN m.avg_promised_days IS NOT NULL
           THEN ROUND(m.avg_promised_days::numeric, 2)::float
           ELSE NULL END AS "promisedLeadDays",
      CASE WHEN m.avg_slip_days IS NOT NULL
           THEN ROUND(m.avg_slip_days::numeric, 2)::float
           ELSE NULL END AS "leadTimeSlipDays",
      CASE WHEN (m.fully_received + m.partially_received) > 0
           THEN ROUND(
             (m.fully_received::numeric / (m.fully_received + m.partially_received)::numeric) * 100,
             2
           )::float
           ELSE NULL END AS "fillRate",
      m.fully_received AS "fullyReceived",
      m.partially_received AS "partiallyReceived"
    FROM metrics m
    WHERE m.total_pos > 0
    `,
    since,
  )

  let written = 0
  for (const r of rows) {
    const onTime = r.onTimeRate === null || r.onTimeRate === undefined ? null : Number(r.onTimeRate)
    const grade = gradeFor(onTime)
    const safety = safetyStockMultiplier(grade)
    const snapshotId = `vscore_${snapshotDate.toISOString().slice(0, 10)}_${r.vendorId.slice(-10)}`
    try {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "VendorScorecardSnapshot" (
          "id", "vendorId", "snapshotDate", "windowDays",
          "totalPOs", "totalSpend",
          "onTimeRate", "onTimeCount", "receivedWithExpected",
          "avgLeadDays", "promisedLeadDays", "leadTimeSlipDays",
          "fillRate", "fullyReceived", "partiallyReceived",
          "reliabilityGrade", "safetyStockMultiplier"
        ) VALUES (
          $1, $2, $3::date, $4, $5, $6,
          $7, $8, $9,
          $10, $11, $12,
          $13, $14, $15,
          $16, $17
        )
        ON CONFLICT ("vendorId", "snapshotDate") DO UPDATE SET
          "windowDays"            = EXCLUDED."windowDays",
          "totalPOs"              = EXCLUDED."totalPOs",
          "totalSpend"            = EXCLUDED."totalSpend",
          "onTimeRate"            = EXCLUDED."onTimeRate",
          "onTimeCount"           = EXCLUDED."onTimeCount",
          "receivedWithExpected"  = EXCLUDED."receivedWithExpected",
          "avgLeadDays"           = EXCLUDED."avgLeadDays",
          "promisedLeadDays"      = EXCLUDED."promisedLeadDays",
          "leadTimeSlipDays"      = EXCLUDED."leadTimeSlipDays",
          "fillRate"              = EXCLUDED."fillRate",
          "fullyReceived"         = EXCLUDED."fullyReceived",
          "partiallyReceived"     = EXCLUDED."partiallyReceived",
          "reliabilityGrade"      = EXCLUDED."reliabilityGrade",
          "safetyStockMultiplier" = EXCLUDED."safetyStockMultiplier"
        `,
        snapshotId,
        r.vendorId,
        snapshotDate.toISOString().slice(0, 10),
        windowDays,
        Number(r.totalPOs || 0),
        Number(r.totalSpend || 0),
        onTime,
        Number(r.onTimeCount || 0),
        Number(r.receivedWithExpected || 0),
        r.avgLeadDays === null || r.avgLeadDays === undefined ? null : Number(r.avgLeadDays),
        r.promisedLeadDays === null || r.promisedLeadDays === undefined ? null : Number(r.promisedLeadDays),
        r.leadTimeSlipDays === null || r.leadTimeSlipDays === undefined ? null : Number(r.leadTimeSlipDays),
        r.fillRate === null || r.fillRate === undefined ? null : Number(r.fillRate),
        Number(r.fullyReceived || 0),
        Number(r.partiallyReceived || 0),
        grade,
        safety,
      )
      written++
    } catch (e: any) {
      logger.error('vendor_scorecard_upsert_failed', { vendorId: r.vendorId, err: e?.message || String(e) })
    }
  }

  const gradeBuckets = rows.reduce(
    (acc, r) => {
      const g = gradeFor(r.onTimeRate === null || r.onTimeRate === undefined ? null : Number(r.onTimeRate))
      if (g) acc[g]++
      else acc.ungraded++
      return acc
    },
    { A: 0, B: 0, C: 0, D: 0, ungraded: 0 },
  )

  return {
    snapshotDate: snapshotDate.toISOString().slice(0, 10),
    windowDays,
    vendorsProcessed: rows.length,
    snapshotsWritten: written,
    gradeBuckets,
  }
}

async function updateMaterialLeadTimes(): Promise<number> {
  // GAP-12: Compute and update MaterialLeadTime records based on vendor performance
  let alertsCreated = 0

  // Get all vendor-product combinations with 3+ completed POs in the last 90 days
  const vendorProductCombos = await prisma.$queryRawUnsafe<
    Array<{
      vendorId: string
      productId: string
      categoryName: string | null
      completedCount: number
      avgLeadDays: number
      minLeadDays: number
      maxLeadDays: number
      stdDev: number
    }>
  >(
    `
    WITH recent_pos AS (
      SELECT
        po."vendorId",
        poi."productId",
        EXTRACT(EPOCH FROM (po."receivedAt" - po."orderedAt")) / 86400.0 AS lead_days
      FROM "PurchaseOrder" po
      JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po.id
      WHERE po."status" = 'RECEIVED'
        AND po."receivedAt" IS NOT NULL
        AND po."orderedAt" IS NOT NULL
        AND po."receivedAt" >= NOW() - INTERVAL '90 days'
        AND poi."productId" IS NOT NULL
    )
    SELECT
      rp."vendorId",
      rp."productId",
      p."category" AS "categoryName",
      COUNT(*)::int AS "completedCount",
      ROUND(AVG(rp.lead_days)::numeric, 2)::float AS "avgLeadDays",
      ROUND(MIN(rp.lead_days)::numeric, 2)::float AS "minLeadDays",
      ROUND(MAX(rp.lead_days)::numeric, 2)::float AS "maxLeadDays",
      ROUND(STDDEV_POP(rp.lead_days)::numeric, 2)::float AS "stdDev"
    FROM recent_pos rp
    LEFT JOIN "Product" p ON rp."productId" = p.id
    GROUP BY rp."vendorId", rp."productId", p."category"
    HAVING COUNT(*) >= 3
    `
  )

  // For each combo, upsert MaterialLeadTime and check for significant increases
  for (const combo of vendorProductCombos) {
    const newAvgLeadDays = combo.avgLeadDays || 0

    // Get previous MaterialLeadTime record for this vendor-product
    const previous = await prisma.$queryRawUnsafe<
      Array<{ id: string; avgLeadDays: number | null }>
    >(
      `
      SELECT "id", "avgLeadDays"
      FROM "MaterialLeadTime"
      WHERE "vendorId" = $1 AND "productId" = $2
      ORDER BY "createdAt" DESC
      LIMIT 1
      `,
      combo.vendorId,
      combo.productId
    )

    const previousAvgLeadDays = previous.length > 0 && previous[0].avgLeadDays ? Number(previous[0].avgLeadDays) : 0
    const percentIncrease = previousAvgLeadDays > 0
      ? ((newAvgLeadDays - previousAvgLeadDays) / previousAvgLeadDays) * 100
      : 0

    // Upsert MaterialLeadTime record
    const mltId = `mlt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "MaterialLeadTime" (
        "id", "vendorId", "productId", "productCategory",
        "avgLeadDays", "minLeadDays", "maxLeadDays", "stdDev",
        "sampleSize", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, $8,
        $9, NOW(), NOW()
      )
      `,
      mltId,
      combo.vendorId,
      combo.productId,
      combo.categoryName,
      newAvgLeadDays,
      combo.minLeadDays,
      combo.maxLeadDays,
      combo.stdDev,
      combo.completedCount
    )

    // Check for significant lead time increase (>25%)
    if (percentIncrease > 25 && previousAvgLeadDays > 0) {
      // Get vendor name
      const vendor = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
        `SELECT "name" FROM "Vendor" WHERE "id" = $1 LIMIT 1`,
        combo.vendorId
      )

      const vendorName = vendor.length > 0 ? vendor[0].name : combo.vendorId

      // Create ProcurementAlert
      const alertId = `alert_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "ProcurementAlert" (
          "id", type, priority, title, message, "vendorId", "relatedProductId",
          "alertData", "createdAt", "updatedAt"
        ) VALUES (
          $1, 'LEAD_TIME_INCREASE', 'HIGH', $2, $3, $4, $5,
          $6::jsonb, NOW(), NOW()
        )
        `,
        alertId,
        `Lead Time Increase: ${vendorName}`,
        `${vendorName} lead time for ${combo.categoryName || 'products'} increased from ${previousAvgLeadDays.toFixed(1)} to ${newAvgLeadDays.toFixed(1)} days (+${percentIncrease.toFixed(1)}%). ` +
        `Review PO delivery expectations and consider safety stock adjustments.`,
        combo.vendorId,
        combo.productId,
        JSON.stringify({
          vendorId: combo.vendorId,
          productId: combo.productId,
          productCategory: combo.categoryName,
          oldAvgLeadDays: previousAvgLeadDays,
          newAvgLeadDays,
          percentIncrease: Math.round(percentIncrease),
          sampleSize: combo.completedCount,
        })
      )

      alertsCreated++
    }
  }

  return alertsCreated
}

export async function GET(request: NextRequest) {
  const expected = getCronSecret()
  if (!expected) {
    return new Response('Not configured', { status: 500 })
  }
  const secret = request.headers.get('authorization')?.split('Bearer ')[1]
  if (secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return withCronRun('vendor-scorecard-daily', async () => {
    const result = await recomputeScorecards()
    // GAP-12: Compute lead time feedback (non-blocking, errors don't fail the cron)
    const alertsCreated = await updateMaterialLeadTimes().catch((err) => {
      logger.error('vendor_lead_time_update_failed', { err: err?.message || String(err) })
      return 0
    })
    return NextResponse.json({ ...result, leadTimeAlertsCreated: alertsCreated })
  })
}
