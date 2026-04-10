export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { batchApply } from '@/lib/integrations/boise-cascade'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/integrations/supplier-pricing/apply
// Apply price updates: approve, reject, or approve-all pending updates
//
// Request body:
// {
//   updateIds: string[],
//   action: 'approve' | 'reject' | 'approve-all',
//   appliedById?: string
// }
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { updateIds, action, appliedById } = body

    // Validate inputs
    if (!action || !['approve', 'reject', 'approve-all'].includes(action)) {
      return safeJson(
        { error: "action must be 'approve', 'reject', or 'approve-all'" },
        { status: 400 }
      )
    }

    if (action !== 'approve-all' && (!updateIds || !Array.isArray(updateIds) || updateIds.length === 0)) {
      return safeJson(
        { error: 'updateIds array is required (except when action is approve-all)' },
        { status: 400 }
      )
    }

    // Get staff ID from headers for audit trail
    const staffId = request.headers.get('x-staff-id') || appliedById || 'system'

    // Execute batch apply
    const result = await batchApply(updateIds || [], action, staffId)

    if (result.errors.length > 0) {
      console.error('Batch apply errors:', result.errors)
    }

    return safeJson({
      success: result.errors.length === 0,
      action,
      appliedCount: result.appliedCount,
      rejectedCount: result.rejectedCount,
      errors: result.errors,
      message: `${result.appliedCount} updates approved, ${result.rejectedCount} rejected`
    })
  } catch (error: any) {
    console.error('Error applying supplier pricing updates:', error)
    return safeJson({ error: error.message || 'Internal server error' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/supplier-pricing/apply
// Get details of pending updates ready for approval
// Query params: ?status=PENDING|APPROVED|REJECTED (default: PENDING)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const url = new URL(request.url)
    const status = url.searchParams.get('status') || 'PENDING'
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '100'), 1000)

    // Ensure table exists
    await ensureTables()

    // Get updates by status
    const updates: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        spu.id,
        spu."productId",
        spu."productName",
        spu."supplierSku",
        spu."previousCost",
        spu."newCost",
        spu."costChange",
        spu."costChangePct",
        spu."currentPrice",
        spu."suggestedPrice",
        spu."currentMarginPct",
        spu."newMarginPct",
        spu.status,
        spu."matchType",
        spu."matchConfidence",
        spu."batchId",
        spu."appliedAt",
        spu."appliedById",
        spu."createdAt",
        p."minMargin"
       FROM "SupplierPriceUpdate" spu
       LEFT JOIN "Product" p ON spu."productId" = p.id
       WHERE spu.status = $1
       ORDER BY spu."newMarginPct" ASC, spu."createdAt" DESC
       LIMIT $2`,
      status,
      limit
    )

    // Get summary stats for this status
    const stats: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        COUNT(*) as total_count,
        COUNT(CASE WHEN "newMarginPct" < ("minMargin" * 100) THEN 1 END) as below_min_margin_count,
        ROUND(AVG("costChangePct")::numeric, 2) as avg_cost_change,
        ROUND(SUM("costChange")::numeric, 2) as total_impact
       FROM "SupplierPriceUpdate" spu
       LEFT JOIN "Product" p ON spu."productId" = p.id
       WHERE spu.status = $1`,
      status
    )

    return safeJson({
      status,
      count: updates.length,
      stats: {
        totalCount: Number(stats[0]?.total_count || 0),
        belowMinMarginCount: Number(stats[0]?.below_min_margin_count || 0),
        avgCostChange: parseFloat(stats[0]?.avg_cost_change) || 0,
        totalImpact: parseFloat(stats[0]?.total_impact) || 0
      },
      updates: updates.map((u: any) => ({
        id: u.id,
        productId: u.productId,
        productName: u.productName,
        supplierSku: u.supplierSku,
        previousCost: u.previousCost,
        newCost: u.newCost,
        costChange: u.costChange,
        costChangePct: parseFloat(u.costChangePct) || 0,
        currentPrice: u.currentPrice,
        suggestedPrice: u.suggestedPrice,
        currentMarginPct: parseFloat(u.currentMarginPct) || 0,
        newMarginPct: parseFloat(u.newMarginPct) || 0,
        minMargin: u.minMargin ? parseFloat(u.minMargin) * 100 : null,
        marginBelowThreshold: u.minMargin && u.newMarginPct < u.minMargin * 100,
        status: u.status,
        matchType: u.matchType,
        matchConfidence: parseFloat(u.matchConfidence) || 0,
        batchId: u.batchId,
        appliedAt: u.appliedAt,
        appliedById: u.appliedById,
        createdAt: u.createdAt
      }))
    })
  } catch (error: any) {
    console.error('Error fetching supplier pricing updates:', error)
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

    // Backfill missing columns on older databases
    await prisma.$executeRawUnsafe(`ALTER TABLE "SupplierPriceUpdate" ADD COLUMN IF NOT EXISTS "matchType" TEXT`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "SupplierPriceUpdate" ADD COLUMN IF NOT EXISTS "matchConfidence" NUMERIC(5, 4)`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "SupplierPriceUpdate" ADD COLUMN IF NOT EXISTS "appliedAt" TIMESTAMP WITH TIME ZONE`)
    await prisma.$executeRawUnsafe(`ALTER TABLE "SupplierPriceUpdate" ADD COLUMN IF NOT EXISTS "appliedById" TEXT`)

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
