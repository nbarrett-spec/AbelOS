export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';

// Smart Procurement & Financial Optimization Engine - Database Setup
// Creates comprehensive tables for vendor performance, procurement intelligence,
// cost trend analysis, cash flow forecasting, profit optimization, and payment behavior tracking

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const tablesCreated: string[] = [];
    const indexesCreated: string[] = [];
    const columnsAdded: string[] = [];

    // ============================================
    // CREATE TABLES
    // ============================================

    // 1. VendorPerformanceLog - Track every PO fulfillment event
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VendorPerformanceLog" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "vendorId" TEXT NOT NULL,
        "purchaseOrderId" TEXT,
        "productCategory" TEXT,
        "orderedAt" TIMESTAMP(3),
        "expectedDeliveryAt" TIMESTAMP(3),
        "actualDeliveryAt" TIMESTAMP(3),
        "leadTimeDays" INT,
        "daysLateOrEarly" INT DEFAULT 0,
        "quantityOrdered" INT DEFAULT 0,
        "quantityReceived" INT DEFAULT 0,
        "quantityDamaged" INT DEFAULT 0,
        "fillRate" FLOAT DEFAULT 1.0,
        "qualityScore" FLOAT DEFAULT 1.0,
        "unitCostAtOrder" FLOAT,
        "notes" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('VendorPerformanceLog');

    // 2. VendorScorecard - Aggregated vendor intelligence
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VendorScorecard" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "vendorId" TEXT NOT NULL UNIQUE,
        "overallScore" FLOAT DEFAULT 0,
        "deliveryScore" FLOAT DEFAULT 0,
        "qualityScore" FLOAT DEFAULT 0,
        "costScore" FLOAT DEFAULT 0,
        "communicationScore" FLOAT DEFAULT 0,
        "avgLeadTimeDays" FLOAT DEFAULT 0,
        "leadTimeStdDev" FLOAT DEFAULT 0,
        "onTimeRate" FLOAT DEFAULT 0,
        "earlyRate" FLOAT DEFAULT 0,
        "lateRate" FLOAT DEFAULT 0,
        "avgFillRate" FLOAT DEFAULT 1.0,
        "avgDamageRate" FLOAT DEFAULT 0,
        "totalPOs" INT DEFAULT 0,
        "totalSpend" FLOAT DEFAULT 0,
        "avgPOValue" FLOAT DEFAULT 0,
        "costTrend" TEXT DEFAULT 'STABLE',
        "riskLevel" TEXT DEFAULT 'LOW',
        "lastEvaluatedAt" TIMESTAMP(3),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('VendorScorecard');

    // 3. MaterialLeadTime - Per-product/vendor lead time intelligence
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "MaterialLeadTime" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "productId" TEXT,
        "productCategory" TEXT,
        "vendorId" TEXT NOT NULL,
        "avgLeadDays" FLOAT DEFAULT 0,
        "minLeadDays" INT DEFAULT 0,
        "maxLeadDays" INT DEFAULT 0,
        "stdDevDays" FLOAT DEFAULT 0,
        "confidenceLevel" FLOAT DEFAULT 0,
        "sampleSize" INT DEFAULT 0,
        "seasonalFactors" JSONB DEFAULT '{}',
        "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('MaterialLeadTime');

    // 4. SmartPORecommendation - AI-generated PO suggestions
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SmartPORecommendation" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "vendorId" TEXT NOT NULL,
        "productId" TEXT,
        "productCategory" TEXT,
        "recommendationType" TEXT NOT NULL DEFAULT 'REORDER',
        "urgency" TEXT NOT NULL DEFAULT 'NORMAL',
        "triggerReason" TEXT NOT NULL,
        "recommendedQty" INT NOT NULL DEFAULT 0,
        "estimatedCost" FLOAT DEFAULT 0,
        "estimatedSavings" FLOAT DEFAULT 0,
        "targetDeliveryDate" TIMESTAMP(3),
        "orderByDate" TIMESTAMP(3),
        "relatedJobIds" JSONB DEFAULT '[]',
        "relatedOrderIds" JSONB DEFAULT '[]',
        "consolidationGroupId" TEXT,
        "status" TEXT NOT NULL DEFAULT 'PENDING',
        "approvedById" TEXT,
        "approvedAt" TIMESTAMP(3),
        "convertedPOId" TEXT,
        "aiConfidence" FLOAT DEFAULT 0,
        "aiReasoning" TEXT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('SmartPORecommendation');

    // 5. CostTrendAnalysis - Material price history and forecasting
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CostTrendAnalysis" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "productId" TEXT,
        "productCategory" TEXT NOT NULL,
        "vendorId" TEXT,
        "periodStart" TIMESTAMP(3) NOT NULL,
        "periodEnd" TIMESTAMP(3) NOT NULL,
        "avgUnitCost" FLOAT NOT NULL,
        "minUnitCost" FLOAT,
        "maxUnitCost" FLOAT,
        "totalUnits" INT DEFAULT 0,
        "totalSpend" FLOAT DEFAULT 0,
        "costChangePercent" FLOAT DEFAULT 0,
        "forecastNextPeriod" FLOAT,
        "forecastConfidence" FLOAT,
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('CostTrendAnalysis');

    // 6. CashFlowForecast - Daily/weekly cash flow projections
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "CashFlowForecast" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "forecastDate" DATE NOT NULL,
        "projectedInflows" FLOAT DEFAULT 0,
        "projectedOutflows" FLOAT DEFAULT 0,
        "netCashFlow" FLOAT DEFAULT 0,
        "runningBalance" FLOAT DEFAULT 0,
        "inflowSources" JSONB DEFAULT '{}',
        "outflowCategories" JSONB DEFAULT '{}',
        "confidenceLevel" FLOAT DEFAULT 0,
        "scenario" TEXT DEFAULT 'BASE',
        "assumptions" JSONB DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('CashFlowForecast');

    // 7. ProfitOptimizationLog - Track every optimization action and its impact
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "ProfitOptimizationLog" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "category" TEXT NOT NULL,
        "action" TEXT NOT NULL,
        "description" TEXT,
        "estimatedImpact" FLOAT DEFAULT 0,
        "actualImpact" FLOAT,
        "status" TEXT DEFAULT 'IDENTIFIED',
        "implementedAt" TIMESTAMP(3),
        "implementedById" TEXT,
        "relatedEntityType" TEXT,
        "relatedEntityId" TEXT,
        "metadata" JSONB DEFAULT '{}',
        "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('ProfitOptimizationLog');

    // 8. PaymentOptimization - Builder payment behavior tracking
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "PaymentOptimization" (
        "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
        "builderId" TEXT NOT NULL,
        "avgPaymentDays" FLOAT DEFAULT 0,
        "medianPaymentDays" FLOAT DEFAULT 0,
        "onTimeRate" FLOAT DEFAULT 0,
        "latePaymentCount" INT DEFAULT 0,
        "totalInvoices" INT DEFAULT 0,
        "totalRevenue" FLOAT DEFAULT 0,
        "outstandingBalance" FLOAT DEFAULT 0,
        "creditRisk" TEXT DEFAULT 'LOW',
        "recommendedTerms" TEXT,
        "earlyPayDiscountEligible" BOOLEAN DEFAULT false,
        "projectedCollectionDate" TIMESTAMP(3),
        "lastAnalyzedAt" TIMESTAMP(3),
        "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY ("id")
      )
    `);
    tablesCreated.push('PaymentOptimization');

    // ============================================
    // CREATE INDEXES
    // ============================================

    // VendorPerformanceLog indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_vendorperformancelog_vendorid" ON "VendorPerformanceLog"("vendorId")
    `);
    indexesCreated.push('idx_vendorperformancelog_vendorid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_vendorperformancelog_purchaseorderid" ON "VendorPerformanceLog"("purchaseOrderId")
    `);
    indexesCreated.push('idx_vendorperformancelog_purchaseorderid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_vendorperformancelog_actualdeliveryat" ON "VendorPerformanceLog"("actualDeliveryAt")
    `);
    indexesCreated.push('idx_vendorperformancelog_actualdeliveryat');

    // VendorScorecard indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_vendorscorecard_vendorid" ON "VendorScorecard"("vendorId")
    `);
    indexesCreated.push('idx_vendorscorecard_vendorid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_vendorscorecard_overallscore" ON "VendorScorecard"("overallScore")
    `);
    indexesCreated.push('idx_vendorscorecard_overallscore');

    // MaterialLeadTime indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_materialleadtime_vendorid" ON "MaterialLeadTime"("vendorId")
    `);
    indexesCreated.push('idx_materialleadtime_vendorid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_materialleadtime_productid" ON "MaterialLeadTime"("productId")
    `);
    indexesCreated.push('idx_materialleadtime_productid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_materialleadtime_productcategory" ON "MaterialLeadTime"("productCategory")
    `);
    indexesCreated.push('idx_materialleadtime_productcategory');

    // SmartPORecommendation indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_smartporecommendation_vendorid" ON "SmartPORecommendation"("vendorId")
    `);
    indexesCreated.push('idx_smartporecommendation_vendorid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_smartporecommendation_status" ON "SmartPORecommendation"("status")
    `);
    indexesCreated.push('idx_smartporecommendation_status');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_smartporecommendation_urgency" ON "SmartPORecommendation"("urgency")
    `);
    indexesCreated.push('idx_smartporecommendation_urgency');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_smartporecommendation_orderbydate" ON "SmartPORecommendation"("orderByDate")
    `);
    indexesCreated.push('idx_smartporecommendation_orderbydate');

    // CostTrendAnalysis indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_costtrendanalysis_productcategory" ON "CostTrendAnalysis"("productCategory")
    `);
    indexesCreated.push('idx_costtrendanalysis_productcategory');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_costtrendanalysis_vendorid" ON "CostTrendAnalysis"("vendorId")
    `);
    indexesCreated.push('idx_costtrendanalysis_vendorid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_costtrendanalysis_periodstart" ON "CostTrendAnalysis"("periodStart")
    `);
    indexesCreated.push('idx_costtrendanalysis_periodstart');

    // CashFlowForecast indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_cashflowforecast_forecastdate" ON "CashFlowForecast"("forecastDate")
    `);
    indexesCreated.push('idx_cashflowforecast_forecastdate');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_cashflowforecast_scenario" ON "CashFlowForecast"("scenario")
    `);
    indexesCreated.push('idx_cashflowforecast_scenario');

    // ProfitOptimizationLog indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_profitoptimizationlog_category" ON "ProfitOptimizationLog"("category")
    `);
    indexesCreated.push('idx_profitoptimizationlog_category');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_profitoptimizationlog_status" ON "ProfitOptimizationLog"("status")
    `);
    indexesCreated.push('idx_profitoptimizationlog_status');

    // PaymentOptimization indexes
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_paymentoptimization_builderid" ON "PaymentOptimization"("builderId")
    `);
    indexesCreated.push('idx_paymentoptimization_builderid');

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_paymentoptimization_creditrisk" ON "PaymentOptimization"("creditRisk")
    `);
    indexesCreated.push('idx_paymentoptimization_creditrisk');

    // ============================================
    // ALTER EXISTING TABLES - ADD COLUMNS
    // ============================================

    // Add columns to Vendor table
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "paymentTerms" TEXT
    `);
    columnsAdded.push('Vendor.paymentTerms');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "minOrderValue" FLOAT DEFAULT 0
    `);
    columnsAdded.push('Vendor.minOrderValue');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "bulkDiscountThreshold" FLOAT
    `);
    columnsAdded.push('Vendor.bulkDiscountThreshold');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "bulkDiscountPercent" FLOAT
    `);
    columnsAdded.push('Vendor.bulkDiscountPercent');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Vendor" ADD COLUMN IF NOT EXISTS "riskScore" FLOAT DEFAULT 0
    `);
    columnsAdded.push('Vendor.riskScore');

    // Add columns to PurchaseOrder table
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "aiGenerated" BOOLEAN DEFAULT false
    `);
    columnsAdded.push('PurchaseOrder.aiGenerated');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "recommendationId" TEXT
    `);
    columnsAdded.push('PurchaseOrder.recommendationId');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "consolidationGroupId" TEXT
    `);
    columnsAdded.push('PurchaseOrder.consolidationGroupId');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "projectedLeadDays" INT
    `);
    columnsAdded.push('PurchaseOrder.projectedLeadDays');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "actualLeadDays" INT
    `);
    columnsAdded.push('PurchaseOrder.actualLeadDays');

    await prisma.$executeRawUnsafe(`
      ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "savingsVsLastOrder" FLOAT DEFAULT 0
    `);
    columnsAdded.push('PurchaseOrder.savingsVsLastOrder');

    return safeJson({
      success: true,
      tablesCreated,
      indexesCreated,
      columnsAdded,
      message: 'Smart Procurement & Financial Optimization engine database setup completed successfully',
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Procurement intelligence setup error:', error);
    return safeJson(
      {
        success: false,
        error: 'Database migration failed',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    // Verify tables exist and return status
    const tables = [
      'VendorPerformanceLog',
      'VendorScorecard',
      'MaterialLeadTime',
      'SmartPORecommendation',
      'CostTrendAnalysis',
      'CashFlowForecast',
      'ProfitOptimizationLog',
      'PaymentOptimization',
    ];

    const status: Record<string, boolean> = {};

    for (const table of tables) {
      try {
        const result: any[] = await prisma.$queryRawUnsafe(`
          SELECT 1 FROM information_schema.tables
          WHERE table_name = $1
        `, table);
        status[table] = result.length > 0;
      } catch {
        status[table] = false;
      }
    }

    const allTablesExist = Object.values(status).every(v => v === true);

    return safeJson({
      status: 'operational',
      allTablesExist,
      tableStatus: status,
      timestamp: new Date().toISOString(),
    });
  } catch (error: any) {
    console.error('Procurement intelligence status check error:', error);
    return safeJson(
      {
        status: 'error',
        error: 'Status check failed',
        details: error?.message || 'Unknown error',
      },
      { status: 500 }
    );
  }
}
