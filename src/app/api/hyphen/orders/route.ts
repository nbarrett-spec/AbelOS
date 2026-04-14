export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateHyphenRequest, recordHyphenEvent } from '@/lib/hyphen/auth'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/hyphen/orders
//
// Inbound resource per Hyphen SPConnect API v13 §2 (Orders). Hyphen POSTs
// purchase orders here authenticated with a Bearer token issued by
// /api/hyphen/oauth/token.
//
// Phase 1: This route validates auth, persists the raw envelope to
// HyphenOrderEvent for replay/inspection, and returns 200. The Phase 2
// upgrade will add the SPConnect → Abel Order schema mapping (header,
// builder, supplier, billing, shipping, task, job, items, summary).
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

  // Phase 2 mapping happens here. For now we ack the message so Hyphen
  // doesn't retry while we build the mapper.
  return NextResponse.json(
    {
      message: 'Order received and queued for processing',
      additionalInfo: {
        eventId,
        builderOrderNumber,
        externalId,
        status: 'RECEIVED',
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
