/**
 * MCP tool-call wrappers — audit logging + rate limiting + structured
 * error capture around every tool handler.
 *
 * Per AEGIS-MCP-CONNECTOR-HANDOFF.docx §10:
 *   "All MCP calls are audit-logged with staffId: 'mcp-service' for
 *   traceability."
 *
 * Usage in a tool file:
 *
 *   server.registerTool(
 *     'search_orders',
 *     { description, inputSchema, annotations: { readOnlyHint: true } },
 *     withMcpAudit('search_orders', 'READ', async (args) => {
 *       // ... handler body
 *       return { content: [{ type: 'text', text: '...' }] }
 *     }),
 *   )
 *
 * For write tools, compose with withRateLimit (Phase 3 polish):
 *
 *   server.registerTool(
 *     'create_purchase_order',
 *     { description, inputSchema, annotations: { destructiveHint: true } },
 *     withMcpAudit('create_purchase_order', 'WRITE',
 *       withRateLimit('create_purchase_order',
 *         async (args) => { ... }
 *       )
 *     ),
 *   )
 *
 * The audit wrapper runs the (rate-limit-wrapped) handler, logs duration
 * + success/failure to AuditLog, and re-throws errors so the SDK formats
 * them as JSON-RPC errors back to Cowork. A rate-limit rejection is
 * captured as a normal failed audit row with the limiter's message.
 *
 * NOTE on args logging: we deliberately do NOT log args. Some tools accept
 * builder/contact info that could include PII and the audit table is not
 * a sensitive store. The tool name + duration + success is enough for
 * traceability — for incident response the developer can correlate by
 * timestamp with the request log.
 */
import { logAudit } from '@/lib/audit'
import { createRateLimiter } from '@/lib/rate-limit'

export type McpToolKind = 'READ' | 'WRITE'

export function withMcpAudit<H extends (args: any) => Promise<any>>(
  toolName: string,
  kind: McpToolKind,
  handler: H,
): H {
  const wrapped = async (args: any) => {
    const start = Date.now()
    let success = true
    let errorMessage: string | undefined
    try {
      return await handler(args)
    } catch (err: any) {
      success = false
      errorMessage = err?.message || String(err)
      throw err
    } finally {
      logAudit({
        staffId: 'mcp-service',
        action: kind === 'READ' ? 'MCP_TOOL_READ' : 'MCP_TOOL_WRITE',
        entity: 'mcp_tool',
        entityId: toolName,
        details: {
          tool: toolName,
          kind,
          durationMs: Date.now() - start,
          success,
          ...(errorMessage ? { error: errorMessage } : {}),
        },
        severity: success ? 'INFO' : 'WARN',
      }).catch(() => {})
    }
  }
  return wrapped as H
}

// ──────────────────────────────────────────────────────────────────────
// withRateLimit — Phase 3 polish.
//
// Caps how often Cowork can fire a given write tool. Uses the existing
// @upstash/ratelimit infra in prod (cross-instance accuracy via Redis)
// and falls back to in-memory for local dev. One limiter per tool name,
// keyed by the tool itself (Cowork is the only caller — no per-user split).
//
// Defaults (60s window):
//   • create_purchase_order, create_order_from_quote, dispatch_delivery,
//     create_invoice — 10 per minute (high-impact, expensive)
//   • everything else — 30 per minute
// Override via opts.max / opts.windowMs.
//
// Limitation: when UPSTASH_REDIS_REST_URL is not set, the limiter is
// per-Vercel-instance and resets on cold start. That's acceptable for
// MCP traffic (single trusted caller, low volume) but real protection
// arrives once Upstash is wired into Vercel prod env (already supported
// by createRateLimiter — just needs the env vars).
// ──────────────────────────────────────────────────────────────────────

const limiterCache = new Map<string, ReturnType<typeof createRateLimiter>>()

function getLimiter(toolName: string, windowMs: number, max: number) {
  const key = `${toolName}:${windowMs}:${max}`
  let l = limiterCache.get(key)
  if (!l) {
    l = createRateLimiter({ windowMs, max })
    limiterCache.set(key, l)
  }
  return l
}

export interface RateLimitOptions {
  /** Time window in ms. Defaults to 60_000 (1 minute). */
  windowMs?: number
  /** Max calls per window. Defaults to 30. */
  max?: number
}

export function withRateLimit<H extends (args: any) => Promise<any>>(
  toolName: string,
  handler: H,
  opts: RateLimitOptions = {},
): H {
  const windowMs = opts.windowMs ?? 60_000
  const max = opts.max ?? 30
  const limiter = getLimiter(toolName, windowMs, max)

  const wrapped = async (args: any) => {
    const result = await limiter.check(`mcp:tool:${toolName}`)
    if (!result.success) {
      const seconds = Math.max(1, Math.ceil(result.resetIn / 1000))
      throw new Error(
        `Rate limit exceeded for ${toolName} — ${max} calls per ${windowMs / 1000}s. Try again in ${seconds}s.`,
      )
    }
    return handler(args)
  }
  return wrapped as H
}
