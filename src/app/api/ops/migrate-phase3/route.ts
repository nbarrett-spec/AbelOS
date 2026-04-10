export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/ops/migrate-phase3
 * Phase 3: Revenue Engine — creates PermitLead, OutreachSequence, OutreachStep tables
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { step: string; status: string; error?: string }[] = []

  async function runStep(name: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step: name, status: 'OK' })
    } catch (e: any) {
      results.push({ step: name, status: 'ERROR', error: e.message?.slice(0, 200) })
    }
  }

  // ── 1. PermitLead ──
  await runStep('PermitLead', `
    CREATE TABLE IF NOT EXISTS "PermitLead" (
      "id" TEXT NOT NULL,
      "permitNumber" TEXT,
      "address" TEXT NOT NULL,
      "city" TEXT,
      "county" TEXT,
      "state" TEXT DEFAULT 'TX',
      "builderName" TEXT,
      "builderFound" BOOLEAN NOT NULL DEFAULT false,
      "matchedBuilderId" TEXT,
      "matchedDealId" TEXT,
      "projectType" TEXT NOT NULL DEFAULT 'RESIDENTIAL',
      "estimatedValue" DOUBLE PRECISION DEFAULT 0,
      "filingDate" TIMESTAMP(3),
      "status" TEXT NOT NULL DEFAULT 'NEW',
      "source" TEXT DEFAULT 'MANUAL',
      "notes" TEXT,
      "researchData" JSONB DEFAULT '{}',
      "outreachSentAt" TIMESTAMP(3),
      "convertedAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PermitLead_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('PermitLead_indexes', `
    CREATE INDEX IF NOT EXISTS "PermitLead_status_idx" ON "PermitLead"("status")
  `)

  await runStep('PermitLead_builder_idx', `
    CREATE INDEX IF NOT EXISTS "PermitLead_builderName_idx" ON "PermitLead"("builderName")
  `)

  await runStep('PermitLead_date_idx', `
    CREATE INDEX IF NOT EXISTS "PermitLead_filingDate_idx" ON "PermitLead"("filingDate")
  `)

  // ── 2. OutreachSequence ──
  await runStep('OutreachSequence', `
    CREATE TABLE IF NOT EXISTS "OutreachSequence" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "targetType" TEXT NOT NULL DEFAULT 'DEAL',
      "targetId" TEXT NOT NULL,
      "builderId" TEXT,
      "dealId" TEXT,
      "permitLeadId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'ACTIVE',
      "currentStep" INT NOT NULL DEFAULT 0,
      "totalSteps" INT NOT NULL DEFAULT 3,
      "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" TIMESTAMP(3),
      "pausedAt" TIMESTAMP(3),
      "cancelledReason" TEXT,
      "metadata" JSONB DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OutreachSequence_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('OutreachSequence_indexes', `
    CREATE INDEX IF NOT EXISTS "OutreachSequence_status_idx" ON "OutreachSequence"("status")
  `)

  await runStep('OutreachSequence_target_idx', `
    CREATE INDEX IF NOT EXISTS "OutreachSequence_targetId_idx" ON "OutreachSequence"("targetId")
  `)

  // ── 3. OutreachStep ──
  await runStep('OutreachStep', `
    CREATE TABLE IF NOT EXISTS "OutreachStep" (
      "id" TEXT NOT NULL,
      "sequenceId" TEXT NOT NULL,
      "stepNumber" INT NOT NULL,
      "channel" TEXT NOT NULL DEFAULT 'EMAIL',
      "subject" TEXT,
      "body" TEXT,
      "templateUsed" TEXT,
      "delayDays" INT NOT NULL DEFAULT 0,
      "scheduledFor" TIMESTAMP(3),
      "sentAt" TIMESTAMP(3),
      "openedAt" TIMESTAMP(3),
      "repliedAt" TIMESTAMP(3),
      "bouncedAt" TIMESTAMP(3),
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "metadata" JSONB DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "OutreachStep_pkey" PRIMARY KEY ("id"),
      CONSTRAINT "OutreachStep_sequenceId_fkey" FOREIGN KEY ("sequenceId") REFERENCES "OutreachSequence"("id") ON DELETE CASCADE
    )
  `)

  await runStep('OutreachStep_indexes', `
    CREATE INDEX IF NOT EXISTS "OutreachStep_sequenceId_idx" ON "OutreachStep"("sequenceId")
  `)

  await runStep('OutreachStep_status_idx', `
    CREATE INDEX IF NOT EXISTS "OutreachStep_status_idx" ON "OutreachStep"("status")
  `)

  await runStep('OutreachStep_scheduled_idx', `
    CREATE INDEX IF NOT EXISTS "OutreachStep_scheduledFor_idx" ON "OutreachStep"("scheduledFor")
  `)

  const failed = results.filter(r => r.status === 'ERROR')

  return NextResponse.json({
    message: `Phase 3 migration complete: ${results.length - failed.length}/${results.length} steps OK`,
    results,
    hasErrors: failed.length > 0,
  })
}
