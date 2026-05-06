# Webhook Receiver Contract

Every inbound webhook route in this codebase must score 6/6 on the
[hardening sweep](../scripts/webhook-hardening-sweep.ts). This doc is the
canonical pattern — copy it when adding a new receiver.

## The six dimensions

| # | Dimension | What it prevents |
|---|---|---|
| 1 | **Signature verification** | Forged inbound events. Use HMAC if the provider signs the body, OAuth/Bearer if they pass a rotating token, or OIDC for Google Pub/Sub. Static shared secrets are last resort. |
| 2 | **Timing-safe compare** | Token-recovery side channels. Always go through `verifyHmacSignature`, `verifyBearerToken`, `verifyGooglePubSubToken` from `@/lib/webhook` — they all use `crypto.timingSafeEqual`. Never `=== 'Bearer ' + secret`. |
| 3 | **Raw body before parse** | HMAC over reformatted JSON drift. If the provider signs the body, call `await request.text()` once and verify against that string. Only `JSON.parse(rawBody)` *after* verification passes. |
| 4 | **Idempotency** | Provider retries creating duplicate writes. Call `ensureIdempotent('<provider>', eventId, eventType, payload)` — returns `'duplicate'` for events already seen. Short-circuit with 200 on duplicate. |
| 5 | **Payload persistence** | Lost events when the processor crashes. The 4-arg form of `ensureIdempotent` writes the payload to `WebhookEvent.payload`; the retry cron + `/admin/webhooks` UI replay from there. |
| 6 | **Audit logging** | Forensic blind spots. Every receipt + every outcome goes into `AuditLog` (via `logAudit` or the wrappers `audit`, `auditBuilder`, `withAudit`). Severity escalates to `WARN` on auth-reject, `CRITICAL` on processing failure. |

## Reference template

```ts
export const runtime = 'nodejs'   // crypto + raw text() need Node, not Edge
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import {
  verifyHmacSignature,        // or verifyBearerToken / verifyGooglePubSubToken
  ensureIdempotent,
  markWebhookProcessed,
  markWebhookFailed,
} from '@/lib/webhook'
import { logAudit } from '@/lib/audit'
import { processFooEvent } from '@/lib/integrations/foo'  // your processor

export async function POST(request: NextRequest) {
  // 1. Read raw body BEFORE doing anything else.
  const rawBody = await request.text()

  // 2. Verify signature with timing-safe compare. Reject 401 on miss.
  const signature = request.headers.get('x-foo-signature')
  const secret = process.env.FOO_WEBHOOK_SECRET
  if (!verifyHmacSignature(rawBody, signature, secret)) {
    logAudit({
      staffId: '',
      action: 'WEBHOOK_AUTH_REJECTED',
      entity: 'foo_webhook',
      details: { hasSignature: !!signature, hasSecret: !!secret },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'WARN',
    }).catch(() => {})
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // 3. Parse JSON only after verify succeeds.
  let event: any
  try {
    event = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // 4. Idempotency. Use the provider's event ID — every reputable webhook
  // provider gives one. Falling back to a synthetic key (timestamp + body
  // length) is a smell; if you're doing it, document why.
  const eventId = event.id || event.eventId
  if (!eventId) {
    return NextResponse.json({ error: 'missing_event_id' }, { status: 400 })
  }
  const idem = await ensureIdempotent('foo', eventId, event.type, event)
  if (idem.status === 'duplicate') {
    return NextResponse.json({ received: true, duplicate: true })
  }

  // 5. Audit the receipt. Even a duplicate gets logged above on a separate
  // path if you want full visibility — many handlers do.
  logAudit({
    staffId: 'webhook:foo',
    action: 'FOO_EVENT_RECEIVED',
    entity: 'foo_webhook',
    entityId: eventId,
    details: { eventType: event.type, idempotencyId: idem.id },
    severity: 'INFO',
  }).catch(() => {})

  // 6. Process. On success → markWebhookProcessed. On failure → markWebhookFailed
  // (which schedules retry/DLQ via exponential backoff).
  try {
    await processFooEvent(event)
    await markWebhookProcessed(idem.id)
    return NextResponse.json({ received: true, processed: true })
  } catch (err: any) {
    await markWebhookFailed(idem.id, err?.message || String(err))
    logAudit({
      staffId: 'webhook:foo',
      action: 'FOO_EVENT_FAILED',
      entity: 'foo_webhook',
      entityId: eventId,
      details: { error: err?.message?.slice(0, 500) },
      severity: 'CRITICAL',
    }).catch(() => {})

    // Status code policy — see "Status code policy" below for the choice.
    return NextResponse.json({ received: true, processed: false }, { status: 200 })
  }
}
```

## Status code policy

When **processing** fails (signature was valid, but our internal handler crashed), there are two valid stances:

| Stance | When to use it | Examples |
|---|---|---|
| **Always 200** — provider's retry stops, our `WebhookEvent` retry cron owns recovery | Provider has aggressive retry storms (Stripe, Resend) and our DLQ is wired | `/api/webhooks/stripe`, `/api/webhooks/resend` |
| **5xx on processing failure** — provider retries, idempotency catches dupes | Provider retry is gentle, our handler is fast, processing is mostly stateless | `/api/webhooks/hyphen`, `/api/webhooks/inflow` |

Pick one explicitly. **The default for new webhooks is "always 200" with internal DLQ** — it's safer because it doesn't depend on provider retry behavior matching what we expect.

## Auth selection guide

| Provider gives… | Use… |
|---|---|
| HMAC signature header (Stripe-style) | `verifyHmacSignature(rawBody, header, secret)` |
| Custom signed envelope (Svix, Resend) | Manual HMAC over `${id}.${ts}.${body}` with timing-safe compare. See `src/app/api/webhooks/resend/route.ts:66` for reference. |
| Static Bearer token | `verifyBearerToken(authHeader, expected)` |
| Google Pub/Sub OIDC JWT | `verifyGooglePubSubToken(authHeader, { expectedAudience, expectedEmail })` |
| OAuth Bearer (rotating, lookup against your DB) | Custom, but use `crypto.timingSafeEqual` for every credential compare. See `authenticateHyphenRequest` for reference. |

## Don't

- **Don't** use `===` to compare secrets. Always timing-safe.
- **Don't** parse the body with `request.json()` if you're verifying HMAC. The signature was computed over raw bytes — `JSON.parse` then `JSON.stringify` round-trip drifts.
- **Don't** persist secrets in code or logs. Pull from `process.env` or the `IntegrationConfig` table.
- **Don't** silently 200 when auth fails. Log the rejection — repeated 401s are a signal someone is probing.
- **Don't** synchronously do heavy work before responding. Provider retries on timeout. Persist + ack first, process async if the work is expensive.
- **Don't** skip `ensureIdempotent` because "the provider promises unique IDs." Network does what network does.

## CI gate

Coverage is enforced in CI — see `.github/workflows/webhook-hardening.yml`. Any PR that drops a webhook below A+ fails the gate.

## Related files

| File | Purpose |
|---|---|
| `src/lib/webhook.ts` | Verify helpers, idempotency, retry, DLQ |
| `src/lib/audit.ts` | `audit()`, `logAudit()`, `auditBuilder()` |
| `scripts/webhook-hardening-sweep.ts` | Re-runnable scorecard |
| `WEBHOOK-HARDENING-REPORT.md` | Latest sweep output |
| `src/app/api/cron/webhook-retry/route.ts` | Retry cron — picks up FAILED rows |
| `src/app/admin/webhooks/page.tsx` | Operator console for replay/resurrect |
