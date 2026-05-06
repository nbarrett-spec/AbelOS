// ──────────────────────────────────────────────────────────────────────────
// POST /api/v1/qb/qbwc — QuickBooks Web Connector SOAP endpoint
// ──────────────────────────────────────────────────────────────────────────
// QBWC running on Dawn's PC posts SOAP envelopes here on a schedule. We
// implement the 8 required operations and exchange qbXML.
//
// Auth: HTTP Basic (Dawn enters QBWC_USERNAME / QBWC_PASSWORD when QBWC
// prompts for the password the first time). The SOAP <authenticate> call
// also re-presents these as plain SOAP args; we accept either path so QBWC
// works regardless of whether the proxy strips Basic.
//
// Decision note (2026-04-22 in src/lib/integrations/quickbooks.ts):
// QBWC was previously KILLED in favor of QBO. This scaffold revives it per
// Nate's 2026-04-30 request. The QBO path remains the long-term plan; this
// is a pragmatic bridge until QBO OAuth is wired.

import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import {
  parseSoapRequest,
  buildSoapResponse,
  buildSoapFault,
  type QbwcOp,
} from '@/lib/qbwc/soap'
import { buildQbxmlRequest, parseQbxmlResponse, type QbRequestKind } from '@/lib/qbwc/qbxml'
import {
  getNextRequest,
  advanceSequence,
  recordIteratorState,
  clearSession,
  estimateRemaining,
} from '@/lib/qbwc/sequence'
import { upsertParsedResponse } from '@/lib/qbwc/upserts'
import { pushBrainEvents } from '@/lib/qbwc/brain'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─── Auth ─────────────────────────────────────────────────────────────────

function checkBasicAuth(req: NextRequest): boolean {
  const expectedUser = process.env.QBWC_USERNAME
  const expectedPass = process.env.QBWC_PASSWORD
  if (!expectedUser || !expectedPass) return false
  const header = req.headers.get('authorization')
  if (!header || !header.startsWith('Basic ')) {
    // QBWC also passes credentials inside the SOAP <authenticate> envelope
    // — checked separately in the operation handler. Don't fail at this layer.
    return true
  }
  try {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
    const [user, ...rest] = decoded.split(':')
    const pass = rest.join(':')
    return user === expectedUser && pass === expectedPass
  } catch {
    return false
  }
}

function checkSoapAuth(args: Record<string, string>): boolean {
  const expectedUser = process.env.QBWC_USERNAME
  const expectedPass = process.env.QBWC_PASSWORD
  if (!expectedUser || !expectedPass) return false
  return args.strUserName === expectedUser && args.strPassword === expectedPass
}

// ─── Per-op handlers ──────────────────────────────────────────────────────

function soap(op: QbwcOp, value: string): NextResponse {
  return new NextResponse(buildSoapResponse(op, value), {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

function fault(message: string): NextResponse {
  return new NextResponse(buildSoapFault(message), {
    status: 500,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
  })
}

async function handleAuthenticate(args: Record<string, string>): Promise<NextResponse> {
  if (!checkSoapAuth(args)) {
    // QBWC convention: return ['', 'nvu'] (no valid user) inside a
    // string-array result. We approximate with two newline-separated fields,
    // which qbwc tolerates in field-by-field parsing.
    return soap('authenticate', '\nnvu')
  }
  const ticket = randomUUID()
  // Empty company file path → use the currently-open file in QB Desktop.
  return soap('authenticate', `${ticket}\n`)
}

async function handleSendRequestXML(args: Record<string, string>): Promise<NextResponse> {
  const ticket = args.ticket || ''
  const next = await getNextRequest(ticket)
  if (!next) {
    // Empty body = "no more requests"; QBWC will move to closeConnection.
    return soap('sendRequestXML', '')
  }
  const xml = buildQbxmlRequest({
    kind: next.kind,
    fromModifiedDate: next.fromModifiedDate,
    iteratorID: next.iteratorID,
    requestID: next.requestID,
  })
  return soap('sendRequestXML', xml)
}

async function handleReceiveResponseXML(args: Record<string, string>): Promise<NextResponse> {
  const ticket = args.ticket || ''
  const responseXml = args.response || ''
  const hresult = args.hresult || ''
  const message = args.message || ''

  if (hresult) {
    logger.error('qbwc.receiveResponseXML.hresult', { hresult, message })
    return soap('receiveResponseXML', '-1')
  }

  let upsertCounts: Record<string, number> = {}
  let parsedKind: QbRequestKind | 'Unknown' = 'Unknown'
  let iteratorRemaining: number | undefined
  let iteratorID: string | undefined
  try {
    const parsed = parseQbxmlResponse(responseXml)
    parsedKind = parsed.kind
    iteratorRemaining = parsed.header.iteratorRemainingCount
    iteratorID = parsed.header.iteratorID
    if (parsed.header.statusCode !== 0 && parsed.header.statusSeverity === 'Error') {
      logger.error('qbwc.receiveResponseXML.qbxml_error', {
        kind: parsedKind,
        statusCode: parsed.header.statusCode,
        statusMessage: parsed.header.statusMessage,
      })
    }
    const counts = await upsertParsedResponse(parsed)
    upsertCounts = counts as unknown as Record<string, number>

    // Mark the corresponding queue row complete.
    if (parsed.header.requestID) {
      await prisma.qBSyncQueue.updateMany({
        where: { id: parsed.header.requestID, status: 'IN_FLIGHT' },
        data: {
          status: 'COMPLETE',
          processedAt: new Date(),
          responseXml: responseXml.slice(0, 50_000),
        },
      })
    }

    // Persist iterator state BEFORE deciding whether to advance the sequence.
    // QBWC iterator semantics: if the response carries iteratorRemainingCount > 0
    // we MUST send another iterator="Continue" with the saved iteratorID before
    // advancing to the next entity type. Skipping continuations silently drops
    // every record past MaxReturned (500 customers, 200 invoices, etc.).
    if (parsedKind !== 'Unknown') {
      await recordIteratorState(ticket, parsedKind, iteratorID, iteratorRemaining)
    }

    // Push a Brain event summarising this batch.
    await pushBrainEvents([
      {
        source: 'quickbooks',
        event_type: 'qbwc_batch_received',
        source_id: parsed.header.requestID || `${ticket}:${Date.now()}`,
        occurred_at: new Date().toISOString(),
        content: {
          kind: parsedKind,
          counts: upsertCounts,
          ticket,
          iteratorRemaining: iteratorRemaining ?? null,
        },
      },
    ])
  } catch (err: any) {
    logger.error('qbwc.receiveResponseXML.parse_failed', { error: err?.message })
    return soap('receiveResponseXML', '-1')
  }

  // Only advance to the next entity type when the current iterator has
  // drained. Non-paginated queries (e.g. AccountQuery) return no iterator
  // state, in which case we treat the step as complete and advance.
  const stillPaginating = typeof iteratorRemaining === 'number' && iteratorRemaining > 0
  if (!stillPaginating) {
    await advanceSequence(ticket)
  }

  // Return a percent-complete integer in 0–100. Higher == more done.
  const remaining = await estimateRemaining(ticket)
  const total = remaining + 1
  const pct = Math.max(1, Math.min(99, Math.floor(((total - remaining) / total) * 100)))
  return soap('receiveResponseXML', String(remaining === 0 ? 100 : pct))
}

async function handleConnectionError(args: Record<string, string>): Promise<NextResponse> {
  logger.warn('qbwc.connectionError', {
    hresult: args.hresult,
    message: args.message,
  })
  // 'done' tells QBWC to stop trying this session.
  return soap('connectionError', 'done')
}

async function handleGetLastError(_args: Record<string, string>): Promise<NextResponse> {
  return soap('getLastError', '')
}

async function handleCloseConnection(args: Record<string, string>): Promise<NextResponse> {
  await clearSession(args.ticket || '')
  await prisma.integrationConfig.updateMany({
    where: { provider: 'QUICKBOOKS_DESKTOP' },
    data: { lastSyncAt: new Date(), lastSyncStatus: 'SUCCESS', status: 'CONNECTED' },
  })
  return soap('closeConnection', 'OK')
}

// ─── Entry point ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!checkBasicAuth(req)) {
    return new NextResponse('unauthorized', { status: 401 })
  }

  const body = await req.text()
  const parsed = parseSoapRequest(body)
  if (!parsed) {
    return fault('Could not parse SOAP envelope')
  }

  try {
    switch (parsed.op) {
      case 'serverVersion':
        return soap('serverVersion', '1.0.0')
      case 'clientVersion':
        // Empty string == accept whatever QBWC version Dawn is running.
        return soap('clientVersion', '')
      case 'authenticate':
        return await handleAuthenticate(parsed.args)
      case 'sendRequestXML':
        return await handleSendRequestXML(parsed.args)
      case 'receiveResponseXML':
        return await handleReceiveResponseXML(parsed.args)
      case 'connectionError':
        return await handleConnectionError(parsed.args)
      case 'getLastError':
        return await handleGetLastError(parsed.args)
      case 'closeConnection':
        return await handleCloseConnection(parsed.args)
      default:
        return fault(`Unsupported QBWC operation: ${parsed.op}`)
    }
  } catch (err: any) {
    logger.error('qbwc.handler_failed', { op: parsed.op, error: err?.message })
    return fault(err?.message || 'Internal QBWC error')
  }
}

// QBWC also pings the URL with a GET to confirm the .qwc endpoint resolves.
export async function GET(): Promise<NextResponse> {
  return new NextResponse(
    'Abel Aegis QBWC SOAP endpoint. POST SOAP 1.1 envelopes here.',
    { status: 200, headers: { 'Content-Type': 'text/plain' } }
  )
}
