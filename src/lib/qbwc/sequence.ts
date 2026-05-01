// ──────────────────────────────────────────────────────────────────────────
// QBWC sync sequence
// ──────────────────────────────────────────────────────────────────────────
// On every QBWC poll cycle, when sendRequestXML is called we either:
//   1. Pop the next QbSyncQueue row in QUEUED status (priority order), or
//   2. Generate the next item in our default fixed sequence (full pull).
//
// The default full-pull sequence runs once on first connect and any time the
// queue is empty: customers → vendors → accounts → items → invoices(90d) →
// bills(90d). On the next idle poll we re-seed the sequence so the data
// stays warm.

import { prisma } from '@/lib/prisma'
import type { QbRequestKind } from './qbxml'

export interface QueuedRequest {
  queueId: string | null
  kind: QbRequestKind
  fromModifiedDate?: string
  iteratorID?: string
  requestID: string
}

const DEFAULT_SEQUENCE: QbRequestKind[] = [
  'CustomerQuery',
  'VendorQuery',
  'AccountQuery',
  'ItemQuery',
  'InvoiceQuery',
  'BillQuery',
]

function isoDaysAgo(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Pull the next pending qbXML request to ship. Returns null when there is
 * nothing left to do this session (which we report to QBWC as "100%
 * complete, send empty string").
 */
export async function getNextRequest(sessionTicket: string): Promise<QueuedRequest | null> {
  // 1. Anything operator-queued first.
  const queued = await prisma.qBSyncQueue.findFirst({
    where: { status: 'QUEUED' },
    orderBy: { createdAt: 'asc' },
  })
  if (queued) {
    await prisma.qBSyncQueue.update({
      where: { id: queued.id },
      data: { status: 'IN_FLIGHT', attempts: { increment: 1 } },
    })
    return {
      queueId: queued.id,
      kind: (queued.entityType as QbRequestKind) || 'CustomerQuery',
      requestID: queued.id,
    }
  }

  // 2. Otherwise generate from the default sequence. We track progress by
  // counting how many sequence items we've seeded and committed in this
  // session — stored as IntegrationConfig.metadata.qbwcSession[ticket].step.
  const cfg = await prisma.integrationConfig.findUnique({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
  })
  const meta = (cfg?.metadata as any) || {}
  const sessions = meta.qbwcSessions || {}
  const session = sessions[sessionTicket] || { step: 0 }

  if (session.step >= DEFAULT_SEQUENCE.length) {
    return null // session complete
  }

  const kind = DEFAULT_SEQUENCE[session.step]
  const fromModifiedDate =
    kind === 'InvoiceQuery' || kind === 'BillQuery' ? isoDaysAgo(90) : undefined

  // Seed a queue row so receiveResponseXML can correlate.
  const queueRow = await prisma.qBSyncQueue.create({
    data: {
      action: 'PULL',
      entityType: kind,
      entityId: kind, // synthetic — full-pull batches don't map to one entity
      status: 'IN_FLIGHT',
      payload: { fromModifiedDate, sessionTicket, sequenceStep: session.step },
      attempts: 1,
    },
  })

  return {
    queueId: queueRow.id,
    kind,
    fromModifiedDate,
    requestID: queueRow.id,
  }
}

export async function advanceSequence(sessionTicket: string): Promise<void> {
  const cfg = await prisma.integrationConfig.findUnique({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
  })
  const meta = (cfg?.metadata as any) || {}
  const sessions = meta.qbwcSessions || {}
  const session = sessions[sessionTicket] || { step: 0 }
  session.step = (session.step || 0) + 1
  sessions[sessionTicket] = session
  await prisma.integrationConfig.upsert({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
    create: {
      provider: 'QUICKBOOKS_DESKTOP',
      name: 'QuickBooks Desktop (QBWC)',
      status: 'CONFIGURING',
      metadata: { ...meta, qbwcSessions: sessions },
    },
    update: { metadata: { ...meta, qbwcSessions: sessions } },
  })
}

export async function clearSession(sessionTicket: string): Promise<void> {
  const cfg = await prisma.integrationConfig.findUnique({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
  })
  const meta = (cfg?.metadata as any) || {}
  const sessions = meta.qbwcSessions || {}
  delete sessions[sessionTicket]
  if (cfg) {
    await prisma.integrationConfig.update({
      where: { provider: 'QUICKBOOKS_DESKTOP' },
      data: { metadata: { ...meta, qbwcSessions: sessions } },
    })
  }
}

/** How many sequence steps we estimate remaining — drives QBWC's progress bar. */
export async function estimateRemaining(sessionTicket: string): Promise<number> {
  const queuedCount = await prisma.qBSyncQueue.count({ where: { status: 'QUEUED' } })
  const cfg = await prisma.integrationConfig.findUnique({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
  })
  const meta = (cfg?.metadata as any) || {}
  const session = meta.qbwcSessions?.[sessionTicket] || { step: 0 }
  const seqRemaining = Math.max(0, DEFAULT_SEQUENCE.length - (session.step || 0))
  return queuedCount + seqRemaining
}
