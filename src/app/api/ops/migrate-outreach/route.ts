export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { safeJson } from '@/lib/safe-json'

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_OUTREACH', 'Database', undefined, { migration: 'RUN_MIGRATE_OUTREACH' }, 'CRITICAL').catch(() => {})

  const results: { step: string; status: string }[] = []

  async function run(step: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step, status: 'OK' })
    } catch (e: any) {
      results.push({ step, status: e.message?.slice(0, 120) || 'ERROR' })
    }
  }

  // Drop old Prisma-created tables that may have wrong schema
  await run('Drop old OutreachEnrollmentStep', 'DROP TABLE IF EXISTS "OutreachEnrollmentStep" CASCADE')
  await run('Drop old OutreachEnrollment', 'DROP TABLE IF EXISTS "OutreachEnrollment" CASCADE')
  await run('Drop old OutreachStep', 'DROP TABLE IF EXISTS "OutreachStep" CASCADE')
  await run('Drop old OutreachSequence', 'DROP TABLE IF EXISTS "OutreachSequence" CASCADE')
  await run('Drop old OutreachTemplate', 'DROP TABLE IF EXISTS "OutreachTemplate" CASCADE')

  // Recreate with correct schema — matches outreach-engine ensureTables() exactly
  await run('Create OutreachSequence', `
    CREATE TABLE "OutreachSequence" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "mode" TEXT NOT NULL CHECK ("mode" IN ('AUTO', 'SEMI_AUTO')),
      "stepCount" INT DEFAULT 0,
      "active" BOOLEAN DEFAULT true,
      "createdBy" TEXT NOT NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  await run('Create OutreachStep', `
    CREATE TABLE "OutreachStep" (
      "id" TEXT PRIMARY KEY,
      "sequenceId" TEXT NOT NULL REFERENCES "OutreachSequence"("id") ON DELETE CASCADE,
      "stepNumber" INT NOT NULL,
      "delayDays" INT NOT NULL,
      "channel" TEXT NOT NULL CHECK ("channel" IN ('EMAIL', 'CALL_TASK', 'SMS')),
      "subject" TEXT,
      "bodyTemplate" TEXT NOT NULL,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  await run('Create OutreachEnrollment', `
    CREATE TABLE "OutreachEnrollment" (
      "id" TEXT PRIMARY KEY,
      "sequenceId" TEXT NOT NULL REFERENCES "OutreachSequence"("id") ON DELETE CASCADE,
      "prospectId" TEXT,
      "email" TEXT NOT NULL,
      "companyName" TEXT NOT NULL,
      "contactName" TEXT NOT NULL,
      "currentStep" INT DEFAULT 0,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE' CHECK ("status" IN ('ACTIVE', 'PAUSED', 'COMPLETED', 'REPLIED', 'CONVERTED')),
      "enrolledAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "completedAt" TIMESTAMP WITH TIME ZONE,
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  await run('Create OutreachEnrollmentStep', `
    CREATE TABLE "OutreachEnrollmentStep" (
      "id" TEXT PRIMARY KEY,
      "enrollmentId" TEXT NOT NULL REFERENCES "OutreachEnrollment"("id") ON DELETE CASCADE,
      "stepId" TEXT NOT NULL REFERENCES "OutreachStep"("id") ON DELETE CASCADE,
      "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'AWAITING_REVIEW', 'SENT', 'SKIPPED')),
      "scheduledAt" TIMESTAMP WITH TIME ZONE NOT NULL,
      "sentAt" TIMESTAMP WITH TIME ZONE,
      "openedAt" TIMESTAMP WITH TIME ZONE,
      "repliedAt" TIMESTAMP WITH TIME ZONE,
      "editedSubject" TEXT,
      "editedBody" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  await run('Create OutreachTemplate', `
    CREATE TABLE "OutreachTemplate" (
      "id" TEXT PRIMARY KEY,
      "templateType" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "subject" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "category" TEXT,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)

  // Indexes — matching outreach-engine ensureTables()
  await run('idx sequence active', 'CREATE INDEX IF NOT EXISTS "idx_outreach_sequence_active" ON "OutreachSequence"("active")')
  await run('idx sequence type', 'CREATE INDEX IF NOT EXISTS "idx_outreach_sequence_type" ON "OutreachSequence"("type")')
  await run('idx step sequence', 'CREATE INDEX IF NOT EXISTS "idx_outreach_step_sequence" ON "OutreachStep"("sequenceId")')
  await run('idx enrollment sequence', 'CREATE INDEX IF NOT EXISTS "idx_outreach_enrollment_sequence" ON "OutreachEnrollment"("sequenceId")')
  await run('idx enrollment status', 'CREATE INDEX IF NOT EXISTS "idx_outreach_enrollment_status" ON "OutreachEnrollment"("status")')
  await run('idx enrollment email', 'CREATE INDEX IF NOT EXISTS "idx_outreach_enrollment_email" ON "OutreachEnrollment"("email")')
  await run('idx estep enrollment', 'CREATE INDEX IF NOT EXISTS "idx_enrollment_step_enrollment" ON "OutreachEnrollmentStep"("enrollmentId")')
  await run('idx estep status', 'CREATE INDEX IF NOT EXISTS "idx_enrollment_step_status" ON "OutreachEnrollmentStep"("status")')
  await run('idx estep scheduled', 'CREATE INDEX IF NOT EXISTS "idx_enrollment_step_scheduled" ON "OutreachEnrollmentStep"("scheduledAt")')
  await run('idx template type', 'CREATE INDEX IF NOT EXISTS "idx_outreach_template_type" ON "OutreachTemplate"("templateType")')

  // InstantQuoteRequest table
  await run('Create InstantQuoteRequest', `
    CREATE TABLE IF NOT EXISTS "InstantQuoteRequest" (
      "id" TEXT PRIMARY KEY,
      "builderEmail" TEXT NOT NULL,
      "builderCompany" TEXT,
      "contactName" TEXT,
      "phone" TEXT,
      "isNewBuilder" BOOLEAN DEFAULT false,
      "projectName" TEXT,
      "projectAddress" TEXT,
      "community" TEXT,
      "estimatedDoors" INT,
      "targetDelivery" TEXT,
      "doorLines" JSONB,
      "notes" TEXT,
      "totalEstimate" FLOAT,
      "source" TEXT DEFAULT 'WEBSITE',
      "status" TEXT DEFAULT 'NEW',
      "assignedTo" TEXT,
      "assignedAt" TIMESTAMP WITH TIME ZONE,
      "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `)
  await run('idx iqr status', 'CREATE INDEX IF NOT EXISTS "idx_iqr_status" ON "InstantQuoteRequest"("status")')
  await run('idx iqr email', 'CREATE INDEX IF NOT EXISTS "idx_iqr_email" ON "InstantQuoteRequest"("builderEmail")')
  await run('idx iqr assigned', 'CREATE INDEX IF NOT EXISTS "idx_iqr_assigned" ON "InstantQuoteRequest"("assignedTo")')

  return safeJson({ success: true, results })
}
