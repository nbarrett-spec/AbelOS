export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import {
  sendQuoteFollowUpDay3,
  sendQuoteFollowUpDay7,
  sendQuoteExpiringEmail,
} from '@/lib/email'

interface FollowUpResult {
  processed: number
  day3Sent: number
  day7Sent: number
  expiringSent: number
  expired: number
  errors: string[]
}

/**
 * GET /api/cron/quote-followups — Cron job trigger (requires CRON_SECRET)
 * POST /api/cron/quote-followups — Manual trigger (requires staff auth)
 */
export async function GET(request: NextRequest) {
  // Check cron secret from headers
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  const expectedSecret = process.env.CRON_SECRET

  if (!expectedSecret || cronSecret !== expectedSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return processQuoteFollowups()
}

export async function POST(request: NextRequest) {
  // Check staff auth for manual trigger
  const authError = checkStaffAuth(request)
  if (authError) return authError

  return processQuoteFollowups()
}

async function processQuoteFollowups(): Promise<NextResponse<FollowUpResult>> {
  const result: FollowUpResult = {
    processed: 0,
    day3Sent: 0,
    day7Sent: 0,
    expiringSent: 0,
    expired: 0,
    errors: [],
  }

  try {
    const now = new Date()
    const nowISO = now.toISOString()

    // Fetch all quotes with SENT status, ordered by createdAt
    const quotesQuery = `
      SELECT
        q."id",
        q."quoteNumber",
        q."projectId",
        q."status",
        q."createdAt",
        q."validUntil",
        q."total",
        p."name" as project_name,
        b."id" as builder_id,
        b."contactName" as builder_contactName,
        b."email" as builder_email
      FROM "Quote" q
      LEFT JOIN "Project" p ON q."projectId" = p."id"
      LEFT JOIN "Builder" b ON p."builderId" = b."id"
      WHERE q."status" = 'SENT'::"QuoteStatus"
      ORDER BY q."createdAt" DESC
    `

    const quotes = await prisma.$queryRawUnsafe<any[]>(quotesQuery)
    result.processed = quotes.length

    for (const quote of quotes) {
      try {
        const createdAt = new Date(quote.createdAt)
        const validUntil = quote.validUntil ? new Date(quote.validUntil) : null
        const daysOld = Math.floor((now.getTime() - createdAt.getTime()) / (24 * 60 * 60 * 1000))

        // Check if quote has expired
        if (validUntil && now > validUntil) {
          // Mark as expired
          await prisma.$executeRawUnsafe(
            `UPDATE "Quote" SET "status" = 'EXPIRED'::"QuoteStatus", "updatedAt" = $1::timestamptz WHERE "id" = $2`,
            nowISO,
            quote.id
          )
          result.expired++
          continue
        }

        // Skip if we don't have builder email
        if (!quote.builder_email) {
          continue
        }

        const builderName = quote.builder_contactName || 'Builder'
        const quoteUrl = `${process.env.NEXT_PUBLIC_APP_URL || ''}/projects/${quote.projectId}`

        // Day 3 follow-up
        if (daysOld >= 3 && daysOld < 4) {
          const existingDay3 = await checkFollowupActivity(quote.id, 'QUOTE_FOLLOWUP_DAY3')
          if (!existingDay3) {
            await sendQuoteFollowUpDay3({
              to: quote.builder_email,
              firstName: builderName.split(' ')[0],
              projectName: quote.project_name || 'Your Project',
              quoteNumber: quote.quoteNumber,
              total: Number(quote.total),
              quoteUrl,
            })
            await logFollowupActivity(quote.id, 'QUOTE_FOLLOWUP_DAY3', quote.quoteNumber, quote.builder_id)
            result.day3Sent++
          }
        }

        // Day 7 follow-up
        if (daysOld >= 7 && daysOld < 8) {
          const existingDay7 = await checkFollowupActivity(quote.id, 'QUOTE_FOLLOWUP_DAY7')
          if (!existingDay7) {
            await sendQuoteFollowUpDay7({
              to: quote.builder_email,
              firstName: builderName.split(' ')[0],
              projectName: quote.project_name || 'Your Project',
              quoteNumber: quote.quoteNumber,
              total: Number(quote.total),
              validUntil: validUntil?.toISOString() || new Date(Date.now() + 30 * 86400000).toISOString(),
              quoteUrl,
            })
            await logFollowupActivity(quote.id, 'QUOTE_FOLLOWUP_DAY7', quote.quoteNumber, quote.builder_id)
            result.day7Sent++
          }
        }

        // Day 14 / Expiring soon follow-up (last chance)
        if (validUntil) {
          const daysUntilExpiry = Math.floor((validUntil.getTime() - now.getTime()) / (24 * 60 * 60 * 1000))
          if (daysUntilExpiry === 1) {
            const existingExpiring = await checkFollowupActivity(quote.id, 'QUOTE_FOLLOWUP_EXPIRING')
            if (!existingExpiring) {
              await sendQuoteExpiringEmail({
                to: quote.builder_email,
                firstName: builderName.split(' ')[0],
                projectName: quote.project_name || 'Your Project',
                quoteNumber: quote.quoteNumber,
                total: Number(quote.total),
                validUntil: validUntil.toISOString(),
                quoteUrl,
              })
              await logFollowupActivity(quote.id, 'QUOTE_FOLLOWUP_EXPIRING', quote.quoteNumber, quote.builder_id)
              result.expiringSent++
            }
          }
        }
      } catch (error: any) {
        console.error(`Error processing quote ${quote.quoteNumber}:`, error)
        result.errors.push(`Quote ${quote.quoteNumber}: ${error.message}`)
      }
    }

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Quote followup cron error:', error)
    result.errors.push(`Cron error: ${error.message}`)
    return NextResponse.json(result, { status: 500 })
  }
}

/**
 * Check if a follow-up has already been sent by checking for an Activity record
 */
async function checkFollowupActivity(quoteId: string, type: string): Promise<boolean> {
  const activity = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "Activity"
     WHERE "metadata"->>'quoteId' = $1
     AND "type" = $2
     LIMIT 1`,
    quoteId,
    type
  )
  return activity && activity.length > 0
}

/**
 * Log a follow-up activity
 */
async function logFollowupActivity(quoteId: string, type: string, quoteNumber: string, builderId?: string) {
  const activityId = crypto.randomUUID()
  const now = new Date().toISOString()

  const typeMap: Record<string, string> = {
    QUOTE_FOLLOWUP_DAY3: `Quote ${quoteNumber} follow-up sent (Day 3)`,
    QUOTE_FOLLOWUP_DAY7: `Quote ${quoteNumber} follow-up sent (Day 7)`,
    QUOTE_FOLLOWUP_EXPIRING: `Quote ${quoteNumber} expiring reminder sent`,
  }

  const description = typeMap[type] || `Quote ${quoteNumber} follow-up sent`

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Activity" ("id", "type", "description", "builderId", "metadata", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6::timestamptz)`,
      activityId,
      type,
      description,
      builderId || null,
      JSON.stringify({
        quoteId,
        quoteNumber,
        action: 'quote_followup',
      }),
      now
    )
  } catch (error: any) {
    console.warn(`Failed to log activity for quote ${quoteNumber}:`, error)
    // Don't throw — the email was sent successfully, just the logging failed
  }
}
