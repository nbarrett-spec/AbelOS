export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// Google Chat Integration API
// Stores webhook configs in AgentTask (taskType = 'GCHAT_WEBHOOK')
// ──────────────────────────────────────────────────────────────────────────

interface GChatChannel {
  id: string
  name: string
  description: string
  webhookUrl: string
  active: boolean
}

const DEFAULT_CHANNELS: GChatChannel[] = [
  { id: 'general', name: 'General', description: 'Company-wide announcements', webhookUrl: '', active: false },
  { id: 'sales', name: 'Sales', description: 'Deal updates, quote alerts, new leads', webhookUrl: '', active: false },
  { id: 'ops', name: 'Operations', description: 'Job status, delivery updates, scheduling', webhookUrl: '', active: false },
  { id: 'finance', name: 'Finance', description: 'AR alerts, collection notices, payment received', webhookUrl: '', active: false },
  { id: 'warehouse', name: 'Warehouse', description: 'Stock alerts, receiving, PO arrivals', webhookUrl: '', active: false },
  { id: 'alerts', name: 'System Alerts', description: 'AI insights, margin warnings, system health', webhookUrl: '', active: false },
]

async function getConfiguredChannels(): Promise<GChatChannel[]> {
  try {
    const configs: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, payload FROM "AgentTask" WHERE "taskType" = 'GCHAT_WEBHOOK' AND status = 'COMPLETE'`
    )

    const configured = configs.map(c => {
      const p = typeof c.payload === 'string' ? JSON.parse(c.payload) : c.payload
      return {
        id: p.channelId || '',
        name: p.name || '',
        description: p.description || '',
        webhookUrl: p.webhookUrl || '',
        active: true,
      }
    })

    return DEFAULT_CHANNELS.map(dc => {
      const found = configured.find(c => c.id === dc.id)
      return found ? { ...dc, ...found, active: true } : dc
    })
  } catch (e) {
    console.error('[GChat] Failed to fetch configured channels:', e)
    return DEFAULT_CHANNELS
  }
}

async function getChannelWebhookUrl(channelId: string): Promise<string | null> {
  try {
    const configs: any[] = await prisma.$queryRawUnsafe(
      `SELECT payload FROM "AgentTask" WHERE "taskType" = 'GCHAT_WEBHOOK' AND status = 'COMPLETE' AND payload::text LIKE $1 LIMIT 1`,
      `%"channelId":"${channelId}"%`
    )
    if (!configs.length) return null
    const p = typeof configs[0].payload === 'string' ? JSON.parse(configs[0].payload) : configs[0].payload
    return p.webhookUrl || null
  } catch (e) {
    console.error(`[GChat] Failed to fetch webhook for ${channelId}:`, e)
    return null
  }
}

// GET – Return list of channels
export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const channels = await getConfiguredChannels()
    const configured = channels.filter(c => c.active).length
    return NextResponse.json({ channels, configured, total: channels.length })
  } catch (error) {
    console.error('[GChat] GET error:', error)
    return NextResponse.json({ error: 'Failed to fetch channels' }, { status: 500 })
  }
}

// POST – Configure webhook, send message, or test
export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { action, channelId, webhookUrl, name, text, cards } = body

    if (!action || !channelId) {
      return NextResponse.json({ error: 'Missing action or channelId' }, { status: 400 })
    }

    // ── Configure ──
    if (action === 'configure') {
      if (!webhookUrl) {
        return NextResponse.json({ error: 'Missing webhookUrl' }, { status: 400 })
      }

      const defaultChannel = DEFAULT_CHANNELS.find(c => c.id === channelId)
      if (!defaultChannel) {
        return NextResponse.json({ error: 'Invalid channelId' }, { status: 400 })
      }

      // Delete existing config for this channel
      await prisma.$executeRawUnsafe(
        `DELETE FROM "AgentTask" WHERE "taskType" = 'GCHAT_WEBHOOK' AND payload::text LIKE $1`,
        `%"channelId":"${channelId}"%`
      )

      // Insert new config
      const taskId = `gchat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const payload = JSON.stringify({
        channelId,
        name: name || defaultChannel.name,
        description: defaultChannel.description,
        webhookUrl,
        configuredAt: new Date().toISOString(),
      })

      await prisma.$executeRawUnsafe(
        `INSERT INTO "AgentTask" (id, "taskType", status, priority, payload, "createdAt", "updatedAt")
         VALUES ($1, 'GCHAT_WEBHOOK', 'COMPLETE', 'LOW', $2::jsonb, NOW(), NOW())`,
        taskId, payload
      )

      return NextResponse.json({
        success: true,
        channel: { id: channelId, name: name || defaultChannel.name, active: true },
      })
    }

    // ── Send ──
    if (action === 'send') {
      if (!text) {
        return NextResponse.json({ error: 'Missing text' }, { status: 400 })
      }

      const hookUrl = await getChannelWebhookUrl(channelId)
      if (!hookUrl) {
        return NextResponse.json({ error: 'Channel not configured' }, { status: 404 })
      }

      const payload: any = { text }
      if (cards) payload.cards = cards

      const response = await fetch(hookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        return NextResponse.json({ error: `Google Chat API error: ${response.status}` }, { status: response.status })
      }

      return NextResponse.json({ success: true, message: 'Sent to Google Chat' })
    }

    // ── Test ──
    if (action === 'test') {
      const hookUrl = await getChannelWebhookUrl(channelId)
      if (!hookUrl) {
        return NextResponse.json({ error: 'Channel not configured' }, { status: 404 })
      }

      const channel = DEFAULT_CHANNELS.find(c => c.id === channelId)
      const response = await fetch(hookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: `✅ Abel OS connected to Google Chat! Channel: ${channel?.name || channelId}` }),
      })

      if (!response.ok) {
        return NextResponse.json({ error: `Google Chat API error: ${response.status}` }, { status: response.status })
      }

      return NextResponse.json({ success: true, message: 'Test message sent successfully' })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[GChat] POST error:', error)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
}
