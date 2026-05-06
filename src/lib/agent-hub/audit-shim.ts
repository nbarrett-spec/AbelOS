// ──────────────────────────────────────────────────────────────────────────
// Agent-hub audit shim.
//
// Wraps a Next.js route handler so that every call writes an AuditLog row
// without each handler having to import + call audit() manually. Mirrors the
// pattern in src/lib/cron.ts where startCronRun/finishCronRun handle audit
// for every cron route via one library change.
//
// Usage in a route:
//
//   import { withAgentHubAudit } from '@/lib/agent-hub/audit-shim'
//
//   export const POST = withAgentHubAudit(async (request) => {
//     // ... existing handler body ...
//     return NextResponse.json({ ok: true })
//   })
//
// The shim:
//   - Infers action + entity from the URL pathname (no per-route config).
//   - Skips audit on non-2xx responses (keeps the log signal:noise high).
//   - Skips audit on GET unless explicitly enabled (state-change focus).
//   - Never throws — wraps logAudit in fire-and-forget.
//
// Rationale: 24 agent-hub routes share an identical shape (auth → action →
// JSON response). Touching each individually means 24 edits and 24 places to
// drift. The shim centralizes the audit policy so a future change (e.g.,
// "every agent-hub action also publishes to Redis topic X") happens once.
// ──────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from 'next/server'
import { logAudit, type AuditSeverity } from '@/lib/audit'

type Handler = (request: NextRequest, ctx: any) => Promise<NextResponse>

interface ShimOptions {
  /** Force a specific entity name. Default: derived from URL path. */
  entity?: string
  /** Force a specific action key. Default: AGENT_HUB_<ROUTE_TAIL>_<METHOD>. */
  action?: string
  /** Severity override. Default: WARN for state-change methods. */
  severity?: AuditSeverity
  /** Audit GET too. Default: false (state-change focus). */
  auditGet?: boolean
  /** Skip audit when this returns true (e.g., empty results). */
  skipIf?: (request: NextRequest, response: NextResponse) => boolean
}

const STATE_CHANGE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function inferEntityFromPath(pathname: string): string {
  // /api/agent-hub/inventory/auto-po → "AgentHubInventoryAutoPo"
  // /api/agent-hub/pricing/calculate → "AgentHubPricingCalculate"
  const parts = pathname
    .replace(/^\/api\/agent-hub\//, '')
    .split('/')
    .filter((p) => p && !p.startsWith('[') && !p.endsWith(']'))
    .slice(0, 3) // cap depth so dynamic segments don't bloat entity name
  if (parts.length === 0) return 'AgentHub'
  return (
    'AgentHub' +
    parts
      .map((p) =>
        p
          .split(/[-_]/)
          .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
          .join('')
      )
      .join('')
  )
}

function inferActionFromPath(pathname: string, method: string): string {
  // /api/agent-hub/inventory/auto-po + POST → AGENT_HUB_INVENTORY_AUTO_PO_POST
  const tail = pathname
    .replace(/^\/api\/agent-hub\//, '')
    .replace(/\[[^\]]+\]/g, 'ID')
    .replace(/[/-]/g, '_')
    .toUpperCase()
  return `AGENT_HUB_${tail}_${method.toUpperCase()}`
}

export function withAgentHubAudit(
  handler: Handler,
  options: ShimOptions = {}
): Handler {
  return async function wrappedHandler(request: NextRequest, ctx: any) {
    const method = request.method.toUpperCase()
    const isStateChange = STATE_CHANGE_METHODS.has(method)
    const shouldAudit = isStateChange || options.auditGet === true

    let response: NextResponse
    let threw: unknown = null
    try {
      response = await handler(request, ctx)
    } catch (e) {
      threw = e
      // Re-throw after audit so callers (Next.js error boundary) still see it.
      // We still want to log the failure as a CRITICAL audit row.
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
            (threw ? 'CRITICAL' : !ok ? 'WARN' : isStateChange ? 'WARN' : 'INFO')

          // staffId from headers — checkStaffAuth puts it there when the
          // route validates auth before the handler runs. Fallback to
          // "system:agent-hub" so cron-driven calls still audit cleanly.
          const staffId =
            request.headers.get('x-staff-id') ||
            'system:agent-hub'

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
          }).catch(() => {
            /* swallow — audit must never break the request */
          })
        }
      } catch {
        // Defensive — URL parse or path inference failed. Don't break the
        // response just because the audit metadata couldn't be computed.
      }
    }

    if (threw) throw threw
    return response
  }
}
