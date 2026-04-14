export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateHyphenRequest, recordHyphenEvent } from '@/lib/hyphen/auth'
import { logger } from '@/lib/logger'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/hyphen/changeOrders
//
// Inbound resource per Hyphen SPConnect API v13 §3 (Change Orders).
// Carries builder reschedules, builder order updates, builder notes, and
// builder option changes — including originalItemDetailWithChanges for
// per-line diffing. Authenticated with a Bearer token from
// /api/hyphen/oauth/token.
//
// Phase 1: validate auth, persist envelope to HyphenOrderEvent, return 200.
// Phase 2 will diff against the existing PO and apply the changes.
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
  const changeOrderNumber = body?.header?.changeOrderNumber || null

  let eventId: string
  try {
    eventId = await recordHyphenEvent({
      credentialId: ctx.credentialId,
      kind: 'changeOrder',
      externalId,
      builderOrderNumber,
      status: 'RECEIVED',
      rawPayload: body,
    })
  } catch (e: any) {
    logger.error('hyphen_change_order_record_failed', e)
    return errorResponse(500, 'Failed to record inbound change order')
  }

  return NextResponse.json(
    {
      message: 'Change order received and queued for processing',
      additionalInfo: {
        eventId,
        builderOrderNumber,
        changeOrderNumber,
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
