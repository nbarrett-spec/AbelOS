/**
 * AI Insights — thin wrapper around the Anthropic SDK with:
 *   · Prompt caching on system prompts (ephemeral, 5-min TTL)
 *   · Exponential backoff on 429 / 5xx
 *   · Cost estimation + persistence to AIInvocation
 *   · Model pinning with automatic fallback
 *
 * Designed to be called from API route handlers. Safe to import in a Node
 * runtime only (uses Anthropic SDK + Prisma).
 */

import Anthropic from '@anthropic-ai/sdk'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

// ── Models ──────────────────────────────────────────────────────────────
// Primary: claude-sonnet-4-5 (latest stable per working rules).
// Fallback: 4-20250514 for older API plans.
export const PRIMARY_MODEL = 'claude-sonnet-4-5'
export const FALLBACK_MODEL = 'claude-sonnet-4-20250514'

// Approximate per-million-token pricing (USD). Sonnet 4.x.
// These are estimates — actual spend should be reconciled against Anthropic console.
const PRICING = {
  inputPerM: 3.0,
  cachedInputPerM: 0.3,   // ~10% of input for cache hits
  cacheWritePerM: 3.75,   // ~125% of input for cache writes
  outputPerM: 15.0,
}

export interface GenerateOpts {
  /** Short label for the endpoint (saved to AIInvocation). */
  endpoint: string
  /** Static, slow-changing prompt — the part we want cached. */
  systemPrompt: string
  /** User-turn content. Small, fast, uncached. */
  userPrompt: string
  /** Max completion tokens. Default 1024. */
  maxTokens?: number
  /** Hashable key — used for cost accounting lookup. */
  inputKey?: string
  /** Current staff id (from request headers). Saved on invocation row. */
  staffId?: string | null
  /** Use "extended output" beta for long reports. Raises cap to 8k. */
  extendedOutput?: boolean
}

export interface GenerateResult {
  text: string
  model: string
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costEstimate: number
  durationMs: number
  inputHash: string
}

// ── Client (single instance, reuses TCP connection) ─────────────────────
let _client: Anthropic | null = null
function client(): Anthropic {
  if (!_client) _client = new Anthropic()
  return _client
}

/**
 * Return true when an Anthropic API key is configured in the current runtime.
 *
 * Callers can use this at the top of an API route to return 503 `{error: 'AI
 * not configured'}` instead of letting the SDK throw a generic 500 at call
 * time. The Anthropic SDK lazy-reads ANTHROPIC_API_KEY at construction, so we
 * mirror the same env var here.
 */
export function isAIConfigured(): boolean {
  const key = process.env.ANTHROPIC_API_KEY
  return typeof key === 'string' && key.trim().length > 0
}

// ── Core ────────────────────────────────────────────────────────────────
export async function generate(opts: GenerateOpts): Promise<GenerateResult> {
  const started = Date.now()
  const inputHash = crypto
    .createHash('sha256')
    .update(`${opts.endpoint}::${opts.inputKey || ''}::${opts.userPrompt}`)
    .digest('hex')
    .slice(0, 24)

  const maxTokens = opts.maxTokens ?? 1024
  const extended = !!opts.extendedOutput

  // Build the system prompt with prompt caching. Claude caches prompts ≥ 1024
  // tokens; below that the cache_control block is silently no-op.
  const systemBlocks = [
    {
      type: 'text' as const,
      text: opts.systemPrompt,
      cache_control: { type: 'ephemeral' as const },
    },
  ]

  const call = async (model: string) => {
    const result = await client().messages.create(
      {
        model,
        max_tokens: extended ? Math.max(maxTokens, 4096) : maxTokens,
        system: systemBlocks as any, // SDK 0.24 types don't include cache_control yet
        messages: [{ role: 'user', content: opts.userPrompt }],
      } as any,
      extended
        ? { headers: { 'anthropic-beta': 'prompt-caching-2024-07-31,output-128k-2025-02-19' } }
        : { headers: { 'anthropic-beta': 'prompt-caching-2024-07-31' } }
    )
    return result
  }

  // Retry loop with fallback-model on 404 (model not found) and backoff on 429/5xx
  let attempt = 0
  let lastErr: any
  let response: any = null
  let modelUsed = PRIMARY_MODEL

  const models = [PRIMARY_MODEL, FALLBACK_MODEL]
  for (const candidate of models) {
    attempt = 0
    while (attempt < 4) {
      try {
        response = await call(candidate)
        modelUsed = candidate
        break
      } catch (err: any) {
        lastErr = err
        const status: number | undefined = err?.status ?? err?.response?.status
        if (status === 404 || status === 400) {
          // model not found / invalid — break out to try fallback
          break
        }
        if (status === 429 || (status && status >= 500)) {
          const delay = Math.min(2000 * Math.pow(2, attempt), 15000)
          await sleep(delay + Math.floor(Math.random() * 400))
          attempt++
          continue
        }
        throw err
      }
    }
    if (response) break
  }

  if (!response) throw lastErr ?? new Error('ai_generate_failed')

  // Extract text
  const text = (response.content || [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')

  // Usage breakdown — newer API returns cache_read/cache_creation counts.
  const usage = response.usage || {}
  const promptTokens = usage.input_tokens || 0
  const completionTokens = usage.output_tokens || 0
  const cacheReadTokens = usage.cache_read_input_tokens || 0
  const cacheWriteTokens = usage.cache_creation_input_tokens || 0

  const costEstimate =
    (promptTokens / 1_000_000) * PRICING.inputPerM +
    (cacheReadTokens / 1_000_000) * PRICING.cachedInputPerM +
    (cacheWriteTokens / 1_000_000) * PRICING.cacheWritePerM +
    (completionTokens / 1_000_000) * PRICING.outputPerM

  const durationMs = Date.now() - started

  // Persist (best-effort — never fail the request if logging fails)
  recordInvocation({
    endpoint: opts.endpoint,
    inputHash,
    model: modelUsed,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costEstimate,
    durationMs,
    staffId: opts.staffId || null,
  }).catch(() => {})

  return {
    text,
    model: modelUsed,
    promptTokens,
    completionTokens,
    cacheReadTokens,
    cacheWriteTokens,
    costEstimate,
    durationMs,
    inputHash,
  }
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Persistence ─────────────────────────────────────────────────────────
let _aiTableReady = false
async function ensureAIInvocationTable() {
  if (_aiTableReady) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AIInvocation" (
        "id" TEXT PRIMARY KEY,
        "endpoint" TEXT NOT NULL,
        "inputHash" TEXT NOT NULL,
        "model" TEXT,
        "promptTokens" INTEGER NOT NULL DEFAULT 0,
        "completionTokens" INTEGER NOT NULL DEFAULT 0,
        "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
        "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
        "costEstimate" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "durationMs" INTEGER NOT NULL DEFAULT 0,
        "staffId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_aiinvocation_endpoint" ON "AIInvocation" ("endpoint")`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_aiinvocation_created" ON "AIInvocation" ("createdAt" DESC)`
    )
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_aiinvocation_staff" ON "AIInvocation" ("staffId")`
    )
    _aiTableReady = true
  } catch (e) {
    _aiTableReady = true
  }
}

async function recordInvocation(row: {
  endpoint: string
  inputHash: string
  model: string
  promptTokens: number
  completionTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  costEstimate: number
  durationMs: number
  staffId: string | null
}) {
  try {
    await ensureAIInvocationTable()
    const id = 'aii' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AIInvocation"
         ("id","endpoint","inputHash","model","promptTokens","completionTokens",
          "cacheReadTokens","cacheWriteTokens","costEstimate","durationMs","staffId","createdAt")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
      id,
      row.endpoint,
      row.inputHash,
      row.model,
      row.promptTokens,
      row.completionTokens,
      row.cacheReadTokens,
      row.cacheWriteTokens,
      row.costEstimate,
      row.durationMs,
      row.staffId
    )
  } catch (e) {
    logger.error('ai_invocation_record_failed', e)
  }
}

// ── Insight cache (Redis-backed with Postgres fallback via AIInvocation) ─
import { getRedis } from '@/lib/redis'

/**
 * Get a cached insight by key, or generate + cache it.
 *
 * - `cacheKey` is caller-constructed (e.g. `order:abc:updatedAtMs:...`).
 * - `ttlSeconds` default 3600 (1 hour).
 */
export async function getOrGenerate(opts: {
  cacheKey: string
  ttlSeconds?: number
  force?: boolean
  generate: () => Promise<GenerateResult>
}): Promise<{
  cached: boolean
  generatedAt: string
  result: GenerateResult
}> {
  const redis = getRedis()
  const ttl = opts.ttlSeconds ?? 3600

  if (redis && !opts.force) {
    const hit = await redis.get<any>(`ai:insight:${opts.cacheKey}`)
    if (hit) {
      // Upstash auto-deserializes JSON
      const parsed = typeof hit === 'string' ? JSON.parse(hit) : hit
      return { cached: true, generatedAt: parsed.generatedAt, result: parsed.result }
    }
  }

  const result = await opts.generate()
  const payload = { generatedAt: new Date().toISOString(), result }

  if (redis) {
    try {
      await redis.set(`ai:insight:${opts.cacheKey}`, JSON.stringify(payload), { ex: ttl })
    } catch {}
  }
  return { cached: false, generatedAt: payload.generatedAt, result }
}

// ── Rate limit: 30 AI calls per staff per hour ─────────────────────────
export async function checkAIRateLimit(staffId: string): Promise<{ ok: boolean; remaining: number; resetIn: number }> {
  const redis = getRedis()
  if (!redis) return { ok: true, remaining: 30, resetIn: 3600 }

  const key = `ai:rl:${staffId}:${Math.floor(Date.now() / 3600_000)}`
  try {
    const next = await redis.incr(key)
    if (next === 1) {
      await redis.expire(key, 3600)
    }
    const resetIn = 3600 - (Math.floor(Date.now() / 1000) % 3600)
    return { ok: next <= 30, remaining: Math.max(0, 30 - next), resetIn }
  } catch {
    return { ok: true, remaining: 30, resetIn: 3600 }
  }
}
