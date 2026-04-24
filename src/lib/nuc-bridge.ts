/**
 * NUC Bridge — Aegis → NUC Brain FastAPI (read-only)
 *
 * Wave-2 B5 deliverable. The NUC coordinator at 100.84.113.47 exposes a
 * FastAPI engine at :8400/brain/* and an MCP layer at :8401/mcp covering
 * 14 modules (knowledge, findings, scores, trends, actions, scans, briefings,
 * cluster, alerts, config, audit, data, health, chat).
 *
 * This module is the Aegis-side read bridge. It is intentionally dumb:
 *   - No caching, no persistence, no mutation.
 *   - Every call re-reads env so the API key is never memoised at module scope
 *     (better for tests + rotation).
 *   - Every method returns a discriminated `{ ok, data?, error? }` shape.
 *     Network errors, timeouts, missing config — NEVER throw. Callers can rely
 *     on that for clean graceful degradation on dashboards.
 *
 * NOTE: 100.84.113.47 is a Tailscale-only address. Reachable from Nate's
 * machines and the NUC hardware itself; NOT reachable from Vercel/Cowork
 * sandbox environments. Monday dashboards relying on this bridge will show
 * 'NUC_OFFLINE' unless a Tailscale-accessible proxy is configured via
 * NUC_BRAIN_URL (e.g. a Cloudflare Tunnel or an internal HTTPS endpoint).
 * Graceful degradation below ensures nothing breaks; the UI just shows a
 * degraded state when the NUC is unreachable.
 */

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface NucConfig {
  baseUrl: string
  apiKey: string
}

export type NucError =
  | 'NUC_OFFLINE'       // env not configured OR network unreachable
  | 'NUC_UNREACHABLE'   // fetch threw (DNS, refused, abort, etc.) after retries
  | 'NUC_TIMEOUT'       // AbortController fired
  | 'NUC_AUTH_FAILED'   // 401/403 from the engine
  | 'NUC_BAD_RESPONSE'  // non-2xx other than auth
  | 'NUC_PARSE_ERROR'   // response wasn't valid JSON

export interface NucOk<T> {
  ok: true
  data: T
  status: number
  durationMs: number
  attempts: number
}

export interface NucFail {
  ok: false
  error: NucError
  status?: number
  detail?: string
  durationMs?: number
  attempts?: number
}

export type NucResult<T> = NucOk<T> | NucFail

export interface NucFetchOptions {
  method?: 'GET' | 'POST'
  body?: unknown
  /** Per-call timeout in ms. Default 10_000. */
  timeout?: number
  /** Override retry count. Default 3 (→ up to 3 total attempts). */
  maxAttempts?: number
}

export interface NucHealthResult {
  reachable: boolean
  latencyMs: number
  engineVersion?: string
  moduleStatus?: Record<string, unknown>
  error?: NucError
  detail?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_BASE_URL = 'http://100.84.113.47:8400'
const DEFAULT_TIMEOUT_MS = 10_000
const HEALTH_TIMEOUT_MS = 5_000
const DEFAULT_MAX_ATTEMPTS = 3
const BASE_BACKOFF_MS = 250 // 250ms → 500ms → 1000ms with jitter

/**
 * Read the bridge config from env on every call (no module-scope memo).
 * Returns null if the API key is missing — without a key we can't talk to
 * the engine at all, so there's no point trying.
 *
 * NUC_BRAIN_URL defaults to the Tailscale IP. On Vercel this default will
 * fail (see header comment) — that's expected; the graceful-degradation
 * layer surfaces it cleanly instead of crashing.
 */
export function getNucConfig(): NucConfig | null {
  const apiKey = process.env.ABEL_MCP_API_KEY
  if (!apiKey) return null

  const baseUrl = (process.env.NUC_BRAIN_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  if (!baseUrl) return null

  return { baseUrl, apiKey }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────

function jitter(ms: number): number {
  // ±20% jitter so parallel callers don't all retry on the same tick.
  const factor = 0.8 + Math.random() * 0.4
  return Math.round(ms * factor)
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function classifyFetchError(err: unknown): { error: NucError; detail: string } {
  const msg = err instanceof Error ? err.message : String(err)
  // AbortController.signal firing
  if (err instanceof Error && err.name === 'AbortError') {
    return { error: 'NUC_TIMEOUT', detail: 'request aborted (timeout)' }
  }
  // Node undici tends to wrap low-level network errors
  const cause = (err as { cause?: { code?: string } })?.cause
  const code = cause?.code
  if (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH' ||
    code === 'ETIMEDOUT' ||
    /fetch failed/i.test(msg) ||
    /network/i.test(msg)
  ) {
    return { error: 'NUC_UNREACHABLE', detail: code ? `${code}: ${msg}` : msg }
  }
  return { error: 'NUC_UNREACHABLE', detail: msg }
}

// ──────────────────────────────────────────────────────────────────────────
// Core fetch with timeout + lightweight exponential backoff retry
// ──────────────────────────────────────────────────────────────────────────

/**
 * Fetch a path on the NUC engine, with bearer auth, timeout, and up to 3
 * attempts on transient failures. Returns a discriminated result — it
 * NEVER throws, which is a hard contract so callers can render degraded
 * UI without try/catch noise.
 *
 * Retries: only on network/timeout or 5xx. 4xx is terminal.
 */
export async function nucFetch<T = unknown>(
  path: string,
  opts: NucFetchOptions = {}
): Promise<NucResult<T>> {
  const started = Date.now()

  const cfg = getNucConfig()
  if (!cfg) {
    return {
      ok: false,
      error: 'NUC_OFFLINE',
      detail: 'ABEL_MCP_API_KEY not configured',
      durationMs: 0,
      attempts: 0,
    }
  }

  const method = opts.method || 'GET'
  const timeout = opts.timeout ?? DEFAULT_TIMEOUT_MS
  const maxAttempts = Math.max(1, opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS)
  const url = `${cfg.baseUrl}${path.startsWith('/') ? path : `/${path}`}`

  let lastFail: NucFail = {
    ok: false,
    error: 'NUC_UNREACHABLE',
    detail: 'no attempt executed',
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const controller = new AbortController()
    const abortTimer = setTimeout(() => controller.abort(), timeout)

    try {
      const init: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'AbelOS-NUCBridge/1.0',
          ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
        },
        signal: controller.signal,
      }
      if (method === 'POST' && opts.body !== undefined) {
        init.body = JSON.stringify(opts.body)
      }

      const res = await fetch(url, init)
      clearTimeout(abortTimer)

      // Auth failures: terminal.
      if (res.status === 401 || res.status === 403) {
        return {
          ok: false,
          error: 'NUC_AUTH_FAILED',
          status: res.status,
          detail: `engine rejected bearer token (${res.status})`,
          durationMs: Date.now() - started,
          attempts: attempt + 1,
        }
      }

      // 5xx: retryable.
      if (res.status >= 500) {
        lastFail = {
          ok: false,
          error: 'NUC_BAD_RESPONSE',
          status: res.status,
          detail: `engine returned ${res.status}`,
          durationMs: Date.now() - started,
          attempts: attempt + 1,
        }
        // fall through to retry
      } else if (!res.ok) {
        // Other 4xx: terminal.
        return {
          ok: false,
          error: 'NUC_BAD_RESPONSE',
          status: res.status,
          detail: `engine returned ${res.status}`,
          durationMs: Date.now() - started,
          attempts: attempt + 1,
        }
      } else {
        // Success path.
        let data: T
        try {
          data = (await res.json()) as T
        } catch (parseErr) {
          return {
            ok: false,
            error: 'NUC_PARSE_ERROR',
            status: res.status,
            detail:
              parseErr instanceof Error ? parseErr.message : 'invalid JSON',
            durationMs: Date.now() - started,
            attempts: attempt + 1,
          }
        }
        return {
          ok: true,
          data,
          status: res.status,
          durationMs: Date.now() - started,
          attempts: attempt + 1,
        }
      }
    } catch (err) {
      clearTimeout(abortTimer)
      const { error, detail } = classifyFetchError(err)
      lastFail = {
        ok: false,
        error,
        detail,
        durationMs: Date.now() - started,
        attempts: attempt + 1,
      }
      // fall through to retry
    }

    // Sleep before next attempt (except after the final attempt).
    if (attempt < maxAttempts - 1) {
      const backoff = jitter(BASE_BACKOFF_MS * Math.pow(2, attempt))
      await sleep(backoff)
    }
  }

  return lastFail
}

// ──────────────────────────────────────────────────────────────────────────
// High-level passthrough methods
// ──────────────────────────────────────────────────────────────────────────

/**
 * GET /brain/health with a tight 5s timeout and NO retries — a failing
 * health probe should return fast so the dashboard can render 'offline'
 * rather than stalling a request-render cycle.
 */
export async function nucHealth(): Promise<NucHealthResult> {
  const started = Date.now()

  const cfg = getNucConfig()
  if (!cfg) {
    return {
      reachable: false,
      latencyMs: 0,
      error: 'NUC_OFFLINE',
      detail: 'ABEL_MCP_API_KEY not configured',
    }
  }

  const result = await nucFetch<{
    version?: string
    engineVersion?: string
    modules?: Record<string, unknown>
    moduleStatus?: Record<string, unknown>
    status?: string
  }>('/brain/health', {
    method: 'GET',
    timeout: HEALTH_TIMEOUT_MS,
    maxAttempts: 1,
  })

  const latencyMs = Date.now() - started

  if (!result.ok) {
    return {
      reachable: false,
      latencyMs,
      error: result.error,
      detail: result.detail,
    }
  }

  return {
    reachable: true,
    latencyMs,
    engineVersion: result.data.engineVersion || result.data.version,
    moduleStatus: result.data.moduleStatus || result.data.modules,
  }
}

/**
 * GET /brain/knowledge/search?q=<q>
 * Passthrough — returns raw NUC JSON inside the bridge result envelope.
 */
export async function nucQueryKnowledge(q: string): Promise<NucResult<unknown>> {
  const safe = encodeURIComponent(q || '')
  return nucFetch<unknown>(`/brain/knowledge/search?q=${safe}`, { method: 'GET' })
}

/**
 * GET /brain/scores/<entity> (+ optional ?id=<id>)
 * `entity` is constrained to 'customer' | 'product' to match the NUC scoring
 * engine surface (A-F grades).
 */
export async function nucGetScores(
  entity: 'customer' | 'product',
  id?: string
): Promise<NucResult<unknown>> {
  const qs = id ? `?id=${encodeURIComponent(id)}` : ''
  return nucFetch<unknown>(`/brain/scores/${entity}${qs}`, { method: 'GET' })
}
