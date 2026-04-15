export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateHyphenRequest, recordHyphenEvent } from '@/lib/hyphen/auth'
import { processHyphenOrderEvent } from '@/lib/hyphen/processor'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/hyphen/orders
//
// Inbound resource per Hyphen SPConnect API v13 §2 (Orders). Hyphen POSTs
// purchase orders here authenticated with a Bearer token issued by
// /api/hyphen/oauth/token.
//
// Flow:
//   1. Authenticate (Bearer token from /api/hyphen/oauth/token)
//   2. Persist raw envelope to HyphenOrderEvent (status=RECEIVED)
//   3. Run SPConnect → Abel Order mapper (processHyphenOrderEvent)
//   4. Ack to Hyphen with mapping result in additionalInfo
//
// On mapping failure we still return HTTP 200 — the envelope is persisted
// and an operator can fix aliases and reprocess via /admin/hyphen. A 500
// would cause Hyphen to retry, which wouldn't help anything.
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const ctx = await authenticateHyphenRequest(request)
  if (!ctx) {
    return NextResponse.json(
      { error: 'invalid_token', error_description: 'Missing or invalid Bearer token' },
      {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer realm="hyphen-spconnect", error="invalid_token"',
        },
      }
    )
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json(
      { correlationId: newCorrelationId(), errorText: 'Bad Request: invalid JSON', details: null },
      { status: 400 }
    )
  }

  const externalId = body?.header?.id ? String(body.header.id) : null
  const builderOrderNumber = body?.header?.builderOrderNumber || null

  let eventId: string
  try {
    eventId = await recordHyphenEvent({
      credentialId: ctx.credentialId,
      kind: 'order',
      externalId,
      builderOrderNumber,
      status: 'RECEIVED',
      rawPayload: body,
    })
  } catch (e: any) {
    logger.error('hyphen_order_record_failed', e)
    return errorResponse(500, 'Failed to record inbound order')
  }

  // Phase 2: run the mapper synchronously. We already persisted the envelope
  // above, so even if this throws we have the raw payload for replay.
  let processResult: Awaited<ReturnType<typeof processHyphenOrderEvent>> | null = null
  try {
    processResult = await processHyphenOrderEvent(eventId)
  } catch (e: any) {
    logger.error('hyphen_order_process_threw', e, { eventId })
    // Fall through to the ack — the event is still in HyphenOrderEvent and
    // can be reprocessed from /admin/hyphen.
  }

  if (processResult?.ok) {
    return NextResponse.json(
      {
        message: 'Order received and mapped to Abel order',
        additionalInfo: {
          eventId,
          builderOrderNumber,
          externalId,
          status: 'PROCESSED',
          mappedOrderId: processResult.orderId,
          orderNumber: processResult.orderNumber,
          warnings: processResult.warnings,
        },
      },
      { status: 200 }
    )
  }

  // Mapping failed, or the processor threw before returning a result. Still
  // return 200 — we kept the envelope and an operator will handle it.
  return NextResponse.json(
    {
      message: processResult
        ? 'Order received but mapping failed — operator intervention required'
        : 'Order received and queued for processing',
      additionalInfo: {
        eventId,
        builderOrderNumber,
        externalId,
        status: processResult ? 'FAILED' : 'RECEIVED',
        mappingError: processResult?.errorMessage,
        errorCode: processResult?.errorCode,
        unresolvedBuilder: processResult?.ok === false ? processResult.unresolvedBuilder : undefined,
        unresolvedSkus: processResult?.ok === false ? processResult.unresolvedSkus : undefined,
        warnings: processResult?.warnings,
      },
    },
    { status: 200 }
  )
}

function newCorrelationId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    '-abel-spconnect'
  )
}

function errorResponse(status: number, errorText: string) {
  return NextResponse.json(
    {
      correlationId: newCorrelationId(),
      errorText,
      details: null,
    },
    { status }
  )
}
