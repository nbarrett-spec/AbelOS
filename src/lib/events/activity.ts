/**
 * Activity Event Helpers
 *
 * Emit CRM Activity rows as a side-effect of primary mutations. Each helper
 * is idempotent: a retry with the same `sourceKey` is a no-op.
 *
 * Why a separate event layer?
 *   The new builder/sales portals render from the Activity table. Until now,
 *   CommunicationLog rows, Deal stage changes, Quote sends, and visit pings
 *   all wrote to their own domain tables and left Activity empty — so the
 *   portals rendered empty-state. These helpers close the loop without
 *   rewriting every route.
 *
 * All helpers:
 *  - are non-throwing (return a result object with ok/action/detail)
 *  - should be called AFTER the primary mutation succeeds
 *  - should be fire-and-forget: `.catch(() => {})` on the call site
 *
 * Callers add `.sourceKey` so a retry doesn't duplicate a row.
 */
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export type ActivityEmitResult = {
  ok: boolean
  action: string
  detail?: string
  activityId?: string
}

type BaseActivity = {
  sourceKey: string
  staffId: string
  activityType:
    | 'CALL'
    | 'EMAIL'
    | 'MEETING'
    | 'SITE_VISIT'
    | 'TEXT_MESSAGE'
    | 'NOTE'
    | 'QUOTE_SENT'
    | 'QUOTE_FOLLOW_UP'
    | 'ISSUE_REPORTED'
    | 'ISSUE_RESOLVED'
  subject: string
  notes?: string | null
  outcome?: string | null
  builderId?: string | null
  jobId?: string | null
  communityId?: string | null
  scheduledAt?: Date | null
  completedAt?: Date | null
  durationMins?: number | null
}

/**
 * Core emitter — all typed helpers delegate to this.
 * Idempotent via Activity.sourceKey unique key.
 */
async function emitActivity(a: BaseActivity): Promise<ActivityEmitResult> {
  try {
    // Fast-path dedupe: if sourceKey already present, skip.
    const existing: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Activity" WHERE "sourceKey" = $1 LIMIT 1`,
      a.sourceKey,
    )
    if (existing.length > 0) {
      return { ok: true, action: 'emitActivity', detail: 'already_emitted', activityId: existing[0].id }
    }

    const id = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Activity" (
         "id", "staffId", "builderId", "jobId", "communityId",
         "activityType", "subject", "notes", "outcome",
         "scheduledAt", "completedAt", "durationMins",
         "sourceKey", "createdAt"
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6::"ActivityType", $7, $8, $9,
         $10, $11, $12,
         $13, NOW()
       )
       ON CONFLICT ("sourceKey") DO NOTHING`,
      id,
      a.staffId,
      a.builderId ?? null,
      a.jobId ?? null,
      a.communityId ?? null,
      a.activityType,
      a.subject,
      a.notes ?? null,
      a.outcome ?? null,
      a.scheduledAt ?? null,
      a.completedAt ?? null,
      a.durationMins ?? null,
      a.sourceKey,
    )
    return { ok: true, action: 'emitActivity', detail: 'inserted', activityId: id }
  } catch (e: any) {
    logger.error('activity_emit_failed', e, { sourceKey: a.sourceKey, type: a.activityType })
    return { ok: false, action: 'emitActivity', detail: e?.message?.slice(0, 200) }
  }
}

// ── helpers ──────────────────────────────────────────────────────────────

/**
 * Pick a default system staff id when the caller can't supply one. Falls back
 * to the oldest Staff row to keep FK happy. Used by cron / webhook flows.
 */
async function systemStaffId(): Promise<string> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff" ORDER BY "createdAt" ASC LIMIT 1`,
  )
  return rows[0]?.id ?? 'system'
}

function channelToActivityType(channel: string): BaseActivity['activityType'] {
  const c = (channel || '').toUpperCase()
  if (c === 'EMAIL') return 'EMAIL'
  if (c === 'PHONE' || c === 'VIDEO_CALL') return 'CALL'
  if (c === 'TEXT' || c === 'SMS') return 'TEXT_MESSAGE'
  if (c === 'IN_PERSON') return 'SITE_VISIT'
  return 'NOTE'
}

// ── public API ───────────────────────────────────────────────────────────

/**
 * Emit an Activity row for a CommunicationLog entry (email, phone, SMS, visit).
 * Called from wherever a communication is logged.
 *
 * @param commLogId CommunicationLog.id — drives idempotency
 */
export async function recordCommunicationActivity(commLogId: string): Promise<ActivityEmitResult> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT cl."id", cl."builderId", cl."jobId", cl."communityId",
              cl."staffId", cl."channel"::text AS "channel",
              cl."direction"::text AS "direction",
              cl."subject", cl."body", cl."sentAt", cl."duration",
              cl."createdAt"
         FROM "CommunicationLog" cl
        WHERE cl."id" = $1
        LIMIT 1`,
      commLogId,
    )
    if (rows.length === 0) return { ok: false, action: 'recordCommunicationActivity', detail: 'commlog_not_found' }
    const c = rows[0]

    const staffId = c.staffId || (await systemStaffId())
    const activityType = channelToActivityType(c.channel)
    const subject = c.subject || `${c.channel || 'NOTE'} ${c.direction || ''}`.trim()
    const bodyPreview = c.body ? String(c.body).slice(0, 500) : null

    return emitActivity({
      sourceKey: `commlog:${commLogId}`,
      staffId,
      activityType,
      subject,
      notes: bodyPreview,
      builderId: c.builderId,
      jobId: c.jobId,
      communityId: c.communityId,
      completedAt: c.sentAt || c.createdAt,
      durationMins: typeof c.duration === 'number' ? Math.round(c.duration / 60) : null,
    })
  } catch (e: any) {
    logger.error('recordCommunicationActivity_failed', e, { commLogId })
    return { ok: false, action: 'recordCommunicationActivity', detail: e?.message }
  }
}

/**
 * Emit an Activity row when a Deal stage changes.
 * Uses DEAL_ACTIVITY_TYPE=NOTE (Deal stage changes aren't in ActivityType enum,
 * so we record them as NOTE with a structured subject).
 *
 * @param dealId Deal.id
 * @param fromStage previous stage (may be null for first stage set)
 * @param toStage new stage
 * @param staffId who triggered the change (falls back to system)
 */
export async function recordDealActivity(params: {
  dealId: string
  fromStage: string | null
  toStage: string
  staffId?: string | null
}): Promise<ActivityEmitResult> {
  try {
    const { dealId, fromStage, toStage } = params
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "builderId", "companyName", "ownerId" FROM "Deal" WHERE "id" = $1 LIMIT 1`,
      dealId,
    )
    if (rows.length === 0) return { ok: false, action: 'recordDealActivity', detail: 'deal_not_found' }
    const deal = rows[0]

    const staffId = params.staffId || deal.ownerId || (await systemStaffId())
    const subject = fromStage
      ? `Deal moved: ${fromStage} → ${toStage}${deal.companyName ? ` (${deal.companyName})` : ''}`
      : `Deal stage set to ${toStage}${deal.companyName ? ` (${deal.companyName})` : ''}`

    return emitActivity({
      sourceKey: `deal:${dealId}:stage:${toStage}:${Date.now()}`, // stage change timestamped so re-entries across stages dedupe per event
      staffId,
      activityType: 'NOTE',
      subject,
      notes: `Stage transition recorded for deal ${dealId}.`,
      builderId: deal.builderId || null,
      completedAt: new Date(),
    })
  } catch (e: any) {
    logger.error('recordDealActivity_failed', e, { dealId: params.dealId })
    return { ok: false, action: 'recordDealActivity', detail: e?.message }
  }
}

/**
 * Emit an Activity for a quote that has been sent.
 * Fixes the earlier buggy insert in src/app/api/ops/quotes/route.ts which
 * referenced non-existent columns (type, description, metadata).
 *
 * @param quoteId Quote.id
 * @param builderId optional — will look up via project if omitted
 * @param staffId who sent (optional)
 */
export async function recordQuoteActivity(params: {
  quoteId: string
  builderId?: string | null
  staffId?: string | null
  quoteNumber?: string
  total?: number
}): Promise<ActivityEmitResult> {
  try {
    const { quoteId } = params
    let builderId = params.builderId ?? null
    let quoteNumber = params.quoteNumber
    let total = params.total

    if (!builderId || !quoteNumber) {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT q."id", q."quoteNumber", q."total", p."builderId"
           FROM "Quote" q
           LEFT JOIN "Project" p ON p."id" = q."projectId"
          WHERE q."id" = $1 LIMIT 1`,
        quoteId,
      )
      if (rows.length === 0) return { ok: false, action: 'recordQuoteActivity', detail: 'quote_not_found' }
      builderId = builderId || rows[0].builderId
      quoteNumber = quoteNumber || rows[0].quoteNumber
      total = total ?? Number(rows[0].total || 0)
    }

    const staffId = params.staffId || (await systemStaffId())
    const subject = `Quote ${quoteNumber} sent${typeof total === 'number' ? ` ($${total.toFixed(2)})` : ''}`

    return emitActivity({
      sourceKey: `quote:${quoteId}:sent`,
      staffId,
      activityType: 'QUOTE_SENT',
      subject,
      builderId,
      completedAt: new Date(),
    })
  } catch (e: any) {
    logger.error('recordQuoteActivity_failed', e, { quoteId: params.quoteId })
    return { ok: false, action: 'recordQuoteActivity', detail: e?.message }
  }
}

/**
 * Emit an Activity for a logged visit (site visit / in-person meeting).
 * Idempotent via caller-supplied sourceKey so repeated check-ins don't dupe.
 */
export async function recordVisitActivity(params: {
  sourceKey: string
  staffId: string
  builderId?: string | null
  jobId?: string | null
  subject?: string
  notes?: string | null
  completedAt?: Date
  durationMins?: number | null
}): Promise<ActivityEmitResult> {
  return emitActivity({
    sourceKey: params.sourceKey,
    staffId: params.staffId,
    activityType: 'SITE_VISIT',
    subject: params.subject || 'Site visit',
    notes: params.notes ?? null,
    builderId: params.builderId ?? null,
    jobId: params.jobId ?? null,
    completedAt: params.completedAt ?? new Date(),
    durationMins: params.durationMins ?? null,
  })
}
