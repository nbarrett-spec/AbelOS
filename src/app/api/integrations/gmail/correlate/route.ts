/**
 * POST/GET /api/integrations/gmail/correlate
 *
 * Links inbound Gmail threads (CommunicationLog rows where channel='EMAIL'
 * and direction='INBOUND') to Aegis Jobs and Builders so they show up on the
 * job-page timeline without manual intervention.
 *
 * Source of truth for thread data: CommunicationLog. "threadId" arguments
 * accept either the CommunicationLog.id (preferred — unique, always present)
 * or the gmailThreadId (correlates every message in the thread together).
 *
 * GET  ?stats=1                 → { total, correlated, uncorrelated, byConfidence }
 * POST { threadId? | threadIds?[] } → runs correlation + persists matches
 * POST {} (empty body)          → backfill pass over uncorrelated INBOUND emails
 *                                  (bounded to 200 per call)
 *
 * Additive-only: we write to existing CommunicationLog.jobId / .builderId
 * FKs and keep correlation provenance (confidence, matchedOn, audit) in a
 * sidecar GmailThreadLink table created lazily via CREATE TABLE IF NOT EXISTS.
 *
 * Does not touch the Gmail sync cron — that cron produces the CommunicationLog
 * rows; this route is a consumer.
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { logAudit, getStaffFromHeaders } from '@/lib/audit'
import { correlateThread, CorrelationResult } from '@/lib/gmail-correlate'

// ──────────────────────────────────────────────────────────────────────────
// Table bootstrap — lightweight sidecar for correlation provenance.
// We don't migrate CommunicationLog (schema drift is expensive); instead
// we store confidence + matchedOn + timestamp + operator here.
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false

async function ensureLinkTable() {
  if (tableEnsured) return
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "GmailThreadLink" (
        "communicationLogId" TEXT PRIMARY KEY,
        "gmailThreadId" TEXT,
        "jobId" TEXT,
        "builderId" TEXT,
        "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
        "matchedOn" TEXT NOT NULL DEFAULT 'NONE',
        "evidence" TEXT,
        "correlatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        "correlatedBy" TEXT
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_gmailthreadlink_job" ON "GmailThreadLink" ("jobId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_gmailthreadlink_builder" ON "GmailThreadLink" ("builderId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_gmailthreadlink_thread" ON "GmailThreadLink" ("gmailThreadId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_gmailthreadlink_confidence" ON "GmailThreadLink" ("confidence")
    `)
    tableEnsured = true
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gmail-correlate] ensureLinkTable failed:', e instanceof Error ? e.message : String(e))
    tableEnsured = true // avoid hot-loop on persistent failure
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

type ThreadRow = {
  id: string
  subject: string | null
  body: string | null
  fromAddress: string | null
  gmailThreadId: string | null
  builderId: string | null
  jobId: string | null
}

async function resolveThreads(threadIds: string[]): Promise<ThreadRow[]> {
  if (threadIds.length === 0) return []
  // Accept either CommunicationLog.id or gmailThreadId.
  return prisma.communicationLog.findMany({
    where: {
      channel: 'EMAIL',
      direction: 'INBOUND',
      OR: [{ id: { in: threadIds } }, { gmailThreadId: { in: threadIds } }],
    },
    select: {
      id: true,
      subject: true,
      body: true,
      fromAddress: true,
      gmailThreadId: true,
      builderId: true,
      jobId: true,
    },
  })
}

function confidenceBucket(c: number): 'high' | 'medium' | 'low' | 'none' {
  if (c >= 0.85) return 'high'
  if (c >= 0.70) return 'medium'
  if (c > 0) return 'low'
  return 'none'
}

async function persistMatch(args: {
  row: ThreadRow
  result: CorrelationResult
  staffId: string
}): Promise<{ updatedCommLog: boolean; wroteLink: boolean }> {
  const { row, result, staffId } = args

  // 1. Update the existing CommunicationLog FKs so the timeline picks it up.
  //    Only set what the result provides, and only if it's a net change.
  const updates: Record<string, string | null> = {}
  if (result.jobId && result.jobId !== row.jobId) updates.jobId = result.jobId
  if (result.builderId && result.builderId !== row.builderId) updates.builderId = result.builderId

  let updatedCommLog = false
  if (Object.keys(updates).length > 0) {
    try {
      await prisma.communicationLog.update({
        where: { id: row.id },
        data: updates,
      })
      updatedCommLog = true
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[gmail-correlate] update commlog failed:', e instanceof Error ? e.message : String(e))
    }
  }

  // 2. Record provenance in the sidecar regardless — even a zero-match pass
  //    is useful ("we tried and nothing stuck") so we don't re-scan endlessly.
  let wroteLink = false
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "GmailThreadLink"
         ("communicationLogId", "gmailThreadId", "jobId", "builderId", "confidence", "matchedOn", "evidence", "correlatedAt", "correlatedBy")
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8)
       ON CONFLICT ("communicationLogId") DO UPDATE SET
         "gmailThreadId" = EXCLUDED."gmailThreadId",
         "jobId"         = COALESCE(EXCLUDED."jobId", "GmailThreadLink"."jobId"),
         "builderId"     = COALESCE(EXCLUDED."builderId", "GmailThreadLink"."builderId"),
         "confidence"    = GREATEST(EXCLUDED."confidence", "GmailThreadLink"."confidence"),
         "matchedOn"     = CASE WHEN EXCLUDED."confidence" > "GmailThreadLink"."confidence" THEN EXCLUDED."matchedOn" ELSE "GmailThreadLink"."matchedOn" END,
         "evidence"      = CASE WHEN EXCLUDED."confidence" > "GmailThreadLink"."confidence" THEN EXCLUDED."evidence" ELSE "GmailThreadLink"."evidence" END,
         "correlatedAt"  = NOW(),
         "correlatedBy"  = EXCLUDED."correlatedBy"`,
      row.id,
      row.gmailThreadId,
      result.jobId || null,
      result.builderId || null,
      result.confidence,
      result.matchedOn,
      result.evidence || null,
      staffId
    )
    wroteLink = true
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[gmail-correlate] insert link failed:', e instanceof Error ? e.message : String(e))
  }

  return { updatedCommLog, wroteLink }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — correlate specific threads, OR backfill when no body is supplied.
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  await ensureLinkTable()
  const staff = getStaffFromHeaders(request.headers)

  let body: any = {}
  try {
    body = await request.json()
  } catch {
    // empty body → treat as backfill pass
  }

  // Normalize inputs.
  const ids: string[] = Array.isArray(body?.threadIds)
    ? body.threadIds.filter((x: any) => typeof x === 'string')
    : typeof body?.threadId === 'string'
      ? [body.threadId]
      : []

  const isBackfill = ids.length === 0
  const maxBackfill = Math.min(Number(body?.limit) || 200, 500)

  let rows: ThreadRow[]
  if (isBackfill) {
    // Uncorrelated inbound emails, oldest-first so the timeline fills in
    // chronologically. We define "uncorrelated" as: missing jobId AND missing
    // a GmailThreadLink row.
    rows = await prisma.$queryRawUnsafe<ThreadRow[]>(
      `SELECT c.id, c.subject, c.body, c."fromAddress", c."gmailThreadId", c."builderId", c."jobId"
         FROM "CommunicationLog" c
         LEFT JOIN "GmailThreadLink" l ON l."communicationLogId" = c.id
        WHERE c."channel" = 'EMAIL'
          AND c."direction" = 'INBOUND'
          AND c."jobId" IS NULL
          AND l."communicationLogId" IS NULL
        ORDER BY c."sentAt" ASC NULLS LAST
        LIMIT ${maxBackfill}`
    )
  } else {
    rows = await resolveThreads(ids)
  }

  const byConfidence: Record<string, number> = { high: 0, medium: 0, low: 0, none: 0 }
  const byRule: Record<string, number> = {}
  let correlated = 0
  let skipped = 0
  let updatedCommLogCount = 0
  const samples: Array<{ id: string; matchedOn: string; confidence: number; jobId?: string; builderId?: string }> = []

  for (const row of rows) {
    try {
      const result = await correlateThread({
        subject: row.subject,
        bodyText: row.body,
        fromEmail: row.fromAddress,
      })

      const { updatedCommLog } = await persistMatch({ row, result, staffId: staff.staffId })
      if (updatedCommLog) updatedCommLogCount++
      if (result.confidence > 0) {
        correlated++
        byConfidence[confidenceBucket(result.confidence)]++
        byRule[result.matchedOn] = (byRule[result.matchedOn] || 0) + 1
        if (samples.length < 5) {
          samples.push({
            id: row.id,
            matchedOn: result.matchedOn,
            confidence: result.confidence,
            jobId: result.jobId,
            builderId: result.builderId,
          })
        }
      } else {
        skipped++
        byConfidence.none++
      }

      // Audit every correlation attempt that produced a hit; suppress no-op
      // audit noise for backfill misses so we don't flood the log.
      if (result.confidence > 0 || !isBackfill) {
        await logAudit({
          staffId: staff.staffId,
          staffName: staff.staffName,
          action: 'CORRELATE',
          entity: 'gmail_thread',
          entityId: row.id,
          details: {
            threadId: row.gmailThreadId,
            matchedJobId: result.jobId,
            matchedBuilderId: result.builderId,
            confidence: result.confidence,
            matchedOn: result.matchedOn,
            evidence: result.evidence,
            mode: isBackfill ? 'backfill' : 'on-demand',
          },
          severity: 'INFO',
        }).catch(() => {})
      }
    } catch (e) {
      skipped++
      // eslint-disable-next-line no-console
      console.warn('[gmail-correlate] row failed:', row.id, e instanceof Error ? e.message : String(e))
    }
  }

  return NextResponse.json({
    success: true,
    mode: isBackfill ? 'backfill' : 'on-demand',
    scanned: rows.length,
    correlated,
    skipped,
    updatedCommLogCount,
    byConfidence,
    byRule,
    samples,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// GET — stats and simple lookups.
//   ?stats=1                  → platform-wide correlation stats
//   ?threadId=<id>            → look up the stored correlation for one row
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  await ensureLinkTable()
  const url = new URL(request.url)

  if (url.searchParams.get('threadId')) {
    const threadId = url.searchParams.get('threadId')!
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "GmailThreadLink"
        WHERE "communicationLogId" = $1 OR "gmailThreadId" = $1
        ORDER BY "correlatedAt" DESC
        LIMIT 25`,
      threadId
    )
    return NextResponse.json({ threadId, links: rows })
  }

  if (url.searchParams.get('stats') === '1') {
    // Platform-wide rollup over INBOUND email. "correlated" means any of
    // {CommunicationLog.jobId, CommunicationLog.builderId, GmailThreadLink.jobId}
    // got populated — matches how the timeline displays.
    try {
      const totalRow = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COUNT(*)::int AS total
          FROM "CommunicationLog"
         WHERE "channel" = 'EMAIL' AND "direction" = 'INBOUND'
      `)
      const total = totalRow[0]?.total || 0

      const correlatedRow = await prisma.$queryRawUnsafe<any[]>(`
        SELECT COUNT(*)::int AS correlated
          FROM "CommunicationLog" c
          LEFT JOIN "GmailThreadLink" l ON l."communicationLogId" = c.id
         WHERE c."channel" = 'EMAIL'
           AND c."direction" = 'INBOUND'
           AND (c."jobId" IS NOT NULL OR c."builderId" IS NOT NULL OR l."jobId" IS NOT NULL OR l."builderId" IS NOT NULL)
      `)
      const correlated = correlatedRow[0]?.correlated || 0
      const uncorrelated = Math.max(0, total - correlated)

      const bucketRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT
          SUM(CASE WHEN "confidence" >= 0.85 THEN 1 ELSE 0 END)::int AS high,
          SUM(CASE WHEN "confidence" >= 0.70 AND "confidence" < 0.85 THEN 1 ELSE 0 END)::int AS medium,
          SUM(CASE WHEN "confidence" > 0 AND "confidence" < 0.70 THEN 1 ELSE 0 END)::int AS low,
          SUM(CASE WHEN "confidence" = 0 THEN 1 ELSE 0 END)::int AS none,
          COUNT(*)::int AS total_links
        FROM "GmailThreadLink"
      `)
      const byConfidence = bucketRows[0] || { high: 0, medium: 0, low: 0, none: 0, total_links: 0 }

      const ruleRows = await prisma.$queryRawUnsafe<any[]>(`
        SELECT "matchedOn", COUNT(*)::int AS count
          FROM "GmailThreadLink"
         GROUP BY "matchedOn"
         ORDER BY count DESC
      `)
      const byRule: Record<string, number> = {}
      for (const r of ruleRows) byRule[r.matchedOn] = r.count

      return NextResponse.json({
        total,
        correlated,
        uncorrelated,
        correlationRate: total > 0 ? +(correlated / total).toFixed(4) : 0,
        byConfidence,
        byRule,
      })
    } catch (e) {
      return NextResponse.json(
        { error: 'stats_failed', detail: e instanceof Error ? e.message : String(e) },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({
    error: 'Provide ?stats=1 or ?threadId=<id>',
  }, { status: 400 })
}
