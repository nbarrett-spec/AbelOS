export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { safeJson } from '@/lib/safe-json'
import { NextRequest, NextResponse } from 'next/server'

interface ProcessResult {
  processed: number
  autoSent: number
  semiAutoQueued: number
  completed: number
  staleCompleted: number
  repliedFound: number
  errors: string[]
}

export async function GET(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return processOutreach()
}

export async function POST(request: NextRequest) {
  const cronSecret = request.headers.get('authorization')?.replace('Bearer ', '')
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return processOutreach()
}

async function processOutreach() {
  const result: ProcessResult = {
    processed: 0,
    autoSent: 0,
    semiAutoQueued: 0,
    completed: 0,
    staleCompleted: 0,
    repliedFound: 0,
    errors: [],
  }

  try {
    const now = new Date()
    const nowISO = now.toISOString()
    const sixtyDaysAgo = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString()

    // Get due outreach steps
    // Column mapping: OutreachEnrollment uses "email", "companyName", "contactName"
    // OutreachStep uses "bodyTemplate", OutreachSequence uses "active" (boolean)
    const dueSteps = await prisma.$queryRawUnsafe<any[]>(
      `SELECT oes."id", oes."enrollmentId", oes."stepId", oes."scheduledAt",
              oe."email", oe."companyName", oe."contactName", oe."enrolledAt",
              os."subject", os."bodyTemplate", os."stepNumber",
              osl."mode"::text AS "sequenceMode", osl."createdBy"
       FROM "OutreachEnrollmentStep" oes
       JOIN "OutreachEnrollment" oe ON oes."enrollmentId" = oe."id"
       JOIN "OutreachStep" os ON oes."stepId" = os."id"
       JOIN "OutreachSequence" osl ON oe."sequenceId" = osl."id"
       WHERE oes."status"::text = 'PENDING' AND oes."scheduledAt" <= $1::timestamptz
         AND oe."status"::text = 'ACTIVE' AND osl."active" = true
       ORDER BY oes."scheduledAt" ASC
       LIMIT 500`,
      nowISO
    )
    result.processed = dueSteps.length

    for (const step of dueSteps) {
      try {
        // Use createdBy (staff name) as repName fallback
        const repName = step.createdBy || 'Our team'
        const { subject, bodyHtml } = replaceTemplateVariables(step.subject, step.bodyTemplate, {
          companyName: step.companyName,
          contactName: step.contactName,
          repName,
        })

        if (step.sequenceMode === 'AUTO') {
          // Send email
          const res = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/ops/email`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.CRON_SECRET}` },
            body: JSON.stringify({ to: step.email, subject, body: bodyHtml, staffId: 'system' }),
          })
          if (!res.ok) throw new Error(`Email API: ${res.status}`)

          // Mark SENT
          await prisma.$executeRawUnsafe(
            `UPDATE "OutreachEnrollmentStep" SET "status" = 'SENT'::text, "sentAt" = $1::timestamptz WHERE "id" = $2`,
            nowISO,
            step.id
          )
          result.autoSent++

          // Create next step or mark enrollment complete
          const nextStep = await prisma.$queryRawUnsafe<any[]>(
            `SELECT os."id", os."delayDays" FROM "OutreachStep" os
             WHERE os."sequenceId" = (SELECT "sequenceId" FROM "OutreachEnrollment" WHERE "id" = $1)
             AND os."stepNumber" = (SELECT "stepNumber" + 1 FROM "OutreachStep" WHERE "id" = $2) LIMIT 1`,
            step.enrollmentId,
            step.stepId
          )

          if (nextStep.length > 0) {
            const scheduledAt = new Date(now.getTime() + nextStep[0].delayDays * 86400000).toISOString()
            await prisma.$executeRawUnsafe(
              `INSERT INTO "OutreachEnrollmentStep" ("id", "enrollmentId", "stepId", "status", "scheduledAt", "createdAt")
               VALUES ($1, $2, $3, 'PENDING'::text, $4::timestamptz, $5::timestamptz)`,
              crypto.randomUUID(),
              step.enrollmentId,
              nextStep[0].id,
              scheduledAt,
              nowISO
            )
          } else {
            await prisma.$executeRawUnsafe(
              `UPDATE "OutreachEnrollment" SET "status" = 'COMPLETED'::text, "completedAt" = $1::timestamptz, "updatedAt" = $1::timestamptz WHERE "id" = $2`,
              nowISO,
              step.enrollmentId
            )
            result.completed++
          }
        } else if (step.sequenceMode === 'SEMI_AUTO') {
          // Mark for review and notify
          await prisma.$executeRawUnsafe(
            `UPDATE "OutreachEnrollmentStep" SET "status" = 'AWAITING_REVIEW'::text WHERE "id" = $1`,
            step.id
          )

          // Look up staff by createdBy name
          const staff = await prisma.$queryRawUnsafe<any[]>(
            `SELECT "id" FROM "Staff" WHERE ("firstName" || ' ' || "lastName") = $1 LIMIT 1`,
            repName
          )

          if (staff.length > 0) {
            await prisma.$executeRawUnsafe(
              `INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "createdAt")
               VALUES ($1, $2, 'OUTREACH_REVIEW'::text, 'Outreach ready for review', $3, $4::timestamptz)`,
              crypto.randomUUID(),
              staff[0].id,
              `Email to ${step.companyName}: "${subject.substring(0, 50)}..."`,
              nowISO
            )
          }
          result.semiAutoQueued++
        }
      } catch (error: any) {
        result.errors.push(`Step ${step.id}: ${error.message}`)
      }
    }

    // Mark stale enrollments (60+ days) as complete
    const staleIds = await prisma.$queryRawUnsafe<any[]>(
      `SELECT "id" FROM "OutreachEnrollment" WHERE "status"::text = 'ACTIVE' AND "enrolledAt" <= $1::timestamptz`,
      sixtyDaysAgo
    )
    for (const { id } of staleIds) {
      await prisma.$executeRawUnsafe(
        `UPDATE "OutreachEnrollment" SET "status" = 'COMPLETED'::text, "completedAt" = $1::timestamptz, "updatedAt" = $1::timestamptz WHERE "id" = $2`,
        nowISO,
        id
      )
      result.staleCompleted++
    }

    // Mark enrollments where a step got a reply (repliedAt IS NOT NULL on any enrollment step)
    const repliedIds = await prisma.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT oe."id" FROM "OutreachEnrollment" oe
       JOIN "OutreachEnrollmentStep" oes ON oe."id" = oes."enrollmentId"
       WHERE oe."status"::text = 'ACTIVE' AND oes."repliedAt" IS NOT NULL`
    )
    for (const { id } of repliedIds) {
      await prisma.$executeRawUnsafe(
        `UPDATE "OutreachEnrollment" SET "status" = 'REPLIED'::text, "updatedAt" = $1::timestamptz WHERE "id" = $2`,
        nowISO,
        id
      )
      result.repliedFound++
    }

    return safeJson(result)
  } catch (error: any) {
    console.error('Outreach cron error:', error)
    result.errors.push(`Fatal: ${error.message}`)
    return safeJson(result, { status: 500 })
  }
}

function replaceTemplateVariables(
  subject: string,
  body: string,
  vars: Record<string, string>
): { subject: string; bodyHtml: string } {
  let s = subject,
    b = body
  Object.entries(vars).forEach(([k, v]) => {
    const p = new RegExp(`{{\\s*${k}\\s*}}`, 'gi')
    s = s.replace(p, v)
    b = b.replace(p, v)
  })
  return { subject: s, bodyHtml: b }
}
