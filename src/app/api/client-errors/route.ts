export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// Client error beacon receiver.
//
// Called from error boundaries via navigator.sendBeacon. Persists an
// unhandled React error to the ClientError table so ops has an
// authoritative record even when Sentry is not configured or fails.
//
// Anonymous-friendly: no auth required, no PII beyond user-agent + path.
// Rate-limiting is implicit (browsers only call this on crash).
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false

async function ensureTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ClientError" (
        "id" TEXT PRIMARY KEY,
        "digest" TEXT,
        "scope" TEXT,
        "path" TEXT,
        "message" TEXT,
        "stack" TEXT,
        "userAgent" TEXT,
        "ipAddress" TEXT,
        "requestId" TEXT,
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    // Backfill column on existing deployments — ALTER is idempotent
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "ClientError" ADD COLUMN IF NOT EXISTS "requestId" TEXT
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_clienterror_created" ON "ClientError" ("createdAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_clienterror_scope" ON "ClientError" ("scope")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_clienterror_digest" ON "ClientError" ("digest")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_clienterror_request" ON "ClientError" ("requestId")
    `)
    tableEnsured = true
  } catch {
    tableEnsured = true
  }
}

function clamp(s: unknown, max: number): string | null {
  if (typeof s !== 'string') return null
  return s.length > max ? s.slice(0, max) : s
}

export async function POST(request: NextRequest) {
  try {
    await ensureTable()

    let body: any = {}
    try {
      body = await request.json()
    } catch {
      // sendBeacon Blob may parse oddly — try text fallback
      try {
        const text = await request.text()
        body = JSON.parse(text)
      } catch {
        body = {}
      }
    }

    const id =
      'cer' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      request.headers.get('x-real-ip') ||
      null

    // Prefer the requestId the client captured from its page-render meta
    // tag (tracks the original server request). Fall back to the beacon's
    // own inbound header (tracks the beacon POST itself).
    const requestId =
      clamp(body.requestId, 100) ||
      clamp(request.headers.get('x-request-id'), 100)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "ClientError" ("id", "digest", "scope", "path", "message", "stack", "userAgent", "ipAddress", "requestId", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())`,
      id,
      clamp(body.digest, 100),
      clamp(body.scope, 50),
      clamp(body.path, 500),
      clamp(body.message, 2000),
      clamp(body.stack, 4000),
      clamp(body.userAgent, 500),
      ip,
      requestId
    )

    // sendBeacon ignores the response, but return 204 for fetch fallback
    return new NextResponse(null, { status: 204 })
  } catch (e: any) {
    console.error('[api/client-errors] write failed:', e?.message || e)
    // Never surface the failure to the caller — they already hit an error
    return new NextResponse(null, { status: 204 })
  }
}
