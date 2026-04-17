export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';
import { safeJson } from '@/lib/safe-json';
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/cash-flow-optimizer/setup
 * Creates additional tables for the Cash Flow Optimizer
 * (CashFlowForecast, PaymentOptimization, ProfitOptimizationLog already exist from procurement setup)
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  const results = { tablesCreated: [] as string[], indexesCreated: [] as string[], columnsAdded: [] as string[], errors: [] as string[] };

  try {
    // Audit log
    audit(request, 'CREATE', 'CashFlowOptimizer', undefined, { method: 'POST' }).catch(() => {})

    // 1. CollectionAction - AI-prioritized collection tasks
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CollectionAction" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "invoiceId" TEXT NOT NULL,
          "builderId" TEXT NOT NULL,
          "actionType" TEXT NOT NULL DEFAULT 'REMINDER',
          "priority" INT DEFAULT 50,
          "urgency" TEXT DEFAULT 'NORMAL',
          "amountDue" FLOAT DEFAULT 0,
          "daysOverdue" INT DEFAULT 0,
          "channel" TEXT DEFAULT 'EMAIL',
          "status" TEXT DEFAULT 'PENDING',
          "scheduledAt" TIMESTAMP(3),
          "executedAt" TIMESTAMP(3),
          "response" TEXT,
          "nextFollowUp" TIMESTAMP(3),
          "escalationLevel" INT DEFAULT 0,
          "aiReasoning" TEXT,
          "aiConfidence" FLOAT DEFAULT 0,
          "metadata" JSONB DEFAULT '{}',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('CollectionAction');
    } catch (err) {
      results.errors.push(`CollectionAction: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 2. CreditLineTracker - Credit line utilization tracking
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "CreditLineTracker" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "builderId" TEXT NOT NULL UNIQUE,
          "creditLimit" FLOAT DEFAULT 0,
          "currentBalance" FLOAT DEFAULT 0,
          "availableCredit" FLOAT DEFAULT 0,
          "utilizationPercent" FLOAT DEFAULT 0,
          "peakUtilization" FLOAT DEFAULT 0,
          "avgUtilization30d" FLOAT DEFAULT 0,
          "creditScore" INT DEFAULT 50,
          "recommendedLimit" FLOAT,
          "limitChangeReason" TEXT,
          "paymentBehavior" TEXT DEFAULT 'NORMAL',
          "lastReviewedAt" TIMESTAMP(3),
          "nextReviewAt" TIMESTAMP(3),
          "metadata" JSONB DEFAULT '{}',
          "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('CreditLineTracker');
    } catch (err) {
      results.errors.push(`CreditLineTracker: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 3. PaymentTermRecommendation - AI term recommendations per builder
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "PaymentTermRecommendation" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "builderId" TEXT NOT NULL,
          "currentTerm" TEXT NOT NULL,
          "recommendedTerm" TEXT NOT NULL,
          "reasoning" TEXT,
          "estimatedCashImpact" FLOAT DEFAULT 0,
          "estimatedRiskChange" TEXT DEFAULT 'NEUTRAL',
          "confidence" FLOAT DEFAULT 0,
          "status" TEXT DEFAULT 'PENDING',
          "reviewedById" TEXT,
          "reviewedAt" TIMESTAMP(3),
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('PaymentTermRecommendation');
    } catch (err) {
      results.errors.push(`PaymentTermRecommendation: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 4. InvoiceTimingRule - When to issue invoices for max collection speed
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "InvoiceTimingRule" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "name" TEXT NOT NULL,
          "description" TEXT,
          "triggerEvent" TEXT NOT NULL,
          "delayDays" INT DEFAULT 0,
          "conditions" JSONB DEFAULT '{}',
          "isActive" BOOLEAN DEFAULT true,
          "appliedCount" INT DEFAULT 0,
          "avgCollectionDays" FLOAT,
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('InvoiceTimingRule');
    } catch (err) {
      results.errors.push(`InvoiceTimingRule: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // 5. WorkingCapitalSnapshot - Daily snapshots for trend analysis
    try {
      await prisma.$executeRawUnsafe(`
        CREATE TABLE IF NOT EXISTS "WorkingCapitalSnapshot" (
          "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
          "snapshotDate" DATE NOT NULL UNIQUE,
          "totalAR" FLOAT DEFAULT 0,
          "totalAP" FLOAT DEFAULT 0,
          "inventory" FLOAT DEFAULT 0,
          "cashOnHand" FLOAT DEFAULT 0,
          "workingCapital" FLOAT DEFAULT 0,
          "currentRatio" FLOAT DEFAULT 0,
          "quickRatio" FLOAT DEFAULT 0,
          "dso" FLOAT DEFAULT 0,
          "dpo" FLOAT DEFAULT 0,
          "cashConversionCycle" FLOAT DEFAULT 0,
          "metadata" JSONB DEFAULT '{}',
          "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY ("id")
        )
      `);
      results.tablesCreated.push('WorkingCapitalSnapshot');
    } catch (err) {
      results.errors.push(`WorkingCapitalSnapshot: ${err instanceof Error ? err.message : 'Unknown'}`);
    }

    // Create indexes
    const indexes = [
      ['idx_collection_action_invoice', 'CollectionAction', '"invoiceId"'],
      ['idx_collection_action_builder', 'CollectionAction', '"builderId"'],
      ['idx_collection_action_status', 'CollectionAction', '"status"'],
      ['idx_collection_action_priority', 'CollectionAction', '"priority" DESC'],
      ['idx_collection_action_urgency', 'CollectionAction', '"urgency"'],
      ['idx_credit_line_builder', 'CreditLineTracker', '"builderId"'],
      ['idx_payment_term_rec_builder', 'PaymentTermRecommendation', '"builderId"'],
      ['idx_payment_term_rec_status', 'PaymentTermRecommendation', '"status"'],
      ['idx_invoice_timing_active', 'InvoiceTimingRule', '"isActive"'],
      ['idx_working_capital_date', 'WorkingCapitalSnapshot', '"snapshotDate" DESC'],
      ['idx_payment_opt_builder', 'PaymentOptimization', '"builderId"'],
      ['idx_cashflow_forecast_date', 'CashFlowForecast', '"forecastDate"'],
      ['idx_cashflow_forecast_scenario', 'CashFlowForecast', '"scenario"'],
      ['idx_profit_opt_category', 'ProfitOptimizationLog', '"category"'],
      ['idx_profit_opt_status', 'ProfitOptimizationLog', '"status"'],
    ];

    for (const [name, table, cols] of indexes) {
      try {
        await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "${name}" ON "${table}"(${cols})`);
        results.indexesCreated.push(name);
      } catch (err) {
        // Index might already exist or table doesn't exist
      }
    }

    return safeJson({
      success: true,
      tables: results.tablesCreated.length,
      indexes: results.indexesCreated.length,
      ...results,
    });
  } catch (error: any) {
    console.error('Cash flow optimizer setup error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const tables = ['CollectionAction', 'CreditLineTracker', 'PaymentTermRecommendation', 'InvoiceTimingRule', 'WorkingCapitalSnapshot', 'CashFlowForecast', 'PaymentOptimization', 'ProfitOptimizationLog'];
    const status: Record<string, boolean> = {};

    for (const t of tables) {
      try {
        const r: any[] = await prisma.$queryRawUnsafe(
          `SELECT EXISTS(SELECT FROM information_schema.tables WHERE table_name = $1)`,
          t
        );
        status[t] = r?.[0]?.exists ?? false;
      } catch { status[t] = false; }
    }

    return safeJson({ tables: status, allReady: Object.values(status).every(v => v) });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
