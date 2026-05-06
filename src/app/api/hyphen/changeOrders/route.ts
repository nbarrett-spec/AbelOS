export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { authenticateHyphenRequest, recordHyphenEvent } from '@/lib/hyphen/auth'
import { processHyphenChangeOrderEvent } from '@/lib/hyphen/processor'
import { prisma } from '@/lib/prisma'
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
// Flow:
//   1. Authenticate Bearer token.
//   2. Persist envelope to HyphenOrderEvent (kind=changeOrder, status=RECEIVED).
//      Stamp HyphenOrderEvent.changeOrderNumber for fast replay lookup.
//   3. Run processHyphenChangeOrderEvent — resolves parent Order, applies the
//      change (Reschedule / ChangeInDetail / ChangeInHeadingSection / NotesOnly),
//      flips status to MAPPED on success or FAILED otherwise.
//   4. Return 200 with the processing result in additionalInfo. Even if the
//      parent order can't be found, we still 200 — the envelope is stored and
//      an operator can retry from /admin/hyphen.
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
  const changeType = body?.header?.changeType || null

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

  // Stamp changeOrderNumber on the event row. Done as a follow-up UPDATE so
  // we don't fight with the recordHyphenEvent helper signature (which Agent 1
  // owns). Column added by Agent 1's additive migration.
  if (changeOrderNumber) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "HyphenOrderEvent" SET "changeOrderNumber" = $1 WHERE "id" = $2`,
        changeOrderNumber,
        eventId
      )
    } catch (e: any) {
      // Non-fatal — the column may not be present yet in a sandbox env.
      logger.error('hyphen_change_order_stamp_failed', e, { eventId })
    }
  }

  // Run the change-order processor synchronously. We already persisted the
  // envelope above, so any throw still leaves a replayable record.
  let processResult: Awaited<ReturnType<typeof processHyphenChangeOrderEvent>> | null = null
  try {
    processResult = await processHyphenChangeOrderEvent(eventId)
  } catch (e: any) {
    logger.error('hyphen_change_order_process_threw', e, { eventId })
  }

  // Map the processor result onto an SPConnect-style ack.
  let ackStatus = 'RECEIVED'
  let message = 'Change order received and queued for processing'
  if (processResult) {
    if (processResult.success) {
      ackStatus = 'MAPPED'
      message = 'Change order mapped onto Abel order'
    } else if (processResult.errorCode === 'PARENT_ORDER_NOT_FOUND') {
      ackStatus = 'RECEIVED_PENDING_MAPPING'
      message = 'Change order received — parent order not found, will retry on operator action'
    } else if (processResult.errorCode === 'UNKNOWN_CHANGE_TYPE') {
      ackStatus = 'RECEIVED_REJECTED'
      message = 'Change order received but changeType is unrecognized'
    } else if (processResult.errorCode === 'TRANSACTION_FAILED') {
      ackStatus = 'RECEIVED_PENDING_MAPPING'
      message = 'Change order received but transaction failed — operator action required'
    } else {
      ackStatus = 'RECEIVED_PENDING_MAPPING'
      message = `Change order received but mapping failed (${processResult.errorCode || 'unknown'})`
    }
  }

  return NextResponse.json(
    {
      message,
      additionalInfo: {
        eventId,
        builderOrderNumber,
        changeOrderNumber,
        externalId,
        changeType,
        status: ackStatus,
        mappedOrderId: processResult?.mappedOrderId ?? null,
        errorCode: processResult && !processResult.success ? processResult.errorCode : undefined,
        errorMessage:
          processResult && !processResult.success ? processResult.errorMessage : undefined,
        warnings: processResult?.warnings,
        unresolvedSkus:
          processResult && processResult.unresolvedSkus.length > 0
            ? processResult.unresolvedSkus
            : undefined,
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
