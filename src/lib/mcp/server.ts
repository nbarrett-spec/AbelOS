/**
 * Aegis MCP Server — single entrypoint that registers every tool.
 *
 * Per AEGIS-MCP-CONNECTOR-HANDOFF.docx (2026-05-04). This is the
 * MCP-protocol-level handle. It's used by the HTTP transport in
 * src/app/api/mcp/route.ts.
 *
 * Phase 1 + Phase 2 — full coverage across 10 tool files.
 *
 * Read tools wrap their handler with withMcpAudit(name, 'READ', ...).
 * Write tools use 'WRITE'. The audit log records every tool call with
 * staffId='mcp-service' so we can grep the audit table to see every
 * action Cowork has taken.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

import { registerOrderTools } from './tools/orders'
import { registerQuoteTools } from './tools/quotes'
import { registerProductTools } from './tools/products'
import { registerBuilderTools } from './tools/builders'
import { registerAnalyticsTools } from './tools/analytics'
import { registerInvoiceTools } from './tools/invoices'
import { registerPurchasingTools } from './tools/purchasing'
import { registerDeliveryTools } from './tools/deliveries'
import { registerProjectTools } from './tools/projects'
import { registerMessagingTools } from './tools/messaging'

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
    version: '2.0.0',
  })

  // Phase 1 + Phase 2 tools
  registerOrderTools(server)
  registerQuoteTools(server)
  registerProductTools(server)
  registerBuilderTools(server)
  registerAnalyticsTools(server)
  registerInvoiceTools(server)
  registerPurchasingTools(server)
  registerDeliveryTools(server)
  registerProjectTools(server)
  registerMessagingTools(server)

  cachedServer = server
  return server
}
