export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { sendMessage, buildSystemPrompt, type ClaudeMessage } from '@/lib/claude'
import { getToolsForRoles, executeTool } from '@/lib/claude-tools'
import { parseRoles, canViewOperationalFinancials } from '@/lib/permissions'
import type { StaffRole } from '@/lib/permissions'

interface ChatRequest {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  context?: string  // optional page context (e.g., "Currently on: Purchase Orders page")
}

interface ActionableRecommendation {
  type: 'approve_po' | 'send_reminder' | 'adjust_price' | 'schedule_delivery' | 'flag_review'
  label: string
  description: string
  endpoint: string
  payload: any
}

// POST /api/ops/ai/chat — Claude-powered AI assistant
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Extract staff info from headers (set by middleware)
    const staffId = request.headers.get('x-staff-id') || ''
    const staffRole = request.headers.get('x-staff-role') || 'VIEWER'
    const staffRoles = parseRoles(request.headers.get('x-staff-roles') || staffRole) as StaffRole[]
    const staffEmail = request.headers.get('x-staff-email') || ''
    const staffDepartment = request.headers.get('x-staff-department') || ''
    const staffFirstName = request.headers.get('x-staff-firstname') || ''
    const staffLastName = request.headers.get('x-staff-lastname') || ''

    const body: ChatRequest = await request.json()
    const { messages: chatMessages, context } = body

    if (!chatMessages || chatMessages.length === 0) {
      return NextResponse.json({ error: 'Messages are required' }, { status: 400 })
    }

    // Build the system prompt with staff context
    const systemPrompt = buildSystemPrompt({
      firstName: staffFirstName || staffEmail.split('@')[0],
      lastName: staffLastName || '',
      email: staffEmail,
      role: staffRole,
      roles: staffRoles,
      department: staffDepartment,
    }) + (context ? `\n\nCURRENT PAGE CONTEXT: ${context}` : '') + `

IMPORTANT - ACTIONABLE RECOMMENDATIONS:
When you identify actions that should be taken (creating purchase orders, sending reminders, adjusting prices, scheduling deliveries, or flagging items for review), format your recommendations in a structured way.

If recommending an action, include it in your message text AND in a separate JSON structure for frontend parsing.

Examples of actionable scenarios:
- "I recommend creating a PO for..." → include an approve_po action
- "You should send a payment reminder to..." → include a send_reminder action
- "I suggest adjusting the price for..." → include an adjust_price action
- "We should schedule delivery for..." → include a schedule_delivery action
- "This item needs review..." → include a flag_review action

Always include the action reasoning in your text message as well.`

    // Get tools available for this user's roles
    const tools = getToolsForRoles(staffRoles)
    const hasFinancialAccess = canViewOperationalFinancials(staffRoles)

    // Convert chat messages to Claude format
    const claudeMessages: ClaudeMessage[] = chatMessages.map(m => ({
      role: m.role,
      content: m.content,
    }))

    // Send to Claude with tool support
    const result = await sendMessage({
      systemPrompt,
      messages: claudeMessages,
      tools,
      executeTool: async (toolName, toolInput) => {
        return await executeTool(toolName, toolInput, staffRoles, hasFinancialAccess)
      },
      maxTokens: 4096,
    })

    // Parse actions from the response text if present
    const actions: ActionableRecommendation[] = parseActionsFromText(result.text)

    return NextResponse.json({
      message: result.text,
      toolsUsed: result.toolCalls.map(tc => ({
        tool: tc.name,
        summary: tc.name.replace(/_/g, ' '),
      })),
      ...(actions.length > 0 && { actions }),
    })
  } catch (error: any) {
    console.error('AI Chat error:', error)

    // Friendly error messages
    if (error.message?.includes('ANTHROPIC_API_KEY')) {
      return NextResponse.json({
        message: 'The AI assistant is not yet configured. An administrator needs to add the ANTHROPIC_API_KEY to the environment settings.',
        error: 'configuration',
      }, { status: 503 })
    }

    if (error.message?.includes('401') || error.message?.includes('authentication')) {
      return NextResponse.json({
        message: 'The AI assistant API key is invalid. Please contact an administrator.',
        error: 'auth',
      }, { status: 503 })
    }

    if (error.message?.includes('429') || error.message?.includes('rate')) {
      return NextResponse.json({
        message: 'The AI assistant is temporarily busy. Please try again in a moment.',
        error: 'rate_limit',
      }, { status: 429 })
    }

    return NextResponse.json({
      message: 'Something went wrong with the AI assistant. Please try again.',
      error: 'internal',
    }, { status: 500 })
  }
}

// Helper function to parse actionable recommendations from AI response text
function parseActionsFromText(text: string): ActionableRecommendation[] {
  const actions: ActionableRecommendation[] = []

  // Pattern: [ACTION_TYPE] label | description | endpoint | json_payload
  const actionPattern = /\[ACTION:(\w+)\]\s*([^\n]+)\n\s*Description:\s*([^\n]+)\n\s*Endpoint:\s*([^\n]+)\n\s*Payload:\s*({[^}]+})/gi

  let match
  while ((match = actionPattern.exec(text)) !== null) {
    try {
      const type = match[1].toLowerCase() as any
      const label = match[2].trim()
      const description = match[3].trim()
      const endpoint = match[4].trim()
      const payloadStr = match[5].trim()

      // Only include recognized action types
      const validTypes = ['approve_po', 'send_reminder', 'adjust_price', 'schedule_delivery', 'flag_review']
      if (!validTypes.includes(type)) continue

      const payload = JSON.parse(payloadStr)

      actions.push({
        type: type as any,
        label,
        description,
        endpoint,
        payload,
      })
    } catch (err) {
      // Skip malformed actions
      continue
    }
  }

  return actions
}
