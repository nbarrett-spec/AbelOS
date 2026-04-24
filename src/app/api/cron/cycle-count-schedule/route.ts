export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { logger } from '@/lib/logger'

// ─────────────────────────────────────────────────────────────────────────────
// Weekly Cycle-Count Scheduler
//
// Fires Mondays 6 AM CT (11 UTC). Ranks every active, physical Product by a
// risk score composed of last-90-day shortages (InboxItem type=MRP_SHORTAGE),
// log-scaled unit value (Product.basePrice), order-line velocity, and
// days-since-last-count (InventoryItem.lastCountedAt). Picks top 20 and drops
// them into a new CycleCountBatch for Gunner (WAREHOUSE_LEAD) to scan through.
//
//   riskScore = shortages*3 + ln(basePrice+1) + velocity*2 + daysSinceCount
//
// Idempotency: only creates one batch per weekStart (Monday). A second run in
// the same week returns 'skipped'. The /ops/portal/warehouse/cycle-count page
// is the intake surface; InboxItem type=CYCLE_COUNT_WEEKLY nudges Gunner.
//
// Register in vercel.json as: { path: '/api/cron/cycle-count-schedule', schedule: '0 11 * * 1' }
// ─────────────────────────────────────────────────────────────────────────────

const CRON_NAME = 'cycle-count-schedule'
const TOP_N = 20

interface ScheduleResult {
  asOf: string
  weekStart: string
  batchId: string | null
  skusSelected: number
  assignedToId: string | null
  inboxItemId: string | null
  skipped: boolean
  skipReason?: string
  durationMs: number
  errors: string[]
}

let tablesEnsured = false
async function ensureTables() {
  if (tablesEnsured) return
  // Idempotent DDL. Schema lives here because the directive is "no
  // prisma/schema.prisma touches this turn" — raw SQL owns these tables
  // until the next migration pass pulls them in.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CycleCountBatch" (
      "id" TEXT PRIMARY KEY,
      "weekStart" DATE NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'OPEN',
      "assignedToId" TEXT REFERENCES "Staff"(id),
      "totalSkus" INT NOT NULL,
      "completedSkus" INT NOT NULL DEFAULT 0,
      "discrepanciesFound" INT NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMPTZ DEFAULT NOW(),
      "closedAt" TIMESTAMPTZ
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "idx_cyclecountbatch_weekstart"
      ON "CycleCountBatch" ("weekStart")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_cyclecountbatch_status"
      ON "CycleCountBatch" ("status")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "CycleCountLine" (
      "id" TEXT PRIMARY KEY,
      "batchId" TEXT NOT NULL REFERENCES "CycleCountBatch"(id) ON DELETE CASCADE,
      "productId" TEXT NOT NULL REFERENCES "Product"(id),
      "sku" TEXT NOT NULL,
      "binLocation" TEXT,
      "expectedQty" INT NOT NULL,
      "countedQty" INT,
      "variance" INT,
      "countedAt" TIMESTAMPTZ,
      "countedById" TEXT REFERENCES "Staff"(id),
      "notes" TEXT,
      "status" TEXT DEFAULT 'PENDING'
    )
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_cyclecountline_batch"
      ON "CycleCountLine" ("batchId")
  `)
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_cyclecountline_status"
      ON "CycleCountLine" ("status")
  `)
  tablesEnsured = true
}

function mondayOf(d: Date): Date {
  const copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = copy.getUTCDay() // 0=Sun .. 6=Sat
  const diff = day === 0 ? -6 : 1 - day
  copy.setUTCDate(copy.getUTCDate() + diff)
  return copy
}

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expected = process.env.CRON_SECRET
  if (!expected || cronSecret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runScheduler('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runScheduler('manual')
}

async function runScheduler(
  triggeredBy: 'schedule' | 'manual'
): Promise<NextResponse<ScheduleResult>> {
  const runId = await startCronRun(CRON_NAME, triggeredBy)
  const started = Date.now()
  const weekStart = mondayOf(new Date())
  const result: ScheduleResult = {
    asOf: new Date().toISOString(),
    weekStart: weekStart.toISOString().slice(0, 10),
    batchId: null,
    skusSelected: 0,
    assignedToId: null,
    inboxItemId: null,
    skipped: false,
    durationMs: 0,
    errors: [],
  }

  try {
    await ensureTables()

    // Idempotency: one batch per weekStart.
    const existing: Array<{ id: string }> = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "CycleCountBatch" WHERE "weekStart" = $1::date LIMIT 1`,
      result.weekStart
    )
    if (existing.length > 0) {
      result.batchId = existing[0].id
      result.skipped = true
      result.skipReason = `Batch already exists for week ${result.weekStart}`
      result.durationMs = Date.now() - started
      await finishCronRun(runId, 'SUCCESS', result.durationMs, { result })
      return NextResponse.json(result)
    }

    // Pick Gunner (the WAREHOUSE_LEAD row, active).
    const leadRows: Array<{ id: string }> = await prisma.$queryRawUnsafe(`
      SELECT s.id FROM "Staff" s
      WHERE s.active = true
        AND (s.role = 'WAREHOUSE_LEAD'
             OR (s.roles IS NOT NULL AND s.roles ILIKE '%WAREHOUSE_LEAD%'))
      ORDER BY s."createdAt" ASC
      LIMIT 1
    `)
    result.assignedToId = leadRows[0]?.id ?? null

    // Rank products by risk score. Restrict to physical SKUs:
    //  * active
    //  * priced (non-zero basePrice — filters labor/discount ghosts)
    //  * has an InventoryItem row (filters catalog-only SKUs)
    //  * exclude obvious non-physical categories/names
    //
    // Scoring:
    //   shortages (distinct MRP_SHORTAGE inbox items in last 90d) × 3
    //   + ln(basePrice + 1) × 1
    //   + velocity (distinct orders touching the SKU in last 90d) × 2
    //   + daysSinceCount (default 90 when never counted) × 1
    const topRows: Array<{
      productId: string
      sku: string
      productName: string
      binLocation: string | null
      onHand: number
      basePrice: number
      shortages: number
      velocity: number
      daysSinceCount: number
      riskScore: number
    }> = await prisma.$queryRawUnsafe(`
      WITH shortages AS (
        SELECT (ii."actionData"->>'productId')::text AS "productId",
               COUNT(DISTINCT ii.id)::int AS shortages
        FROM "InboxItem" ii
        WHERE ii."type" = 'MRP_SHORTAGE'
          AND ii."createdAt" >= NOW() - INTERVAL '90 days'
          AND ii."actionData"->>'productId' IS NOT NULL
        GROUP BY (ii."actionData"->>'productId')::text
      ),
      velocity AS (
        SELECT oi."productId", COUNT(DISTINCT oi."orderId")::int AS velocity
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        WHERE o."createdAt" >= NOW() - INTERVAL '90 days'
        GROUP BY oi."productId"
      )
      SELECT
        p.id                                        AS "productId",
        p.sku                                       AS "sku",
        p.name                                      AS "productName",
        ii."binLocation"                            AS "binLocation",
        COALESCE(ii."onHand", 0)::int               AS "onHand",
        COALESCE(p."basePrice", 0)::float           AS "basePrice",
        COALESCE(s.shortages, 0)::int               AS "shortages",
        COALESCE(v.velocity, 0)::int                AS "velocity",
        COALESCE(EXTRACT(DAY FROM (NOW() - ii."lastCountedAt"))::int, 90)::int AS "daysSinceCount",
        (
          COALESCE(s.shortages, 0) * 3.0
          + LN(COALESCE(p."basePrice", 0) + 1) * 1.0
          + COALESCE(v.velocity, 0) * 2.0
          + COALESCE(EXTRACT(DAY FROM (NOW() - ii."lastCountedAt"))::int, 90) * 1.0
        )::float AS "riskScore"
      FROM "Product" p
      INNER JOIN "InventoryItem" ii ON ii."productId" = p.id
      LEFT JOIN shortages s ON s."productId" = p.id
      LEFT JOIN velocity  v ON v."productId" = p.id
      WHERE p.active = true
        AND COALESCE(p."basePrice", 0) > 0
        AND p.category NOT ILIKE '%labor%'
        AND p.name NOT ILIKE 'Labor%'
        AND p.name NOT ILIKE 'Discount%'
        AND p.name NOT ILIKE 'MISC%'
      ORDER BY "riskScore" DESC, p.sku ASC
      LIMIT ${TOP_N}
    `)

    if (topRows.length === 0) {
      result.skipped = true
      result.skipReason = 'No candidate SKUs found'
      result.durationMs = Date.now() - started
      await finishCronRun(runId, 'SUCCESS', result.durationMs, { result })
      return NextResponse.json(result)
    }

    const batchId = 'ccb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "CycleCountBatch"
        ("id", "weekStart", "status", "assignedToId", "totalSkus", "completedSkus", "discrepanciesFound", "createdAt")
      VALUES ($1, $2::date, 'OPEN', $3, $4, 0, 0, NOW())
      `,
      batchId,
      result.weekStart,
      result.assignedToId,
      topRows.length
    )

    // Batch-insert the 20 lines.
    for (const row of topRows) {
      const lineId = 'ccl_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "CycleCountLine"
          ("id", "batchId", "productId", "sku", "binLocation", "expectedQty", "status")
        VALUES ($1, $2, $3, $4, $5, $6, 'PENDING')
        `,
        lineId,
        batchId,
        row.productId,
        row.sku,
        row.binLocation,
        Number(row.onHand) || 0
      )
    }

    result.batchId = batchId
    result.skusSelected = topRows.length

    // Nudge Gunner via InboxItem. Idempotent via batchId-keyed entityId.
    if (result.assignedToId) {
      const inboxId = 'inb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10)
      const topSample = topRows
        .slice(0, 5)
        .map((r) => `${r.sku} (risk ${r.riskScore.toFixed(0)})`)
        .join(', ')
      try {
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "InboxItem"
            ("id", "type", "source", "title", "description", "priority", "status",
             "entityType", "entityId", "assignedTo",
             "actionData", "createdAt", "updatedAt")
          VALUES (
            $1, 'CYCLE_COUNT_WEEKLY', 'cycle-count-schedule', $2, $3, 'MEDIUM', 'PENDING',
            'CycleCountBatch', $4, $5,
            $6::jsonb, NOW(), NOW()
          )
          `,
          inboxId,
          `Weekly cycle count: ${topRows.length} SKUs to count (week of ${result.weekStart})`,
          `Top-risk SKUs this week: ${topSample}. Open /ops/portal/warehouse/cycle-count to start scanning.`,
          batchId,
          result.assignedToId,
          JSON.stringify({
            batchId,
            weekStart: result.weekStart,
            skusSelected: topRows.length,
            href: '/ops/portal/warehouse/cycle-count',
          })
        )
        result.inboxItemId = inboxId
      } catch (e: any) {
        // Inbox nudge is best-effort — the batch itself is the source of truth.
        result.errors.push(`inbox_create_failed: ${e?.message || String(e)}`)
        logger.error('cycle_count_inbox_failed', e, { batchId })
      }
    }

    result.durationMs = Date.now() - started
    await finishCronRun(runId, 'SUCCESS', result.durationMs, { result })
    return NextResponse.json(result)
  } catch (err: any) {
    result.errors.push(err?.message || String(err))
    result.durationMs = Date.now() - started
    logger.error('cycle_count_schedule_failed', err, { weekStart: result.weekStart })
    await finishCronRun(runId, 'FAILURE', result.durationMs, {
      error: err?.message || String(err),
      result,
    })
    return NextResponse.json(result, { status: 500 })
  }
}
