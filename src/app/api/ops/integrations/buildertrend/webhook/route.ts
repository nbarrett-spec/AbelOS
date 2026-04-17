export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import {
import { audit } from '@/lib/audit'
  verifyWebhookSignature,
  processWebhookPayload,
  type BTWebhookPayload,
} from '@/lib/integrations/buildertrend'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/buildertrend/webhook
// Receive BuilderTrend webhook notifications (NO staff auth on this endpoint)
// BuilderTrend sends webhooks when:
// - Schedule changes (schedule.created, schedule.updated, schedule.deleted)
// - Selections change (selection.created, selection.updated, selection.deleted)
// - Project status changes (project.created, project.updated)
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    // Get the raw body for signature verification
    const body = await request.text()

    // Extract signature from headers
    const signature = request.headers.get('x-buildertrend-signature') || ''

    // Verify webhook signature
    const isValid = await verifyWebhookSignature(body, signature)

    if (!isValid) {
      console.warn('Invalid BuilderTrend webhook signature')
      return safeJson(
        { error: 'Invalid signature' },
        { status: 401 }
      )
    }

    // Parse payload
    let payload: BTWebhookPayload
    try {
      payload = JSON.parse(body)
    } catch (err) {
      return safeJson(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      )
    }

    // Log webhook for audit
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "Activity"
         ("jobId", "type", "title", "description", "metadata")
         SELECT NULL, 'WEBHOOK'::"ActivityType", $1, $2, $3`,
        `BuilderTrend Webhook: ${payload.event}`,
        `Project ${payload.projectId}: ${payload.event}`,
        JSON.stringify(payload)
      )
    } catch (logErr) {
      console.error('Failed to log webhook activity:', logErr)
      // Continue processing even if logging fails
    }

    // Process the webhook asynchronously to avoid timeout
    // In production, this should be queued to a job processor
    processWebhookPayload(payload)
      .catch(err => {
        console.error('Error processing webhook payload:', err)
      })

    // Return 202 Accepted immediately
    return NextResponse.json(
      { acknowledged: true, event: payload.event },
      { status: 202 }
    )
  } catch (error: any) {
    console.error('Error in BuilderTrend webhook handler:', error)
    return safeJson(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// Optional: GET for webhook health check / test
export async function GET(request: NextRequest) {
  return safeJson({
    message: 'BuilderTrend webhook endpoint is ready',
    endpoint: '/api/ops/integrations/buildertrend/webhook',
  })
}
