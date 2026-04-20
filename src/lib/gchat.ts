/**
 * Google Chat webhook utility
 * Send messages to Google Chat spaces from anywhere in the app.
 * Webhooks are stored in AgentTask (taskType = 'GCHAT_WEBHOOK').
 */

import { prisma } from '@/lib/prisma'

interface GChatMessage {
  channelId: string
  text: string
  threadKey?: string
}

export async function sendGChat(msg: GChatMessage): Promise<{
  success: boolean
  error?: string
}> {
  try {
    // Look up webhook URL from AgentTask
    const configs: any[] = await prisma.$queryRawUnsafe(
      `SELECT payload FROM "AgentTask" WHERE "taskType" = 'GCHAT_WEBHOOK' AND status = 'COMPLETE' AND payload::text LIKE $1 LIMIT 1`,
      `%"channelId":"${msg.channelId}"%`
    )

    if (!configs.length) {
      console.warn(`[GChat] Channel "${msg.channelId}" not configured`)
      return { success: false, error: `Channel "${msg.channelId}" not configured` }
    }

    const p = typeof configs[0].payload === 'string' ? JSON.parse(configs[0].payload) : configs[0].payload
    const webhookUrl = p.webhookUrl

    if (!webhookUrl) {
      return { success: false, error: `No webhook URL for channel "${msg.channelId}"` }
    }

    const payload: any = { text: msg.text }
    if (msg.threadKey) {
      payload.thread = { threadKey: msg.threadKey }
    }

    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const errorText = await response.text()
      console.error(`[GChat] Send failed (${response.status}): ${errorText}`)
      return { success: false, error: `Google Chat API error: ${response.status}` }
    }

    return { success: true }
  } catch (error) {
    console.error('[GChat] Send error:', error)
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' }
  }
}

// Convenience functions per channel
export async function notifyGeneral(text: string) { return sendGChat({ channelId: 'general', text }) }
export async function notifySales(text: string) { return sendGChat({ channelId: 'sales', text }) }
export async function notifyOps(text: string) { return sendGChat({ channelId: 'ops', text }) }
export async function notifyFinance(text: string) { return sendGChat({ channelId: 'finance', text }) }
export async function notifyWarehouse(text: string) { return sendGChat({ channelId: 'warehouse', text }) }
export async function notifyAlerts(text: string) { return sendGChat({ channelId: 'alerts', text }) }
