// NO WRITE METHODS — adding create/update/delete is a multi-week compliance conversation. See BUILDERTREND-WRITE.md (not yet written).
//
// ──────────────────────────────────────────────────────────────────────────
// BuilderTrend — Thin Read-Only HTTP Client (env-var driven)
//
// Wave-2 / Agent B9 / Monday-launch sprint (2026-04-23).
//
// This module is deliberately independent from the legacy
// `src/lib/integrations/buildertrend.ts` lib (which pulls credentials out
// of the `IntegrationConfig` DB row and mixes transport with persistence).
// Goals for this new client:
//
//   1. Credentials come from env, not the DB — so Monday's deployment can
//      be gated without a schema migration or admin console round-trip.
//   2. Only READ methods are exported. No create/update/delete surface
//      exists at the module boundary. Enforcing "read-only for Monday" at
//      the API surface — not just with a runtime guard — is the point.
//   3. Graceful degradation: if creds are missing or the feature flag is
//      'off', every method returns a structured `{ok:false, error:...}`
//      envelope and NEVER throws. Callers stay simple.
//   4. Backoff/retry matches the Wave-1 A4 pattern used by `inflow.ts`:
//      exponential with ±20% jitter, honors Retry-After, max 5 retries,
//      non-retryable on 4xx other than 429.
//
// NOTE: This client is not wired into the existing BT cron or routes.
// Wiring it in is a follow-up task, deliberately out of scope for B9.
// ──────────────────────────────────────────────────────────────────────────

// ─── Types ─────────────────────────────────────────────────────────────────

/** Discriminated-union result envelope. Every public method returns this. */
export type BtResult<T> = { ok: true; data: T } | { ok: false; error: BtErrorCode; detail?: string }

/** Stable error codes callers can branch on without parsing strings. */
export type BtErrorCode =
  | 'BT_CREDS_MISSING' // One or more env vars absent
  | 'BT_FEATURE_OFF' // FEATURE_BUILDERTREND_INGEST=off short-circuit
  | 'BT_AUTH_FAILED' // OAuth token endpoint refused creds
  | 'BT_HTTP_ERROR' // Non-2xx after all retries
  | 'BT_NETWORK' // Transport failure after all retries
  | 'BT_UNKNOWN' // Anything else

// Shapes intentionally kept narrow — mirror the fields the legacy lib
// already uses plus a raw escape hatch so callers can read new fields
// without a code change.
export interface BtJob {
  id: string
  name: string
  number?: string
  status: string
  builderName?: string
  community?: string
  lot?: string
  startDate?: string
  endDate?: string
  raw?: Record<string, unknown>
}

export interface BtScheduleItem {
  id: string
  jobId: string
  title: string
  type: string
  scheduledDate: string
  scheduledTime?: string
  status: string
  notes?: string
  raw?: Record<string, unknown>
}

export interface BtChangeOrder {
  id: string
  jobId: string
  number?: string
  title: string
  status: string
  amount?: number
  createdAt?: string
  raw?: Record<string, unknown>
}

export interface BtDocument {
  id: string
  jobId: string
  name: string
  mimeType?: string
  sizeBytes?: number
  uploadedAt?: string
  url?: string
  raw?: Record<string, unknown>
}

export interface BtMaterialSelection {
  id: string
  jobId: string
  category: string
  productName: string
  productCode?: string
  specification?: string
  quantity?: number
  unit?: string
  raw?: Record<string, unknown>
}

// ─── Env / Feature Flag ────────────────────────────────────────────────────

interface BtEnv {
  clientId: string
  clientSecret: string
  baseUrl: string
  accountId?: string
}

/**
 * Read env vars. Returns null if any required var is missing.
 * We accept either BUILDERTREND_CLIENT_ID/SECRET (OAuth2 client_credentials,
 * matching the legacy lib's field names) OR BUILDERTREND_API_KEY (PAT style,
 * left as an alias for ops convenience).
 */
function readEnv(): BtEnv | null {
  const clientId = process.env.BUILDERTREND_CLIENT_ID || process.env.BUILDERTREND_API_KEY
  const clientSecret = process.env.BUILDERTREND_CLIENT_SECRET || process.env.BUILDERTREND_API_SECRET
  const baseUrl = process.env.BUILDERTREND_BASE_URL || 'https://api.buildertrend.com/v1'
  const accountId = process.env.BUILDERTREND_ACCOUNT_ID

  if (!clientId || !clientSecret) {
    return null
  }
  return { clientId, clientSecret, baseUrl: baseUrl.replace(/\/+$/, ''), accountId }
}

/** Feature flag — 'off' short-circuits every read. Default is 'on'. */
function isFeatureOff(): boolean {
  return process.env.FEATURE_BUILDERTREND_INGEST === 'off'
}

// ─── Backoff / Retry (same shape as InFlow fetchWithBackoff) ──────────────

function jitter(ms: number): number {
  const factor = 0.8 + Math.random() * 0.4
  return Math.round(ms * factor)
}

interface FetchBackoffResult {
  status: number
  body: string
  attempts: number
  durationMs: number
}

/**
 * Retry wrapper around `fetch`. Retries on 429 and 5xx (and network
 * errors) with exponential backoff + jitter, up to `maxRetries` times.
 * Returns the final response status/body regardless of success — the
 * caller decides how to interpret non-2xx. Never throws.
 */
async function fetchWithBackoff(
  url: string,
  init: RequestInit,
  endpoint: string,
  maxRetries = 5,
  baseMs = 500,
  capMs = 30_000
): Promise<FetchBackoffResult> {
  const startedAt = Date.now()
  let attempt = 0
  let lastStatus = 0
  let lastBody = ''

  while (attempt <= maxRetries) {
    let response: Response | null = null
    let networkErr: unknown = null

    try {
      response = await fetch(url, init)
    } catch (err) {
      networkErr = err
    }

    if (response) {
      lastStatus = response.status
      try {
        lastBody = await response.text()
      } catch {
        lastBody = ''
      }

      if (response.ok) {
        const totalMs = Date.now() - startedAt
        console.log(
          `[BuilderTrend] ${endpoint} ok status=${response.status} attempts=${attempt + 1} ms=${totalMs}`
        )
        return { status: response.status, body: lastBody, attempts: attempt + 1, durationMs: totalMs }
      }

      const retryable = response.status === 429 || (response.status >= 500 && response.status <= 599)
      if (!retryable || attempt >= maxRetries) {
        const totalMs = Date.now() - startedAt
        console.warn(
          `[BuilderTrend] ${endpoint} fail status=${response.status} attempts=${attempt + 1} ms=${totalMs} body="${lastBody.slice(0, 120)}"`
        )
        return {
          status: response.status,
          body: lastBody,
          attempts: attempt + 1,
          durationMs: totalMs,
        }
      }

      // Compute backoff with Retry-After override.
      const expMs = Math.min(baseMs * Math.pow(2, attempt), capMs)
      let backoffMs = jitter(expMs)
      const retryAfterHeader = response.headers.get('Retry-After')
      if (retryAfterHeader) {
        const secs = parseInt(retryAfterHeader, 10)
        if (Number.isFinite(secs) && secs > 0) {
          backoffMs = Math.max(secs * 1000, backoffMs)
        }
      }
      backoffMs = Math.min(backoffMs, capMs)

      console.warn(
        `[BuilderTrend] ${endpoint} retry status=${response.status} attempt=${attempt + 1}/${maxRetries + 1} backoff=${backoffMs}ms retry-after=${retryAfterHeader || 'none'}`
      )
      await new Promise(r => setTimeout(r, backoffMs))
      attempt++
      continue
    }

    // Network error path.
    lastStatus = 0
    lastBody = `network error: ${networkErr instanceof Error ? networkErr.message : String(networkErr)}`
    if (attempt >= maxRetries) {
      const totalMs = Date.now() - startedAt
      console.warn(
        `[BuilderTrend] ${endpoint} fail net-err attempts=${attempt + 1} ms=${totalMs} body="${lastBody.slice(0, 120)}"`
      )
      return { status: 0, body: lastBody, attempts: attempt + 1, durationMs: totalMs }
    }
    const expMs = Math.min(baseMs * Math.pow(2, attempt), capMs)
    const backoffMs = Math.min(jitter(expMs), capMs)
    console.warn(
      `[BuilderTrend] ${endpoint} retry net-err attempt=${attempt + 1}/${maxRetries + 1} backoff=${backoffMs}ms`
    )
    await new Promise(r => setTimeout(r, backoffMs))
    attempt++
  }

  // Unreachable under current control flow — loop always returns when
  // attempt > maxRetries. Kept for exhaustiveness so tsc is happy.
  return {
    status: lastStatus,
    body: lastBody,
    attempts: attempt,
    durationMs: Date.now() - startedAt,
  }
}

// ─── Internal Singleton ────────────────────────────────────────────────────

interface CachedToken {
  accessToken: string
  expiresAt: number // ms epoch
}

// Module-scoped singleton state. Lives for the life of the server process.
// In serverless, each cold invocation may re-fetch a token — that's fine;
// BT tokens are cheap relative to the rate we call them.
let cachedToken: CachedToken | null = null
let tokenInFlight: Promise<BtResult<string>> | null = null

/** Returns a fresh/cached OAuth2 access token, or a structured failure. */
async function getAccessToken(env: BtEnv): Promise<BtResult<string>> {
  const now = Date.now()
  if (cachedToken && cachedToken.expiresAt > now + 30_000) {
    return { ok: true, data: cachedToken.accessToken }
  }

  // Coalesce concurrent callers onto a single in-flight token request.
  if (tokenInFlight) return tokenInFlight

  tokenInFlight = (async (): Promise<BtResult<string>> => {
    const tokenUrl = `${env.baseUrl}/oauth/token`
    const result = await fetchWithBackoff(
      tokenUrl,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: env.clientId,
          client_secret: env.clientSecret,
        }).toString(),
      },
      '/oauth/token'
    )

    if (result.status === 0) {
      return { ok: false, error: 'BT_NETWORK', detail: result.body }
    }
    if (result.status < 200 || result.status >= 300) {
      // 401/403 → creds rejected; anything else still counts as auth-failure
      // since the token endpoint is the only thing we called.
      return {
        ok: false,
        error: 'BT_AUTH_FAILED',
        detail: `status=${result.status} body=${result.body.slice(0, 200)}`,
      }
    }

    try {
      const parsed = JSON.parse(result.body) as {
        access_token?: string
        expires_in?: number
      }
      if (!parsed.access_token) {
        return { ok: false, error: 'BT_AUTH_FAILED', detail: 'token response missing access_token' }
      }
      const ttlMs = Math.max(60_000, (parsed.expires_in ?? 3600) * 1000)
      cachedToken = { accessToken: parsed.access_token, expiresAt: Date.now() + ttlMs }
      return { ok: true, data: parsed.access_token }
    } catch (err) {
      return {
        ok: false,
        error: 'BT_AUTH_FAILED',
        detail: `token parse error: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  })()

  try {
    return await tokenInFlight
  } finally {
    tokenInFlight = null
  }
}

/**
 * Core request helper. Handles feature flag, missing creds, token fetch,
 * backoff, and JSON parsing. Only used by read methods below.
 */
async function readJson<T>(path: string): Promise<BtResult<T>> {
  if (isFeatureOff()) {
    return { ok: false, error: 'BT_FEATURE_OFF' }
  }

  const env = readEnv()
  if (!env) {
    return { ok: false, error: 'BT_CREDS_MISSING' }
  }

  const tokenResult = await getAccessToken(env)
  if (!tokenResult.ok) return tokenResult

  const url = `${env.baseUrl}${path}`
  const result = await fetchWithBackoff(
    url,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${tokenResult.data}`,
        Accept: 'application/json',
        ...(env.accountId ? { 'X-BuilderTrend-Account-Id': env.accountId } : {}),
      },
    },
    path
  )

  if (result.status === 0) {
    return { ok: false, error: 'BT_NETWORK', detail: result.body }
  }
  if (result.status === 401 || result.status === 403) {
    // Token may have been revoked. Drop cache so the next call re-auths.
    cachedToken = null
    return {
      ok: false,
      error: 'BT_AUTH_FAILED',
      detail: `status=${result.status} body=${result.body.slice(0, 200)}`,
    }
  }
  if (result.status < 200 || result.status >= 300) {
    return {
      ok: false,
      error: 'BT_HTTP_ERROR',
      detail: `status=${result.status} body=${result.body.slice(0, 200)}`,
    }
  }

  try {
    const parsed = JSON.parse(result.body) as T
    return { ok: true, data: parsed }
  } catch (err) {
    return {
      ok: false,
      error: 'BT_UNKNOWN',
      detail: `json parse: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/** Normalize the BT response envelope (`{data:[...]}` vs bare array). */
function unwrapArray<T>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[]
  if (raw && typeof raw === 'object' && Array.isArray((raw as { data?: unknown }).data)) {
    return (raw as { data: T[] }).data
  }
  return []
}

// ─── PUBLIC READ API — no write methods are exported from this module ─────

/**
 * List all jobs (BuilderTrend calls these "projects") visible to the
 * configured account. No filtering — callers paginate/filter in memory.
 */
export async function listJobs(): Promise<BtResult<BtJob[]>> {
  const r = await readJson<unknown>('/projects')
  if (!r.ok) return r
  const rows = unwrapArray<Record<string, unknown>>(r.data).map(
    (row): BtJob => ({
      id: String(row.id ?? ''),
      name: String(row.name ?? ''),
      number: row.number != null ? String(row.number) : undefined,
      status: String(row.status ?? 'UNKNOWN'),
      builderName: row.builderName != null ? String(row.builderName) : undefined,
      community: row.community != null ? String(row.community) : undefined,
      lot: row.lot != null ? String(row.lot) : undefined,
      startDate: row.startDate != null ? String(row.startDate) : undefined,
      endDate: row.endDate != null ? String(row.endDate) : undefined,
      raw: row,
    })
  )
  return { ok: true, data: rows }
}

/** Fetch a single job by BuilderTrend id. */
export async function getJob(id: string): Promise<BtResult<BtJob>> {
  if (!id) return { ok: false, error: 'BT_UNKNOWN', detail: 'id is required' }
  const r = await readJson<Record<string, unknown>>(
    `/projects/${encodeURIComponent(id)}`
  )
  if (!r.ok) return r
  const row = r.data
  return {
    ok: true,
    data: {
      id: String(row.id ?? id),
      name: String(row.name ?? ''),
      number: row.number != null ? String(row.number) : undefined,
      status: String(row.status ?? 'UNKNOWN'),
      builderName: row.builderName != null ? String(row.builderName) : undefined,
      community: row.community != null ? String(row.community) : undefined,
      lot: row.lot != null ? String(row.lot) : undefined,
      startDate: row.startDate != null ? String(row.startDate) : undefined,
      endDate: row.endDate != null ? String(row.endDate) : undefined,
      raw: row,
    },
  }
}

/** List schedule items for a job. */
export async function listSchedules(jobId: string): Promise<BtResult<BtScheduleItem[]>> {
  if (!jobId) return { ok: false, error: 'BT_UNKNOWN', detail: 'jobId is required' }
  const r = await readJson<unknown>(`/projects/${encodeURIComponent(jobId)}/schedules`)
  if (!r.ok) return r
  const rows = unwrapArray<Record<string, unknown>>(r.data).map(
    (row): BtScheduleItem => ({
      id: String(row.id ?? ''),
      jobId,
      title: String(row.title ?? ''),
      type: String(row.type ?? ''),
      scheduledDate: String(row.scheduledDate ?? ''),
      scheduledTime: row.scheduledTime != null ? String(row.scheduledTime) : undefined,
      status: String(row.status ?? 'UNKNOWN'),
      notes: row.notes != null ? String(row.notes) : undefined,
      raw: row,
    })
  )
  return { ok: true, data: rows }
}

/** List change orders for a job. */
export async function listChangeOrders(jobId: string): Promise<BtResult<BtChangeOrder[]>> {
  if (!jobId) return { ok: false, error: 'BT_UNKNOWN', detail: 'jobId is required' }
  const r = await readJson<unknown>(
    `/projects/${encodeURIComponent(jobId)}/change-orders`
  )
  if (!r.ok) return r
  const rows = unwrapArray<Record<string, unknown>>(r.data).map(
    (row): BtChangeOrder => ({
      id: String(row.id ?? ''),
      jobId,
      number: row.number != null ? String(row.number) : undefined,
      title: String(row.title ?? ''),
      status: String(row.status ?? 'UNKNOWN'),
      amount: typeof row.amount === 'number' ? row.amount : undefined,
      createdAt: row.createdAt != null ? String(row.createdAt) : undefined,
      raw: row,
    })
  )
  return { ok: true, data: rows }
}

/** List documents attached to a job. */
export async function listDocuments(jobId: string): Promise<BtResult<BtDocument[]>> {
  if (!jobId) return { ok: false, error: 'BT_UNKNOWN', detail: 'jobId is required' }
  const r = await readJson<unknown>(`/projects/${encodeURIComponent(jobId)}/documents`)
  if (!r.ok) return r
  const rows = unwrapArray<Record<string, unknown>>(r.data).map(
    (row): BtDocument => ({
      id: String(row.id ?? ''),
      jobId,
      name: String(row.name ?? ''),
      mimeType: row.mimeType != null ? String(row.mimeType) : undefined,
      sizeBytes: typeof row.sizeBytes === 'number' ? row.sizeBytes : undefined,
      uploadedAt: row.uploadedAt != null ? String(row.uploadedAt) : undefined,
      url: row.url != null ? String(row.url) : undefined,
      raw: row,
    })
  )
  return { ok: true, data: rows }
}

// ─── Test / ops utilities (still read-only) ────────────────────────────────

/**
 * Small probe for ops dashboards and cron health. Returns a tagged
 * envelope without calling any upstream endpoint — just flag + env check.
 */
export function probeReadiness(): {
  featureEnabled: boolean
  credsPresent: boolean
  writeAllowed: boolean
} {
  return {
    featureEnabled: !isFeatureOff(),
    credsPresent: readEnv() !== null,
    // Importing readonly-mode here would be fine, but keeping this module
    // free of intra-lib deps so it can be imported from anywhere without
    // pulling the guard error class into bundle graphs that don't need it.
    writeAllowed: process.env.BUILDERTREND_WRITE_ENABLED === 'true',
  }
}

/**
 * Clears the in-memory token cache. Exposed for tests and for ops tooling
 * to force a re-auth after rotating credentials in Vercel. Does NOT make
 * any HTTP call and is safe to invoke from any context.
 */
export function _resetTokenCacheForTests(): void {
  cachedToken = null
  tokenInFlight = null
}
