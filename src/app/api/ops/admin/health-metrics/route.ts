export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { getCronSummaries, detectCronDrift, REGISTERED_CRONS } from '@/lib/cron'

// ─── Types ────────────────────────────────────────────────────────────────
type Severity = 'P0' | 'P1' | 'P2'
type SignalColor = 'GREEN' | 'AMBER' | 'RED'

interface Alert {
  severity: Severity
  message: string
  linkTo?: string
}

// GET /api/ops/admin/health-metrics
// Returns a wide JSON blob of system-health signals across:
//  - DB row counts + orphan/drift counters
//  - Inbox backlog per role / type / age / unassigned
//  - Cascade firing counts (last 24h)
//  - Cron last-run / status summary
//  - Integration lag per provider
//  - Live activity (last 1h)
//  - Aggregated alerts list (P0/P1/P2)
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const [
      rowCounts,
      orphans,
      drift,
      inbox,
      cascades,
      cronSummaries,
      cronDrift,
      integrations,
      activity,
    ] = await Promise.all([
      getRowCounts(),
      getOrphanCounts(),
      getDriftCounts(),
      getInboxHealth(),
      getCascadeActivity(),
      getCronSummaries().catch(() => []),
      detectCronDrift().catch(() => ({ orphaned: [], neverRun: [], stale: [] })),
      getIntegrations(),
      getLiveActivity(),
    ])

    const alerts: Alert[] = []

    // ── Alert roll-up ──────────────────────────────────────────────────
    if (orphans.ordersWithoutJobs > 10) {
      alerts.push({
        severity: 'P1',
        message: `${orphans.ordersWithoutJobs} confirmed orders have no linked Job`,
        linkTo: '/ops/admin/data-quality',
      })
    }
    if (orphans.jobsWithoutPM > 20) {
      alerts.push({
        severity: 'P1',
        message: `${orphans.jobsWithoutPM} active jobs have no assigned PM`,
        linkTo: '/ops/jobs?filter=unassigned',
      })
    }
    if (orphans.invoicesWithoutDueDate > 0) {
      alerts.push({
        severity: 'P2',
        message: `${orphans.invoicesWithoutDueDate} issued invoices are missing a due date`,
        linkTo: '/ops/admin/data-quality',
      })
    }
    if (drift.orderSubtotalVsItems > 0) {
      alerts.push({
        severity: 'P1',
        message: `${drift.orderSubtotalVsItems} orders drift vs line-item totals (>$1)`,
        linkTo: '/ops/admin/data-quality',
      })
    }
    if (drift.invoiceBalanceDueVsComputed > 0) {
      alerts.push({
        severity: 'P0',
        message: `${drift.invoiceBalanceDueVsComputed} invoices: balanceDue ≠ total − amountPaid`,
        linkTo: '/ops/admin/data-quality',
      })
    }
    if (drift.inventoryOnOrderNegative > 0) {
      alerts.push({
        severity: 'P1',
        message: `${drift.inventoryOnOrderNegative} inventory rows have negative onOrder`,
        linkTo: '/ops/inventory',
      })
    }
    if (inbox.oldestPendingAgeDays > 14) {
      alerts.push({
        severity: 'P1',
        message: `Oldest pending inbox item is ${inbox.oldestPendingAgeDays}d old`,
        linkTo: '/ops/inbox',
      })
    }
    if (inbox.unassigned > 100) {
      alerts.push({
        severity: 'P2',
        message: `${inbox.unassigned} unassigned inbox items`,
        linkTo: '/ops/inbox?filter=unassigned',
      })
    }
    // Cron drift
    for (const s of cronDrift.stale) {
      alerts.push({
        severity: 'P0',
        message: `Cron "${s.name}" last ran ${Math.round(s.minutesSinceLastRun / 60)}h ago (expected ≤ ${Math.round(s.expectedMaxGapMinutes / 60)}h)`,
        linkTo: '/ops/admin/crons',
      })
    }
    for (const n of cronDrift.neverRun) {
      alerts.push({
        severity: 'P1',
        message: `Cron "${n.name}" registered but has never fired`,
        linkTo: '/ops/admin/crons',
      })
    }
    // Integrations
    for (const k of Object.keys(integrations) as Array<keyof typeof integrations>) {
      const intg = integrations[k]
      if (intg.status === 'STALE' || intg.status === 'ERROR') {
        alerts.push({
          severity: intg.status === 'ERROR' ? 'P0' : 'P1',
          message: `${k} integration ${intg.status === 'ERROR' ? 'error' : 'stale'} — last sync ${intg.lastSync ? new Date(intg.lastSync).toLocaleString() : 'never'}`,
          linkTo: '/ops/sync-health',
        })
      }
    }

    alerts.sort((a, b) => priorityRank(a.severity) - priorityRank(b.severity))

    // ── Signal colors ──────────────────────────────────────────────────
    const dbSignal: SignalColor =
      drift.invoiceBalanceDueVsComputed > 0 || drift.orderSubtotalVsItems > 50
        ? 'RED'
        : (orphans.ordersWithoutJobs > 10 ||
            orphans.jobsWithoutPM > 20 ||
            drift.orderSubtotalVsItems > 0 ||
            drift.inventoryOnOrderNegative > 0)
          ? 'AMBER'
          : 'GREEN'

    const inboxSignal: SignalColor =
      inbox.oldestPendingAgeDays > 14
        ? 'RED'
        : inbox.oldestPendingAgeDays > 7 || inbox.pendingTotal > 300
          ? 'AMBER'
          : 'GREEN'

    const cascadeTotal24h =
      cascades.ordersAutoCreatingJobs +
      cascades.invoicesAutoPaidOnPayment +
      cascades.deliveriesSchedulingOnOrderFlip
    const cascadeSignal: SignalColor =
      cascadeTotal24h === 0 ? 'RED' : cascadeTotal24h < 3 ? 'AMBER' : 'GREEN'

    const integrationsSignal: SignalColor = (() => {
      const statuses = Object.values(integrations).map((i) => i.status)
      if (statuses.includes('ERROR')) return 'RED'
      if (statuses.includes('STALE')) return 'AMBER'
      return 'GREEN'
    })()

    return NextResponse.json({
      atdateTime: new Date().toISOString(),
      signals: {
        db: dbSignal,
        inbox: inboxSignal,
        cascades: cascadeSignal,
        integrations: integrationsSignal,
      },
      db: { rowCounts, orphans, drift },
      inbox,
      cascades,
      crons: cronSummaries.map((c) => ({
        name: c.name,
        schedule: c.schedule,
        lastRunAt: c.lastRunAt,
        status: c.lastStatus,
        lastDurationMs: c.lastDurationMs,
        lastError: c.lastError,
        successCount24h: c.successCount24h,
        failureCount24h: c.failureCount24h,
      })),
      cronDrift,
      cronRegisteredCount: REGISTERED_CRONS.length,
      integrations,
      activity,
      alerts,
    })
  } catch (error: any) {
    logger.error('health_metrics_failed', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to compute health metrics' },
      { status: 500 }
    )
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function priorityRank(s: Severity): number {
  return s === 'P0' ? 0 : s === 'P1' ? 1 : 2
}

async function getRowCounts(): Promise<Record<string, number>> {
  // One roundtrip per counted model. Counts are cheap on indexed tables.
  const [
    orderCount,
    jobCount,
    invoiceCount,
    paymentCount,
    deliveryCount,
    poCount,
    productCount,
    inboxCount,
    builderCount,
    inventoryCount,
  ] = await Promise.all([
    prisma.order.count().catch(() => 0),
    prisma.job.count().catch(() => 0),
    prisma.invoice.count().catch(() => 0),
    prisma.payment.count().catch(() => 0),
    prisma.delivery.count().catch(() => 0),
    prisma.purchaseOrder.count().catch(() => 0),
    prisma.product.count().catch(() => 0),
    prisma.inboxItem.count().catch(() => 0),
    prisma.builder.count().catch(() => 0),
    prisma.inventoryItem.count().catch(() => 0),
  ])

  return {
    Order: orderCount,
    Job: jobCount,
    Invoice: invoiceCount,
    Payment: paymentCount,
    Delivery: deliveryCount,
    PurchaseOrder: poCount,
    Product: productCount,
    InboxItem: inboxCount,
    Builder: builderCount,
    InventoryItem: inventoryCount,
  }
}

async function getOrphanCounts() {
  // Confirmed orders without a linked job (missed cascade).
  const ordersWithoutJobs = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Order" o
    WHERE o."status"::text IN ('CONFIRMED','IN_PRODUCTION','READY_TO_SHIP','PARTIAL_SHIPPED','SHIPPED','DELIVERED')
      AND NOT EXISTS (SELECT 1 FROM "Job" j WHERE j."orderId" = o."id")
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Active jobs without a PM.
  const jobsWithoutPM = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Job" j
    WHERE j."status"::text NOT IN ('COMPLETE','CLOSED','INVOICED')
      AND j."assignedPMId" IS NULL
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Deliveries flipped COMPLETE but missing completedAt — cascade gap.
  const deliveriesWithoutCompletedAt = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Delivery"
    WHERE "status"::text = 'COMPLETE' AND "completedAt" IS NULL
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Issued invoices missing due date.
  const invoicesWithoutDueDate = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Invoice"
    WHERE "status"::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')
      AND "dueDate" IS NULL
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  return { ordersWithoutJobs, jobsWithoutPM, deliveriesWithoutCompletedAt, invoicesWithoutDueDate }
}

async function getDriftCounts() {
  // Orders where stored subtotal ≠ sum of line-item totals (> $1 tolerance).
  const orderSubtotalVsItems = await prisma.$queryRawUnsafe<any[]>(`
    WITH agg AS (
      SELECT o."id", o."subtotal" AS stored,
             COALESCE(SUM(oi."lineTotal"), 0)::float AS computed
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      GROUP BY o."id", o."subtotal"
    )
    SELECT COUNT(*)::int AS n
    FROM agg
    WHERE ABS(stored - computed) > 1.00
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Invoice balanceDue drifted from (total − amountPaid).
  const invoiceBalanceDueVsComputed = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Invoice"
    WHERE ABS(COALESCE("balanceDue", 0) - (COALESCE("total", 0) - COALESCE("amountPaid", 0))) > 0.01
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Inventory onOrder should never be negative.
  const inventoryOnOrderNegative = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "InventoryItem"
    WHERE "onOrder" < 0
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  return { orderSubtotalVsItems, invoiceBalanceDueVsComputed, inventoryOnOrderNegative }
}

async function getInboxHealth() {
  const pendingTotal = await prisma.inboxItem
    .count({ where: { status: 'PENDING' } })
    .catch(() => 0)

  // Per-role pending count (via assignedTo → Staff.role).
  const byRoleRows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COALESCE(s."role"::text, 'UNASSIGNED') AS role, COUNT(*)::int AS n
    FROM "InboxItem" i
    LEFT JOIN "Staff" s ON s."id" = i."assignedTo"
    WHERE i."status" = 'PENDING'
    GROUP BY COALESCE(s."role"::text, 'UNASSIGNED')
    ORDER BY n DESC
  `).catch(() => [])
  const byRole: Record<string, number> = {}
  for (const r of byRoleRows) byRole[r.role] = Number(r.n || 0)

  const byTypeRows = await prisma.$queryRawUnsafe<any[]>(`
    SELECT "type", COUNT(*)::int AS n
    FROM "InboxItem"
    WHERE "status" = 'PENDING'
    GROUP BY "type"
    ORDER BY n DESC
  `).catch(() => [])
  const byType: Record<string, number> = {}
  for (const r of byTypeRows) byType[r.type] = Number(r.n || 0)

  const oldestRow = await prisma.$queryRawUnsafe<any[]>(`
    SELECT EXTRACT(EPOCH FROM (NOW() - MIN("createdAt"))) / 86400 AS days
    FROM "InboxItem"
    WHERE "status" = 'PENDING'
  `).catch(() => [])
  const oldestPendingAgeDays = Math.round(Number(oldestRow[0]?.days || 0) * 10) / 10

  const unassigned = await prisma.inboxItem
    .count({ where: { status: 'PENDING', assignedTo: null } })
    .catch(() => 0)

  return {
    pendingTotal,
    byRole,
    byType,
    oldestPendingAgeDays,
    unassigned,
  }
}

async function getCascadeActivity() {
  // Jobs created from orders in last 24h (proxy for onOrderConfirmed cascade).
  const ordersAutoCreatingJobs = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Job"
    WHERE "orderId" IS NOT NULL
      AND "createdAt" >= NOW() - INTERVAL '24 hours'
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Invoices flipped to PAID in last 24h with a Payment recorded inside that window (proxy for onPaymentReceived cascade).
  const invoicesAutoPaidOnPayment = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(DISTINCT i."id")::int AS n
    FROM "Invoice" i
    JOIN "Payment" p ON p."invoiceId" = i."id"
    WHERE i."status"::text = 'PAID'
      AND i."paidAt" IS NOT NULL
      AND i."paidAt" >= NOW() - INTERVAL '24 hours'
      AND p."receivedAt" >= NOW() - INTERVAL '24 hours'
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  // Deliveries scheduled via Order flipping READY_TO_SHIP (proxy — count deliveries created in last 24h).
  const deliveriesSchedulingOnOrderFlip = await prisma.$queryRawUnsafe<any[]>(`
    SELECT COUNT(*)::int AS n
    FROM "Delivery"
    WHERE "createdAt" >= NOW() - INTERVAL '24 hours'
  `).then(r => Number(r[0]?.n || 0)).catch(() => 0)

  return {
    ordersAutoCreatingJobs,
    invoicesAutoPaidOnPayment,
    deliveriesSchedulingOnOrderFlip,
  }
}

async function getIntegrations(): Promise<
  Record<string, { lastSync: string | null; status: 'OK' | 'STALE' | 'ERROR' | 'PENDING'; rowsSynced?: number; provider?: string }>
> {
  // Cadence tolerance (minutes) for "STALE" decision — 3x the registered schedule.
  const PROVIDER_CADENCE_MIN: Record<string, number> = {
    INFLOW: 180,
    BOLT: 180,
    HYPHEN: 180,
    BPW: 180,
    BUILDERTREND: 360,
    STRIPE: 1440,
    GMAIL: 45,
  }

  const rows = await prisma.integrationConfig
    .findMany({
      select: {
        provider: true,
        status: true,
        lastSyncAt: true,
        lastSyncStatus: true,
      },
    })
    .catch(() => [])

  const out: Record<string, { lastSync: string | null; status: 'OK' | 'STALE' | 'ERROR' | 'PENDING'; provider?: string }> = {}
  for (const r of rows) {
    const provider = String(r.provider)
    const last = r.lastSyncAt ? new Date(r.lastSyncAt) : null
    const minSince = last ? (Date.now() - last.getTime()) / 60000 : Infinity
    const tolerance = PROVIDER_CADENCE_MIN[provider] ?? 180
    let status: 'OK' | 'STALE' | 'ERROR' | 'PENDING' = 'OK'
    if (r.lastSyncStatus === 'FAILED' || r.status === 'ERROR' || r.status === 'DISCONNECTED') {
      status = 'ERROR'
    } else if (!last) {
      status = 'PENDING'
    } else if (minSince > tolerance) {
      status = 'STALE'
    }
    out[provider.toLowerCase()] = {
      lastSync: last ? last.toISOString() : null,
      status,
      provider,
    }
  }

  // Ensure common providers always appear even if not configured.
  for (const p of ['inflow', 'hyphen', 'stripe', 'gmail']) {
    if (!out[p]) out[p] = { lastSync: null, status: 'PENDING', provider: p.toUpperCase() }
  }
  return out
}

async function getLiveActivity() {
  const [auditLastHour, ordersCreatedLastHour, paymentsReceivedLastHour, invoicesIssuedLastHour] = await Promise.all([
    prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::int AS n FROM "AuditLog" WHERE "createdAt" >= NOW() - INTERVAL '1 hour'
    `).then(r => Number(r[0]?.n || 0)).catch(() => 0),
    prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::int AS n FROM "Order" WHERE "createdAt" >= NOW() - INTERVAL '1 hour'
    `).then(r => Number(r[0]?.n || 0)).catch(() => 0),
    prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::int AS n FROM "Payment" WHERE "receivedAt" >= NOW() - INTERVAL '1 hour'
    `).then(r => Number(r[0]?.n || 0)).catch(() => 0),
    prisma.$queryRawUnsafe<any[]>(`
      SELECT COUNT(*)::int AS n FROM "Invoice" WHERE "issuedAt" >= NOW() - INTERVAL '1 hour'
    `).then(r => Number(r[0]?.n || 0)).catch(() => 0),
  ])

  return {
    auditLastHour,
    ordersCreatedLastHour,
    paymentsReceivedLastHour,
    invoicesIssuedLastHour,
  }
}
