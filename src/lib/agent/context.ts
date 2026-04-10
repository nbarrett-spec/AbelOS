// ── Conversation Context Manager ─────────────────────────────────────────
// Tracks conversation state so follow-up questions work naturally.
// e.g. "What's my order status?" → "What items are on the first one?"
//
// Context is stored in AgentConversation.metadata (JSONB) so it persists
// across requests without extra tables.

import { prisma } from '@/lib/prisma'

export interface ConversationContext {
  /** Last-referenced entity IDs for follow-up resolution */
  lastEntities: {
    orderIds?: string[]
    orderNumbers?: string[]
    deliveryIds?: string[]
    deliveryNumbers?: string[]
    invoiceIds?: string[]
    invoiceNumbers?: string[]
    jobNumbers?: string[]
    productSkus?: string[]
    claimNumbers?: string[]
  }
  /** Last intent for context-aware re-classification */
  lastIntent?: string
  /** Number of messages in this conversation */
  messageCount: number
  /** Builder's first name for personalized responses */
  builderFirstName?: string
}

const EMPTY_CONTEXT: ConversationContext = {
  lastEntities: {},
  messageCount: 0,
}

/**
 * Load conversation context from the metadata JSONB column.
 */
export async function loadContext(conversationId: string): Promise<ConversationContext> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT metadata FROM "AgentConversation" WHERE id = $1`,
      conversationId,
    )
    if (rows.length === 0) return { ...EMPTY_CONTEXT }
    const meta = rows[0].metadata
    if (!meta || typeof meta !== 'object') return { ...EMPTY_CONTEXT }
    return {
      lastEntities: meta.lastEntities || {},
      lastIntent: meta.lastIntent || undefined,
      messageCount: meta.messageCount || 0,
      builderFirstName: meta.builderFirstName || undefined,
    }
  } catch {
    return { ...EMPTY_CONTEXT }
  }
}

/**
 * Save updated context back to the conversation metadata.
 */
export async function saveContext(conversationId: string, ctx: ConversationContext): Promise<void> {
  try {
    await prisma.$queryRawUnsafe(
      `UPDATE "AgentConversation" SET metadata = $1::jsonb, "updatedAt" = NOW() WHERE id = $2`,
      JSON.stringify(ctx),
      conversationId,
    )
  } catch (err: any) {
    console.error('Failed to save context:', err.message)
  }
}

/**
 * Update context with new data references from the latest response.
 * Extracts entity IDs/numbers from dataRefs and stores them for follow-ups.
 */
export function updateContextFromRefs(ctx: ConversationContext, intent: string, dataRefs: any[]): ConversationContext {
  const updated = { ...ctx, lastIntent: intent, messageCount: ctx.messageCount + 1 }

  if (!dataRefs || dataRefs.length === 0) return updated

  // Extract entities by type
  const entities = { ...ctx.lastEntities }

  const orders = dataRefs.filter((r: any) => r.type === 'order')
  if (orders.length > 0) {
    entities.orderIds = orders.map((r: any) => r.id)
    entities.orderNumbers = orders.filter((r: any) => r.number).map((r: any) => r.number)
  }

  const deliveries = dataRefs.filter((r: any) => r.type === 'delivery')
  if (deliveries.length > 0) {
    entities.deliveryIds = deliveries.map((r: any) => r.id)
    entities.deliveryNumbers = deliveries.filter((r: any) => r.number).map((r: any) => r.number)
  }

  const invoices = dataRefs.filter((r: any) => r.type === 'invoice')
  if (invoices.length > 0) {
    entities.invoiceIds = invoices.map((r: any) => r.id)
    entities.invoiceNumbers = invoices.filter((r: any) => r.number).map((r: any) => r.number)
  }

  const products = dataRefs.filter((r: any) => r.type === 'product')
  if (products.length > 0) {
    entities.productSkus = products.filter((r: any) => r.sku).map((r: any) => r.sku)
  }

  const warranties = dataRefs.filter((r: any) => r.type === 'warranty')
  if (warranties.length > 0) {
    entities.claimNumbers = warranties.map((r: any) => r.id)
  }

  updated.lastEntities = entities
  return updated
}

/**
 * Check if a message is likely a follow-up question that needs context.
 * Returns the resolved intent + any entity IDs to use, or null if not a follow-up.
 */
export function resolveFollowUp(
  message: string,
  ctx: ConversationContext,
): { resolvedOrderId?: string; resolvedDeliveryId?: string } | null {
  const m = message.toLowerCase().trim()

  // Common follow-up patterns
  const followUpPatterns = [
    /^(what|show|tell).*(about|on|in).*(it|that|this|the first|the second|#?\d)/i,
    /^(more|details|info|items|line items|breakdown)/i,
    /^(yes|yep|yeah|sure|ok).*(show|tell|more|details)?/i,
    /^the (first|second|third|last) one/i,
    /^#?\d{1,2}$/,  // Just a number like "1" or "#2"
  ]

  const isFollowUp = followUpPatterns.some(p => p.test(m))
  if (!isFollowUp) return null

  // Try to resolve "the first one", "the second one", "#2", etc.
  const ordinalMatch = m.match(/\b(first|second|third|last|1|2|3|#1|#2|#3)\b/)
  let index = 0
  if (ordinalMatch) {
    const val = ordinalMatch[1].replace('#', '')
    if (val === 'first' || val === '1') index = 0
    else if (val === 'second' || val === '2') index = 1
    else if (val === 'third' || val === '3') index = 2
    else if (val === 'last') index = -1 // special: last item
  }

  const result: { resolvedOrderId?: string; resolvedDeliveryId?: string } = {}

  // Resolve based on last intent context
  if (ctx.lastIntent?.startsWith('ORDER') && ctx.lastEntities.orderIds?.length) {
    const ids = ctx.lastEntities.orderIds
    result.resolvedOrderId = index === -1 ? ids[ids.length - 1] : ids[index] || ids[0]
  } else if (ctx.lastIntent?.startsWith('DELIVERY') && ctx.lastEntities.deliveryIds?.length) {
    const ids = ctx.lastEntities.deliveryIds
    result.resolvedDeliveryId = index === -1 ? ids[ids.length - 1] : ids[index] || ids[0]
  }

  return Object.keys(result).length > 0 ? result : null
}
