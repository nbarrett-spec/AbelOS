// ──────────────────────────────────────────────────────────────────────────
// Gmail / Google Workspace — Integration
// OAuth2 auth, Pub/Sub for real-time notifications
// Maps emails to CRM communication logs automatically
// Domain: abellumber.com (Google Workspace)
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { GmailMessage, GmailWatchResponse, SyncResult } from './types'

const GOOGLE_API = 'https://www.googleapis.com/gmail/v1'
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com/token'

interface GmailConfig {
  accessToken: string
  refreshToken: string
  tokenExpiresAt: Date
  gmailHistoryId?: string
  gmailWatchExpiry?: Date
}

async function getConfig(): Promise<GmailConfig | null> {
  const config = await (prisma as any).integrationConfig.findUnique({
    where: { provider: 'GMAIL' },
  })
  if (!config || config.status !== 'CONNECTED' || !config.accessToken) {
    return null
  }
  return {
    accessToken: config.accessToken,
    refreshToken: config.refreshToken,
    tokenExpiresAt: config.tokenExpiresAt,
    gmailHistoryId: config.gmailHistoryId,
    gmailWatchExpiry: config.gmailWatchExpiry,
  }
}

async function getValidAccessToken(): Promise<string | null> {
  const config = await getConfig()
  if (!config) return null

  // Check if token is expired (with 5 min buffer)
  if (config.tokenExpiresAt && new Date(config.tokenExpiresAt) > new Date(Date.now() + 5 * 60 * 1000)) {
    return config.accessToken
  }

  // Refresh the token
  if (!config.refreshToken) return null

  const integrationRecord = await (prisma as any).integrationConfig.findUnique({
    where: { provider: 'GMAIL' },
  })

  const clientId = integrationRecord?.metadata?.clientId
  const clientSecret = integrationRecord?.metadata?.clientSecret

  if (!clientId || !clientSecret) return null

  try {
    const response = await fetch(GOOGLE_OAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: config.refreshToken,
        grant_type: 'refresh_token',
      }),
    })

    if (!response.ok) return null

    const tokens = await response.json()
    const expiresAt = new Date(Date.now() + tokens.expires_in * 1000)

    await (prisma as any).integrationConfig.update({
      where: { provider: 'GMAIL' },
      data: {
        accessToken: tokens.access_token,
        tokenExpiresAt: expiresAt,
      },
    })

    return tokens.access_token
  } catch {
    return null
  }
}

async function gmailFetch(path: string, accessToken: string, options?: RequestInit) {
  const url = `${GOOGLE_API}/users/me${path}`
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options?.headers || {}),
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Gmail API ${response.status}: ${text}`)
  }

  return response.json()
}

// ─── Email Sync — Pull recent emails ─────────────────────────────────

export async function syncEmails(maxResults: number = 50): Promise<SyncResult> {
  const startedAt = new Date()
  const token = await getValidAccessToken()
  if (!token) {
    return {
      provider: 'GMAIL', syncType: 'emails', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'Gmail not configured or token expired',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  let created = 0, skipped = 0, failed = 0

  try {
    // Get list of recent messages
    const listData = await gmailFetch(`/messages?maxResults=${maxResults}&labelIds=INBOX`, token)
    const messageIds: string[] = (listData.messages || []).map((m: any) => m.id)

    for (const msgId of messageIds) {
      try {
        // Check if already processed
        const existing = await (prisma as any).communicationLog.findUnique({
          where: { gmailMessageId: msgId },
        })
        if (existing) { skipped++; continue }

        // Fetch full message
        const msg = await gmailFetch(`/messages/${msgId}?format=full`, token)
        const parsed = parseGmailMessage(msg)

        // Match to builder/org by email
        const match = await matchEmailToContact(parsed.from, parsed.to)

        await (prisma as any).communicationLog.create({
          data: {
            channel: 'EMAIL',
            direction: parsed.from.includes('@abellumber.com') ? 'OUTBOUND' : 'INBOUND',
            subject: parsed.subject,
            body: parsed.body,
            bodyHtml: parsed.bodyHtml,
            fromAddress: parsed.from,
            toAddresses: parsed.to,
            ccAddresses: parsed.cc,
            gmailMessageId: parsed.id,
            gmailThreadId: parsed.threadId,
            sentAt: new Date(parsed.date),
            hasAttachments: parsed.hasAttachments,
            attachmentCount: parsed.attachments.length,
            builderId: match.builderId,
            organizationId: match.organizationId,
            staffId: match.staffId,
            status: 'LOGGED',
          },
        })
        created++
      } catch (err) {
        failed++
        console.error(`Gmail message sync error for ${msgId}:`, err)
      }
    }

    // Update history ID for incremental sync
    if (listData.resultSizeEstimate > 0) {
      const latestMsg = await gmailFetch(`/messages/${messageIds[0]}?format=minimal`, token)
      await (prisma as any).integrationConfig.update({
        where: { provider: 'GMAIL' },
        data: {
          gmailHistoryId: latestMsg.historyId,
          lastSyncAt: new Date(),
          lastSyncStatus: 'success',
        },
      })
    }

    const completedAt = new Date()
    await (prisma as any).syncLog.create({
      data: {
        provider: 'GMAIL', syncType: 'emails', direction: 'PULL',
        status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
        recordsProcessed: created + skipped + failed,
        recordsCreated: created, recordsUpdated: 0,
        recordsSkipped: skipped, recordsFailed: failed,
        startedAt, completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
      },
    })

    return {
      provider: 'GMAIL', syncType: 'emails', direction: 'PULL',
      status: failed > 0 ? 'PARTIAL' : 'SUCCESS',
      recordsProcessed: created + skipped + failed,
      recordsCreated: created, recordsUpdated: 0,
      recordsSkipped: skipped, recordsFailed: failed,
      startedAt, completedAt,
      durationMs: completedAt.getTime() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'GMAIL', syncType: 'emails', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: error.message,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Pub/Sub Watch Setup ─────────────────────────────────────────────

export async function setupWatch(topicName: string): Promise<GmailWatchResponse | null> {
  const token = await getValidAccessToken()
  if (!token) return null

  try {
    const response = await gmailFetch('/watch', token, {
      method: 'POST',
      body: JSON.stringify({
        topicName, // e.g., "projects/abel-lumber/topics/gmail-notifications"
        labelIds: ['INBOX', 'SENT'],
        labelFilterBehavior: 'INCLUDE',
      }),
    })

    // Store watch expiry
    await (prisma as any).integrationConfig.update({
      where: { provider: 'GMAIL' },
      data: {
        gmailWatchExpiry: new Date(parseInt(response.expiration)),
        gmailHistoryId: response.historyId,
      },
    })

    return response
  } catch (error) {
    console.error('Gmail watch setup error:', error)
    return null
  }
}

// ─── Handle Pub/Sub Push Notification ────────────────────────────────

export async function handlePushNotification(historyId: string) {
  const token = await getValidAccessToken()
  if (!token) return

  const config = await getConfig()
  if (!config?.gmailHistoryId) return

  try {
    // Get history since last known ID
    const history = await gmailFetch(
      `/history?startHistoryId=${config.gmailHistoryId}&historyTypes=messageAdded`,
      token
    )

    const messageIdSet = new Set<string>()
    for (const record of (history.history || [])) {
      for (const added of (record.messagesAdded || [])) {
        messageIdSet.add(added.message.id)
      }
    }
    const messageIds = Array.from(messageIdSet)

    // Process each new message
    for (const msgId of messageIds) {
      const existing = await (prisma as any).communicationLog.findUnique({
        where: { gmailMessageId: msgId },
      })
      if (existing) continue

      const msg = await gmailFetch(`/messages/${msgId}?format=full`, token)
      const parsed = parseGmailMessage(msg)
      const match = await matchEmailToContact(parsed.from, parsed.to)

      await (prisma as any).communicationLog.create({
        data: {
          channel: 'EMAIL',
          direction: parsed.from.includes('@abellumber.com') ? 'OUTBOUND' : 'INBOUND',
          subject: parsed.subject,
          body: parsed.body,
          bodyHtml: parsed.bodyHtml,
          fromAddress: parsed.from,
          toAddresses: parsed.to,
          ccAddresses: parsed.cc,
          gmailMessageId: parsed.id,
          gmailThreadId: parsed.threadId,
          sentAt: new Date(parsed.date),
          hasAttachments: parsed.hasAttachments,
          attachmentCount: parsed.attachments.length,
          builderId: match.builderId,
          organizationId: match.organizationId,
          staffId: match.staffId,
          status: 'LOGGED',
        },
      })
    }

    // Update history ID
    await (prisma as any).integrationConfig.update({
      where: { provider: 'GMAIL' },
      data: { gmailHistoryId: historyId },
    })
  } catch (error) {
    console.error('Gmail push notification handler error:', error)
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function parseGmailMessage(msg: any): GmailMessage {
  const headers = msg.payload?.headers || []
  const getHeader = (name: string) => headers.find((h: any) => h.name.toLowerCase() === name.toLowerCase())?.value || ''

  // Extract body
  let body = ''
  let bodyHtml = ''

  function extractBody(part: any) {
    if (part.mimeType === 'text/plain' && part.body?.data) {
      body = Buffer.from(part.body.data, 'base64url').toString('utf-8')
    }
    if (part.mimeType === 'text/html' && part.body?.data) {
      bodyHtml = Buffer.from(part.body.data, 'base64url').toString('utf-8')
    }
    if (part.parts) {
      for (const sub of part.parts) extractBody(sub)
    }
  }
  extractBody(msg.payload)

  // Extract attachments
  const attachments: GmailMessage['attachments'] = []
  function extractAttachments(part: any) {
    if (part.filename && part.body?.attachmentId) {
      attachments.push({
        attachmentId: part.body.attachmentId,
        filename: part.filename,
        mimeType: part.mimeType,
        size: part.body.size || 0,
      })
    }
    if (part.parts) {
      for (const sub of part.parts) extractAttachments(sub)
    }
  }
  extractAttachments(msg.payload)

  const toField = getHeader('To')
  const ccField = getHeader('Cc')

  return {
    id: msg.id,
    threadId: msg.threadId,
    labelIds: msg.labelIds || [],
    from: extractEmail(getHeader('From')),
    to: toField ? toField.split(',').map((e: string) => extractEmail(e.trim())) : [],
    cc: ccField ? ccField.split(',').map((e: string) => extractEmail(e.trim())) : [],
    subject: getHeader('Subject'),
    body,
    bodyHtml,
    date: getHeader('Date'),
    hasAttachments: attachments.length > 0,
    attachments,
  }
}

function extractEmail(str: string): string {
  const match = str.match(/<(.+?)>/)
  return match ? match[1].toLowerCase() : str.toLowerCase().trim()
}

async function matchEmailToContact(from: string, to: string[]): Promise<{
  builderId: string | null
  organizationId: string | null
  staffId: string | null
}> {
  let builderId: string | null = null
  let organizationId: string | null = null
  let staffId: string | null = null

  // All addresses involved
  const allAddresses = [from, ...to].map(e => e.toLowerCase())
  const externalAddresses = allAddresses.filter(e => !e.includes('@abellumber.com'))
  const internalAddresses = allAddresses.filter(e => e.includes('@abellumber.com'))

  // Match external addresses to builders
  for (const addr of externalAddresses) {
    const builder = await (prisma as any).builder.findFirst({
      where: { email: addr },
      include: { organization: true },
    })
    if (builder) {
      builderId = builder.id
      organizationId = builder.organizationId
      break
    }

    // Try matching to org contact email
    const org = await (prisma as any).builderOrganization.findFirst({
      where: { email: addr },
    })
    if (org) {
      organizationId = org.id
      break
    }
  }

  // Match internal addresses to staff
  for (const addr of internalAddresses) {
    const staff = await (prisma as any).staff.findFirst({
      where: { email: addr },
    })
    if (staff) {
      staffId = staff.id
      break
    }
  }

  return { builderId, organizationId, staffId }
}

// ─── OAuth2 URL Generator ───────────────────────────────────────────

export function getOAuthUrl(clientId: string, redirectUri: string): string {
  const scopes = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.modify',
  ]

  return `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(scopes.join(' '))}` +
    `&access_type=offline` +
    `&prompt=consent` +
    `&hd=abellumber.com` // Restrict to workspace domain
}

// ─── OAuth2 Token Exchange ───────────────────────────────────────────

export async function exchangeCodeForTokens(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date } | null> {
  try {
    const response = await fetch(GOOGLE_OAUTH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    })

    if (!response.ok) return null

    const tokens = await response.json()
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: new Date(Date.now() + tokens.expires_in * 1000),
    }
  } catch {
    return null
  }
}
