/**
 * Aegis → Brain Ingest
 * ---------------------------------------------------------------
 * One-shot job that pulls last-24h activity out of Aegis and
 * pushes it into the NUC Brain ingest pipeline as Events.
 *
 * Event shape (from NUC_CLUSTER/brain/api/routes.py IngestPayload):
 *   { source, source_id, event_type, title, content, tags, entity_ids }
 *
 * Posts in batches of 100 to:
 *   https://brain.abellumber.com/brain/ingest/batch
 *
 * Protected by Cloudflare Access service token
 * (CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET env vars).
 *
 * Also flips InboxItem.brainAcknowledgedAt = NOW() for items it
 * successfully sent, so hourly re-runs don't duplicate.
 *
 * Usage:
 *   npx tsx scripts/aegis-to-brain-sync.ts            # DRY RUN (default)
 *   npx tsx scripts/aegis-to-brain-sync.ts --commit   # actually POST
 *   npx tsx scripts/aegis-to-brain-sync.ts --commit --limit=5   # test send 5 events
 *   npx tsx scripts/aegis-to-brain-sync.ts --since=2h  # 2 hour lookback instead of 24
 */

import { PrismaClient } from '@prisma/client'

type BrainEvent = {
  source: string
  source_id?: string | null
  event_type: string
  title: string
  content: string
  tags?: string[]
  entity_ids?: string[]
  // raw_data/timestamp/priority are accepted by the IngestPayload model but
  // the canonical 7-field shape above is what the brain persists.
  raw_data?: Record<string, any>
  timestamp?: string
  priority?: string
}

type ArgMap = {
  commit: boolean
  lookbackMs: number
  limit: number | null
}

const BRAIN_BASE_URL =
  process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'
const BRAIN_INGEST_URL = `${BRAIN_BASE_URL}/brain/ingest/batch`
const BATCH_SIZE = 100

function parseArgs(argv: string[]): ArgMap {
  const commit = argv.includes('--commit')
  let lookbackMs = 24 * 60 * 60 * 1000 // 24h default
  let limit: number | null = null

  for (const arg of argv) {
    if (arg.startsWith('--since=')) {
      const raw = arg.slice('--since='.length).trim()
      const m = raw.match(/^(\d+)([hmd])$/)
      if (m) {
        const n = Number(m[1])
        const unit = m[2]
        const mult =
          unit === 'h' ? 3600_000 : unit === 'm' ? 60_000 : 86_400_000
        lookbackMs = n * mult
      }
    } else if (arg.startsWith('--limit=')) {
      const n = Number(arg.slice('--limit='.length))
      if (Number.isFinite(n) && n > 0) limit = n
    }
  }
  return { commit, lookbackMs, limit }
}

function cfHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AbelOS-AegisToBrain/1.0',
  }
  const id = process.env.CF_ACCESS_CLIENT_ID
  const secret = process.env.CF_ACCESS_CLIENT_SECRET
  if (id && secret) {
    h['CF-Access-Client-Id'] = id
    h['CF-Access-Client-Secret'] = secret
  }
  const brainKey = process.env.BRAIN_API_KEY
  if (brainKey) {
    h['X-API-Key'] = brainKey
    h['Authorization'] = `Bearer ${brainKey}` // CF strips X-API-Key
  }
  return h
}

// ──────────────────────────────────────────────────────────────────
// Event builders
// ──────────────────────────────────────────────────────────────────

function moneyFmt(n: number | null | undefined): string {
  const v = Number(n || 0)
  return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function buildOrderEvents(orders: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const o of orders) {
    const placedWindow = o.createdAt
    const deliveredAt = o.status === 'DELIVERED' ? o.updatedAt : null

    const builderName = o.builder?.companyName || 'Unknown builder'
    const line = `${o.orderNumber} — ${builderName} — ${moneyFmt(o.total)}`

    // order_placed (new orders in window)
    out.push({
      source: 'aegis',
      source_id: `order:${o.id}`,
      event_type: 'order_placed',
      title: `Order placed: ${line}`,
      content: [
        `Order: ${o.orderNumber}`,
        `Builder: ${builderName}`,
        `Builder PO: ${o.poNumber || '—'}`,
        `Total: ${moneyFmt(o.total)}`,
        `Status: ${o.status}`,
        `Payment: ${o.paymentStatus} (${o.paymentTerm})`,
        `Order date: ${o.orderDate ? new Date(o.orderDate).toISOString() : '—'}`,
      ].join('\n'),
      tags: ['aegis', 'order', o.status.toLowerCase()],
      entity_ids: [o.builderId],
      raw_data: {
        id: o.id,
        orderNumber: o.orderNumber,
        poNumber: o.poNumber,
        total: o.total,
        status: o.status,
        builderId: o.builderId,
      },
      timestamp: (placedWindow || new Date()).toISOString(),
      priority: o.total > 20000 ? 'P1' : 'P2',
    })

    // order_delivered — fire a second event if it just went to DELIVERED
    if (deliveredAt) {
      out.push({
        source: 'aegis',
        source_id: `order:${o.id}:delivered`,
        event_type: 'order_delivered',
        title: `Order delivered: ${line}`,
        content: `Order ${o.orderNumber} marked DELIVERED. Builder ${builderName}. Total ${moneyFmt(
          o.total
        )}.`,
        tags: ['aegis', 'order', 'delivered'],
        entity_ids: [o.builderId],
        raw_data: { id: o.id, orderNumber: o.orderNumber, total: o.total },
        timestamp: new Date(deliveredAt).toISOString(),
        priority: 'P2',
      })
    }
  }
  return out
}

function buildPOEvents(pos: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const po of pos) {
    const vendorName = po.vendor?.name || 'Unknown vendor'
    const line = `${po.poNumber} — ${vendorName} — ${moneyFmt(po.total)}`

    // po_created on fresh rows
    out.push({
      source: 'aegis',
      source_id: `po:${po.id}`,
      event_type: 'po_created',
      title: `PO created: ${line}`,
      content: [
        `PO: ${po.poNumber}`,
        `Vendor: ${vendorName}`,
        `Total: ${moneyFmt(po.total)}`,
        `Status: ${po.status}`,
        `Category: ${po.category}`,
        `Expected: ${po.expectedDate ? new Date(po.expectedDate).toISOString() : '—'}`,
      ].join('\n'),
      tags: ['aegis', 'po', po.status.toLowerCase()],
      entity_ids: [po.vendorId],
      raw_data: {
        id: po.id,
        poNumber: po.poNumber,
        total: po.total,
        status: po.status,
        vendorId: po.vendorId,
      },
      timestamp: new Date(po.createdAt).toISOString(),
      priority: po.total > 50000 ? 'P1' : 'P2',
    })

    // po_issued — additional event if it was issued to the vendor in-window
    if (po.orderedAt) {
      out.push({
        source: 'aegis',
        source_id: `po:${po.id}:issued`,
        event_type: 'po_issued',
        title: `PO issued: ${line}`,
        content: `PO ${po.poNumber} issued to ${vendorName} at ${new Date(
          po.orderedAt
        ).toISOString()}. Total ${moneyFmt(po.total)}.`,
        tags: ['aegis', 'po', 'issued'],
        entity_ids: [po.vendorId],
        raw_data: { id: po.id, poNumber: po.poNumber, total: po.total },
        timestamp: new Date(po.orderedAt).toISOString(),
        priority: 'P2',
      })
    }
  }
  return out
}

function buildInboxEvents(items: any[]): BrainEvent[] {
  return items.map((it) => ({
    source: 'aegis',
    source_id: `inbox:${it.id}`,
    event_type: 'inbox_item_surfaced',
    title: `Inbox ${it.type}: ${it.title}`,
    content: [
      `Type: ${it.type}`,
      `Source: ${it.source}`,
      `Priority: ${it.priority}`,
      `Status: ${it.status}`,
      it.description ? `\n${it.description}` : '',
      it.financialImpact ? `Financial impact: ${moneyFmt(it.financialImpact)}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    tags: ['aegis', 'inbox', it.type.toLowerCase(), it.priority.toLowerCase()],
    entity_ids: it.entityId ? [it.entityId] : [],
    raw_data: {
      id: it.id,
      type: it.type,
      source: it.source,
      entityType: it.entityType,
      entityId: it.entityId,
      financialImpact: it.financialImpact,
    },
    timestamp: new Date(it.createdAt).toISOString(),
    priority:
      it.priority === 'CRITICAL'
        ? 'P0'
        : it.priority === 'HIGH'
        ? 'P1'
        : it.priority === 'MEDIUM'
        ? 'P2'
        : 'P3',
  }))
}

function buildCollectionEvents(actions: any[]): BrainEvent[] {
  return actions.map((a) => ({
    source: 'aegis',
    source_id: `collection:${a.id}`,
    event_type: 'collection_action_created',
    title: `Collections: ${a.actionType} via ${a.channel}`,
    content: [
      `Action: ${a.actionType}`,
      `Channel: ${a.channel}`,
      `Invoice: ${a.invoiceId}`,
      `Sent at: ${new Date(a.sentAt).toISOString()}`,
      a.notes ? `\n${a.notes}` : '',
      a.response ? `Response: ${a.response}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    tags: ['aegis', 'collections', a.actionType.toLowerCase(), a.channel.toLowerCase()],
    entity_ids: [a.invoiceId],
    raw_data: {
      id: a.id,
      invoiceId: a.invoiceId,
      actionType: a.actionType,
      channel: a.channel,
    },
    timestamp: new Date(a.sentAt).toISOString(),
    priority: a.actionType === 'FINAL_NOTICE' || a.actionType === 'ACCOUNT_HOLD' ? 'P1' : 'P2',
  }))
}

// ──────────────────────────────────────────────────────────────────
// POST
// ──────────────────────────────────────────────────────────────────

type PostResult = {
  ok: boolean
  status: number
  body?: string
  sentCount: number
}

async function postBatch(events: BrainEvent[]): Promise<PostResult> {
  if (events.length === 0) return { ok: true, status: 200, sentCount: 0 }

  const res = await fetch(BRAIN_INGEST_URL, {
    method: 'POST',
    headers: cfHeaders(),
    body: JSON.stringify(events),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text().catch(() => '')
  return {
    ok: res.ok,
    status: res.status,
    body: text.substring(0, 300),
    sentCount: events.length,
  }
}

// ──────────────────────────────────────────────────────────────────
// Core
// ──────────────────────────────────────────────────────────────────

export type SyncReport = {
  dryRun: boolean
  since: string
  eventCounts: Record<string, number>
  totalEvents: number
  sent: number
  batches: Array<{ status: number; ok: boolean; size: number }>
  inboxAckUpdated: number
  errors: string[]
  cfAuth: 'ok' | 'missing'
}

export async function runAegisToBrainSync(
  prisma: PrismaClient,
  opts: { commit: boolean; lookbackMs: number; limit?: number | null } = {
    commit: false,
    lookbackMs: 24 * 60 * 60 * 1000,
    limit: null,
  }
): Promise<SyncReport> {
  const since = new Date(Date.now() - opts.lookbackMs)
  const report: SyncReport = {
    dryRun: !opts.commit,
    since: since.toISOString(),
    eventCounts: {},
    totalEvents: 0,
    sent: 0,
    batches: [],
    inboxAckUpdated: 0,
    errors: [],
    cfAuth: process.env.CF_ACCESS_CLIENT_ID && process.env.CF_ACCESS_CLIENT_SECRET ? 'ok' : 'missing',
  }

  // 1. Pull window data
  const [orders, pos, inboxItems, collections] = await Promise.all([
    prisma.order.findMany({
      where: {
        OR: [
          { createdAt: { gte: since } },
          { status: 'DELIVERED', updatedAt: { gte: since } },
        ],
      },
      include: { builder: { select: { companyName: true } } },
      take: 500,
    }),
    prisma.purchaseOrder.findMany({
      where: {
        OR: [
          { createdAt: { gte: since } },
          { orderedAt: { gte: since } },
        ],
      },
      include: { vendor: { select: { name: true } } },
      take: 500,
    }),
    prisma.inboxItem.findMany({
      where: {
        createdAt: { gte: since },
        brainAcknowledgedAt: null,
      },
      take: 500,
    }),
    prisma.collectionAction.findMany({
      where: { createdAt: { gte: since } },
      take: 500,
    }),
  ])

  // 2. Transform
  const orderEvents = buildOrderEvents(orders)
  const poEvents = buildPOEvents(pos)
  const inboxEvents = buildInboxEvents(inboxItems)
  const collectionEvents = buildCollectionEvents(collections)

  const byType: Record<string, number> = {}
  const allEvents: BrainEvent[] = [
    ...orderEvents,
    ...poEvents,
    ...inboxEvents,
    ...collectionEvents,
  ]
  for (const e of allEvents) {
    byType[e.event_type] = (byType[e.event_type] || 0) + 1
  }
  report.eventCounts = byType
  report.totalEvents = allEvents.length

  // optional --limit (for test sends)
  const eventsToSend = opts.limit ? allEvents.slice(0, opts.limit) : allEvents

  if (!opts.commit) {
    // DRY RUN — don't POST, don't ack
    return report
  }

  if (report.cfAuth === 'missing') {
    report.errors.push('CF_ACCESS_CLIENT_ID / CF_ACCESS_CLIENT_SECRET not set — refusing to POST')
    return report
  }

  // 3. POST in batches of 100
  const sentInboxIds: string[] = []
  for (let i = 0; i < eventsToSend.length; i += BATCH_SIZE) {
    const batch = eventsToSend.slice(i, i + BATCH_SIZE)
    try {
      const res = await postBatch(batch)
      report.batches.push({ status: res.status, ok: res.ok, size: res.sentCount })
      if (res.ok) {
        report.sent += res.sentCount
        for (const ev of batch) {
          if (ev.event_type === 'inbox_item_surfaced' && ev.raw_data?.id) {
            sentInboxIds.push(ev.raw_data.id as string)
          }
        }
      } else {
        report.errors.push(
          `Batch ${i / BATCH_SIZE + 1} HTTP ${res.status}: ${res.body || ''}`.slice(0, 300)
        )
      }
    } catch (err: any) {
      report.batches.push({ status: 0, ok: false, size: batch.length })
      report.errors.push(`Batch ${i / BATCH_SIZE + 1} threw: ${err?.message || err}`)
    }
  }

  // 4. Ack InboxItems we actually pushed
  if (sentInboxIds.length > 0) {
    try {
      const updated = await prisma.inboxItem.updateMany({
        where: { id: { in: sentInboxIds } },
        data: { brainAcknowledgedAt: new Date() },
      })
      report.inboxAckUpdated = updated.count
    } catch (err: any) {
      report.errors.push(`Inbox ack update failed: ${err?.message || err}`)
    }
  }

  return report
}

// ──────────────────────────────────────────────────────────────────
// CLI entry
// ──────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const prisma = new PrismaClient()
  try {
    const report = await runAegisToBrainSync(prisma, {
      commit: args.commit,
      lookbackMs: args.lookbackMs,
      limit: args.limit,
    })

    const tag = report.dryRun ? '[DRY-RUN]' : '[COMMIT]'
    const sinceHrs = Math.round(args.lookbackMs / 3600_000)
    console.log(`${tag} Aegis → Brain sync (last ${sinceHrs}h, since ${report.since})`)
    console.log(`  CF Access auth: ${report.cfAuth}`)
    console.log(`  Total events built: ${report.totalEvents}`)
    for (const [t, n] of Object.entries(report.eventCounts)) {
      console.log(`    ${t}: ${n}`)
    }
    if (!report.dryRun) {
      console.log(`  Events POSTed OK: ${report.sent}`)
      console.log(`  Batches: ${report.batches.length}`)
      for (const b of report.batches) {
        console.log(`    HTTP ${b.status} (size=${b.size}, ok=${b.ok})`)
      }
      console.log(`  InboxItem.brainAcknowledgedAt updates: ${report.inboxAckUpdated}`)
    }
    if (report.errors.length > 0) {
      console.log(`  Errors:`)
      for (const e of report.errors) console.log(`    - ${e}`)
    }

    // exit non-zero if we committed and anything failed
    if (!report.dryRun && (report.errors.length > 0 || report.sent < report.totalEvents)) {
      process.exitCode = 1
    }
  } finally {
    await prisma.$disconnect()
  }
}

// Only run main when invoked as a script (not when imported by the cron route)
const invokedDirectly =
  typeof require !== 'undefined' && require.main === module
if (invokedDirectly) {
  main().catch((err) => {
    console.error('Aegis → Brain sync fatal error:', err)
    process.exit(1)
  })
}
