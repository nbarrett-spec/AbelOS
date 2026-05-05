/**
 * MCP bearer-token validation.
 *
 * Two-tier check, env var first, DB second:
 *   1. ABEL_MCP_API_KEY env var — the seed key set in Vercel. Always
 *      works. Provides the bootstrap path before any ApiKey rows
 *      exist in the DB.
 *   2. ApiKey table (sha256 hash lookup) — keys generated via the
 *      /ops/admin/api-keys UI. Scope must be 'mcp' or 'admin'.
 *      Revoked keys are rejected. Last-used timestamp is updated
 *      fire-and-forget on every successful auth.
 *
 * Middleware (src/middleware.ts) does a cheap presence check on the
 * Bearer header before forwarding here, but the actual token
 * comparison happens in this helper since middleware is in the Edge
 * runtime (no Prisma). This means the Node-runtime route handler
 * carries the auth load — which is fine, MCP traffic is low-volume.
 *
 * Returns null on success (authenticated), NextResponse 401/500 on
 * failure. Async because the DB lookup may run.
 */
import { NextRequest, NextResponse } from 'next/server'
import { verifyApiKey } from '@/lib/api-keys'

export async function checkMcpAuth(request: NextRequest): Promise<NextResponse | null> {
  const authHeader = request.headers.get('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Authentication required.' }, { status: 401 })
  }
  const token = authHeader.slice(7)
  if (!token) {
    return NextResponse.json({ error: 'Empty bearer token.' }, { status: 401 })
  }

  // Tier 1 — seed env var
  const seed = process.env.ABEL_MCP_API_KEY
  if (seed && token === seed) {
    return null
  }

  // Tier 2 — DB-backed key (any scope of 'mcp' or 'admin')
  try {
    const row = await verifyApiKey(token)
    if (row && (row.scope === 'mcp' || row.scope === 'admin')) {
      return null
    }
  } catch {
    // Fall through to 401 — never leak DB errors to the caller
  }

  return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 })
}
