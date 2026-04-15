export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET  /api/admin/errors           → recent client-side errors + stats
// DELETE /api/admin/errors?id=...   → dismiss a single error row
//
// Query filters on GET:
//   ?scope=ops         (admin, ops, crew, dashboard, root, ...)
//   ?digest=abc123
//   ?since=24          (hours; default 24)
//   ?limit=100 (max 500)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
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

  try {
    // Build WHERE clause defensively — table may not exist yet on a fresh DB
    const whereClauses: string[] = [`"createdAt" > NOW() - INTERVAL '${sinceHours} hours'`]
    const params: any[] = []
    if (scope) {
      params.push(scope)
      whereClauses.push(`"scope" = $${params.length}`)
    }
    if (digest) {
      params.push(digest)
      whereClauses.push(`"digest" = $${params.length}`)
    }
    const whereSql = whereClauses.join(' AND ')

    params.push(limit)
    const limitParam = `$${params.length}`

    const errors: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "digest", "scope", "path", "message", "userAgent", "ipAddress", "requestId", "createdAt"
       FROM "ClientError"
       WHERE ${whereSql}
       ORDER BY "createdAt" DESC
       LIMIT ${limitParam}`,
      ...params
    )

    // Aggregate by scope for summary cards
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT "scope", COUNT(*)::int AS count
       FROM "ClientError"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours'
       GROUP BY "scope"
       ORDER BY count DESC`
    )

    // Top digests (recurring failures — highest-value to fix first)
    const topDigests: any[] = await prisma.$queryRawUnsafe(
      `SELECT "digest", "scope", COUNT(*)::int AS count, MAX("createdAt") AS "lastSeen", MIN("message") AS "sampleMessage"
       FROM "ClientError"
       WHERE "createdAt" > NOW() - INTERVAL '${sinceHours} hours' AND "digest" IS NOT NULL
       GROUP BY "digest", "scope"
       ORDER BY count DESC
       LIMIT 10`
    )

    return NextResponse.json({ errors, stats, topDigests, sinceHours })
  } catch (e: any) {
    // Table likely doesn't exist yet — return empty state gracefully
    const msg = e?.message || String(e)
    if (msg.includes('does not exist') || msg.includes('relation')) {
      return NextResponse.json({
        errors: [],
        stats: [],
        topDigests: [],
        sinceHours,
        note: 'ClientError table will be created on the first beacon write.',
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
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
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
        `DELETE FROM "ClientError" WHERE "id" = $1`,
        id
      )
      return NextResponse.json({ success: true, deleted: 'row' })
    }
    // Bulk-dismiss all rows sharing a digest
    const result = await prisma.$executeRawUnsafe(
      `DELETE FROM "ClientError" WHERE "digest" = $1`,
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
