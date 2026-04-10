export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/ops/migrate-phase2
 * Phase 2: Operations Autopilot — creates DemandForecast, AutoPurchaseOrder, QualityPrediction tables
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

  // ── 1. DemandForecast ──
  await runStep('DemandForecast', `
    CREATE TABLE IF NOT EXISTS "DemandForecast" (
      "id" TEXT NOT NULL,
      "productId" TEXT NOT NULL,
      "forecastDate" TIMESTAMP(3) NOT NULL,
      "periodDays" INT NOT NULL DEFAULT 30,
      "predictedDemand" INT NOT NULL DEFAULT 0,
      "actualDemand" INT,
      "confidenceLevel" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
      "basedOn" JSONB DEFAULT '{}',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "DemandForecast_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('DemandForecast_indexes', `
    CREATE INDEX IF NOT EXISTS "DemandForecast_productId_idx" ON "DemandForecast"("productId")
  `)

  await runStep('DemandForecast_date_idx', `
    CREATE INDEX IF NOT EXISTS "DemandForecast_forecastDate_idx" ON "DemandForecast"("forecastDate")
  `)

  // ── 2. AutoPurchaseOrder ──
  await runStep('AutoPurchaseOrder', `
    CREATE TABLE IF NOT EXISTS "AutoPurchaseOrder" (
      "id" TEXT NOT NULL,
      "vendorName" TEXT NOT NULL DEFAULT 'Unknown',
      "vendorId" TEXT,
      "status" TEXT NOT NULL DEFAULT 'RECOMMENDED',
      "items" JSONB NOT NULL DEFAULT '[]',
      "estimatedTotal" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "reason" TEXT,
      "approvedBy" TEXT,
      "approvedAt" TIMESTAMP(3),
      "sentAt" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "AutoPurchaseOrder_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('AutoPurchaseOrder_indexes', `
    CREATE INDEX IF NOT EXISTS "AutoPurchaseOrder_status_idx" ON "AutoPurchaseOrder"("status")
  `)

  // ── 3. QualityPrediction ──
  await runStep('QualityPrediction', `
    CREATE TABLE IF NOT EXISTS "QualityPrediction" (
      "id" TEXT NOT NULL,
      "jobId" TEXT NOT NULL,
      "deliveryId" TEXT,
      "riskScore" INT NOT NULL DEFAULT 50,
      "riskFactors" JSONB NOT NULL DEFAULT '[]',
      "recommendation" TEXT NOT NULL DEFAULT 'STANDARD',
      "resolved" BOOLEAN NOT NULL DEFAULT false,
      "resolvedAt" TIMESTAMP(3),
      "resolvedBy" TEXT,
      "notes" TEXT,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "QualityPrediction_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('QualityPrediction_indexes', `
    CREATE INDEX IF NOT EXISTS "QualityPrediction_jobId_idx" ON "QualityPrediction"("jobId")
  `)

  await runStep('QualityPrediction_risk_idx', `
    CREATE INDEX IF NOT EXISTS "QualityPrediction_riskScore_idx" ON "QualityPrediction"("riskScore")
  `)

  // ── 4. Add "requiresApproval" column to CollectionAction if not exists ──
  await runStep('CollectionAction_approvalCol', `
    ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "requiresApproval" BOOLEAN NOT NULL DEFAULT false
  `)

  await runStep('CollectionAction_approvedAt', `
    ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3)
  `)

  await runStep('CollectionAction_approvedBy', `
    ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT
  `)

  await runStep('CollectionAction_toneUsed', `
    ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "toneUsed" TEXT
  `)

  await runStep('CollectionAction_intelligenceSnapshot', `
    ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "intelligenceSnapshot" JSONB
  `)

  // ── 5. Add "paymentPlanOffered" column to Invoice if not exists ──
  await runStep('Invoice_paymentPlanOffered', `
    ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paymentPlanOffered" BOOLEAN NOT NULL DEFAULT false
  `)

  await runStep('Invoice_paymentPlanDetails', `
    ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paymentPlanDetails" JSONB
  `)

  const failed = results.filter(r => r.status === 'ERROR')

  return NextResponse.json({
    message: `Phase 2 migration complete: ${results.length - failed.length}/${results.length} steps OK`,
    results,
    hasErrors: failed.length > 0,
  })
}
