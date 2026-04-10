// ── Agent Orchestrator ────────────────────────────────────────────────────
// Single entry point for all channels (chat, SMS, email).
// Ties together: intent → data → response → persistence.

import { prisma } from '@/lib/prisma'
import { classifyIntent, classifyAllIntents } from './intents'
import type { Intent } from './intents'
import { resolveDataForIntent } from './resolvers'
import { generateResponse, generateMultiIntentResponse } from './responses'
import type { Channel, AgentResponse } from './responses'
import { loadContext, saveContext, updateContextFromRefs, resolveFollowUp } from './context'

export type { Intent } from './intents'
export type { Channel, AgentResponse } from './responses'

export interface AgentInput {
  message: string
  builderId: string
  conversationId?: string | null
  channel: Channel
}

export interface AgentResult {
  conversationId: string
  response: AgentResponse
  intent: Intent
  allIntents: Intent[]
}

/**
 * Process a message through the full agent pipeline.
 * This is the single function all channel routes should call.
 *
 * Pipeline: classify → resolve context → resolve data → generate response → persist
 */
export async function processMessage(input: AgentInput): Promise<AgentResult> {
  const { message, builderId, channel } = input

  // 1. Get builder name for personalized responses
  const builders: any[] = await prisma.$queryRawUnsafe(
    `SELECT "contactName", "companyName" FROM "Builder" WHERE id = $1`, builderId
  )
  const builderFirstName = builders[0]?.contactName?.split(' ')[0] || ''

  // 2. Get or create conversation
  let convId: string = input.conversationId || ''
  if (!convId) {
    const convRows: any[] = await prisma.$queryRawUnsafe(`
      INSERT INTO "AgentConversation" (id, "builderId", channel, status)
      VALUES (gen_random_uuid()::text, $1, $2, 'ACTIVE')
      RETURNING id
    `, builderId, channel)
    convId = convRows[0].id
  }

  // 3. Load conversation context for follow-up resolution
  const ctx = await loadContext(convId)
  ctx.builderFirstName = ctx.builderFirstName || builderFirstName

  // 4. Classify intent(s)
  let allIntents = classifyAllIntents(message)
  let primaryIntent = allIntents[0]

  // 5. Check for follow-up questions using context
  const followUp = resolveFollowUp(message, ctx)
  if (followUp && primaryIntent === 'GENERAL') {
    // Re-classify as the last intent's detail view
    if (followUp.resolvedOrderId) {
      primaryIntent = 'ORDER_DETAIL'
      allIntents = ['ORDER_DETAIL']
    } else if (followUp.resolvedDeliveryId) {
      primaryIntent = 'DELIVERY_STATUS'
      allIntents = ['DELIVERY_STATUS']
    }
  }

  // 6. Save user message
  await prisma.$queryRawUnsafe(`
    INSERT INTO "AgentMessage" (id, "conversationId", role, content, intent)
    VALUES (gen_random_uuid()::text, $1, 'user', $2, $3)
  `, convId, message, primaryIntent)

  // 7. Resolve data for all intents
  let response: AgentResponse

  if (allIntents.length > 1) {
    // Multi-intent: resolve data for each, generate combined response
    const dataMap = new Map<Intent, any>()
    for (const intent of allIntents.slice(0, 3)) { // max 3 intents
      try {
        dataMap.set(intent, await resolveDataForIntent(intent, builderId, message))
      } catch {
        dataMap.set(intent, null)
      }
    }
    response = generateMultiIntentResponse(allIntents, dataMap, builderFirstName, channel)
  } else {
    // Single intent
    let data: any = null
    try {
      data = await resolveDataForIntent(primaryIntent, builderId, message)
    } catch (err: any) {
      console.error(`Data resolution error for ${primaryIntent}:`, err.message)
    }
    response = generateResponse(primaryIntent, data, builderFirstName, channel)
  }

  // 8. Handle escalation
  if (primaryIntent === 'ESCALATE') {
    await prisma.$queryRawUnsafe(`
      UPDATE "AgentConversation" SET status = 'ESCALATED', "escalatedAt" = NOW(), "updatedAt" = NOW()
      WHERE id = $1
    `, convId)
  }

  // 9. Save agent response
  await prisma.$queryRawUnsafe(`
    INSERT INTO "AgentMessage" (id, "conversationId", role, content, intent, "dataRefs")
    VALUES (gen_random_uuid()::text, $1, 'assistant', $2, $3, $4::jsonb)
  `, convId, response.text, primaryIntent, JSON.stringify(response.dataRefs))

  // 10. Update conversation metadata
  await prisma.$queryRawUnsafe(`
    UPDATE "AgentConversation" SET "lastMessageAt" = NOW(), subject = COALESCE(subject, $2), "updatedAt" = NOW()
    WHERE id = $1
  `, convId, primaryIntent.replace(/_/g, ' ').toLowerCase())

  // 11. Update and save context
  const updatedCtx = updateContextFromRefs(ctx, primaryIntent, response.dataRefs)
  await saveContext(convId, updatedCtx)

  return {
    conversationId: convId,
    response,
    intent: primaryIntent,
    allIntents,
  }
}
