// ──────────────────────────────────────────────────────────────────────────
// Gmail / Google Workspace — Integration
// Supports two auth modes:
//   1. Service Account with domain-wide delegation (production — all 6 mailboxes)
//   2. OAuth2 per-user refresh tokens (legacy/manual)
// Maps emails to CRM communication logs automatically
// Domain: abellumber.com (Google Workspace)
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { GmailMessage, GmailWatchResponse, SyncResult } from './types'
import * as crypto from 'crypto'

const GOOGLE_API = 'https://www.googleapis.com/gmail/v1'
const GOOGLE_OAUTH = 'https://oauth2.googleapis.com/token'
const GOOGLE_ADMIN_API = 'https://admin.googleapis.com/admin/directory/v1'

// ─── Service Account Auth (Domain-Wide Delegation) ──────────────────

interface ServiceAccountKey {
  type: string
  project_id: string
  private_key_id: string
  private_key: string
  client_email: string
  client_id: string
  auth_uri: string
  token_uri: string
}

// Cache tokens per-user to avoid re-signing JWTs on every API call
const tokenCache = new Map<string, { token: string; expiresAt: number }>()

/**
 * Load the service account key from env var.
 * Set GOOGLE_SERVICE_ACCOUNT_KEY to the full JSON string,
 * or GOOGLE_SERVICE_ACCOUNT_KEY_PATH to the file path.
 *
 * Returns the key, or an object with an `error` string on failure so the
 * caller can surface the real reason (previously both failure modes returned
 * null indistinguishably, which hid "key pasted with bad newline escaping").
 */
function getServiceAccountKey(): ServiceAccountKey | null {
  const res = loadServiceAccountKey()
  return 'error' in res ? null : res
}

export function loadServiceAccountKey(): ServiceAccountKey | { error: string } {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  if (keyJson) {
    try {
      const parsed = JSON.parse(keyJson) as ServiceAccountKey
      if (!parsed.client_email || !parsed.private_key || !parsed.token_uri) {
        return { error: `GOOGLE_SERVICE_ACCOUNT_KEY JSON is missing required fields (client_email/private_key/token_uri). Got keys: ${Object.keys(parsed).join(',')}` }
      }
      return parsed
    } catch (e: any) {
      return { error: `GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON: ${e?.message?.slice(0, 200) || 'parse error'}. Common cause: private_key newlines were stripped when pasted into Vercel — re-paste as a single-line JSON with \\n escapes intact.` }
    }
  }
  const keyPath = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH
  if (keyPath) {
    try {
      const fs = require('fs')
      const parsed = JSON.parse(fs.readFileSync(keyPath, 'utf8')) as ServiceAccountKey
      if (!parsed.client_email || !parsed.private_key) {
        return { error: `Key file at ${keyPath} is missing required fields` }
      }
      return parsed
    } catch (e: any) {
      return { error: `Could not read GOOGLE_SERVICE_ACCOUNT_KEY_PATH (${keyPath}): ${e?.message?.slice(0, 200) || 'io error'}` }
    }
  }
  return { error: 'Neither GOOGLE_SERVICE_ACCOUNT_KEY nor GOOGLE_SERVICE_ACCOUNT_KEY_PATH is set' }
}

/**
 * Create a signed JWT for Google service account auth.
 * Impersonates `userEmail` via domain-wide delegation.
 */
function createServiceAccountJwt(
  key: ServiceAccountKey,
  scopes: string[],
  userEmail: string
): string {
  const now = Math.floor(Date.now() / 1000)
  const header = { alg: 'RS256', typ: 'JWT' }
  const payload = {
    iss: key.client_email,
    sub: userEmail, // Impersonate this user
    scope: scopes.join(' '),
    aud: key.token_uri,
    iat: now,
    exp: now + 3600, // 1 hour
  }

  const encode = (obj: object) =>
    Buffer.from(JSON.stringify(obj)).toString('base64url')

  const headerB64 = encode(header)
  const payloadB64 = encode(payload)
  const signingInput = `${headerB64}.${payloadB64}`

  const signature = crypto
    .createSign('RSA-SHA256')
    .update(signingInput)
    .sign(key.private_key, 'base64url')

  return `${signingInput}.${signature}`
}

/**
 * Get an access token for a specific user via service account impersonation.
 * Caches tokens for up to 50 minutes.
 */
async function getServiceAccountToken(
  userEmail: string,
  scopes: string[] = ['https://www.googleapis.com/auth/gmail.readonly']
): Promise<string | null> {
  const cacheKey = `${userEmail}:${scopes.join(',')}`
  const cached = tokenCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.token
  }

  const key = getServiceAccountKey()
  if (!key) return null

  try {
    const jwt = createServiceAccountJwt(key, scopes, userEmail)
    const response = await fetch(key.token_uri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt,
      }),
    })

    if (!response.ok) {
      const text = await response.text()
      console.error(`Service account token exchange failed for ${userEmail}:`, text)
      return null
    }

    const data = await response.json()
    tokenCache.set(cacheKey, {
      token: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    })
    return data.access_token
  } catch (err) {
    console.error('Service account JWT exchange error:', err)
    return null
  }
}

/**
 * List all users in the abellumber.com Google Workspace domain.
 * Requires Admin SDK Directory API + admin.directory.user.readonly scope.
 * The `sub` user must be a Workspace admin (e.g. nate@abellumber.com).
 */
export async function listDomainUsers(
  adminEmail: string = 'n.barrett@abellumber.com'
): Promise<string[]> {
  const token = await getServiceAccountToken(adminEmail, [
    'https://www.googleapis.com/auth/admin.directory.user.readonly',
  ])
  if (!token) return []

  try {
    const response = await fetch(
      `${GOOGLE_ADMIN_API}/users?domain=abellumber.com&maxResults=100`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (!response.ok) {
      console.error('Admin API error:', await response.text())
      return []
    }
    const data = await response.json()
    return (data.users || []).map((u: any) => u.primaryEmail as string)
  } catch (err) {
    console.error('List domain users error:', err)
    return []
  }
}

/**
 * Sync emails for ALL domain users via service account delegation.
 * This is the main production sync function called by the cron.
 */
export async function syncAllAccounts(
  maxPerAccount: number = 50,
  query: string = 'newer_than:1d',
  opts: { deadlineAt?: number } = {}
): Promise<SyncResult> {
  const startedAt = new Date()
  let totalCreated = 0, totalSkipped = 0, totalFailed = 0
  let firstError: string | null = null
  // Default deadline: 220s after start — leaves budget for the route to finish
  // writing CronRun even if we abort mid-loop.
  const deadlineAt = opts.deadlineAt ?? (Date.now() + 220_000)
  const outOfTime = () => Date.now() > deadlineAt

  const keyResult = loadServiceAccountKey()
  if ('error' in keyResult) {
    return {
      provider: 'GMAIL', syncType: 'multi-account', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: keyResult.error,
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  // Get all users in the domain
  const users = await listDomainUsers()
  if (users.length === 0) {
    return {
      provider: 'GMAIL', syncType: 'multi-account', direction: 'PULL',
      status: 'FAILED', recordsProcessed: 0, recordsCreated: 0,
      recordsUpdated: 0, recordsSkipped: 0, recordsFailed: 0,
      errorMessage: 'listDomainUsers() returned 0 — check (a) service account has admin.directory.user.readonly scope via domain-wide delegation, (b) admin email n.barrett@abellumber.com is a Workspace admin, (c) Admin SDK API is enabled in the GCP project',
      startedAt, completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }

  // console.log(`[Gmail Sync] Found ${users.length} domain users: ${users.join(', ')}`)

  for (const userEmail of users) {
    if (outOfTime()) {
      firstError = firstError || `Aborted before ${userEmail} — time budget reached after ${totalCreated} created across prior accounts`
      break
    }
    try {
      const token = await getServiceAccountToken(userEmail)
      if (!token) {
        firstError = firstError || `Could not get Gmail access token for ${userEmail} — check domain-wide delegation is authorized for scope gmail.readonly`
        console.warn(`[Gmail Sync] Could not get token for ${userEmail}, skipping`)
        totalFailed++
        continue
      }

      // List messages matching query
      const listUrl = `${GOOGLE_API}/users/me/messages?maxResults=${maxPerAccount}&q=${encodeURIComponent(query)}`
      const listResponse = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (!listResponse.ok) {
        const bodyText = await listResponse.text().catch(() => '')
        firstError = firstError || `Gmail messages.list for ${userEmail} → ${listResponse.status} ${bodyText.slice(0, 200)}`
        console.warn(`[Gmail Sync] List failed for ${userEmail}: ${listResponse.status}`)
        totalFailed++
        continue
      }

      const listData = await listResponse.json()
      const messageIds: string[] = (listData.messages || []).map((m: any) => m.id)

      for (const msgId of messageIds) {
        if (outOfTime()) {
          firstError = firstError || `Aborted mid-account ${userEmail} — time budget reached after ${totalCreated} created`
          break
        }
        try {
          // Check for duplicate
          const existing = await prisma.$queryRawUnsafe<any[]>(
            `SELECT "id" FROM "CommunicationLog" WHERE "gmailMessageId" = $1 LIMIT 1`,
            msgId
          )
          if (existing.length > 0) { totalSkipped++; continue }

          // Fetch full message
          const msgResponse = await fetch(
            `${GOOGLE_API}/users/me/messages/${msgId}?format=full`,
            { headers: { Authorization: `Bearer ${token}` } }
          )
          if (!msgResponse.ok) { totalFailed++; continue }

          const msg = await msgResponse.json()
          const parsed = parseGmailMessage(msg)
          const match = await matchEmailToContact(parsed.from, parsed.to)

          const direction = parsed.from.includes('@abellumber.com') ? 'OUTBOUND' : 'INBOUND'

          await prisma.$executeRawUnsafe(
            `INSERT INTO "CommunicationLog" (
              "channel", "direction", "subject", "body", "bodyHtml", "fromAddress",
              "toAddresses", "ccAddresses", "sentAt", "status",
              "hasAttachments", "attachmentCount", "gmailMessageId", "gmailThreadId",
              "builderId", "organizationId", "staffId", "syncAccount"
            ) VALUES (
              'EMAIL'::"CommChannel", $1::"CommDirection", $2, $3, $4, $5,
              $6::text[], $7::text[], $8, 'SYNCED'::"CommLogStatus",
              $9, $10, $11, $12, $13, $14, $15, $16
            )`,
            direction,
            parsed.subject || '(No Subject)',
            parsed.body || null,
            parsed.bodyHtml || null,
            parsed.from,
            `{${parsed.to.map(a => `"${a}"`).join(',')}}`,
            `{${parsed.cc.map(a => `"${a}"`).join(',')}}`,
            parsed.date ? new Date(parsed.date) : new Date(),
            parsed.hasAttachments,
            parsed.attachments.length,
            parsed.id,
            parsed.threadId,
            match.builderId,
            match.organizationId,
            match.staffId,
            userEmail
          )
          totalCreated++
        } catch (err: any) {
          totalFailed++
          firstError = firstError || `Message ${msgId} (${userEmail}) insert failed: ${err?.message?.slice(0, 200) || String(err).slice(0, 200)}`
          console.error(`[Gmail Sync] Message ${msgId} error for ${userEmail}:`, err)
        }
      }
    } catch (err: any) {
      totalFailed++
      firstError = firstError || `Account ${userEmail} top-level error: ${err?.message?.slice(0, 200) || String(err).slice(0, 200)}`
      console.error(`[Gmail Sync] Account ${userEmail} error:`, err)
    }
  }

  const completedAt = new Date()
  const result: SyncResult = {
    provider: 'GMAIL', syncType: 'multi-account', direction: 'PULL',
    status: totalFailed > 0 ? (totalCreated > 0 ? 'PARTIAL' : 'FAILED') : 'SUCCESS',
    recordsProcessed: totalCreated + totalSkipped + totalFailed,
    recordsCreated: totalCreated, recordsUpdated: 0,
    recordsSkipped: totalSkipped, recordsFailed: totalFailed,
    errorMessage: firstError || undefined,
    startedAt, completedAt,
    durationMs: completedAt.getTime() - startedAt.getTime(),
  }

  // Log sync result
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SyncLog" (provider, "syncType", direction, status,
       "recordsProcessed", "recordsCreated", "recordsUpdated", "recordsSkipped", "recordsFailed",
       "startedAt", "completedAt", "durationMs", "errorMessage")
      VALUES ($1::"IntegrationProvider", $2, $3::"SyncDirection", $4::"SyncStatus",
       $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      'GMAIL', 'multi-account', 'PULL', result.status,
      result.recordsProcessed, result.recordsCreated, result.recordsUpdated,
      result.recordsSkipped, result.recordsFailed,
      result.startedAt, result.completedAt, result.durationMs,
      result.errorMessage || null
    )
  } catch (logErr) {
    console.error('[Gmail Sync] Failed to write SyncLog:', logErr)
  }

  // console.log(`[Gmail Sync] Complete: ${totalCreated} created, ${totalSkipped} skipped, ${totalFailed} failed across ${users.length} accounts`)
  return result
}

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
