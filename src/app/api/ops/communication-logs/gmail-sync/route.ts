export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/communication-logs/gmail-sync
//
// POST — Sync Gmail emails into the CommunicationLog table
//
// Accepts an array of email thread data (from the Gmail MCP connector,
// the frontend Gmail search, or the Google Apps Script auto-sync).
// Deduplicates by gmailMessageId.
//
// Auth: Either staff session (middleware headers) OR x-api-key header
// for service-to-service calls (Google Apps Script, cron, etc.)
//
// Body: { emails: GmailEmail[], syncAccount?: string }
//
// GET — Check sync status and last sync time
// ──────────────────────────────────────────────────────────────────────────

const GMAIL_SYNC_API_KEY = process.env.GMAIL_SYNC_API_KEY || process.env.API_SECRET_KEY || 'abel-os-gmail-sync-2024'

interface GmailEmail {
  messageId: string       // Gmail message ID
  threadId: string        // Gmail thread ID
  subject: string
  sender: string          // e.g. "nate@abellumber.com"
  toRecipients: string[]
  ccRecipients?: string[]
  snippet: string         // Preview text
  body?: string           // Full body (optional)
  date: string            // ISO timestamp
  hasAttachment?: boolean
  labels?: string[]
  syncAccount?: string    // Which Gmail account this was synced from
}

/**
 * Auth check that supports both staff session and API key auth.
 * The Apps Script sends x-api-key for service-to-service auth.
 */
function checkSyncAuth(request: NextRequest): NextResponse | null {
  // First check for API key (service-to-service from Apps Script)
  const apiKey = request.headers.get('x-api-key')
  if (apiKey && apiKey === GMAIL_SYNC_API_KEY) {
    return null // Authorized via API key
  }

  // Fall back to staff session auth (frontend calls)
  return checkStaffAuth(request)
}

export async function GET(request: NextRequest) {
  const authError = checkSyncAuth(request)
  if (authError) return authError

  try {
    // Get sync stats — overall and per-account
    const [totalSynced, lastSync, todayCount, perAccount] = await Promise.all([
      prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int AS total FROM "CommunicationLog" WHERE "channel" = 'EMAIL' AND "gmailMessageId" IS NOT NULL`
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT MAX("createdAt") AS "lastSync" FROM "CommunicationLog" WHERE "channel" = 'EMAIL' AND "gmailMessageId" IS NOT NULL`
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT COUNT(*)::int AS total FROM "CommunicationLog" WHERE "channel" = 'EMAIL' AND "gmailMessageId" IS NOT NULL AND "sentAt" >= CURRENT_DATE`
      ),
      prisma.$queryRawUnsafe<any[]>(
        `SELECT "syncAccount", COUNT(*)::int AS total, MAX("sentAt") AS "lastEmail"
         FROM "CommunicationLog"
         WHERE "channel" = 'EMAIL' AND "gmailMessageId" IS NOT NULL AND "syncAccount" IS NOT NULL
         GROUP BY "syncAccount"
         ORDER BY "lastEmail" DESC`
      ).catch(() => [] as any[]), // Column may not exist yet
    ])

    return NextResponse.json({
      totalSynced: (totalSynced as any[])[0]?.total || 0,
      lastSync: (lastSync as any[])[0]?.lastSync || null,
      todaySynced: (todayCount as any[])[0]?.total || 0,
      accountStats: perAccount || [],
      status: 'ready',
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkSyncAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || 'system-gmail-sync'

  let body: { emails?: GmailEmail[], syncAccount?: string } = {}
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const emails = body.emails || []
  const syncAccount = body.syncAccount || 'unknown'

  audit(request, 'CREATE', 'GmailSync', undefined, { method: 'POST' }).catch(() => {})

  if (emails.length === 0) {
    return NextResponse.json({ error: 'No emails provided', syncAccount }, { status: 400 })
  }

  let created = 0
  let skipped = 0
  let errors = 0
  const results: any[] = []

  // Ensure Gmail sync columns and enum values exist (safe to run multiple times)
  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        -- Add SYNCED to CommLogStatus enum if it doesn't exist
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'SYNCED'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'CommLogStatus')
        ) THEN
          ALTER TYPE "CommLogStatus" ADD VALUE 'SYNCED';
        END IF;
      END
      $$;
    `)
  } catch (e) {
    // Enum value may already exist — that's fine
  }

  try {
    await prisma.$executeRawUnsafe(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'CommunicationLog' AND column_name = 'gmailMessageId'
        ) THEN
          ALTER TABLE "CommunicationLog" ADD COLUMN "gmailMessageId" TEXT;
          ALTER TABLE "CommunicationLog" ADD COLUMN "gmailThreadId" TEXT;
          CREATE INDEX IF NOT EXISTS "idx_commlog_gmail_msg_id" ON "CommunicationLog" ("gmailMessageId");
          CREATE INDEX IF NOT EXISTS "idx_commlog_gmail_thread_id" ON "CommunicationLog" ("gmailThreadId");
        END IF;
        -- Add syncAccount column for multi-account tracking
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_name = 'CommunicationLog' AND column_name = 'syncAccount'
        ) THEN
          ALTER TABLE "CommunicationLog" ADD COLUMN "syncAccount" TEXT;
          CREATE INDEX IF NOT EXISTS "idx_commlog_sync_account" ON "CommunicationLog" ("syncAccount");
        END IF;
      END
      $$;
    `)
  } catch (e) {
    // Columns may already exist — that's fine
  }

  for (const email of emails) {
    try {
      // Check for duplicate by gmailMessageId
      const existing = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id" FROM "CommunicationLog" WHERE "gmailMessageId" = $1 LIMIT 1`,
        email.messageId
      )
      if (existing.length > 0) {
        skipped++
        continue
      }

      // Determine direction based on sender
      const abelDomains = ['abellumber.com', 'abeldoor.com']
      const senderDomain = email.sender?.split('@')[1]?.toLowerCase() || ''
      const direction = abelDomains.some(d => senderDomain.includes(d)) ? 'OUTBOUND' : 'INBOUND'

      // Try to match sender or recipients to a builder
      const allAddresses = [email.sender, ...(email.toRecipients || []), ...(email.ccRecipients || [])]
        .filter(Boolean)
        .map(a => a.toLowerCase())

      let builderId: string | null = null
      if (allAddresses.length > 0) {
        // Look for builder match by email
        const builderMatch = await prisma.$queryRawUnsafe<any[]>(
          `SELECT "id" FROM "Builder" WHERE LOWER("email") = ANY($1::text[]) LIMIT 1`,
          allAddresses.filter(a => !abelDomains.some(d => a.includes(d)))
        )
        if (builderMatch.length > 0) {
          builderId = builderMatch[0].id
        }
      }

      // Insert into CommunicationLog
      const emailSyncAccount = email.syncAccount || syncAccount
      const result = await prisma.$queryRawUnsafe<any[]>(
        `INSERT INTO "CommunicationLog" (
          "channel", "direction", "subject", "body", "fromAddress",
          "toAddresses", "ccAddresses", "sentAt", "status",
          "hasAttachments", "gmailMessageId", "gmailThreadId",
          "builderId", "staffId", "syncAccount"
        ) VALUES (
          'EMAIL'::"CommChannel", $1::"CommDirection", $2, $3, $4,
          $5::text[], $6::text[], $7, 'SYNCED'::"CommLogStatus",
          $8, $9, $10, $11, $12, $13
        ) RETURNING "id"`,
        direction,
        email.subject || '(No Subject)',
        email.body || email.snippet || null,
        email.sender || null,
        `{${(email.toRecipients || []).map(a => `"${a}"`).join(',')}}`,
        `{${(email.ccRecipients || []).map(a => `"${a}"`).join(',')}}`,
        email.date ? new Date(email.date) : new Date(),
        email.hasAttachment || false,
        email.messageId,
        email.threadId,
        builderId,
        staffId,
        emailSyncAccount
      )

      created++
      results.push({ messageId: email.messageId, status: 'created', id: result[0]?.id })
    } catch (error: any) {
      errors++
      results.push({ messageId: email.messageId, status: 'error', error: error.message })
    }
  }

  return NextResponse.json({
    synced: created,
    skipped,
    errors,
    total: emails.length,
    syncAccount,
    results: results.slice(0, 20), // Limit results in response
  })
}
