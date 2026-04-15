export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/admin/request-trace?id=xyz
//
// Cross-source forensic lookup. Given a requestId, returns every row from
// ClientError AND ServerError that shares it, merged into one chronological
// list. Lets an operator pivot from "single failed request" to "everything
// that broke in that request" without flipping between /admin/errors
// source=client and source=server tabs.
//
// Both tables carry requestId (ClientError captures it from the X-Request-Id
// response header echoed back by the client beacon; ServerError captures it
// from the server-side logger correlation). When an API route fails:
//   1. logger.error writes a ServerError row with requestId=abc123
//   2. The server returns 500
//   3. The browser's error boundary fires and beacons /api/client-errors
//      with the same requestId
//
// So a single failed request commonly produces one row in each table, and
// this endpoint stitches them back together.
//
// Wire shape:
//   {
//     requestId: string,
//     total: number,
//     rows: Array<{
//       source: 'client' | 'server',
//       id: string,
//       createdAt: string,
//       digest: string | null,
//       scope: string | null,    // errName for server, scope for client
//       path: string | null,     // null for server
//       message: string | null
//     }>
//   }
// ──────────────────────────────────────────────────────────────────────────

interface TraceRow {
  source: 'client' | 'server'
  id: string
  createdAt: string
  digest: string | null
  scope: string | null
  path: string | null
  message: string | null
}

async function fetchClientRows(requestId: string): Promise<TraceRow[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "digest", "scope", "path", "message"
       FROM "ClientError"
       WHERE "requestId" = $1
       ORDER BY "createdAt" ASC
       LIMIT 200`,
      requestId
    )
    return rows.map((r) => ({
      source: 'client' as const,
      id: String(r.id),
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      digest: r.digest ?? null,
      scope: r.scope ?? null,
      path: r.path ?? null,
      message: r.message ?? null,
    }))
  } catch {
    return []
  }
}

async function fetchServerRows(requestId: string): Promise<TraceRow[]> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "createdAt", "digest",
              "errName" AS "scope",
              NULL::text AS "path",
              COALESCE("errMessage", "msg") AS "message"
       FROM "ServerError"
       WHERE "requestId" = $1
       ORDER BY "createdAt" ASC
       LIMIT 200`,
      requestId
    )
    return rows.map((r) => ({
      source: 'server' as const,
      id: String(r.id),
      createdAt:
        r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
      digest: r.digest ?? null,
      scope: r.scope ?? null,
      path: r.path ?? null,
      message: r.message ?? null,
    }))
  } catch {
    return []
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const requestId = searchParams.get('id')?.trim()

  if (!requestId) {
    return NextResponse.json(
      { error: 'Missing required ?id=<requestId>' },
      { status: 400 }
    )
  }

  // Defend against pathological input. requestId in practice is a short
  // alphanumeric-with-dashes string; anything over 200 chars is a mistake
  // or an attempted injection and should be rejected before the query.
  if (requestId.length > 200) {
    return NextResponse.json(
      { error: 'requestId exceeds 200-character maximum' },
      { status: 400 }
    )
  }

  const [clientRows, serverRows] = await Promise.all([
    fetchClientRows(requestId),
    fetchServerRows(requestId),
  ])

  const merged = [...clientRows, ...serverRows].sort((a, b) => {
    const ta = new Date(a.createdAt).getTime()
    const tb = new Date(b.createdAt).getTime()
    return ta - tb
  })

  return NextResponse.json({
    requestId,
    total: merged.length,
    rows: merged,
  })
}
