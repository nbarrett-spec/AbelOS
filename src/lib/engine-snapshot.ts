/**
 * engine-snapshot.ts — Read-side helper for MCP-backed data bridges.
 *
 * The engine data routes for Gmail, Calendar, QuickBooks, HubSpot, and Drive
 * cannot call Anthropic MCPs from Vercel's runtime. Instead, a Cowork-side
 * brain-build session periodically extracts those sources and writes snapshot
 * rows into the `EngineSnapshot` table. These routes serve the most recent
 * snapshot per source/method and return `connected: false` when a snapshot
 * hasn't been populated yet.
 */

import { prisma } from '@/lib/prisma'

let tableEnsured = false

async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EngineSnapshot" (
        "id"         TEXT PRIMARY KEY,
        "source"     TEXT NOT NULL,
        "method"     TEXT NOT NULL,
        "queryHash"  TEXT,
        "payload"    JSONB NOT NULL,
        "fetchedAt"  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "ttlSeconds" INT  NOT NULL DEFAULT 86400
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_engsnap_source_method"
        ON "EngineSnapshot" ("source", "method", "fetchedAt" DESC)
    `)
    tableEnsured = true
  } catch {
    // Ignore — if we can't create the table, every read below will fail closed.
  }
}

export interface SnapshotResult<T = any> {
  connected: boolean
  source: string
  method: string
  fetched_at: string | null
  stale: boolean
  error?: string
  data?: T
}

/**
 * Fetch the latest snapshot for a source+method. Returns `connected: false`
 * when no row exists yet, so engine scans can degrade gracefully.
 */
export async function readSnapshot<T = any>(
  source: string,
  method: string
): Promise<SnapshotResult<T>> {
  try {
    await ensureTable()
    const rows = await prisma.$queryRawUnsafe<Array<{
      payload: any
      fetchedAt: Date
      ttlSeconds: number
    }>>(
      `SELECT "payload", "fetchedAt", "ttlSeconds"
         FROM "EngineSnapshot"
        WHERE "source" = $1 AND "method" = $2
        ORDER BY "fetchedAt" DESC
        LIMIT 1`,
      source,
      method
    )
    if (!rows.length) {
      return {
        connected: false,
        source,
        method,
        fetched_at: null,
        stale: true,
        error: 'snapshot pending — run the brain-build session to populate',
      }
    }
    const row = rows[0]
    const age = (Date.now() - row.fetchedAt.getTime()) / 1000
    return {
      connected: true,
      source,
      method,
      fetched_at: row.fetchedAt.toISOString(),
      stale: age > row.ttlSeconds,
      data: row.payload as T,
    }
  } catch (e: any) {
    return {
      connected: false,
      source,
      method,
      fetched_at: null,
      stale: true,
      error: String(e?.message || e),
    }
  }
}

/** Convenience: write a snapshot row. Used by the brain-build loader. */
export async function writeSnapshot(params: {
  source: string
  method: string
  queryHash?: string
  payload: any
  ttlSeconds?: number
}): Promise<string> {
  await ensureTable()
  const id = 'snap_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  await prisma.$executeRawUnsafe(
    `INSERT INTO "EngineSnapshot" ("id", "source", "method", "queryHash", "payload", "ttlSeconds")
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    id,
    params.source,
    params.method,
    params.queryHash ?? null,
    JSON.stringify(params.payload),
    params.ttlSeconds ?? 86_400
  )
  return id
}
