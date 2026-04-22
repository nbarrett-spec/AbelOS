export const dynamic = 'force-dynamic'
import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { getBatchHistory } from '@/lib/integrations/boise-cascade'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/supplier-pricing/history
// Return all past imports with stats (items processed, applied, rejected,
// avg cost change, date range)
//
// Query params:
// - limit: Number of batches to return (default: 50, max: 500)
// - supplier: Filter by supplier (default: all)
// - days: Only show batches from last N days (optional)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const url = new URL(request.url)
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 500)
    const supplier = url.searchParams.get('supplier') || 'BOISE_CASCADE'
    const days = parseInt(url.searchParams.get('days') || '0')

    // Ensure table exists
    await ensureTables()

    // Get list of batches
    let query = `
      SELECT DISTINCT ON ("batchId") "batchId", supplier, "createdAt"
      FROM "SupplierPriceUpdate"
      WHERE supplier = $1
    `
    const params: any[] = [supplier]

    if (days > 0) {
      query += ` AND "createdAt" >= NOW() - INTERVAL '${days} days'`
    }

    query += ` ORDER BY "batchId" DESC, "createdAt" DESC LIMIT $2`
    params.push(limit)

    const batches: any[] = await prisma.$queryRawUnsafe(query, ...params)

    // For each batch, get detailed stats
    const batchHistoryDetails = await Promise.all(
      batches.map(async batch => {
        const stats: any[] = await prisma.$queryRawUnsafe(
          `SELECT
            "batchId",
            COUNT(*)::int as total_items,
            COUNT(CASE WHEN status = 'PENDING' THEN 1 END)::int as pending_count,
            COUNT(CASE WHEN status = 'APPROVED' THEN 1 END)::int as approved_count,
            COUNT(CASE WHEN status = 'REJECTED' THEN 1 END)::int as rejected_count,
            ROUND(AVG("costChangePct")::numeric, 2) as avg_cost_change_pct,
            ROUND(MIN("costChangePct")::numeric, 2) as min_cost_change_pct,
            ROUND(MAX("costChangePct")::numeric, 2) as max_cost_change_pct,
            ROUND(SUM("costChange")::numeric, 2) as total_cost_impact,
            MIN("createdAt") as import_date,
            MAX("appliedAt") as last_applied_date,
            COUNT(DISTINCT "appliedById")::int as applied_by_count
           FROM "SupplierPriceUpdate"
           WHERE "batchId" = $1`,
          batch.batchId
        )

        const stat = stats[0]
        return {
          batchId: batch.batchId,
          supplier: batch.supplier,
          importDate: stat.import_date,
          lastAppliedDate: stat.last_applied_date,
          totalItems: Number(stat.total_items),
          pending: Number(stat.pending_count),
          approved: Number(stat.approved_count),
          rejected: Number(stat.rejected_count),
          stats: {
            avgCostChangePct: parseFloat(stat.avg_cost_change_pct) || 0,
            minCostChangePct: parseFloat(stat.min_cost_change_pct) || 0,
            maxCostChangePct: parseFloat(stat.max_cost_change_pct) || 0,
            totalCostImpact: parseFloat(stat.total_cost_impact) || 0,
            appliedByCount: Number(stat.applied_by_count)
          }
        }
      })
    )

    // Get overall statistics across all time
    const overallStats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(DISTINCT "batchId")::int as total_batches,
        COUNT(*)::int as total_updates,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END)::int as total_applied,
        COUNT(CASE WHEN status = 'REJECTED' THEN 1 END)::int as total_rejected,
        ROUND(AVG(CASE WHEN status = 'APPROVED' THEN "costChangePct" END)::numeric, 2) as avg_applied_cost_change
       FROM "SupplierPriceUpdate"
       WHERE supplier = $1`,
      supplier
    )

    // Get recent sync logs for this supplier
    const syncLogs: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        provider,
        "syncType",
        status,
        "recordsProcessed",
        "recordsCreated",
        "recordsUpdated",
        "recordsSkipped",
        "recordsFailed",
        "startedAt",
        "completedAt",
        "durationMs",
        "errorMessage"
       FROM "SyncLog"
       WHERE provider = 'BOISE_CASCADE'
       ORDER BY "startedAt" DESC
       LIMIT 20`
    )

    // Get product updates by category (which products got updated)
    const productUpdates: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*)::int as update_count,
        COUNT(CASE WHEN status = 'APPROVED' THEN 1 END)::int as approved_count,
        p.category,
        p.subcategory
       FROM "SupplierPriceUpdate" spu
       LEFT JOIN "Product" p ON spu."productId" = p.id
       WHERE spu.supplier = $1
       GROUP BY p.category, p.subcategory
       ORDER BY update_count DESC`,
      supplier
    )

    return safeJson({
      supplier,
      overallStats: {
        totalBatches: Number(overallStats[0]?.total_batches || 0),
        totalUpdates: Number(overallStats[0]?.total_updates || 0),
        totalApplied: Number(overallStats[0]?.total_applied || 0),
        totalRejected: Number(overallStats[0]?.total_rejected || 0),
        avgAppliedCostChange: parseFloat(overallStats[0]?.avg_applied_cost_change) || 0
      },
      batchHistory: batchHistoryDetails,
      syncLogs: syncLogs.map((log: any) => ({
        provider: log.provider,
        syncType: log.syncType,
        status: log.status,
        recordsProcessed: Number(log.recordsProcessed),
        recordsCreated: Number(log.recordsCreated),
        recordsUpdated: Number(log.recordsUpdated),
        recordsSkipped: Number(log.recordsSkipped),
        recordsFailed: Number(log.recordsFailed),
        startedAt: log.startedAt,
        completedAt: log.completedAt,
        durationMs: Number(log.durationMs),
        errorMessage: log.errorMessage
      })),
      productUpdates: productUpdates.map((p: any) => ({
        category: p.category || 'Uncategorized',
        subcategory: p.subcategory || 'Other',
        updateCount: Number(p.update_count),
        approvedCount: Number(p.approved_count),
        approvalRate: Number(p.update_count) > 0 ? ((Number(p.approved_count) / Number(p.update_count)) * 100).toFixed(1) : '0'
      }))
    })
  } catch (error: any) {
    console.error('Error fetching supplier pricing history:', error)
    return safeJson({ error: 'Internal server error' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: Ensure database tables exist
// ──────────────────────────────────────────────────────────────────────────

async function ensureTables() {
  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "SupplierPriceUpdate" (
        id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        supplier TEXT NOT NULL,
        "batchId" TEXT NOT NULL,
        "productId" TEXT NOT NULL,
        "supplierSku" TEXT NOT NULL,
        "productName" TEXT NOT NULL,
        "previousCost" NUMERIC(12, 2) NOT NULL,
        "newCost" NUMERIC(12, 2) NOT NULL,
        "costChange" NUMERIC(12, 2) NOT NULL,
        "costChangePct" NUMERIC(8, 4) NOT NULL,
        "currentPrice" NUMERIC(12, 2) NOT NULL,
        "suggestedPrice" NUMERIC(12, 2),
        "currentMarginPct" NUMERIC(8, 4),
        "newMarginPct" NUMERIC(8, 4),
        "matchType" TEXT,
        "matchConfidence" NUMERIC(5, 4),
        status TEXT NOT NULL DEFAULT 'PENDING',
        "appliedAt" TIMESTAMP WITH TIME ZONE,
        "appliedById" TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_batch_id"
      ON "SupplierPriceUpdate"("batchId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_product_id"
      ON "SupplierPriceUpdate"("productId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_status"
      ON "SupplierPriceUpdate"(status)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_supplier_price_update_supplier"
      ON "SupplierPriceUpdate"(supplier)
    `)
  } catch (error) {
    console.error('Error creating tables:', error)
  }
}
