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
 * Build a fresh transport per request. The server instance is shared
 * (cached at module level inside getMcpServer) but each transport
 * handles one request lifecycle in stateless mode.
 */
async function handle(request: NextRequest): Promise<Response> {
  // Defense-in-depth: middleware should have already 401'd unauthenticated
  // requests, but check again in case of direct invocation.
  const authError = checkMcpAuth(request)
  if (authError) return authError

  try {
    const server = getMcpServer()
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
