export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { logSecurityEvent, SecurityEventKind } from '@/lib/security-events'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/internal/security-event
//
// Lightweight fire-and-forget receiver for security events emitted from
// Edge middleware (which can't import Prisma directly). Protected by a
// shared secret rather than staff auth, since the caller IS middleware.
//
// The middleware sends a POST with a JSON body:
//   { kind, path, method, ip, userAgent, requestId, details, secret }
//
// Secret is INTERNAL_LOG_SECRET env var — a simple shared token. If not
// set, rejects all writes (fail-closed).
// ──────────────────────────────────────────────────────────────────────────

const VALID_KINDS = new Set<string>(['RATE_LIMIT', 'CSRF', 'AUTH_FAIL', 'SUSPICIOUS'])

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // Validate shared secret
    const expectedSecret = process.env.INTERNAL_LOG_SECRET
    if (!expectedSecret || body.secret !== expectedSecret) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const kind = body.kind as string
    if (!kind || !VALID_KINDS.has(kind)) {
      return NextResponse.json({ error: 'Invalid kind' }, { status: 400 })
    }

    // Fire-and-forget write — don't block the response
    logSecurityEvent({
      kind: kind as SecurityEventKind,
      path: body.path || null,
      method: body.method || null,
      ip: body.ip || null,
      userAgent: body.userAgent || null,
      requestId: body.requestId || null,
      details: body.details || null,
    })

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 })
  }
}
