// ──────────────────────────────────────────────────────────────────────────
// Claude AI Service — Anthropic Messages API integration for Abel Builder
// ──────────────────────────────────────────────────────────────────────────
// Uses raw fetch (no SDK dependency) to call the Anthropic Messages API.
// Supports tool use so Claude can query the database, create records, etc.
// ──────────────────────────────────────────────────────────────────────────

import { buildSOPContextForAgent } from './sops'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-sonnet-4-20250514'

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string | ClaudeContentBlock[]
}

export interface ClaudeContentBlock {
  type: 'text' | 'tool_use' | 'tool_result'
  text?: string
  id?: string
  name?: string
  input?: Record<string, any>
  tool_use_id?: string
  content?: string
  is_error?: boolean
}

export interface ClaudeTool {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, any>
    required?: string[]
  }
}

export interface ClaudeResponse {
  id: string
  type: string
  role: string
  content: ClaudeContentBlock[]
  model: string
  stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence'
  usage: { input_tokens: number; output_tokens: number }
}

/**
 * Send a message to Claude with optional tools.
 * Handles the full tool-use loop: if Claude wants to call a tool,
 * we execute it and feed the result back until Claude produces a final text response.
 *
 * Returns `truncated: true` when the tool-use loop hits MAX_ITERATIONS without
 * arriving at a final text response — the caller should surface this to the UI
 * so the user knows context was clipped.
 */
export async function sendMessage(opts: {
  systemPrompt: string
  messages: ClaudeMessage[]
  tools?: ClaudeTool[]
  executeTool?: (name: string, input: Record<string, any>) => Promise<string>
  maxTokens?: number
  maxIterations?: number
}): Promise<{ text: string; toolCalls: Array<{ name: string; input: any; result: string }>; truncated?: boolean }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured. Add it to .env.local to enable the AI assistant.')
  }

  const { systemPrompt, tools, executeTool, maxTokens = 4096, maxIterations } = opts
  let messages = [...opts.messages]
  const toolCalls: Array<{ name: string; input: any; result: string }> = []
  // Track the most recent partial-text response so we can surface it if we run out of iterations.
  let lastPartialText = ''

  // Tool-use loop: keep calling Claude until we get a final text response.
  // 5 -> 10 (BUGFIX 2.6) -> 15 (F5-AI-DEEPER): tool-heavy chats need more
  // headroom; the real cap users hit is the per-turn TOKEN budget, not the
  // iteration count. The iteration ceiling is just a safety stop.
  let iterations = 0
  const MAX_ITERATIONS = Math.min(Math.max(maxIterations ?? 15, 1), 20)

  // F5-AI-DEEPER: when we get within REMAINING_NUDGE iterations of the cap,
  // append a system-style instruction to the next user message asking Claude
  // to wrap up. This nudges synthesis instead of more tool fishing.
  const REMAINING_NUDGE = 2

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const remaining = MAX_ITERATIONS - iterations
    const effectiveSystemPrompt =
      remaining <= REMAINING_NUDGE
        ? `${systemPrompt}\n\nIMPORTANT: You have only ${remaining + 1} tool-call rounds left this turn. Stop calling tools and write the final answer based on the data you've already gathered. If you don't have enough data, say so explicitly and suggest a tighter follow-up question.`
        : systemPrompt

    const body: Record<string, any> = {
      model: MODEL,
      max_tokens: maxTokens,
      system: effectiveSystemPrompt,
      messages: messages.map(m => ({
        role: m.role,
        content: m.content,
      })),
    }

    if (tools && tools.length > 0) {
      body.tools = tools
    }

    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Claude API error:', response.status, errorBody)
      throw new Error(`Claude API returned ${response.status}: ${errorBody}`)
    }

    const result: ClaudeResponse = await response.json()

    // Capture any text in this turn so we can return it as a partial answer if the loop ends.
    const partialText = result.content
      .filter(b => b.type === 'text')
      .map(b => b.text || '')
      .join('\n')
      .trim()
    if (partialText) lastPartialText = partialText

    // If Claude wants to use tools, execute them and continue the loop
    if (result.stop_reason === 'tool_use' && executeTool) {
      // Add Claude's response (with tool_use blocks) to the conversation
      messages.push({
        role: 'assistant',
        content: result.content,
      })

      // Execute each tool call
      const toolResults: ClaudeContentBlock[] = []
      for (const block of result.content) {
        if (block.type === 'tool_use' && block.id && block.name) {
          try {
            const toolResult = await executeTool(block.name, block.input || {})
            toolCalls.push({ name: block.name, input: block.input, result: toolResult })
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: toolResult,
            })
          } catch (err: any) {
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: `Error: ${err.message}`,
              is_error: true,
            })
          }
        }
      }

      // Feed tool results back to Claude
      messages.push({
        role: 'user',
        content: toolResults,
      })

      continue // Go back to Claude with the tool results
    }

    // Extract the final text response
    const textBlocks = result.content.filter(b => b.type === 'text')
    const text = textBlocks.map(b => b.text).join('\n')
    return { text, toolCalls }
  }

  // Hit the iteration cap — tool-call loop exhausted before a final answer.
  // F5-AI-DEEPER: also surface which tools ran so the user can see what *was*
  // accomplished and ask a tighter follow-up.
  const toolsUsedList = toolCalls.length > 0
    ? `\n\nWhat I gathered before stopping:\n${toolCalls.map(tc => `- ${tc.name.replace(/_/g, ' ')}`).join('\n')}`
    : ''
  const limitMessage =
    'This question needed more steps than I can do in one turn. ' +
    'Try breaking it into parts, or specify a tighter scope (e.g., "just for Pulte", "only this week").'
  const text = lastPartialText
    ? `${lastPartialText}\n\n${limitMessage}${toolsUsedList}`
    : `${limitMessage}${toolsUsedList}`
  return { text, toolCalls, truncated: true }
}

/**
 * Build a role-aware system prompt for a staff member.
 */
export function buildSystemPrompt(staff: {
  firstName: string
  lastName: string
  email: string
  role: string
  roles: string[]
  department: string
  title?: string | null
}): string {
  const roleDescriptions: Record<string, string> = {
    ADMIN: 'You have full administrative access to all systems, data, and operations.',
    MANAGER: 'You manage teams and oversee daily operations. You can view operational financials and approve POs.',
    PROJECT_MANAGER: 'You manage construction projects from quote to completion. You track jobs, coordinate crews, manage schedules, and ensure on-time delivery.',
    ESTIMATOR: 'You create material takeoffs and quotes from blueprints. You work with products, pricing, and builder relationships.',
    SALES_REP: 'You manage builder relationships, handle quote requests, and drive revenue. You track your pipeline and close deals.',
    PURCHASING: 'You manage vendor relationships, create purchase orders, track inventory levels, and optimize procurement costs.',
    WAREHOUSE_LEAD: 'You oversee warehouse operations, pick lists, staging, quality control, and shipping logistics.',
    WAREHOUSE_TECH: 'You handle pick lists, staging, and physical inventory management.',
    DRIVER: 'You manage deliveries, routes, and delivery confirmations.',
    INSTALLER: 'You handle on-site installation, punch lists, and warranty work.',
    QC_INSPECTOR: 'You ensure quality standards are met in production, staging, and installation.',
    ACCOUNTING: 'You manage invoicing, payments, collections, AR/AP, and financial reporting.',
    VIEWER: 'You have read-only access to view reports and dashboards.',
  }

  const roleContext = staff.roles
    .map(r => roleDescriptions[r] || '')
    .filter(Boolean)
    .join(' ')

  return `You are Abel AI, the intelligent co-pilot for Abel Lumber's Builder Platform. You are assisting ${staff.firstName} ${staff.lastName} (${staff.email}).

STAFF CONTEXT:
- Name: ${staff.firstName} ${staff.lastName}
- Title: ${staff.title || 'Team Member'}
- Department: ${staff.department}
- Role(s): ${staff.roles.join(', ')}
- Primary Role: ${staff.role}

ROLE CAPABILITIES:
${roleContext}

COMPANY CONTEXT:
Abel Lumber is a building materials supplier specializing in doors, trim, and hardware for residential construction. The company works with builders (customers) who submit blueprint floor plans. Abel's team creates material takeoffs, generates quotes, processes orders, manufactures/picks products, and delivers to job sites. The company also handles installation services.

KEY TERMINOLOGY:
- "Takeoff" = extracting material quantities from a blueprint
- "Builder" = customer (construction company/contractor)
- "PO" = Purchase Order (buying from vendors/suppliers)
- "Job" = a construction project being tracked from quote to completion
- "Pick List" = warehouse order to pull items for an order
- "Punch List" = remaining items to fix/complete after installation
- "Net 15/Net 30" = payment terms (days until payment is due)
- "Pay at Order" = builder pays when order is placed (gets 3% discount)

YOUR CAPABILITIES:
You can help ${staff.firstName} with tasks relevant to their role:
1. Look up orders, invoices, builders, inventory, jobs, and POs
2. Draft professional emails and communications
3. Create purchase orders (for Purchasing/Admin roles)
4. Analyze data and generate insights
5. Help with scheduling and workflow optimization
6. Answer questions about company operations and data

DATA ACCESS BOUNDARIES (ENFORCED — do NOT bypass):
${buildDataBoundaryRules(staff.roles)}

GUIDELINES:
- Be concise and action-oriented. This is a work tool, not a chatbot.
- When you look up data, present it clearly with key numbers highlighted.
- If asked to do something outside the user's role permissions, explain what they need and suggest who to contact.
- Use the available tools to look up real data — never make up numbers or records.
- When drafting emails, match Abel Lumber's professional but friendly tone.
- NEVER reveal financial data (AR/AP totals, revenue, margins, invoice amounts, PO values) to roles that lack operational financial access. If a tool returns financial data and the user shouldn't see it, summarize only the non-financial portions.
- Always confirm before creating or modifying records (POs, emails, etc.).
- When a user asks "how do I..." or seems unsure about a process, walk them through the relevant SOP step-by-step.
- Current date: ${new Date().toISOString().split('T')[0]}

${buildSOPContextForAgent(staff.roles)}
`
}

/**
 * Generate explicit data boundary rules based on user's roles.
 * These rules tell Claude exactly what data categories are off-limits.
 */
function buildDataBoundaryRules(roles: string[]): string {
  const rules: string[] = []

  // Roles that can see operational financials
  const financialRoles = ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'ACCOUNTING']
  const hasFinancials = roles.some(r => financialRoles.includes(r))

  // Roles that can see sensitive financials (bank balances, employee comp)
  const sensitiveFinRoles = ['ADMIN', 'ACCOUNTING']
  const hasSensitiveFinancials = roles.some(r => sensitiveFinRoles.includes(r))

  // Field-level workers (no financial data at all)
  const fieldRoles = ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR']
  const isFieldWorker = roles.every(r => fieldRoles.includes(r) || r === 'VIEWER')

  if (isFieldWorker) {
    rules.push('- You MUST NOT show: invoice amounts, order totals, revenue figures, AR/AP balances, profit margins, deal values, quote pricing, credit limits, or any dollar figures beyond basic product catalog prices.')
    rules.push('- You CAN show: order status, schedule/delivery info, product names/SKUs, inventory counts (quantities only, not dollar values), staff contacts, and job pipeline status.')
    rules.push('- If a tool result includes financial data, strip all dollar amounts before responding.')
  } else if (!hasFinancials) {
    rules.push('- You MUST NOT show: AR/AP totals, revenue figures, profit margins, or company-wide financial summaries.')
    rules.push('- You CAN show: individual order details, schedule info, inventory, product info, and job status.')
  } else {
    rules.push('- You CAN show operational financial data: AR/AP, revenue, margins, invoice amounts, PO values.')
  }

  if (!hasSensitiveFinancials) {
    rules.push('- You MUST NOT show: company bank balance, cash position, employee salaries/compensation, or credit facility details.')
  }

  // Role-specific capabilities
  const createPORoles = ['ADMIN', 'MANAGER', 'PURCHASING']
  if (!roles.some(r => createPORoles.includes(r))) {
    rules.push('- You CANNOT create purchase orders. Suggest the user contacts Purchasing or a Manager.')
  }

  const emailRoles = ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'PURCHASING', 'ACCOUNTING']
  if (!roles.some(r => emailRoles.includes(r))) {
    rules.push('- You CANNOT draft external emails. Suggest the user contacts their supervisor.')
  }

  return rules.join('\n')
}
