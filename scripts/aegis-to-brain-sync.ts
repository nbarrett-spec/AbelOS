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

// ── Communications (Gmail/Quo/SMS) ──────────────────────────────────────
// Sends a per-message event so Brain can correlate to entity timelines.
// Channel is preserved as a tag; subject + sender go into title/content.
function buildCommunicationEvents(comms: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const c of comms) {
    const dir = (c.direction || '').toLowerCase()
    const ch = (c.channel || 'email').toLowerCase()
    const who = c.toEmail || c.fromEmail || c.toPhone || c.fromPhone || c.contactName || 'unknown'
    const subj = (c.subject || c.summary || c.body || '').toString().slice(0, 140)
    const evt: BrainEvent = {
      source: ch === 'sms' || ch === 'phone' || ch === 'quo' ? 'cowork' : 'gmail',
      source_id: `comm:${c.id}`,
      event_type: dir === 'inbound' ? `${ch}_inbound` : `${ch}_outbound`,
      title: `${ch.toUpperCase()} ${dir} · ${subj || who}`.slice(0, 220),
      content: [
        `From: ${c.fromEmail || c.fromPhone || c.fromName || '—'}`,
        `To: ${c.toEmail || c.toPhone || c.toName || '—'}`,
        c.subject ? `Subject: ${c.subject}` : '',
        c.aiSummary ? `Summary: ${c.aiSummary}` : '',
        c.body ? `Body: ${String(c.body).slice(0, 800)}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['communication', ch, dir, c.aiSentiment].filter(Boolean) as string[],
      raw_data: {
        attachmentCount: c.attachmentCount,
        hasAttachments: c.hasAttachments,
        actionItems: c.aiActionItems,
        communityId: c.communityId,
      },
      timestamp: c.sentAt?.toISOString?.() || c.createdAt?.toISOString?.(),
      priority: dir === 'inbound' ? 'P2' : 'P3',
    }
    out.push(evt)
  }
  return out
}

// ── Builder updates ─────────────────────────────────────────────────────
function buildBuilderEvents(builders: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const b of builders) {
    out.push({
      source: 'aegis',
      source_id: `builder:${b.id}`,
      event_type: 'builder_updated',
      title: `Builder updated: ${b.companyName || b.name || b.id}`.slice(0, 220),
      content: [
        `Builder: ${b.companyName || b.name}`,
        b.tier ? `Tier: ${b.tier}` : '',
        b.status ? `Status: ${b.status}` : '',
        b.healthScore != null ? `Health: ${b.healthScore}` : '',
        b.contactEmail ? `Contact: ${b.contactEmail}` : '',
        b.totalRevenue != null ? `YTD revenue: $${Number(b.totalRevenue).toFixed(0)}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['builder', b.status, b.tier].filter(Boolean) as string[],
      timestamp: b.updatedAt?.toISOString?.(),
      priority: 'P3',
    })
  }
  return out
}

// ── Vendor updates ──────────────────────────────────────────────────────
function buildVendorEvents(vendors: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const v of vendors) {
    out.push({
      source: 'aegis',
      source_id: `vendor:${v.id}`,
      event_type: 'vendor_updated',
      title: `Vendor updated: ${v.name || v.id}`.slice(0, 220),
      content: [
        `Vendor: ${v.name}`,
        v.status ? `Status: ${v.status}` : '',
        v.contactEmail ? `Contact: ${v.contactEmail}` : '',
        v.paymentTerms ? `Terms: ${v.paymentTerms}` : '',
        v.creditLimit != null ? `Credit limit: $${v.creditLimit}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['vendor', v.status].filter(Boolean) as string[],
      timestamp: v.updatedAt?.toISOString?.(),
      priority: 'P3',
    })
  }
  return out
}

// ── Pricing changes (top movers as one summary event) ──────────────────
function buildPricingEvents(rows: any[]): BrainEvent[] {
  if (!rows.length) return []
  const top = rows.slice(0, 30)
  const lines = top.map(p => {
    const sku = p.productSku || p.productId || '?'
    const price = p.customPrice != null ? `$${Number(p.customPrice).toFixed(2)}` : '—'
    return `  ${sku.padEnd(14)} ${price}  builder=${p.builderId?.slice(0,12) || '?'}`
  }).join('\n')
  return [{
    source: 'aegis',
    source_id: `pricing:${Math.floor(Date.now() / 60000)}`,  // bucket per minute, dedup-safe
    event_type: 'pricing_changes_summary',
    title: `Pricing updates: ${rows.length} changes (${top.length} shown)`,
    content: `Recent BuilderPricing rows updated:\n\n${lines}`,
    tags: ['pricing', 'aegis'],
    priority: 'P2',
  }]
}

// ── Job lifecycle ──────────────────────────────────────────────────────
function buildJobEvents(jobs: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const j of jobs) {
    out.push({
      source: 'aegis',
      source_id: `job:${j.id}`,
      event_type: 'job_updated',
      title: `Job ${j.jobNumber || j.id} ${j.builderName ? '· ' + j.builderName : ''} · ${j.status || ''}`.slice(0, 220),
      content: [
        `Builder: ${j.builderName || '—'}`,
        j.status ? `Status: ${j.status}` : '',
        j.jobAddress ? `Address: ${j.jobAddress}` : '',
        j.community ? `Community: ${j.community}` : '',
        j.lotBlock ? `Lot/Block: ${j.lotBlock}` : '',
        j.bwpPoNumber ? `Builder PO: ${j.bwpPoNumber}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['job', j.status].filter(Boolean) as string[],
      timestamp: j.updatedAt?.toISOString?.(),
      priority: 'P3',
    })
  }
  return out
}

// ── Hyphen orders, per builder (multi-tenant: Brookfield/Toll/Shaddock) ─
function buildHyphenOrderEvents(orders: any[]): BrainEvent[] {
  const out: BrainEvent[] = []
  for (const o of orders) {
    const builder = o.builderName || 'unknown'
    const tag = builder.toLowerCase().replace(/\s+/g, '_')
    out.push({
      source: 'aegis',
      source_id: `hyphen_order:${o.id}`,
      event_type: 'hyphen_order',
      title: `Hyphen ${builder} · ${o.builderOrderNum || o.hyphId || o.id} · ${o.orderStatus || o.builderStatus || ''}`.slice(0, 220),
      content: [
        `Builder: ${builder}`,
        o.subdivision ? `Community: ${o.subdivision}` : '',
        o.lotBlockPlan ? `Lot/Block: ${o.lotBlockPlan}` : '',
        o.address ? `Address: ${o.address}` : '',
        o.task ? `Task: ${o.task}` : '',
        o.total != null ? `Total: $${Number(o.total).toFixed(2)}` : '',
        o.orderStatus ? `Status: ${o.orderStatus}` : '',
        o.builderStatus ? `Builder status: ${o.builderStatus}` : '',
      ].filter(Boolean).join('\n'),
      tags: ['hyphen', 'builder_order', tag, o.orderStatus].filter(Boolean) as string[],
      timestamp: o.updatedAt?.toISOString?.(),
      priority: 'P3',
    })
  }
  return out
}

// ── Inventory + product summary (volume guard) ────────────────────────
// 3000+/day product changes would flood Brain. Send one aggregate event per cycle.
function buildInventorySummaryEvent(productCount: number, inventoryCount: number, since: Date): BrainEvent[] {
  if (productCount === 0 && inventoryCount === 0) return []
  return [{
    source: 'aegis',
    source_id: `invsummary:${Math.floor(Date.now() / 60000)}`,
    event_type: 'inventory_summary',
    title: `Inventory pulse: ${productCount} products · ${inventoryCount} stock changes`,
    content: `Since ${since.toISOString()}:\n  • Product rows updated: ${productCount}\n  • InventoryItem rows updated: ${inventoryCount}`,
    tags: ['inventory', 'inflow'],
    priority: 'P3',
  }]
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
  const [
    orders, pos, inboxItems, collections,
    comms, builderUpdates, vendorUpdates, pricingChanges, jobUpdates,
    productCount, inventoryCount, hyphenOrders,
  ] = await Promise.all([
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
    // CommunicationLog — Gmail/Quo/SMS landing point. Cap at 200/window so a
    // backlog from cold-boot doesn't slam Brain with thousands of events.
    prisma.communicationLog.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 200,
    }),
    // Builders updated by sync (BuilderTrend/Hyphen) but not just-created
    prisma.builder.findMany({
      where: { updatedAt: { gte: since } },
      take: 200,
    }),
    // Vendors updated (InFlow vendor sync, manual edits)
    prisma.vendor.findMany({
      where: { updatedAt: { gte: since } },
      take: 200,
    }),
    // BuilderPricing updates — sample, since 1k+/day is too much detail.
    // Brain gets a summary event with the top movers per cycle.
    prisma.builderPricing.findMany({
      where: { updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    }),
    // Job lifecycle changes — Job has builderName denormalized, no relation
    prisma.job.findMany({
      where: { updatedAt: { gte: since } },
      take: 100,
    }),
    // Product/inventory volume — sent as aggregate counts only
    prisma.product.count({ where: { updatedAt: { gte: since } } }),
    prisma.inventoryItem.count({ where: { updatedAt: { gte: since } } }),
    // HyphenOrder updates per builder (Brookfield/Toll/Shaddock multi-tenant).
    // builderName is denormalized on the row, so Brain gets per-tenant tags.
    prisma.hyphenOrder.findMany({
      where: { updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: 300,
    }).catch((err: any) => {
      // HyphenOrder schema is stable (72 rows currently); guard only against
      // table-not-found in case this script runs against a stripped-down DB.
      console.warn('hyphenOrder pull failed:', err?.message)
      return []
    }),
  ])

  // 2. Transform
  const orderEvents = buildOrderEvents(orders)
  const poEvents = buildPOEvents(pos)
  const inboxEvents = buildInboxEvents(inboxItems)
  const collectionEvents = buildCollectionEvents(collections)
  const commEvents = buildCommunicationEvents(comms)
  const builderEvents = buildBuilderEvents(builderUpdates)
  const vendorEvents = buildVendorEvents(vendorUpdates)
  const pricingEvents = buildPricingEvents(pricingChanges)
  const jobEvents = buildJobEvents(jobUpdates)
  const inventorySummary = buildInventorySummaryEvent(productCount, inventoryCount, since)
  const hyphenOrderEvents = buildHyphenOrderEvents(hyphenOrders)

  const byType: Record<string, number> = {}
  const allEvents: BrainEvent[] = [
    ...orderEvents,
    ...poEvents,
    ...inboxEvents,
    ...collectionEvents,
    ...commEvents,
    ...builderEvents,
    ...vendorEvents,
    ...pricingEvents,
    ...jobEvents,
    ...inventorySummary,
    ...hyphenOrderEvents,
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
