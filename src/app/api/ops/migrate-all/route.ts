export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/migrate-all
 * Unified migration runner: executes Phase 2, 3, 4, and 5 migrations in sequence.
 *
 * This endpoint runs all database schema updates in a single request:
 * - Phase 2: Operations tables (DemandForecast, AutoPurchaseOrder, QualityPrediction)
 *            + CollectionAction & Invoice columns
 * - Phase 3: Revenue tables (PermitLead, OutreachSequence, OutreachStep)
 * - Phase 4: Marketing tables (SEOContent, SEOKeyword) + 12 keyword seeds
 * - Phase 5: Pricing tables (PricingRule, PricingEvent, CompetitorPrice) + 7 rule seeds
 *
 * Auth: Requires staff authentication (ADMIN or OPS role recommended)
 */
export async function POST(request: NextRequest) {
  // ──────────────────────────────────────────────────────────────────────────
  // Authentication Check
  // ──────────────────────────────────────────────────────────────────────────
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Track all steps across all phases
  const results: { phase: string; step: string; status: string; error?: string }[] = []

  /**
   * Helper function to safely run SQL statements
   * Uses prisma.$executeRawUnsafe() for DDL operations
   */
  async function runStep(
    phase: string,
    name: string,
    sql: string
  ) {
    try {
    audit(request, 'RUN_MIGRATE_ALL', 'Database', undefined, { migration: 'RUN_MIGRATE_ALL' }, 'CRITICAL').catch(() => {})
      await prisma.$executeRawUnsafe(sql)
      results.push({ phase, step: name, status: 'OK' })
    } catch (e: any) {
      const errorMsg = e.message?.slice(0, 200) || 'Unknown error'
      results.push({ phase, step: name, status: 'ERROR', error: errorMsg })
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 2: Operations Autopilot Tables
  // ──────────────────────────────────────────────────────────────────────────

  // 1. DemandForecast
  await runStep(
    'Phase 2',
    'DemandForecast',
    `
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
    `
  )

  await runStep(
    'Phase 2',
    'DemandForecast_productId_idx',
    `CREATE INDEX IF NOT EXISTS "DemandForecast_productId_idx" ON "DemandForecast"("productId")`
  )

  await runStep(
    'Phase 2',
    'DemandForecast_forecastDate_idx',
    `CREATE INDEX IF NOT EXISTS "DemandForecast_forecastDate_idx" ON "DemandForecast"("forecastDate")`
  )

  // 2. AutoPurchaseOrder
  await runStep(
    'Phase 2',
    'AutoPurchaseOrder',
    `
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
    `
  )

  await runStep(
    'Phase 2',
    'AutoPurchaseOrder_status_idx',
    `CREATE INDEX IF NOT EXISTS "AutoPurchaseOrder_status_idx" ON "AutoPurchaseOrder"("status")`
  )

  // 3. QualityPrediction
  await runStep(
    'Phase 2',
    'QualityPrediction',
    `
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
    `
  )

  await runStep(
    'Phase 2',
    'QualityPrediction_jobId_idx',
    `CREATE INDEX IF NOT EXISTS "QualityPrediction_jobId_idx" ON "QualityPrediction"("jobId")`
  )

  await runStep(
    'Phase 2',
    'QualityPrediction_riskScore_idx',
    `CREATE INDEX IF NOT EXISTS "QualityPrediction_riskScore_idx" ON "QualityPrediction"("riskScore")`
  )

  // 4. CollectionAction columns
  await runStep(
    'Phase 2',
    'CollectionAction_requiresApproval',
    `ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "requiresApproval" BOOLEAN NOT NULL DEFAULT false`
  )

  await runStep(
    'Phase 2',
    'CollectionAction_approvedAt',
    `ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3)`
  )

  await runStep(
    'Phase 2',
    'CollectionAction_approvedBy',
    `ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "approvedBy" TEXT`
  )

  await runStep(
    'Phase 2',
    'CollectionAction_toneUsed',
    `ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "toneUsed" TEXT`
  )

  await runStep(
    'Phase 2',
    'CollectionAction_intelligenceSnapshot',
    `ALTER TABLE "CollectionAction" ADD COLUMN IF NOT EXISTS "intelligenceSnapshot" JSONB`
  )

  // 5. Invoice columns
  await runStep(
    'Phase 2',
    'Invoice_paymentPlanOffered',
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paymentPlanOffered" BOOLEAN NOT NULL DEFAULT false`
  )

  await runStep(
    'Phase 2',
    'Invoice_paymentPlanDetails',
    `ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "paymentPlanDetails" JSONB`
  )

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 3: Revenue Engine Tables
  // ──────────────────────────────────────────────────────────────────────────

  // 1. PermitLead
  await runStep(
    'Phase 3',
    'PermitLead',
    `
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
    `
  )

  await runStep(
    'Phase 3',
    'PermitLead_status_idx',
    `CREATE INDEX IF NOT EXISTS "PermitLead_status_idx" ON "PermitLead"("status")`
  )

  await runStep(
    'Phase 3',
    'PermitLead_builderName_idx',
    `CREATE INDEX IF NOT EXISTS "PermitLead_builderName_idx" ON "PermitLead"("builderName")`
  )

  await runStep(
    'Phase 3',
    'PermitLead_filingDate_idx',
    `CREATE INDEX IF NOT EXISTS "PermitLead_filingDate_idx" ON "PermitLead"("filingDate")`
  )

  // 2. OutreachSequence
  await runStep(
    'Phase 3',
    'OutreachSequence',
    `
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
    `
  )

  await runStep(
    'Phase 3',
    'OutreachSequence_status_idx',
    `CREATE INDEX IF NOT EXISTS "OutreachSequence_status_idx" ON "OutreachSequence"("status")`
  )

  await runStep(
    'Phase 3',
    'OutreachSequence_targetId_idx',
    `CREATE INDEX IF NOT EXISTS "OutreachSequence_targetId_idx" ON "OutreachSequence"("targetId")`
  )

  // 3. OutreachStep
  await runStep(
    'Phase 3',
    'OutreachStep',
    `
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
    `
  )

  await runStep(
    'Phase 3',
    'OutreachStep_sequenceId_idx',
    `CREATE INDEX IF NOT EXISTS "OutreachStep_sequenceId_idx" ON "OutreachStep"("sequenceId")`
  )

  await runStep(
    'Phase 3',
    'OutreachStep_status_idx',
    `CREATE INDEX IF NOT EXISTS "OutreachStep_status_idx" ON "OutreachStep"("status")`
  )

  await runStep(
    'Phase 3',
    'OutreachStep_scheduledFor_idx',
    `CREATE INDEX IF NOT EXISTS "OutreachStep_scheduledFor_idx" ON "OutreachStep"("scheduledFor")`
  )

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 4: Marketing & SEO Machine Tables
  // ──────────────────────────────────────────────────────────────────────────

  // 1. SEOContent
  await runStep(
    'Phase 4',
    'SEOContent',
    `
    CREATE TABLE IF NOT EXISTS "SEOContent" (
      "id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "contentType" TEXT NOT NULL DEFAULT 'BLOG',
      "targetKeywords" JSONB DEFAULT '[]',
      "content" TEXT NOT NULL DEFAULT '',
      "metaDescription" TEXT,
      "excerpt" TEXT,
      "author" TEXT DEFAULT 'Abel Lumber',
      "status" TEXT NOT NULL DEFAULT 'DRAFT',
      "publishedAt" TIMESTAMP(3),
      "lastUpdated" TIMESTAMP(3),
      "pageViews" INT NOT NULL DEFAULT 0,
      "avgTimeOnPage" DOUBLE PRECISION DEFAULT 0,
      "bounceRate" DOUBLE PRECISION DEFAULT 0,
      "conversions" INT NOT NULL DEFAULT 0,
      "featuredImage" TEXT,
      "tags" JSONB DEFAULT '[]',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SEOContent_pkey" PRIMARY KEY ("id")
    )
    `
  )

  await runStep(
    'Phase 4',
    'SEOContent_slug_idx',
    `CREATE INDEX IF NOT EXISTS "SEOContent_slug_idx" ON "SEOContent"("slug")`
  )

  await runStep(
    'Phase 4',
    'SEOContent_status_idx',
    `CREATE INDEX IF NOT EXISTS "SEOContent_status_idx" ON "SEOContent"("status")`
  )

  await runStep(
    'Phase 4',
    'SEOContent_type_idx',
    `CREATE INDEX IF NOT EXISTS "SEOContent_type_idx" ON "SEOContent"("contentType")`
  )

  // 2. SEOKeyword
  await runStep(
    'Phase 4',
    'SEOKeyword',
    `
    CREATE TABLE IF NOT EXISTS "SEOKeyword" (
      "id" TEXT NOT NULL,
      "keyword" TEXT NOT NULL,
      "searchVolume" INT DEFAULT 0,
      "difficulty" INT DEFAULT 50,
      "currentRank" INT,
      "previousRank" INT,
      "targetPage" TEXT,
      "contentId" TEXT,
      "category" TEXT,
      "intent" TEXT DEFAULT 'INFORMATIONAL',
      "lastChecked" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SEOKeyword_pkey" PRIMARY KEY ("id")
    )
    `
  )

  await runStep(
    'Phase 4',
    'SEOKeyword_keyword_idx',
    `CREATE UNIQUE INDEX IF NOT EXISTS "SEOKeyword_keyword_idx" ON "SEOKeyword"("keyword")`
  )

  await runStep(
    'Phase 4',
    'SEOKeyword_rank_idx',
    `CREATE INDEX IF NOT EXISTS "SEOKeyword_rank_idx" ON "SEOKeyword"("currentRank")`
  )

  // 3. Seed 12 initial keywords
  const keywords = [
    { keyword: 'pre hung interior doors wholesale', volume: 1200, difficulty: 45, intent: 'COMMERCIAL' },
    { keyword: 'builder door packages texas', volume: 480, difficulty: 35, intent: 'COMMERCIAL' },
    { keyword: 'mdf vs solid wood trim', volume: 2400, difficulty: 55, intent: 'INFORMATIONAL' },
    { keyword: 'interior door installation guide', volume: 3600, difficulty: 60, intent: 'INFORMATIONAL' },
    { keyword: 'door and trim package cost calculator', volume: 880, difficulty: 40, intent: 'TRANSACTIONAL' },
    { keyword: 'building materials supplier near me', volume: 6600, difficulty: 70, intent: 'LOCAL' },
    { keyword: 'residential door package estimating', volume: 320, difficulty: 30, intent: 'COMMERCIAL' },
    { keyword: 'pre hung door vs slab door', volume: 2900, difficulty: 50, intent: 'INFORMATIONAL' },
    { keyword: 'bulk interior doors for builders', volume: 720, difficulty: 38, intent: 'COMMERCIAL' },
    { keyword: 'shaker interior doors wholesale', volume: 1600, difficulty: 42, intent: 'COMMERCIAL' },
    { keyword: 'door hardware packages bulk', volume: 590, difficulty: 35, intent: 'COMMERCIAL' },
    { keyword: 'trim and casing packages new construction', volume: 440, difficulty: 32, intent: 'COMMERCIAL' },
  ]

  for (const kw of keywords) {
    const kwId = `kw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await runStep(
      'Phase 4',
      `Keyword_${kw.keyword.slice(0, 30)}`,
      `INSERT INTO "SEOKeyword" ("id", "keyword", "searchVolume", "difficulty", "intent", "createdAt", "updatedAt") VALUES ('${kwId}', '${kw.keyword}', ${kw.volume}, ${kw.difficulty}, '${kw.intent}', NOW(), NOW()) ON CONFLICT ("keyword") DO NOTHING`
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // PHASE 5: Pricing & Margin Engine Tables
  // ──────────────────────────────────────────────────────────────────────────

  // 1. PricingRule
  await runStep(
    'Phase 5',
    'PricingRule',
    `
    CREATE TABLE IF NOT EXISTS "PricingRule" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "ruleType" TEXT NOT NULL,
      "conditions" JSONB NOT NULL DEFAULT '{}',
      "adjustment" JSONB NOT NULL DEFAULT '{}',
      "priority" INT NOT NULL DEFAULT 50,
      "isActive" BOOLEAN NOT NULL DEFAULT true,
      "effectiveDate" TIMESTAMP(3),
      "expiryDate" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
    )
    `
  )

  await runStep(
    'Phase 5',
    'PricingRule_ruleType_idx',
    `CREATE INDEX IF NOT EXISTS "PricingRule_ruleType_idx" ON "PricingRule"("ruleType")`
  )

  // 2. PricingEvent
  await runStep(
    'Phase 5',
    'PricingEvent',
    `
    CREATE TABLE IF NOT EXISTS "PricingEvent" (
      "id" TEXT NOT NULL,
      "builderId" TEXT,
      "productId" TEXT,
      "orderId" TEXT,
      "basePrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "finalPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
      "rulesApplied" JSONB DEFAULT '[]',
      "margin" DOUBLE PRECISION,
      "savings" DOUBLE PRECISION DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "PricingEvent_pkey" PRIMARY KEY ("id")
    )
    `
  )

  await runStep(
    'Phase 5',
    'PricingEvent_builderId_idx',
    `CREATE INDEX IF NOT EXISTS "PricingEvent_builderId_idx" ON "PricingEvent"("builderId")`
  )

  // 3. CompetitorPrice
  await runStep(
    'Phase 5',
    'CompetitorPrice',
    `
    CREATE TABLE IF NOT EXISTS "CompetitorPrice" (
      "id" TEXT NOT NULL,
      "productCategory" TEXT NOT NULL,
      "competitorName" TEXT NOT NULL,
      "productName" TEXT,
      "price" DOUBLE PRECISION NOT NULL,
      "source" TEXT,
      "notes" TEXT,
      "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "CompetitorPrice_pkey" PRIMARY KEY ("id")
    )
    `
  )

  await runStep(
    'Phase 5',
    'CompetitorPrice_productCategory_idx',
    `CREATE INDEX IF NOT EXISTS "CompetitorPrice_category_idx" ON "CompetitorPrice"("productCategory")`
  )

  // 4. Seed 7 default pricing rules
  const rules = [
    {
      name: 'Volume Break — 25+ units',
      type: 'VOLUME_BREAK',
      conditions: { minQuantity: 25 },
      adjustment: { type: 'PERCENTAGE', value: -5 },
      priority: 40,
    },
    {
      name: 'Volume Break — 50+ units',
      type: 'VOLUME_BREAK',
      conditions: { minQuantity: 50 },
      adjustment: { type: 'PERCENTAGE', value: -8 },
      priority: 30,
    },
    {
      name: 'Loyalty Tier — Gold ($50K+ LTV)',
      type: 'LOYALTY_DISCOUNT',
      conditions: { minLTV: 50000 },
      adjustment: { type: 'PERCENTAGE', value: -3 },
      priority: 50,
    },
    {
      name: 'Loyalty Tier — Platinum ($100K+ LTV)',
      type: 'LOYALTY_DISCOUNT',
      conditions: { minLTV: 100000 },
      adjustment: { type: 'PERCENTAGE', value: -5 },
      priority: 45,
    },
    {
      name: 'Early Payment Reward (pays within 15 days)',
      type: 'EARLY_PAYMENT',
      conditions: { maxAvgDaysToPayment: 15 },
      adjustment: { type: 'PERCENTAGE', value: -2 },
      priority: 60,
    },
    {
      name: 'Inventory Clearance — Overstock',
      type: 'INVENTORY_CLEARANCE',
      conditions: { stockRatio: 3.0 },
      adjustment: { type: 'PERCENTAGE', value: -12 },
      priority: 20,
    },
    {
      name: 'Door + Trim + Hardware Bundle',
      type: 'BUNDLE',
      conditions: { requiredCategories: ['Interior Doors', 'Trim', 'Hardware'] },
      adjustment: { type: 'PERCENTAGE', value: -10 },
      priority: 35,
    },
  ]

  for (const rule of rules) {
    const id = `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    // Escape single quotes in rule name for SQL
    const escapedName = rule.name.replace(/'/g, "''")
    await runStep(
      'Phase 5',
      `Seed_${rule.name.slice(0, 25)}`,
      `INSERT INTO "PricingRule" ("id", "name", "ruleType", "conditions", "adjustment", "priority", "isActive", "createdAt", "updatedAt") VALUES ('${id}', '${escapedName}', '${rule.type}', '${JSON.stringify(rule.conditions)}'::jsonb, '${JSON.stringify(rule.adjustment)}'::jsonb, ${rule.priority}, true, NOW(), NOW())`
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Build Summary Results
  // ──────────────────────────────────────────────────────────────────────────

  // Count results by phase and status
  const byPhase = {
    'Phase 2': results.filter(r => r.phase === 'Phase 2'),
    'Phase 3': results.filter(r => r.phase === 'Phase 3'),
    'Phase 4': results.filter(r => r.phase === 'Phase 4'),
    'Phase 5': results.filter(r => r.phase === 'Phase 5'),
  }

  const phaseSummaries = Object.entries(byPhase).map(([phase, steps]) => {
    const ok = steps.filter(s => s.status === 'OK').length
    return {
      phase,
      total: steps.length,
      successful: ok,
      failed: steps.length - ok,
    }
  })

  const totalSteps = results.length
  const totalOK = results.filter(r => r.status === 'OK').length
  const totalErrors = totalSteps - totalOK
  const hasErrors = totalErrors > 0

  return NextResponse.json({
    message: `All migrations complete: ${totalOK}/${totalSteps} steps OK`,
    summary: phaseSummaries,
    totalSteps,
    successfulSteps: totalOK,
    failedSteps: totalErrors,
    hasErrors,
    details: results,
  })
}
