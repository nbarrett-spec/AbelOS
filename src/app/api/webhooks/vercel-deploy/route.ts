export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import * as Sentry from '@sentry/nextjs'
import { NextRequest, NextResponse } from 'next/server'
import { verifyHmacSignature } from '@/lib/webhook'
import { logger } from '@/lib/logger'
import { prisma } from '@/lib/prisma'
import { sendEmail } from '@/lib/email'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/webhooks/vercel-deploy — A-OBS-9: Deployment notifications.
//
// Vercel can post deployment lifecycle events to a webhook. This handler
// receives them, verifies the HMAC-SHA1 signature, and surfaces production
// successes/failures via structured logs, Sentry, InboxItem, and email.
//
// ─── Setup (manual, in Vercel dashboard) ──────────────────────────────────
//   1. Vercel Dashboard → Team Settings → Webhooks → Create
//   2. URL:         https://app.abellumber.com/api/webhooks/vercel-deploy
//   3. Events:      deployment.created, deployment.succeeded, deployment.error,
//                   deployment.canceled (optional)
//   4. Project:     abel-builder-platform (or "all projects" if scoping team-wide)
//   5. Copy the generated secret. Add to Vercel project env as
//      VERCEL_DEPLOY_WEBHOOK_SECRET (and any preview/dev environments that
//      should also receive). Redeploy so the env var is live.
//
//   Docs: https://vercel.com/docs/observability/webhooks-overview
//   Signature reference:
//     https://vercel.com/docs/observability/webhooks-overview/webhooks-api#securing-webhooks
//
// ─── Signature verification ───────────────────────────────────────────────
// Vercel signs each request with HMAC-SHA1 using the webhook secret.
// Header:    x-vercel-signature
// Algorithm: sha1
// Payload:   raw request body bytes (NOT a stripe-style "<ts>.<body>" string)
//
// We delegate to verifyHmacSignature(rawBody, header, secret, 'sha1') which
// uses crypto.timingSafeEqual under the hood.
//
// ─── Event payload shape (per Vercel docs) ────────────────────────────────
//   {
//     id: string,
//     type: 'deployment.created' | 'deployment.succeeded' | 'deployment.error' | ...,
//     createdAt: number,
//     payload: {
//       deployment: {
//         id, url, name, meta, target, ...
//       },
//       project: { id, name },
//       team?: { id },
//       user: { id },
//       region?: string
//     }
//   }
//
// Production-only filtering: only deployment events with target='production'
// reach the alerting paths. Preview deploys are noisy; they fall through to
// a structured log line and nothing else.
// ──────────────────────────────────────────────────────────────────────────

interface VercelDeploymentEvent {
  id?: string
  type?: string
  createdAt?: number
  payload?: {
    deployment?: {
      id?: string
      url?: string
      name?: string
      target?: string | null
      meta?: Record<string, any>
    }
    project?: { id?: string; name?: string }
    team?: { id?: string } | null
    user?: { id?: string }
    region?: string
  }
}

// Recipients for production deployment.error emails. Mirrors cron-alerting
// so the same operators see deploy failures and cron failures.
const DEFAULT_RECIPIENTS = [
  'n.barrett@abellumber.com',
  'c.vinson@abellumber.com',
]

function parseRecipients(): string[] {
  const raw = process.env.DEPLOY_FAILURE_NOTIFY_EMAILS
  if (!raw || !raw.trim()) return DEFAULT_RECIPIENTS
  const parsed = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.includes('@'))
  return parsed.length > 0 ? parsed : DEFAULT_RECIPIENTS
}

function isProductionDeploy(event: VercelDeploymentEvent): boolean {
  return event?.payload?.deployment?.target === 'production'
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function renderFailureEmail(event: VercelDeploymentEvent): string {
  const dep = event.payload?.deployment
  const proj = event.payload?.project
  const url = dep?.url ? `https://${dep.url}` : ''
  const safeName = escapeHtml(proj?.name || 'unknown')
  const safeUrl = escapeHtml(url)
  const safeId = escapeHtml(dep?.id || event.id || '')
  const ts = new Date(event.createdAt || Date.now()).toISOString()
  return `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:640px;margin:0 auto;padding:24px;background:#fff;">
      <div style="background:#991b1b;color:#fff;padding:16px 20px;border-radius:8px 8px 0 0;">
        <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Deployment failed</div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;font-family:ui-monospace,monospace;">${safeName}</div>
      </div>
      <div style="border:1px solid #fecaca;border-top:none;border-radius:0 0 8px 8px;padding:20px;">
        <table style="font-size:13px;width:100%;border-collapse:collapse;color:#374151;">
          <tr><td style="padding:4px 0;color:#6b7280;width:130px;">Project</td><td style="font-family:ui-monospace,monospace;">${safeName}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Failed at</td><td>${ts}</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Target</td><td>production</td></tr>
          <tr><td style="padding:4px 0;color:#6b7280;">Deployment ID</td><td style="font-family:ui-monospace,monospace;">${safeId}</td></tr>
          ${url ? `<tr><td style="padding:4px 0;color:#6b7280;">URL</td><td><a href="${safeUrl}" style="color:#dc2626;">${safeUrl}</a></td></tr>` : ''}
        </table>
        <div style="margin-top:20px;">
          <a href="https://vercel.com/dashboard" style="display:inline-block;padding:10px 18px;background:#dc2626;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Open Vercel dashboard</a>
        </div>
      </div>
    </div>
  `.trim()
}

async function writeInboxItem(args: {
  event: VercelDeploymentEvent
  priority: 'HIGH' | 'MEDIUM'
  title: string
  description: string
}): Promise<void> {
  try {
    const dep = args.event.payload?.deployment
    await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: 'vercel-deploy-webhook',
        title: args.title,
        description: args.description,
        priority: args.priority,
        entityType: 'VercelDeployment',
        entityId: dep?.id || args.event.id || 'unknown',
        actionData: {
          eventId: args.event.id,
          eventType: args.event.type,
          deploymentId: dep?.id,
          deploymentUrl: dep?.url,
          project: args.event.payload?.project?.name,
          target: dep?.target,
        } as any,
      },
    })
  } catch (e: any) {
    logger.error('vercel_deploy_inbox_failed', e, {
      eventId: args.event.id,
      eventType: args.event.type,
    })
  }
}

export async function POST(request: NextRequest) {
  // Read raw body once — required for HMAC verification AND JSON parse.
  // Order matters: ALWAYS verify before parsing. A malformed payload from
  // an unauthenticated source must never reach JSON.parse with side effects.
  const rawBody = await request.text()
  const sigHeader = request.headers.get('x-vercel-signature')
  const secret = process.env.VERCEL_DEPLOY_WEBHOOK_SECRET

  // ── Auth ──────────────────────────────────────────────────────────────
  // Hard-fail if secret is missing in production. In dev, allow the request
  // through so local testing with `vercel webhook` doesn't require setup —
  // this matches the inflow/hyphen webhook convention.
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      logger.error(
        'vercel_deploy_secret_missing',
        new Error('VERCEL_DEPLOY_WEBHOOK_SECRET unset in production'),
        {}
      )
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      )
    }
    // Dev fallback only — log loudly and proceed.
    logger.warn('vercel_deploy_secret_missing_dev_fallthrough', {})
  } else {
    try {
      const valid = verifyHmacSignature(rawBody, sigHeader, secret, 'sha1')
      if (!valid) {
        logger.warn('vercel_deploy_signature_invalid', {
          hasHeader: !!sigHeader,
        })
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } catch (e: any) {
      // verifyHmacSignature shouldn't throw — defensive only.
      logger.error('vercel_deploy_signature_error', e, {})
      return NextResponse.json({ error: 'Signature verification failed' }, { status: 400 })
    }
  }

  // ── Parse ─────────────────────────────────────────────────────────────
  let event: VercelDeploymentEvent
  try {
    event = JSON.parse(rawBody) as VercelDeploymentEvent
  } catch (e: any) {
    logger.warn('vercel_deploy_invalid_json', { error: e?.message })
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const eventType = event.type || ''
  const dep = event.payload?.deployment
  const proj = event.payload?.project
  const isProd = isProductionDeploy(event)

  // Always log receipt. Vercel preview-deploy noise lands here and goes no
  // further unless this is a production event.
  logger.info('vercel_deploy_event_received', {
    eventId: event.id,
    eventType,
    deploymentId: dep?.id,
    project: proj?.name,
    target: dep?.target,
    url: dep?.url,
    isProd,
  })

  // ── Route by event type (production only past this point) ─────────────
  try {
    if (!isProd) {
      // Preview/dev deploys: log-only. Return 200 fast — Vercel retries on
      // non-2xx so we want a clean ack.
      return NextResponse.json({ received: true, action: 'log_only' })
    }

    if (eventType === 'deployment.succeeded') {
      logger.info('vercel_deploy_production_succeeded', {
        eventId: event.id,
        deploymentId: dep?.id,
        url: dep?.url,
        project: proj?.name,
      })
      // InboxItem at MEDIUM priority — useful as a forensic record but
      // shouldn't page anyone. Successful deploys are the happy path.
      await writeInboxItem({
        event,
        priority: 'MEDIUM',
        title: `[Deploy OK] ${proj?.name || 'production'}`,
        description:
          `Production deployment succeeded.\n\n` +
          `URL: https://${dep?.url || 'unknown'}\n` +
          `Deployment ID: ${dep?.id || 'unknown'}\n` +
          `Time: ${new Date(event.createdAt || Date.now()).toISOString()}`,
      })
    } else if (eventType === 'deployment.error') {
      logger.error(
        'vercel_deploy_production_failed',
        new Error(`Production deployment ${dep?.id} failed`),
        {
          eventId: event.id,
          deploymentId: dep?.id,
          url: dep?.url,
          project: proj?.name,
        }
      )

      // Sentry — capture as an error so it shows up in the issue feed and
      // alerts wired to Sentry fire.
      try {
        Sentry.captureException(new Error(`Vercel production deploy failed: ${proj?.name}`), {
          tags: {
            webhook: 'vercel-deploy',
            eventType,
            project: proj?.name,
          },
          extra: {
            eventId: event.id,
            deploymentId: dep?.id,
            url: dep?.url,
          },
          level: 'error',
        })
      } catch { /* Sentry capture is best-effort */ }

      // InboxItem HIGH — a failed prod deploy needs eyes on it now.
      await writeInboxItem({
        event,
        priority: 'HIGH',
        title: `[Deploy FAILED] ${proj?.name || 'production'}`,
        description:
          `Production deployment FAILED.\n\n` +
          `URL: https://${dep?.url || 'unknown'}\n` +
          `Deployment ID: ${dep?.id || 'unknown'}\n` +
          `Time: ${new Date(event.createdAt || Date.now()).toISOString()}\n\n` +
          `Open Vercel dashboard for build logs.`,
      })

      // Email via the existing alerting helper. Fire-and-forget per recipient
      // so a single Resend failure doesn't 500 the webhook.
      const recipients = parseRecipients()
      const html = renderFailureEmail(event)
      const subject = `[DEPLOY FAILED] ${proj?.name || 'production'}`
      for (const to of recipients) {
        sendEmail({ to, subject, html }).catch((err) => {
          logger.error('vercel_deploy_email_failed', err, { to })
        })
      }
    } else if (eventType === 'deployment.created') {
      // Lifecycle marker only. No InboxItem, no email — just the structured
      // log above for forensics ("when did this build start?").
    } else {
      // Unknown / canceled / future event types — log and ack.
      logger.info('vercel_deploy_event_unhandled', {
        eventId: event.id,
        eventType,
      })
    }

    return NextResponse.json({ received: true, processed: true })
  } catch (e: any) {
    // Top-level guard: never fail Vercel's webhook on a downstream bug. Vercel
    // retries on non-2xx and we don't want flapping inboxes. Sentry the bug,
    // ack the event.
    try {
      Sentry.captureException(e, {
        tags: { route: '/api/webhooks/vercel-deploy', eventType },
        extra: { eventId: event?.id },
      })
    } catch { /* best-effort */ }
    logger.error('vercel_deploy_handler_error', e, {
      eventId: event?.id,
      eventType,
    })
    return NextResponse.json({ received: true, processed: false })
  }
}
