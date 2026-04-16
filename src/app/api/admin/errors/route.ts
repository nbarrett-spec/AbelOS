export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET  /api/admin/errors           → recent errors + stats
// DELETE /api/admin/errors?id=...   → dismiss a single error row
//
// Query filters on GET:
//   ?source=client     (default) browser beacons from ClientError
//   ?source=server     structured logger.error writes from ServerError
//   ?scope=ops         client: route scope (admin, ops, crew, ...)
//                      server: error class name (TypeError, ...)
//   ?digest=abc123
//   ?since=24          (hours; default 24)
//   ?limit=100 (max 500)
//
// Both sources are normalized to the same row shape so the /admin/errors
// page can toggle between them without two rendering paths:
//
//   { id, digest, scope, path, message, userAgent, ipAddress, requestId, createdAt }
//
// Mapping for server:
//   scope     ← errName  (the error class is the closest analog to scope)
//   path      ← NULL     (server errors don't have a browser path)
//   message   ← COALESCE(errMessage, msg)  (favor the real error text)
//   userAgent ← NULL
//   ipAddress ← NULL
// ──────────────────────────────────────────────────────────────────────────

type ErrorSource = 'client' | 'server'

function parseSource(raw: string | null): ErrorSource {
  return raw === 'server' ? 'server' : 'client'
}

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const source = parseSource(searchParams.get('source'))
  const scope = searchParams.get('scope') || undefined
  const digest = searchParams.get('digest') || undefined
  const sinceHours = Math.min(
    Math.max(parseInt(searchParams.get('since') || '24'), 1),
    24 * 30
  )
  const limit = Math.min(
    Math.max(parseInt(searchParams.get('limit') || '200'), 1),
    500
  )

  // Pick the table + column projections once — everything downstream is
  // the same normalized wire shape.
  const table = source === 'server' ? 'ServerError' : 'ClientError'
  const scopeCol = source === 'server' ? 'errName' : 'scope'
  const rowsSelect =
    source === 'server'
      ? `"id",
         "digest",
         "errName" AS "scope",
         NULL::text AS "path",
         COALESCE("errMessage", "msg") AS "message",
         NULL::text AS "userAgent",
         NULL::text AS "ipAddress",
         "requestId",
         "createdAt"`
      : `"id", "digest", "scope", "path", "message", "userAgent", "ipAddress", "requestId", "createdAt"`
  const digestSampleCol = source === 'server' ? `COALESCE("errMessage", "msg")` : `"message"`

  try {
    // Build WHERE clause defensively — table may not exist yet on a fresh DB
    const whereClauses: string[] = [`"createdAt" > NOW() - INTERVAL '${sinceHours} hours'`]
    const params: any[] = []
    if (scope) {
      params.push(scope)
      whereClauses.push(`"${scopeCol}" = $${params.length}`)
    }
    if (digest) {
      params.push(digest)
      whereClauses.push(`"digest" = $${params.length}`)
    }
    const whereSql = whereClauses.join(' AND ')

    params.push(limit)
    const limitParam = `$${params.length}`

    const errors: any[] = await prisma.$queryRawUnsafe(
      `SELECT ${rowsSelect}
       FROM "${table}"
       WHERE ${whereSql}
       ORDER BY "createdAt" DESC
       LIMIT ${limitParam}`,
      ...params
    )

    // Aggregate by scope (or errName for server) for summary cards
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT "${scopeCol}" AS "scope", COUNT(*)::int AS count
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       GROUP BY "${scopeCol}"
       ORDER BY count DESC`
    )

    // Top digests (recurring failures — highest-value to fix first)
    const topDigests: any[] = await prisma.$queryRawUnsafe(
      `SELECT "digest",
              "${scopeCol}" AS "scope",
              COUNT(*)::int AS count,
              MAX("createdAt") AS "lastSeen",
              MIN(${digestSampleCol}) AS "sampleMessage"
       FROM "${table}"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours' AND "digest" IS NOT NULL
       GROUP BY "digest", "${scopeCol}"
       ORDER BY count DESC
       LIMIT 10`
    )

    return NextResponse.json({ errors, stats, topDigests, sinceHours, source })
  } catch (e: any) {
    // Table likely doesn't exist yet — return empty state gracefully
    const msg = e?.message || String(e)
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return NextResponse.json({
        errors: [],
        stats: [],
        topDigests: [],
        sinceHours,
        source,
        note:
          source === 'server'
            ? 'ServerError table will be created on the first logger.error call.'
            : 'ClientError table will be created on the first beacon write.',
      })
    }
    console.error('[admin/errors GET] error:', e)
    return NextResponse.json(
      { error: msg || 'Failed to load errors' },
      { status: 500 }
    )
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const source = parseSource(searchParams.get('source'))
  const table = source === 'server' ? 'ServerError' : 'ClientError'
  const id = searchParams.get('id')
  const digest = searchParams.get('digest')

  if (!id && !digest) {
    return NextResponse.json(
      { error: 'Must provide ?id= or ?digest=' },
      { status: 400 }
    )
  }

  try {
    if (id) {
      await prisma.$executeRawUnsafe(
        `DELETE FROM "${table}" WHERE "id" = $1`,
        id
      )
      return NextResponse.json({ success: true, deleted: 'row' })
    }
    // Bulk-dismiss all rows sharing a digest
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM "${table}" WHERE "digest" = $1`,
      digest
    )
    return NextResponse.json({ success: true, deleted: 'digest', count: result })
  } catch (e: any) {
    return NextResponse.json(
      { error: e?.message || 'Delete failed' },
      { status: 500 }
    )
  }
}
