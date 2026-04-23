export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/admin/integrations-freshness
//
// Returns a dashboard-ready matrix of "when did we last hear from X?"
// per integration. The goal is one screen that tells Nate "InFlow synced
// 4m ago, Hyphen 12h ago, Bolt 2m ago, Stripe 31m ago" without digging.
//
// For each integration we surface:
//   - key              string  — short machine id
//   - label            string  — human name
//   - description      string  — one-liner
//   - status           'green' | 'amber' | 'red' | 'not-wired'
//   - lastSyncAt       ISO | null   — primary freshness timestamp
//   - lastSuccessAt    ISO | null   — last *successful* sync timestamp
//   - secondarySignalAt ISO | null  — co-signal (e.g. MAX(updatedAt) on a
//                                    mirrored table) that proves the pipe
//                                    is actually moving data, not just
//                                    firing empty polls.
//   - signalSource     string        — what produced lastSyncAt
//   - cadenceMinutes   number | null — expected gap between runs
//   - nextExpectedAt   ISO | null    — when the next run is due
//   - minutesSinceLast number | null
//   - cronName         string | null — for click-through to cron history
//   - notes            string | null — anything human-readable (e.g.
//                                      "cron disabled — migrating off Bolt")
//
// Thresholds (relative to cadenceMinutes):
//   green   : ≤ 1×  cadence
//   amber   : 1×–3× cadence, OR last run failed
//   red     : > 3×  cadence, OR last status FAILED + no recovery
//   not-wired: no record of the integration ever
//
// Reads only. No writes to InboxItem or anything else.
// ──────────────────────────────────────────────────────────────────────────

type FreshnessStatus = 'green' | 'amber' | 'red' | 'not-wired'

interface IntegrationFreshness {
  key: string
  label: string
  description: string
  status: FreshnessStatus
  lastSyncAt: string | null
  lastSuccessAt: string | null
  secondarySignalAt: string | null
  signalSource: string
  cadenceMinutes: number | null
  nextExpectedAt: string | null
  minutesSinceLast: number | null
  cronName: string | null
  notes: string | null
}

// Cadence expectations (minutes). Pulled from vercel.json cron schedules /
// REGISTERED_CRONS. Surfacing these here keeps the thresholds self-contained
// so the widget doesn't have to import the cron registry client-side.
const CADENCE: Record<string, number> = {
  inflow: 60,              // inflow-sync runs every hour (0 * * * *)
  hyphen: 60,              // hyphen-sync runs every hour (15 * * * *)
  gmail: 15,               // gmail-sync runs every 15 min
  bolt: 30,                // nominal — currently disabled, see notes below
  stripe: 1440,            // no cron; driven by webhook traffic (daily guard)
  nuc_brain: 240,          // brain-sync runs every 4 hours
  quickbooks: 60,          // hypothetical — QB Desktop sync, often NOT WIRED
  data_quality_watchdog: 1440, // data-quality-watchdog runs daily at noon
}

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const [
      cronLatest,
      inflowUpdated,
      boltUpdated,
      stripeLast,
      nucLastInbox,
      nucLastAck,
      qbLast,
    ] = await Promise.all([
      // Most recent successful CronRun per cron name (and its latest-anything).
      prisma.$queryRawUnsafe<any[]>(`
        WITH latest AS (
          SELECT DISTINCT ON ("name")
            "name", "status", "startedAt", "finishedAt"
          FROM "CronRun"
          ORDER BY "name", "startedAt" DESC
        ),
        last_success AS (
          SELECT DISTINCT ON ("name")
            "name", "startedAt" AS "successAt"
          FROM "CronRun"
          WHERE "status" = 'SUCCESS'
          ORDER BY "name", "startedAt" DESC
        )
        SELECT l."name", l."status", l."startedAt", l."finishedAt", s."successAt"
        FROM latest l
        LEFT JOIN last_success s USING ("name")
      `).catch(() => [] as any[]),

      // InFlow mirrors into InventoryItem — max(updatedAt) is the liveness
      // tell even if the cron log is pruned.
      prisma.$queryRawUnsafe<any[]>(`
        SELECT MAX("updatedAt") AS t FROM "InventoryItem"
      `).catch(() => [] as any[]),

      // Bolt scraper writes rows into BoltWorkOrder — no updatedAt, use
      // createdAt as our proxy.
      prisma.$queryRawUnsafe<any[]>(`
        SELECT MAX("createdAt") AS t FROM "BoltWorkOrder"
      `).catch(() => [] as any[]),

      // Stripe: last Payment row is a cheap proxy for "webhook fired",
      // and InboxItem rows from source='stripe' are a secondary tell.
      prisma.$queryRawUnsafe<any[]>(`
        SELECT
          (SELECT MAX("receivedAt") FROM "Payment") AS payment_at,
          (SELECT MAX("createdAt") FROM "InboxItem"
            WHERE LOWER("source") LIKE '%stripe%') AS inbox_at
      `).catch(() => [] as any[]),

      // NUC engine: inbox items it authored. We match a few plausible
      // source/type tokens so we stay tolerant if naming shifts.
      prisma.$queryRawUnsafe<any[]>(`
        SELECT MAX("createdAt") AS t
        FROM "InboxItem"
        WHERE LOWER("source") LIKE '%nuc%'
           OR LOWER("source") LIKE '%brain%'
           OR LOWER("source") LIKE '%engine%'
           OR LOWER("source") LIKE '%agent%'
      `).catch(() => [] as any[]),

      // NUC ack watermark — "did the brain confirm the loop?"
      prisma.$queryRawUnsafe<any[]>(`
        SELECT MAX("brainAcknowledgedAt") AS t FROM "InboxItem"
      `).catch(() => [] as any[]),

      // QuickBooks: MAX(processedAt) from QBSyncQueue. If the table is empty
      // or processedAt is always null, we treat it as NOT WIRED.
      prisma.$queryRawUnsafe<any[]>(`
        SELECT
          MAX("processedAt") AS t,
          COUNT(*)::int AS total
        FROM "QBSyncQueue"
      `).catch(() => [] as any[]),
    ])

    // Fold cron rows into a lookup {name → {last, status, success}}.
    const cronMap = new Map<
      string,
      { startedAt: Date | null; status: string | null; successAt: Date | null }
    >()
    for (const row of cronLatest) {
      cronMap.set(row.name, {
        startedAt: row.startedAt ? new Date(row.startedAt) : null,
        status: row.status ?? null,
        successAt: row.successAt ? new Date(row.successAt) : null,
      })
    }

    const now = Date.now()

    // ── Builder ────────────────────────────────────────────────────────
    const build = ({
      key,
      label,
      description,
      cronName,
      secondarySignal,
      notes,
      disabled,
    }: {
      key: string
      label: string
      description: string
      cronName: string | null
      secondarySignal: Date | null
      notes?: string | null
      disabled?: boolean
    }): IntegrationFreshness => {
      const cron = cronName ? cronMap.get(cronName) : undefined
      const cadence = CADENCE[key] ?? null

      const lastSyncMs = Math.max(
        cron?.startedAt?.getTime() ?? 0,
        secondarySignal?.getTime() ?? 0,
      )
      const lastSyncAt = lastSyncMs > 0 ? new Date(lastSyncMs).toISOString() : null
      const lastSuccessAt = cron?.successAt ? cron.successAt.toISOString() : null
      const minutesSinceLast = lastSyncMs > 0 ? Math.round((now - lastSyncMs) / 60_000) : null
      const nextExpectedAt =
        cron?.startedAt && cadence
          ? new Date(cron.startedAt.getTime() + cadence * 60_000).toISOString()
          : null

      let status: FreshnessStatus
      if (disabled) {
        status = 'not-wired'
      } else if (lastSyncMs === 0) {
        status = 'not-wired'
      } else if (cron?.status === 'FAILURE' && (minutesSinceLast ?? 0) > (cadence ?? 60)) {
        status = 'red'
      } else if (cadence == null) {
        status = 'green' // webhook-driven, best-effort signal
      } else if ((minutesSinceLast ?? 0) > cadence * 3) {
        status = 'red'
      } else if ((minutesSinceLast ?? 0) > cadence) {
        status = 'amber'
      } else if (cron?.status === 'FAILURE') {
        status = 'amber'
      } else {
        status = 'green'
      }

      return {
        key,
        label,
        description,
        status,
        lastSyncAt,
        lastSuccessAt,
        secondarySignalAt: secondarySignal ? secondarySignal.toISOString() : null,
        signalSource: cronName ? `CronRun:${cronName}` : 'derived',
        cadenceMinutes: cadence,
        nextExpectedAt,
        minutesSinceLast,
        cronName,
        notes: notes ?? null,
      }
    }

    const integrations: IntegrationFreshness[] = [
      build({
        key: 'inflow',
        label: 'InFlow',
        description: 'Inventory + product catalog sync',
        cronName: 'inflow-sync',
        secondarySignal: inflowUpdated[0]?.t ? new Date(inflowUpdated[0].t) : null,
      }),
      build({
        key: 'hyphen',
        label: 'Hyphen',
        description: 'Brookfield BuildPro/SupplyPro',
        cronName: 'hyphen-sync',
        secondarySignal: null,
        notes: '0/80 linked — diagnostic pending',
      }),
      build({
        key: 'gmail',
        label: 'Gmail',
        description: 'Email thread ingestion → comms log',
        cronName: 'gmail-sync',
        secondarySignal: null,
      }),
      build({
        key: 'bolt',
        label: 'Bolt (NUC scraper)',
        description: 'Legacy ECI Bolt work-order scrape',
        cronName: null, // cron disabled 2026-04-23 — see REGISTERED_CRONS
        secondarySignal: boltUpdated[0]?.t ? new Date(boltUpdated[0].t) : null,
        notes: 'Cron disabled 2026-04-23 — Abel migrating off ECI Bolt',
        disabled: true,
      }),
      build({
        key: 'stripe',
        label: 'Stripe',
        description: 'Payment webhooks + charge events',
        cronName: null, // webhook-driven, not cron
        secondarySignal: (() => {
          const row = stripeLast[0]
          if (!row) return null
          const a = row.payment_at ? new Date(row.payment_at).getTime() : 0
          const b = row.inbox_at ? new Date(row.inbox_at).getTime() : 0
          const best = Math.max(a, b)
          return best > 0 ? new Date(best) : null
        })(),
      }),
      build({
        key: 'nuc_brain',
        label: 'NUC Brain',
        description: 'Aegis → NUC engine sync + ack loop',
        cronName: 'brain-sync',
        secondarySignal: (() => {
          const a = nucLastInbox[0]?.t ? new Date(nucLastInbox[0].t).getTime() : 0
          const b = nucLastAck[0]?.t ? new Date(nucLastAck[0].t).getTime() : 0
          const best = Math.max(a, b)
          return best > 0 ? new Date(best) : null
        })(),
      }),
      build({
        key: 'quickbooks',
        label: 'QuickBooks',
        description: 'QB Desktop sync queue',
        cronName: null,
        secondarySignal: (() => {
          const row = qbLast[0]
          if (!row) return null
          if (!row.t || Number(row.total ?? 0) === 0) return null
          return new Date(row.t)
        })(),
        notes: (() => {
          const row = qbLast[0]
          if (!row) return 'NOT WIRED — QBSyncQueue empty'
          if (Number(row.total ?? 0) === 0) return 'NOT WIRED — QBSyncQueue empty'
          if (!row.t) return 'Queue has rows but nothing has processed'
          return null
        })(),
        disabled:
          !qbLast[0] || Number(qbLast[0]?.total ?? 0) === 0 || !qbLast[0]?.t,
      }),
      build({
        key: 'data_quality_watchdog',
        label: 'Data Quality Watchdog',
        description: 'Nightly integrity scan → DATA_QUALITY inbox',
        cronName: 'data-quality-watchdog',
        secondarySignal: null,
      }),
    ]

    const summary = {
      green: integrations.filter((i) => i.status === 'green').length,
      amber: integrations.filter((i) => i.status === 'amber').length,
      red: integrations.filter((i) => i.status === 'red').length,
      notWired: integrations.filter((i) => i.status === 'not-wired').length,
    }

    return NextResponse.json({
      atdateTime: new Date().toISOString(),
      summary,
      integrations,
    })
  } catch (error: any) {
    logger.error('integrations_freshness_failed', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to compute integration freshness' },
      { status: 500 }
    )
  }
}
