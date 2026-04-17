export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'
import {
  batchImport,
  getPriceAlerts,
  getBatchHistory
} from '@/lib/integrations/boise-cascade'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/supplier-pricing
// Return overview: pending updates count, last import, price change summary,
// margin risk items, and batch history
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ensure table exists
    await ensureTables()

    // Get pending updates count by supplier
    const pendingStats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        supplier,
        COUNT(*)::int as count,
        COUNT(CASE WHEN "newMarginPct" < "currentMarginPct" THEN 1 END)::int as cost_increase_count
      FROM "SupplierPriceUpdate"
      WHERE status::text = 'PENDING'
      GROUP BY supplier
    `)

    // Get total pending count
    const totalPending = pendingStats.reduce((sum: number, s: any) => sum + Number(s.count), 0)

    // Get last import time
    const lastImport: any[] = await prisma.$queryRawUnsafe(`
      SELECT MAX("createdAt") as last_import_time
      FROM "SupplierPriceUpdate"
      WHERE status::text IN ('APPROVED', 'PENDING')
    `)

    const lastImportTime = lastImport[0]?.last_import_time || null

    // Get price change summary (pending only)
    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as total_updates,
        COUNT(CASE WHEN "costChange" > 0 THEN 1 END)::int as cost_increases,
        COUNT(CASE WHEN "costChange" < 0 THEN 1 END)::int as cost_decreases,
        COUNT(CASE WHEN "costChange" = 0 THEN 1 END)::int as no_change,
        ROUND(AVG("costChangePct")::numeric, 2) as avg_cost_change_pct,
        ROUND(MIN("costChangePct")::numeric, 2) as min_cost_change_pct,
        ROUND(MAX("costChangePct")::numeric, 2) as max_cost_change_pct,
        ROUND(SUM("costChange")::numeric, 2) as total_cost_impact
      FROM "SupplierPriceUpdate"
      WHERE status::text = 'PENDING'
    `)

    // Get price alerts (items below minMargin)
    const alerts = await getPriceAlerts()

    // Get recent sync history
    const syncHistory: any[] = await prisma.$queryRawUnsafe(`
      SELECT
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
        "durationMs"
      FROM "SyncLog"
      WHERE provider = 'BOISE_CASCADE'
      ORDER BY "startedAt" DESC
      LIMIT 10
    `)

    // Get batch history
    const batchHistory = await getBatchHistory(10)

    return safeJson({
      overview: {
        totalPendingUpdates: totalPending,
        lastImportTime,
        suppliers: pendingStats.map((s: any) => ({
          name: s.supplier,
          pendingUpdates: Number(s.count),
          costIncreases: Number(s.cost_increase_count)
        }))
      },
      changeSummary: summary[0]
        ? {
            totalUpdates: Number(summary[0].total_updates),
            costIncreases: Number(summary[0].cost_increases),
            costDecreases: Number(summary[0].cost_decreases),
            noChange: Number(summary[0].no_change),
            avgCostChangePct: parseFloat(summary[0].avg_cost_change_pct) || 0,
            minCostChangePct: parseFloat(summary[0].min_cost_change_pct) || 0,
            maxCostChangePct: parseFloat(summary[0].max_cost_change_pct) || 0,
            totalCostImpact: parseFloat(summary[0].total_cost_impact) || 0
          }
        : null,
      priceAlerts: {
        count: alerts.length,
        items: alerts.slice(0, 10)
      },
      syncHistory: syncHistory.map((s: any) => ({
        provider: s.provider,
        syncType: s.syncType,
        status: s.status,
        recordsProcessed: Number(s.recordsProcessed),
        recordsCreated: Number(s.recordsCreated),
        recordsUpdated: Number(s.recordsUpdated),
        recordsSkipped: Number(s.recordsSkipped),
        recordsFailed: Number(s.recordsFailed),
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        durationMs: Number(s.durationMs)
      })),
      batchHistory
    })
  } catch (error: any) {
    console.error('Error fetching supplier pricing overview:', error)
    return safeJson({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/supplier-pricing
// Upload CSV, parse it, match SKUs, store as SupplierPriceUpdate records
// Request body: multipart form data with 'file' field or 'csv' text field
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    // Parse request body
    let csvContent: string | null = null
    const contentType = request.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      // Parse multipart form data (CSV file upload)
      const formData = await request.formData()
      const file = formData.get('file') as File

      if (file) {
        csvContent = await file.text()
      }
    } else if (contentType.includes('application/json')) {
      // Accept raw CSV in JSON body
      const body = await request.json()
      csvContent = body.csv || body.csvContent
    } else {
      // Try raw text body
      csvContent = await request.text()
    }

    if (!csvContent || csvContent.trim().length === 0) {
      return safeJson(
        { error: 'No CSV content provided. Send as multipart form data (file) or raw text.' },
        { status: 400 }
      )
    }

    // Get supplier from query params or body
    const url = new URL(request.url)
    const supplier = url.searchParams.get('supplier') || 'BOISE_CASCADE'

    // Import and process the CSV
    const result = await batchImport(csvContent, supplier)

    return safeJson({
      success: true,
      batchId: result.batchId,
      supplier: result.supplier,
      summary: {
        totalRows: result.totalRows,
        matchedProducts: result.matchedProducts,
        unmatchedRows: result.unmatchedRows,
        matchRate: result.totalRows > 0 ? (result.matchedProducts / result.totalRows) * 100 : 0
      },
      matchedUpdates: result.matchedUpdates.map(u => ({
        id: u.id,
        productId: u.productId,
        productName: u.productName,
        supplierSku: u.supplierSku,
        previousCost: u.previousCost,
        newCost: u.newCost,
        costChange: u.costChange,
        costChangePct: u.costChangePct,
        currentPrice: u.currentPrice,
        suggestedPrice: u.suggestedPrice,
        currentMarginPct: u.currentMarginPct,
        newMarginPct: u.newMarginPct,
        status: u.status,
        matchType: u.matchType,
        matchConfidence: u.matchConfidence
      })),
      unmatchedItems: result.unmatchedItems.slice(0, 20)
    })
  } catch (error: any) {
    console.error('Error processing supplier pricing import:', error)
    return safeJson({ error: error.message || 'Internal server error' }, { status: 500 })
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
  } catch (error) {
    console.error('Error creating tables:', error)
  }
}
