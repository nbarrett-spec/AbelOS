export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/migrate-phase5
 * Phase 5: Pricing & Margin Engine — PricingRule, PricingEvent, CompetitorPrice tables
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_PHASE5', 'Database', undefined, { migration: 'RUN_MIGRATE_PHASE5' }, 'CRITICAL').catch(() => {})

  const results: { step: string; status: string; error?: string }[] = []

  async function runStep(name: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step: name, status: 'OK' })
    } catch (e: any) {
      results.push({ step: name, status: 'ERROR', error: e.message?.slice(0, 200) })
    }
  }

  await runStep('PricingRule', `
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
  `)

  await runStep('PricingRule_idx', `CREATE INDEX IF NOT EXISTS "PricingRule_ruleType_idx" ON "PricingRule"("ruleType")`)

  await runStep('PricingEvent', `
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
  `)

  await runStep('PricingEvent_idx', `CREATE INDEX IF NOT EXISTS "PricingEvent_builderId_idx" ON "PricingEvent"("builderId")`)

  await runStep('CompetitorPrice', `
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
  `)

  await runStep('CompetitorPrice_idx', `CREATE INDEX IF NOT EXISTS "CompetitorPrice_category_idx" ON "CompetitorPrice"("productCategory")`)

  // Seed default pricing rules
  const rules = [
    { name: 'Volume Break — 25+ units', type: 'VOLUME_BREAK', conditions: { minQuantity: 25 }, adjustment: { type: 'PERCENTAGE', value: -5 }, priority: 40 },
    { name: 'Volume Break — 50+ units', type: 'VOLUME_BREAK', conditions: { minQuantity: 50 }, adjustment: { type: 'PERCENTAGE', value: -8 }, priority: 30 },
    { name: 'Loyalty Tier — Gold ($50K+ LTV)', type: 'LOYALTY_DISCOUNT', conditions: { minLTV: 50000 }, adjustment: { type: 'PERCENTAGE', value: -3 }, priority: 50 },
    { name: 'Loyalty Tier — Platinum ($100K+ LTV)', type: 'LOYALTY_DISCOUNT', conditions: { minLTV: 100000 }, adjustment: { type: 'PERCENTAGE', value: -5 }, priority: 45 },
    { name: 'Early Payment Reward (pays within 15 days)', type: 'EARLY_PAYMENT', conditions: { maxAvgDaysToPayment: 15 }, adjustment: { type: 'PERCENTAGE', value: -2 }, priority: 60 },
    { name: 'Inventory Clearance — Overstock', type: 'INVENTORY_CLEARANCE', conditions: { stockRatio: 3.0 }, adjustment: { type: 'PERCENTAGE', value: -12 }, priority: 20 },
    { name: 'Door + Trim + Hardware Bundle', type: 'BUNDLE', conditions: { requiredCategories: ['Interior Doors', 'Trim', 'Hardware'] }, adjustment: { type: 'PERCENTAGE', value: -10 }, priority: 35 },
  ]

  for (const rule of rules) {
    const id = `pr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await runStep(`Seed_${rule.name.slice(0, 25)}`, `
      INSERT INTO "PricingRule" ("id", "name", "ruleType", "conditions", "adjustment", "priority", "isActive", "createdAt", "updatedAt")
      VALUES ('${id}', '${rule.name.replace(/'/g, "''")}', '${rule.type}', '${JSON.stringify(rule.conditions)}'::jsonb, '${JSON.stringify(rule.adjustment)}'::jsonb, ${rule.priority}, true, NOW(), NOW())
    `)
  }

  const failed = results.filter(r => r.status === 'ERROR')
  return NextResponse.json({
    message: `Phase 5 migration complete: ${results.length - failed.length}/${results.length} steps OK`,
    results, hasErrors: failed.length > 0,
  })
}
