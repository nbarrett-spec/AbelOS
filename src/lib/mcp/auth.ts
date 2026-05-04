/**
 * MCP service-key validation helper.
 *
 * Note: the primary auth gate for /api/mcp is in src/middleware.ts (Bearer
 * ABEL_MCP_API_KEY). By the time a request reaches the route handler the
 * middleware has already 401'd anything without a valid key, set
 * x-mcp-authenticated=true, and stamped x-staff-id=mcp-service /
 * x-staff-role=ADMIN.
 *
 * This helper is the defense-in-depth check inside the route handler in
 * case middleware is ever bypassed (e.g., direct invocation via internal
 * imports). Returns null if authenticated, NextResponse 401 if not.
 */
import { NextRequest, NextResponse } from 'next/server'

export function checkMcpAuth(request: NextRequest): NextResponse | null {
  if (request.headers.get('x-mcp-authenticated') === 'true') {
    return null
  }
  const authHeader = request.headers.get('authorization')
  const expected = process.env.ABEL_MCP_API_KEY
  if (!expected) {
    return NextResponse.json(
      { error: 'MCP server not configured (ABEL_MCP_API_KEY missing).' },
      { status: 500 },
    )
  }
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Authentication required.' },
      { status: 401 },
    )
  }
  if (authHeader.slice(7) !== expected) {
    return NextResponse.json({ error: 'Invalid API key.' }, { status: 401 })
  }
  return null
}
