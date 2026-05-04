/**
 * Aegis MCP Server — single entrypoint that registers every tool.
 *
 * Per AEGIS-MCP-CONNECTOR-HANDOFF.docx (2026-05-04). This is the
 * MCP-protocol-level handle. It's used by the HTTP transport in
 * src/app/api/mcp/route.ts.
 *
 * Phase 1 (current): 10 read-only tools across 5 domains.
 *   • Orders: search_orders, get_order
 *   • Quotes: search_quotes, get_quote
 *   • Products/Inventory: search_products, check_inventory
 *   • Builders: search_builders, get_builder
 *   • Analytics: ops_dashboard, global_search
 *
 * Phase 2 (queued): write tools, full read coverage, audit + rate
 * limiting + tool annotations (readOnlyHint / destructiveHint).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerOrderTools } from './tools/orders'
import { registerQuoteTools } from './tools/quotes'
import { registerProductTools } from './tools/products'
import { registerBuilderTools } from './tools/builders'
import { registerAnalyticsTools } from './tools/analytics'

let cachedServer: McpServer | null = null

/**
 * Build (or return the cached) MCP server with every tool registered.
 *
 * The server itself is stateless — each tool handler reaches into Prisma
 * fresh per call. We cache the McpServer instance because tool registration
 * is the same on every cold start.
 */
export function getMcpServer(): McpServer {
  if (cachedServer) return cachedServer

  const server = new McpServer({
    name: 'abel-aegis',
    version: '1.0.0',
  })

  registerOrderTools(server)
  registerQuoteTools(server)
  registerProductTools(server)
  registerBuilderTools(server)
  registerAnalyticsTools(server)

  cachedServer = server
  return server
}
