export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { withCronRun } from '@/lib/cron'

/**
 * /api/cron/quote-expiration — Daily 6 AM CT.
 *
 * Quotes carry a `validUntil` timestamp but nothing was enforcing it; old
 * quotes with stale pricing were getting converted to orders months later
 * (A-BIZ-1). This cron flips any quote past `validUntil` from a live status
 * (DRAFT | SENT | APPROVED) to EXPIRED, idempotently.
 *
 * APPROVED quotes that expire are also surfaced as InboxItems — those were
 * live deals where a builder said yes; if we let pricing go stale on them,
 * that's revenue silently bleeding out. DRAFT/SENT quotes don't get the same
 * treatment because they're already covered by the quote-followups cron's
 * Day-3/Day-7/expiring-tomorrow nudges.
 *
 * GET — schedule trigger; requires `Authorization: Bearer ${CRON_SECRET}`.
 * POST — manual trigger; requires staff auth.
 */
export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET
  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runJob('schedule')
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  return runJob('manual')
}

async function runJob(triggeredBy: 'schedule' | 'manual') {
  return withCronRun(
    'quote-expiration',
    async () => {
      // Capture which quotes are about to expire BEFORE flipping them, so we
      // can grade APPROVED ones (live deals) for inbox alerts. RETURNING from
      // the same UPDATE would also work, but a two-step keeps the alert side
      // free to fail without rolling back the status flip.
      const newlyExpired: Array<{
        id: string
        quoteNumber: string
        priorStatus: string
        total: number | null
        builderId: string | null
        builderName: string | null
        projectName: string | null
      }> = await prisma.$queryRawUnsafe(`
        SELECT q."id",
               q."quoteNumber",
               q."status"::text AS "priorStatus",
               q."total",
               b."id"          AS "builderId",
               b."companyName" AS "builderName",
               p."name"        AS "projectName"
          FROM "Quote" q
          LEFT JOIN "Project" p ON q."projectId" = p."id"
          LEFT JOIN "Builder" b ON p."builderId" = b."id"
         WHERE q."validUntil" < NOW()
           AND q."status" IN ('DRAFT'::"QuoteStatus",
                              'SENT'::"QuoteStatus",
                              'APPROVED'::"QuoteStatus")
      `)

      const expired = newlyExpired.length

      if (expired > 0) {
        await prisma.$executeRawUnsafe(`
          UPDATE "Quote"
             SET "status"    = 'EXPIRED'::"QuoteStatus",
                 "updatedAt" = NOW()
           WHERE "validUntil" < NOW()
             AND "status" IN ('DRAFT'::"QuoteStatus",
                              'SENT'::"QuoteStatus",
                              'APPROVED'::"QuoteStatus")
        `)
      }

      // InboxItem alert per builder for any APPROVED-quote expirations.
      // APPROVED = builder said yes; this is a deal we lost to pricing drift.
      // Group by builder so a single builder with five expiring quotes gets
      // one inbox row, not five.
      const approvedExpired = newlyExpired.filter((q) => q.priorStatus === 'APPROVED')
      const byBuilder = new Map<
        string,
        { builderName: string | null; quotes: typeof approvedExpired; totalValue: number }
      >()
      for (const q of approvedExpired) {
        if (!q.builderId) continue
        const slot = byBuilder.get(q.builderId)
        const total = Number(q.total || 0)
        if (slot) {
          slot.quotes.push(q)
          slot.totalValue += total
        } else {
          byBuilder.set(q.builderId, {
            builderName: q.builderName,
            quotes: [q],
            totalValue: total,
          })
        }
      }

      let alertsCreated = 0
      for (const [builderId, slot] of byBuilder.entries()) {
        const inboxId = `inbox_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
        const count = slot.quotes.length
        const title =
          count === 1
            ? `Approved quote expired: ${slot.quotes[0].quoteNumber}`
            : `${count} approved quotes expired (${slot.builderName || 'builder'})`
        const description =
          count === 1
            ? `Quote ${slot.quotes[0].quoteNumber} for ${slot.builderName || 'builder'} (${slot.quotes[0].projectName || 'no project'}) expired with status APPROVED — pricing is now stale. Re-quote or extend validity if still active.`
            : `${count} approved quotes for ${slot.builderName || 'builder'} expired today (~$${slot.totalValue.toFixed(0)} total). These were live deals — pricing is now stale. Re-quote or extend validity.`

        try {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "InboxItem" ("id", "type", "source", "title", "description",
                                        "priority", "status", "entityType", "entityId",
                                        "financialImpact", "actionData", "createdAt", "updatedAt")
             VALUES ($1, 'QUOTE_EXPIRED', 'quote-expiration', $2, $3,
                     'HIGH', 'PENDING', 'Builder', $4,
                     $5, $6::jsonb, NOW(), NOW())`,
            inboxId,
            title,
            description,
            builderId,
            slot.totalValue,
            JSON.stringify({
              builderId,
              builderName: slot.builderName,
              expiredCount: count,
              totalValue: slot.totalValue,
              quotes: slot.quotes.map((q) => ({
                id: q.id,
                quoteNumber: q.quoteNumber,
                total: Number(q.total || 0),
                projectName: q.projectName,
              })),
            })
          )
          alertsCreated++
        } catch (e: any) {
          // Don't fail the whole cron if inbox writes blow up — the status
          // flip is the load-bearing part.
          console.warn('[quote-expiration] InboxItem insert failed:', e?.message)
        }
      }

      return { expired, alertsCreated, triggeredBy }
    },
    { triggeredBy }
  ).then((result) => NextResponse.json(result))
}
