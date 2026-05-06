export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

/**
 * GET /api/ops/revenue-intelligence/setup
 * Check migration status and report tables/indexes
 */
export async function GET(request: NextRequest) {
  try {
    const authError = checkStaffAuth(request);
    if (authError) return authError;

    // Check if tables exist by querying system tables
    const tableCheckQueries = [
      'BuilderValueProfile',
      'DynamicPriceRule',
      'QuoteOptimizationLog',
      'UpsellRecommendation',
      'RevenueForecast',
      'RetentionAction'
    ];

    const tablesStatus: Record<string, boolean> = {};

    for (const tableName of tableCheckQueries) {
      try {
        const result = await prisma.$queryRawUnsafe<any[]>(
          `SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = $1)`,
          tableName
        );
        tablesStatus[tableName] = result?.[0]?.exists ?? false;
      } catch (err) {
        tablesStatus[tableName] = false;
      }
    }

    // Check existing table columns
    let builderColumnsAdded = false;
    let quoteColumnsAdded = false;

    try {
      const builderColumns = await prisma.$queryRawUnsafe<any[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'Builder' AND column_name IN ('segmentTag', 'lifetimeValue', 'churnRisk', 'lastAnalyzedAt')`
      );
      builderColumnsAdded = (builderColumns?.length ?? 0) > 0;
    } catch (err) {
      builderColumnsAdded = false;
    }

    try {
      const quoteColumns = await prisma.$queryRawUnsafe<any[]>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'Quote' AND column_name IN ('aiOptimized', 'originalTotal', 'marginPercent', 'aiRecommendations')`
      );
      quoteColumnsAdded = (quoteColumns?.length ?? 0) > 0;
    } catch (err) {
      quoteColumnsAdded = false;
    }

    return safeJson({
      status: 'ok',
      message: 'Revenue Intelligence schema status',
      tables: tablesStatus,
      builderColumnsAdded,
      quoteColumnsAdded,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Migration status check error:', error);
    return NextResponse.json(
      {
        error: 'Status check failed',
        message: 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/ops/revenue-intelligence/setup
 * Run the full migration: create tables, indexes, and alter existing tables
 */
export async function POST(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'RevenueIntelligence', undefined, { method: 'POST' }).catch(() => {})

    const authError = checkStaffAuth(request);
    if (authError) return authError;

    const results = {
      success: false,
      tablesCreated: [] as string[],
      indexesCreated: [] as string[],
      columnsAdded: [] as string[],
      errors: [] as string[]
    };

    // 1. Create BuilderValueProfile table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "BuilderValueProfile" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "builderId" TEXT NOT NULL UNIQUE,
          "lifetimeRevenue" FLOAT DEFAULT 0,
          "lifetimeOrders" INT DEFAULT 0,
          "lifetimeQuotes" INT DEFAULT 0,
          "quoteToOrderRate" FLOAT DEFAULT 0,
          "avgOrderValue" FLOAT DEFAULT 0,
          "avgOrderFrequencyDays" FLOAT DEFAULT 0,
          "lastOrderDate" TIMESTAMP(3),
          "daysSinceLastOrder" INT DEFAULT 0,
          "predictedNextOrderDate" TIMESTAMP(3),
          "predictedAnnualRevenue" FLOAT DEFAULT 0,
          "lifetimeValueScore" FLOAT DEFAULT 0,
          "growthTrend" TEXT DEFAULT 'STABLE',
          "churnRisk" TEXT DEFAULT 'LOW',
          "churnRiskScore" FLOAT DEFAULT 0,
          "preferredCategories" JSONB DEFAULT '[]',
          "preferredVendors" JSONB DEFAULT '[]',
          "priceElasticity" TEXT DEFAULT 'NORMAL',
          "avgMarginPercent" FLOAT DEFAULT 0,
          "paymentReliability" TEXT DEFAULT 'GOOD',
          "upsellOpportunities" JSONB DEFAULT '[]',
          "crossSellOpportunities" JSONB DEFAULT '[]',
          "segmentTag" TEXT DEFAULT 'STANDARD',
          "lastAnalyzedAt" TIMESTAMP(3),
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('BuilderValueProfile');
    } catch (err) {
      results.errors.push(`BuilderValueProfile table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 2. Create DynamicPriceRule table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "DynamicPriceRule" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "name" TEXT NOT NULL,
          "description" TEXT,
          "ruleType" TEXT NOT NULL DEFAULT 'MARGIN_FLOOR',
          "productCategory" TEXT,
          "productId" TEXT,
          "builderSegment" TEXT,
          "builderId" TEXT,
          "condition" JSONB NOT NULL DEFAULT '{}',
          "adjustment" JSONB NOT NULL DEFAULT '{}',
          "priority" INT DEFAULT 0,
          "isActive" BOOLEAN DEFAULT true,
          "appliedCount" INT DEFAULT 0,
          "totalRevenueImpact" FLOAT DEFAULT 0,
          "createdById" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('DynamicPriceRule');
    } catch (err) {
      results.errors.push(`DynamicPriceRule table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 3. Create QuoteOptimizationLog table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "QuoteOptimizationLog" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "quoteId" TEXT NOT NULL,
          "builderId" TEXT NOT NULL,
          "originalTotal" FLOAT DEFAULT 0,
          "optimizedTotal" FLOAT DEFAULT 0,
          "marginBefore" FLOAT DEFAULT 0,
          "marginAfter" FLOAT DEFAULT 0,
          "rulesApplied" JSONB DEFAULT '[]',
          "upsellsRecommended" JSONB DEFAULT '[]',
          "upsellsAccepted" JSONB DEFAULT '[]',
          "revenueImpact" FLOAT DEFAULT 0,
          "builderSegment" TEXT,
          "competitivePosition" TEXT DEFAULT 'MARKET',
          "aiConfidence" FLOAT DEFAULT 0,
          "aiReasoning" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('QuoteOptimizationLog');
    } catch (err) {
      results.errors.push(`QuoteOptimizationLog table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 4. Create UpsellRecommendation table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "UpsellRecommendation" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "sourceProductId" TEXT,
          "sourceCategory" TEXT NOT NULL,
          "targetProductId" TEXT,
          "targetCategory" TEXT NOT NULL,
          "recommendationType" TEXT NOT NULL DEFAULT 'UPGRADE',
          "title" TEXT NOT NULL,
          "description" TEXT,
          "priceIncrease" FLOAT DEFAULT 0,
          "marginIncrease" FLOAT DEFAULT 0,
          "acceptanceRate" FLOAT DEFAULT 0,
          "timesShown" INT DEFAULT 0,
          "timesAccepted" INT DEFAULT 0,
          "isActive" BOOLEAN DEFAULT true,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('UpsellRecommendation');
    } catch (err) {
      results.errors.push(`UpsellRecommendation table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 5. Create RevenueForecast table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "RevenueForecast" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "periodStart" DATE NOT NULL,
          "periodEnd" DATE NOT NULL,
          "periodType" TEXT NOT NULL DEFAULT 'MONTHLY',
          "projectedRevenue" FLOAT DEFAULT 0,
          "projectedOrders" INT DEFAULT 0,
          "projectedMargin" FLOAT DEFAULT 0,
          "pipelineValue" FLOAT DEFAULT 0,
          "weightedPipeline" FLOAT DEFAULT 0,
          "sourcesBreakdown" JSONB DEFAULT '{}',
          "scenarioType" TEXT DEFAULT 'BASE',
          "confidenceLevel" FLOAT DEFAULT 0,
          "actualRevenue" FLOAT,
          "actualOrders" INT,
          "forecastAccuracy" FLOAT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('RevenueForecast');
    } catch (err) {
      results.errors.push(`RevenueForecast table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 6. Create RetentionAction table
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "RetentionAction" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "builderId" TEXT NOT NULL,
          "triggerType" TEXT NOT NULL,
          "triggerReason" TEXT NOT NULL,
          "suggestedAction" TEXT NOT NULL,
          "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
          "estimatedRevenueAtRisk" FLOAT DEFAULT 0,
          "status" TEXT NOT NULL DEFAULT 'PENDING',
          "assignedToId" TEXT,
          "completedAt" TIMESTAMP(3),
          "outcome" TEXT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('RetentionAction');
    } catch (err) {
      results.errors.push(`RetentionAction table: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 7. Create index on BuilderValueProfile(builderId)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "BuilderValueProfile_builderId_idx" ON "BuilderValueProfile"("builderId")
      `);
      results.indexesCreated.push('BuilderValueProfile_builderId_idx');
    } catch (err) {
      results.errors.push(`BuilderValueProfile_builderId_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 8. Create index on BuilderValueProfile(lifetimeValueScore)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "BuilderValueProfile_lifetimeValueScore_idx" ON "BuilderValueProfile"("lifetimeValueScore")
      `);
      results.indexesCreated.push('BuilderValueProfile_lifetimeValueScore_idx');
    } catch (err) {
      results.errors.push(`BuilderValueProfile_lifetimeValueScore_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 9. Create index on BuilderValueProfile(churnRisk)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "BuilderValueProfile_churnRisk_idx" ON "BuilderValueProfile"("churnRisk")
      `);
      results.indexesCreated.push('BuilderValueProfile_churnRisk_idx');
    } catch (err) {
      results.errors.push(`BuilderValueProfile_churnRisk_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 10. Create index on BuilderValueProfile(segmentTag)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "BuilderValueProfile_segmentTag_idx" ON "BuilderValueProfile"("segmentTag")
      `);
      results.indexesCreated.push('BuilderValueProfile_segmentTag_idx');
    } catch (err) {
      results.errors.push(`BuilderValueProfile_segmentTag_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 11. Create index on DynamicPriceRule(ruleType)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "DynamicPriceRule_ruleType_idx" ON "DynamicPriceRule"("ruleType")
      `);
      results.indexesCreated.push('DynamicPriceRule_ruleType_idx');
    } catch (err) {
      results.errors.push(`DynamicPriceRule_ruleType_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 12. Create index on DynamicPriceRule(productCategory)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "DynamicPriceRule_productCategory_idx" ON "DynamicPriceRule"("productCategory")
      `);
      results.indexesCreated.push('DynamicPriceRule_productCategory_idx');
    } catch (err) {
      results.errors.push(`DynamicPriceRule_productCategory_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 13. Create index on DynamicPriceRule(builderSegment)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "DynamicPriceRule_builderSegment_idx" ON "DynamicPriceRule"("builderSegment")
      `);
      results.indexesCreated.push('DynamicPriceRule_builderSegment_idx');
    } catch (err) {
      results.errors.push(`DynamicPriceRule_builderSegment_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 14. Create index on DynamicPriceRule(isActive)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "DynamicPriceRule_isActive_idx" ON "DynamicPriceRule"("isActive")
      `);
      results.indexesCreated.push('DynamicPriceRule_isActive_idx');
    } catch (err) {
      results.errors.push(`DynamicPriceRule_isActive_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 15. Create index on QuoteOptimizationLog(quoteId)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "QuoteOptimizationLog_quoteId_idx" ON "QuoteOptimizationLog"("quoteId")
      `);
      results.indexesCreated.push('QuoteOptimizationLog_quoteId_idx');
    } catch (err) {
      results.errors.push(`QuoteOptimizationLog_quoteId_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 16. Create index on QuoteOptimizationLog(builderId)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "QuoteOptimizationLog_builderId_idx" ON "QuoteOptimizationLog"("builderId")
      `);
      results.indexesCreated.push('QuoteOptimizationLog_builderId_idx');
    } catch (err) {
      results.errors.push(`QuoteOptimizationLog_builderId_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 17. Create index on QuoteOptimizationLog(createdAt)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "QuoteOptimizationLog_createdAt_idx" ON "QuoteOptimizationLog"("createdAt")
      `);
      results.indexesCreated.push('QuoteOptimizationLog_createdAt_idx');
    } catch (err) {
      results.errors.push(`QuoteOptimizationLog_createdAt_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 18. Create index on UpsellRecommendation(sourceCategory)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "UpsellRecommendation_sourceCategory_idx" ON "UpsellRecommendation"("sourceCategory")
      `);
      results.indexesCreated.push('UpsellRecommendation_sourceCategory_idx');
    } catch (err) {
      results.errors.push(`UpsellRecommendation_sourceCategory_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 19. Create index on UpsellRecommendation(targetCategory)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "UpsellRecommendation_targetCategory_idx" ON "UpsellRecommendation"("targetCategory")
      `);
      results.indexesCreated.push('UpsellRecommendation_targetCategory_idx');
    } catch (err) {
      results.errors.push(`UpsellRecommendation_targetCategory_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 20. Create index on UpsellRecommendation(recommendationType)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "UpsellRecommendation_recommendationType_idx" ON "UpsellRecommendation"("recommendationType")
      `);
      results.indexesCreated.push('UpsellRecommendation_recommendationType_idx');
    } catch (err) {
      results.errors.push(`UpsellRecommendation_recommendationType_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 21. Create index on RevenueForecast(periodStart)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RevenueForecast_periodStart_idx" ON "RevenueForecast"("periodStart")
      `);
      results.indexesCreated.push('RevenueForecast_periodStart_idx');
    } catch (err) {
      results.errors.push(`RevenueForecast_periodStart_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 22. Create index on RevenueForecast(scenarioType)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RevenueForecast_scenarioType_idx" ON "RevenueForecast"("scenarioType")
      `);
      results.indexesCreated.push('RevenueForecast_scenarioType_idx');
    } catch (err) {
      results.errors.push(`RevenueForecast_scenarioType_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 23. Create index on RevenueForecast(periodType)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RevenueForecast_periodType_idx" ON "RevenueForecast"("periodType")
      `);
      results.indexesCreated.push('RevenueForecast_periodType_idx');
    } catch (err) {
      results.errors.push(`RevenueForecast_periodType_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 24. Create index on RetentionAction(builderId)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RetentionAction_builderId_idx" ON "RetentionAction"("builderId")
      `);
      results.indexesCreated.push('RetentionAction_builderId_idx');
    } catch (err) {
      results.errors.push(`RetentionAction_builderId_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 25. Create index on RetentionAction(status)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RetentionAction_status_idx" ON "RetentionAction"("status")
      `);
      results.indexesCreated.push('RetentionAction_status_idx');
    } catch (err) {
      results.errors.push(`RetentionAction_status_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 26. Create index on RetentionAction(urgency)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RetentionAction_urgency_idx" ON "RetentionAction"("urgency")
      `);
      results.indexesCreated.push('RetentionAction_urgency_idx');
    } catch (err) {
      results.errors.push(`RetentionAction_urgency_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 27. Create index on RetentionAction(triggerType)
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "RetentionAction_triggerType_idx" ON "RetentionAction"("triggerType")
      `);
      results.indexesCreated.push('RetentionAction_triggerType_idx');
    } catch (err) {
      results.errors.push(`RetentionAction_triggerType_idx: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 28. Alter Builder table - add segmentTag
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "segmentTag" TEXT DEFAULT 'STANDARD'
      `);
      results.columnsAdded.push('Builder.segmentTag');
    } catch (err) {
      results.errors.push(`Builder.segmentTag: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 29. Alter Builder table - add lifetimeValue
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "lifetimeValue" FLOAT DEFAULT 0
      `);
      results.columnsAdded.push('Builder.lifetimeValue');
    } catch (err) {
      results.errors.push(`Builder.lifetimeValue: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 30. Alter Builder table - add churnRisk
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "churnRisk" TEXT DEFAULT 'LOW'
      `);
      results.columnsAdded.push('Builder.churnRisk');
    } catch (err) {
      results.errors.push(`Builder.churnRisk: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 31. Alter Builder table - add lastAnalyzedAt
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "lastAnalyzedAt" TIMESTAMP(3)
      `);
      results.columnsAdded.push('Builder.lastAnalyzedAt');
    } catch (err) {
      results.errors.push(`Builder.lastAnalyzedAt: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 32. Alter Quote table - add aiOptimized
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "aiOptimized" BOOLEAN DEFAULT false
      `);
      results.columnsAdded.push('Quote.aiOptimized');
    } catch (err) {
      results.errors.push(`Quote.aiOptimized: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 33. Alter Quote table - add originalTotal
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "originalTotal" FLOAT
      `);
      results.columnsAdded.push('Quote.originalTotal');
    } catch (err) {
      results.errors.push(`Quote.originalTotal: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 34. Alter Quote table - add marginPercent
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "marginPercent" FLOAT
      `);
      results.columnsAdded.push('Quote.marginPercent');
    } catch (err) {
      results.errors.push(`Quote.marginPercent: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    // 35. Alter Quote table - add aiRecommendations
    try {
      await prisma.$executeRawUnsafe(`
        ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "aiRecommendations" JSONB
      `);
      results.columnsAdded.push('Quote.aiRecommendations');
    } catch (err) {
      results.errors.push(`Quote.aiRecommendations: ${err instanceof Error ? err.message : 'Unknown error'}`);
    }

    results.success = results.errors.length === 0;

    return safeJson({
      ...results,
      timestamp: new Date().toISOString(),
      migrationStatus: results.success ? 'completed' : 'completed_with_errors'
    });
  } catch (error) {
    console.error('Migration error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Migration failed',
        message: 'Unknown error',
        timestamp: new Date().toISOString()
      },
      { status: 500 }
    );
  }
}
