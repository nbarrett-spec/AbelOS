// ──────────────────────────────────────────────────────────────────────────
// Generic route audit shim.
//
// Wraps any state-changing API route handler so every call writes an
// AuditLog row without per-handler boilerplate. Same pattern as the
// agent-hub shim, but generic — the entity + action are inferred from the
// URL path so a single line at the export site is enough.
//
// Usage:
//   import { withAudit } from '@/lib/audit-route'
//
//   export const POST = withAudit(async (request) => {
//     // ... existing handler body ...
//     return NextResponse.json({ ok: true })
//   })
//
// Override entity/action/severity when the path doesn't tell the whole
// story:
//
//   export const POST = withAudit(handler, {
//     entity: 'Invoice',
//     action: 'INVOICE_VOID',
//     severity: 'CRITICAL',
//   })
//
// Notes:
//   - GET is ignored unless `auditGet: true`.
//   - 4xx/5xx responses still audit (with severity escalated to WARN/CRITICAL)
//     so failed mutations are visible alongside successes.
//   - Hand-rolled audit() calls inside the handler still work — this wraps
//     the response, it doesn't replace logAudit().
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { logAudit, type AuditSeverity } from '@/lib/audit'

type Handler<T = any> = (request: NextRequest, ctx: T) => Promise<NextResponse | Response>

interface ShimOptions {
  /** Force a specific entity name. Default: derived from URL path. */
  entity?: string
  /** Force a specific action key. Default: <TOP>_<MID>_<METHOD>. */
  action?: string
  /** Severity override. Default: WARN for state-change methods. */
  severity?: AuditSeverity
  /** Audit GET too. Default: false. */
  auditGet?: boolean
  /** Skip audit when this returns true. */
  skipIf?: (request: NextRequest, response: Response) => boolean
}

const STATE_CHANGE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function pascalize(s: string): string {
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
    .join('')
}

function inferEntityFromPath(pathname: string): string {
  // /api/dashboard/reorder              → "DashboardReorder"
  // /api/v1/engine/inbox/[id]/ack       → "EngineInboxAck"
  // /api/notifications                  → "Notification"
  const parts = pathname
    .replace(/^\/api(?:\/v\d+)?\//, '')
    .split('/')
    .filter((p) => p && !p.startsWith('[') && !p.endsWith(']'))
    .slice(0, 3)
  if (parts.length === 0) return 'ApiAction'
  return parts.map(pascalize).join('')
}

function inferActionFromPath(pathname: string, method: string): string {
  const tail = pathname
    .replace(/^\/api(?:\/v\d+)?\//, '')
    .replace(/\[[^\]]+\]/g, 'ID')
    .replace(/[/-]/g, '_')
    .toUpperCase()
  return `${tail}_${method.toUpperCase()}`
}

export function withAudit<T = any>(
  handler: Handler<T>,
  options: ShimOptions = {}
): Handler<T> {
  return async function wrapped(request: NextRequest, ctx: T) {
    const method = request.method.toUpperCase()
    const isStateChange = STATE_CHANGE_METHODS.has(method)
    const shouldAudit = isStateChange || options.auditGet === true

    let response: NextResponse | Response
    let threw: unknown = null
    try {
      response = await handler(request, ctx)
    } catch (e) {
      threw = e
      response = NextResponse.json(
        { error: e instanceof Error ? e.message : 'Internal error' },
        { status: 500 }
      )
    }

    if (shouldAudit) {
      try {
        const url = new URL(request.url)
        const pathname = url.pathname
        const entity = options.entity || inferEntityFromPath(pathname)
        const action = options.action || inferActionFromPath(pathname, method)

        const skip = options.skipIf?.(request, response) ?? false
        if (!skip) {
          const ok = response.status >= 200 && response.status < 400
          const sev: AuditSeverity =
            options.severity ||
            (threw
              ? 'CRITICAL'
              : !ok && response.status >= 500
              ? 'CRITICAL'
              : !ok
              ? 'WARN'
              : isStateChange
              ? 'INFO'
              : 'INFO')

          const staffId =
            request.headers.get('x-staff-id') ||
            // Builder portal session puts builder id in the cookie not header;
            // use a fallback marker so the row still has staffId populated.
            (request.cookies.get('abel_session') ? 'builder:session' : 'system:api')

          logAudit({
            staffId,
            action,
            entity,
            details: {
              method,
              status: response.status,
              path: pathname,
              error: threw
                ? threw instanceof Error
                  ? threw.message.slice(0, 500)
                  : String(threw).slice(0, 500)
                : null,
            },
            ipAddress:
              request.headers.get('x-forwarded-for') ||
              request.headers.get('x-real-ip') ||
              undefined,
            userAgent: request.headers.get('user-agent') || undefined,
            severity: sev,
          }).catch(() => {})
        }
      } catch {
        /* defensive — never break the response on audit metadata failure */
      }
    }

    if (threw) throw threw
    return response
  }
}
