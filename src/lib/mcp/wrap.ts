/**
 * MCP tool-call wrapper — adds audit logging + structured error capture
 * around every tool handler.
 *
 * Per AEGIS-MCP-CONNECTOR-HANDOFF.docx §10:
 *   "All MCP calls are audit-logged with staffId: 'mcp-service' for
 *   traceability."
 *
 * Usage in a tool file:
 *
 *   server.registerTool(
 *     'search_orders',
 *     { description, inputSchema, annotations: { readOnlyHint: true } },
 *     withMcpAudit('search_orders', 'READ', async (args) => {
 *       // ... handler body
 *       return { content: [{ type: 'text', text: '...' }] }
 *     }),
 *   )
 *
 * The wrapper runs the handler, logs duration + success/failure to the
 * Audit table, and re-throws any error so the SDK formats it as a proper
 * JSON-RPC error response back to Cowork.
 *
 * NOTE on args logging: we deliberately do NOT log args. Some tools accept
 * builder/contact info that could include PII and the audit table is not
 * a sensitive store. The tool name + duration + success is enough for
 * traceability — for incident response the developer can correlate by
 * timestamp with the request log.
 */
import { logAudit } from '@/lib/audit'

export type McpToolKind = 'READ' | 'WRITE'

export function withMcpAudit<H extends (args: any) => Promise<any>>(
  toolName: string,
  kind: McpToolKind,
  handler: H,
): H {
  const wrapped = async (args: any) => {
    const start = Date.now()
    let success = true
    let errorMessage: string | undefined
    try {
      return await handler(args)
    } catch (err: any) {
      success = false
      errorMessage = err?.message || String(err)
      throw err
    } finally {
      logAudit({
        staffId: 'mcp-service',
        action: kind === 'READ' ? 'MCP_TOOL_READ' : 'MCP_TOOL_WRITE',
        entity: 'mcp_tool',
        entityId: toolName,
        details: {
          tool: toolName,
          kind,
          durationMs: Date.now() - start,
          success,
          ...(errorMessage ? { error: errorMessage } : {}),
        },
        severity: success ? 'INFO' : 'WARN',
      }).catch(() => {})
    }
  }
  return wrapped as H
}
