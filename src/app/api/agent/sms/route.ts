export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/agent/sms — Inbound SMS webhook (STUBBED)
// ──────────────────────────────────────────────────────────────────────────
// TODO(twilio): Wire real Twilio integration.
//
// Removed 2026-04-22 along with the TWILIO_AUTH_TOKEN / TWILIO_WEBHOOK_SECRET
// placeholder env vars. The previous handler parsed Twilio webhook bodies,
// looked up the sender by phone, and ran the message through the agent
// pipeline. It was complete code but pointed at env vars that were never
// populated, so in production it always failed webhook-signature auth and
// short-circuited. Keeping a stub is safer than keeping dead code that
// silently rejects 100% of traffic.
//
// When we bring Twilio back:
//   1. Re-add TWILIO_AUTH_TOKEN + TWILIO_WEBHOOK_SECRET to .env.example.
//   2. Restore the handler (see git history before 2026-04-22).
//   3. Re-register Twilio in src/lib/integration-guard.ts.
// ──────────────────────────────────────────────────────────────────────────

export async function POST(_request: NextRequest) {
  return NextResponse.json(
    {
      error: 'Not Implemented',
      integrated: false,
      message:
        'Twilio SMS agent is not wired up. Placeholder env vars were ' +
        'removed 2026-04-22. Re-enable by restoring the handler and ' +
        'setting TWILIO_AUTH_TOKEN + TWILIO_WEBHOOK_SECRET.',
    },
    { status: 501 }
  )
}
