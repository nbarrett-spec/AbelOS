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
//
// Iterator pagination
// ───────────────────
// QBXML query types (Customer/Vendor/Item/Invoice/Bill) are paginated. The
// first request emits iterator="Start" + MaxReturned. The response carries
// iteratorID and iteratorRemainingCount. We MUST keep paging the same entity
// type (iterator="Continue" with the saved iteratorID) until
// iteratorRemainingCount = 0 before advancing to the next sequence step.
// Skipping continuations silently drops every record past MaxReturned.

import { prisma } from '@/lib/prisma'
import type { QbRequestKind } from './qbxml'

export interface QueuedRequest {
  queueId: string | null
  kind: QbRequestKind
  fromModifiedDate?: string
  iteratorID?: string
  requestID: string
}

interface IteratorState {
  kind: QbRequestKind
  iteratorID: string
  remaining: number
}

interface SessionState {
  step: number
  iterator?: IteratorState
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

async function readSession(sessionTicket: string): Promise<{
  meta: any
  sessions: Record<string, SessionState>
  session: SessionState
}> {
  const cfg = await prisma.integrationConfig.findUnique({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
  })
  const meta = (cfg?.metadata as any) || {}
  const sessions: Record<string, SessionState> = meta.qbwcSessions || {}
  const session: SessionState = sessions[sessionTicket] || { step: 0 }
  return { meta, sessions, session }
}

async function writeSession(
  sessionTicket: string,
  meta: any,
  sessions: Record<string, SessionState>,
  session: SessionState
): Promise<void> {
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

/**
 * Pull the next pending qbXML request to ship. Returns null when there is
 * nothing left to do this session (which we report to QBWC as "100%
 * complete, send empty string").
 *
 * Priority order:
 *   1. Operator-queued rows in QUEUED status.
 *   2. An in-flight iterator continuation for the current sequence step.
 *      If the previous response left iteratorRemainingCount > 0 we MUST
 *      continue the same query before moving on — otherwise we drop records.
 *   3. The next fresh sequence step (Start of the next entity type).
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

  const { session } = await readSession(sessionTicket)

  // 2. If a paginated query is mid-flight, continue it before moving on.
  if (session.iterator && session.iterator.remaining > 0) {
    const { kind, iteratorID } = session.iterator
    const fromModifiedDate =
      kind === 'InvoiceQuery' || kind === 'BillQuery' ? isoDaysAgo(90) : undefined

    const queueRow = await prisma.qBSyncQueue.create({
      data: {
        action: 'PULL',
        entityType: kind,
        entityId: kind,
        status: 'IN_FLIGHT',
        payload: {
          fromModifiedDate,
          sessionTicket,
          sequenceStep: session.step,
          iteratorID,
          continuation: true,
        },
        attempts: 1,
      },
    })

    return {
      queueId: queueRow.id,
      kind,
      fromModifiedDate,
      iteratorID,
      requestID: queueRow.id,
    }
  }

  // 3. Generate the next fresh sequence step.
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

/**
 * Persist the iterator state from the most recent response. If
 * remaining > 0, the next sendRequestXML will emit a Continue using the
 * saved iteratorID. If remaining === 0 the iterator is cleared and the
 * caller can advance to the next sequence step.
 */
export async function recordIteratorState(
  sessionTicket: string,
  kind: QbRequestKind,
  iteratorID: string | undefined,
  remaining: number | undefined
): Promise<void> {
  const { meta, sessions, session } = await readSession(sessionTicket)
  if (iteratorID && typeof remaining === 'number' && remaining > 0) {
    session.iterator = { kind, iteratorID, remaining }
  } else {
    // Iterator complete (remaining === 0 or absent). Clear any saved state.
    delete session.iterator
  }
  await writeSession(sessionTicket, meta, sessions, session)
}

/**
 * Whether the in-flight iterator (if any) still has more pages.
 * Route handler uses this to decide whether to call advanceSequence().
 */
export async function hasPendingContinuation(sessionTicket: string): Promise<boolean> {
  const { session } = await readSession(sessionTicket)
  return !!(session.iterator && session.iterator.remaining > 0)
}

export async function advanceSequence(sessionTicket: string): Promise<void> {
  const { meta, sessions, session } = await readSession(sessionTicket)
  session.step = (session.step || 0) + 1
  // Defensive: a fresh sequence step is a fresh iterator.
  delete session.iterator
  await writeSession(sessionTicket, meta, sessions, session)
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
  const { session } = await readSession(sessionTicket)
  const seqRemaining = Math.max(0, DEFAULT_SEQUENCE.length - (session.step || 0))
  // If we're paginating mid-step, QBWC's progress bar should not advance.
  // Treat the in-flight iterator as "still on the current step."
  return queuedCount + seqRemaining
}
