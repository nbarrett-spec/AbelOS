/**
 * /api/mcp — MCP Streamable HTTP transport endpoint.
 *
 * Per AEGIS-MCP-CONNECTOR-HANDOFF.docx (2026-05-04). Single route that
 * speaks JSON-RPC over the MCP Streamable HTTP transport. Auth is gated
 * by middleware (Bearer ABEL_MCP_API_KEY); by the time we reach this
 * handler the request is trusted and stamped x-staff-id=mcp-service.
 *
 * Why WebStandardStreamableHTTPServerTransport (not the Node-HTTP wrapper):
 *   The Node transport in the SDK uses `IncomingMessage`/`ServerResponse`,
 *   which Next.js App Router handlers don't expose — they receive Web
 *   `Request` and return `Response`. The Web Standard transport does
 *   exactly that with `handleRequest(req: Request): Promise<Response>`.
 *
 * Stateless mode: no `sessionIdGenerator`. Each Cowork tool call is
 * one-shot; no need to track sessions across requests. This also makes
 * the route safe to run on Vercel's stateless serverless functions
 * without sticky sessions.
 *
 * Runtime: Node (default). The transport doesn't strictly need it, but
 * Prisma + the various tool handlers do.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { getMcpServer } from '@/lib/mcp/server'
import { checkMcpAuth } from '@/lib/mcp/auth'
import { logger } from '@/lib/logger'

/**
 * Build a fresh transport AND server per request. The previous version
 * cached the McpServer but called server.connect(transport) on every
 * request — the SDK throws "Already connected to a transport" on the
 * second hit to the same Vercel instance. Creating a fresh server per
 * request is cheap (just tool registration calls) and avoids the issue.
 */
async function handle(request: NextRequest): Promise<Response> {
  // Auth happens here (Node runtime, Prisma access) rather than in
  // middleware (Edge runtime, no Prisma) — see lib/mcp/auth.ts. Middleware
  // confirms a Bearer header is present, this verifies it against env +
  // the ApiKey table.
  const authError = await checkMcpAuth(request)
  if (authError) return authError

  try {
    // Fresh server + transport per request — stateless, no caching issues.
    const server = getMcpServer(true)
    const transport = new WebStandardStreamableHTTPServerTransport({
      // Stateless — no session tracking.
      sessionIdGenerator: undefined,
    })

    await server.connect(transport)

    return await transport.handleRequest(request as unknown as Request)
  } catch (err: any) {
    logger.error('mcp_transport_error', err, {
      method: request.method,
      url: request.url,
    })
    return NextResponse.json(
      {
        jsonrpc: '2.0',
        error: {
          code: -32603,
          message: 'Internal server error',
          data: { detail: err?.message || String(err) },
        },
        id: null,
      },
      { status: 500 },
    )
  }
}

// MCP Streamable HTTP uses POST for JSON-RPC tool calls and GET for
// optional SSE session init (we're stateless so GET is largely unused).
export async function POST(request: NextRequest) {
  return handle(request)
}
export async function GET(request: NextRequest) {
  return handle(request)
}
export async function DELETE(request: NextRequest) {
  return handle(request)
}
