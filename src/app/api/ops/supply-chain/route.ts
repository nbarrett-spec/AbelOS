export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// SUPPLY CHAIN COMMAND CENTER API
// Vendor concentration, lead times, PO pipeline, material forecasts, scorecards
// ──────────────────────────────────────────────────────────────────────────

interface VendorConcentrationResult {
  id: string
  name: string
  poCount: number
  spend: number
}

interface LeadTimeResult {
  vendorId: string
  vendorName: string
  avgLeadDays: number
  completedPOs: number
}

interface POPipelineResult {
  status: string
  count: number
  value: number
}

interface MaterialForecastResult {
  id: string
  productName: string
  onHand: number
  reorderPoint: number
  onOrder: number
  available: number
  preferredVendor: string | null
}

interface VendorScorecardQuery {
  vendorId: string
  vendorName: string
  poCount: number
  spend: number
  avgLeadDays: number
  onTimeRate: number | null
}

interface RiskAlert {
  type: 'concentration' | 'lead_time' | 'stockout' | 'vendor_inactive'
  severity: 'high' | 'medium' | 'low'
  title: string
  message: string
  affectedVendor?: string
  affectedProduct?: string
  metadata?: Record<string, any>
}

export async function GET(request: NextRequest) {
  const auth = await requireStaffAuth(request)
  if (auth.error) return auth.error

  try {
    // Run all queries in parallel for performance
    const [
      vendorConcentrationResult,
      leadTimeResult,
      poPipelineResult,
      materialForecastResult,
      vendorScorecardResult,
      totalOpenPOResult,
      allVendorsResult,
    ] = await Promise.all([
      // 1. VENDOR CONCENTRATION: PO count, spend, and percentage
      prisma.$queryRawUnsafe<VendorConcentrationResult[]>(
        `SELECT v.id, v.name, COUNT(po.id)::int as "poCount",
          COALESCE(SUM(po.total),0)::float as spend
        FROM "Vendor" v
        LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v.id
          AND po."createdAt" >= NOW() - INTERVAL '12 months'
        WHERE v.active = true
        GROUP BY v.id, v.name
        ORDER BY spend DESC`
      ),

      // 2. LEAD TIME PERFORMANCE: Avg days from PO creation to receiving
      prisma.$queryRawUnsafe<LeadTimeResult[]>(
        `SELECT po."vendorId", v.name as "vendorName",
          AVG(EXTRACT(DAY FROM po."receivedAt" - po."createdAt"))::float as "avgLeadDays",
          COUNT(po.id)::int as "completedPOs"
        FROM "PurchaseOrder" po
        JOIN "Vendor" v ON v.id = po."vendorId"
        WHERE po.status = 'RECEIVED' AND po."receivedAt" IS NOT NULL
        GROUP BY po."vendorId", v.name
        ORDER BY "avgLeadDays" ASC`
      ),

      // 3. PO PIPELINE: Open POs by status with total values
      prisma.$queryRawUnsafe<POPipelineResult[]>(
        `SELECT status::text as status, COUNT(*)::int as count,
          COALESCE(SUM(total),0)::float as value
        FROM "PurchaseOrder"
        WHERE status NOT IN ('RECEIVED','CANCELLED')
        GROUP BY status
        ORDER BY count DESC`
      ),

      // 4. MATERIAL AVAILABILITY FORECAST: Products with onHand < reorderPoint
      prisma.$queryRawUnsafe<MaterialForecastResult[]>(
        `SELECT ii.id, ii."productName", ii."onHand", ii."reorderPoint", ii."onOrder",
          ii.available, v.name as "preferredVendor"
        FROM "InventoryItem" ii
        LEFT JOIN "VendorProduct" vp ON vp."productId" = ii."productId" AND vp.preferred = true
        LEFT JOIN "Vendor" v ON v.id = vp."vendorId"
        WHERE ii."onHand" <= ii."reorderPoint" AND ii."reorderPoint" > 0
        ORDER BY (ii."onHand"::float / NULLIF(ii."reorderPoint",0)) ASC`
      ),

      // 5. VENDOR SCORECARD: Reliability based on on-time delivery, fill rate, pricing
      prisma.$queryRawUnsafe<VendorScorecardQuery[]>(
        `SELECT v.id as "vendorId", v.name as "vendorName",
          COUNT(po.id)::int as "poCount",
          COALESCE(SUM(po.total),0)::float as spend,
          AVG(EXTRACT(DAY FROM po."receivedAt" - po."createdAt"))::float as "avgLeadDays",
          v."onTimeRate"::float as "onTimeRate"
        FROM "Vendor" v
        LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v.id
          AND po.status = 'RECEIVED' AND po."receivedAt" IS NOT NULL
        WHERE v.active = true
        GROUP BY v.id, v.name, v."onTimeRate"
        ORDER BY spend DESC`
      ),

      // Total open PO value
      prisma.$queryRawUnsafe<[{ total: number }]>(
        `SELECT COALESCE(SUM(total),0)::float as total
        FROM "PurchaseOrder"
        WHERE status NOT IN ('RECEIVED','CANCELLED')`
      ),

      // All active vendors for reference
      prisma.$queryRawUnsafe<[{ id: string; name: string }]>(
        `SELECT id, name FROM "Vendor" WHERE active = true ORDER BY name ASC`
      ),
    ])

    // Calculate total spend across all vendors
    const totalSpend = vendorConcentrationResult.reduce((sum, v) => sum + v.spend, 0)
    const totalOpenPOValue = totalOpenPOResult[0]?.total || 0

    // Build vendor concentration map with percentages and risk flag
    const vendorConcentration = vendorConcentrationResult.map(v => ({
      vendorId: v.id,
      vendorName: v.name,
      poCount: v.poCount,
      spend: v.spend,
      percentOfTotal: totalSpend > 0 ? (v.spend / totalSpend) * 100 : 0,
      isHighRisk: totalSpend > 0 && (v.spend / totalSpend) > 0.4, // Flag if >40%
    }))

    // Build lead time map
    const leadTimesMap = new Map<string, { avgLeadDays: number; completedPOs: number }>()
    for (const lt of leadTimeResult) {
      leadTimesMap.set(lt.vendorId, {
        avgLeadDays: Math.round(lt.avgLeadDays * 10) / 10,
        completedPOs: lt.completedPOs,
      })
    }

    // Calculate average lead days across all vendors with completed POs
    const avgLeadDaysOverall = leadTimeResult.length > 0
      ? leadTimeResult.reduce((sum, lt) => sum + lt.avgLeadDays, 0) / leadTimeResult.length
      : 0

    // Build PO pipeline breakdown
    const poPipeline = poPipelineResult.reduce((acc, item) => {
      acc[item.status] = { count: item.count, value: item.value }
      return acc
    }, {} as Record<string, { count: number; value: number }>)

    // Material forecast: identify urgency levels
    const materialForecast = materialForecastResult.map(item => {
      const stockoutDays = item.onOrder > 0 ? 7 : 1 // Rough estimate
      let urgency: 'critical' | 'high' | 'medium' | 'low'
      if (item.onHand === 0) {
        urgency = 'critical'
      } else if (item.onHand < item.reorderPoint * 0.25) {
        urgency = 'high'
      } else if (item.onHand < item.reorderPoint * 0.5) {
        urgency = 'medium'
      } else {
        urgency = 'low'
      }

      return {
        inventoryId: item.id,
        productName: item.productName,
        onHand: item.onHand,
        reorderPoint: item.reorderPoint,
        onOrder: item.onOrder,
        available: item.available,
        preferredVendor: item.preferredVendor,
        urgency,
      }
    })

    // Build vendor scorecard with reliability score (A-F)
    const vendorScorecards = vendorScorecardResult.map(v => {
      const leadTimes = leadTimesMap.get(v.vendorId)
      const avgLeadDays = leadTimes?.avgLeadDays || v.avgLeadDays || 14

      // Simple scoring: A=90+, B=80+, C=70+, D=60+, F=<60
      // Based on: lead time (40%), on-time rate (40%), order count (20%)
      const leadTimeScore = Math.max(0, 100 - avgLeadDays * 2) // Deduct 2 points per day
      const onTimeScore = (v.onTimeRate ?? 0.85) * 100
      const orderCountScore = Math.min(100, (v.poCount / 10) * 100) // Cap at 100

      const reliabilityScore =
        leadTimeScore * 0.4 + onTimeScore * 0.4 + orderCountScore * 0.2

      let grade: 'A' | 'B' | 'C' | 'D' | 'F'
      if (reliabilityScore >= 90) grade = 'A'
      else if (reliabilityScore >= 80) grade = 'B'
      else if (reliabilityScore >= 70) grade = 'C'
      else if (reliabilityScore >= 60) grade = 'D'
      else grade = 'F'

      const percentOfTotal = totalSpend > 0 ? (v.spend / totalSpend) * 100 : 0

      return {
        vendorId: v.vendorId,
        vendorName: v.vendorName,
        poCount: v.poCount,
        totalSpend: v.spend,
        percentOfTotal,
        avgLeadDays: Math.round(avgLeadDays * 10) / 10,
        onTimeRate: v.onTimeRate ?? null,
        reliabilityScore: Math.round(reliabilityScore),
        grade,
      }
    })

    // Generate risk alerts
    const riskAlerts: RiskAlert[] = []

    // Alert: Vendor concentration >40%
    const concentrationRisks = vendorConcentration.filter(v => v.isHighRisk)
    for (const v of concentrationRisks) {
      riskAlerts.push({
        type: 'concentration',
        severity: 'high',
        title: `High Vendor Concentration: ${v.vendorName}`,
        message: `${v.vendorName} represents ${v.percentOfTotal.toFixed(1)}% of total spend (>40% threshold).`,
        affectedVendor: v.vendorName,
        metadata: { percentOfTotal: v.percentOfTotal, poCount: v.poCount },
      })
    }

    // Alert: Slow lead times (>21 days average)
    const slowVendors = vendorScorecards.filter(v => v.avgLeadDays > 21)
    for (const v of slowVendors) {
      riskAlerts.push({
        type: 'lead_time',
        severity: 'medium',
        title: `Slow Lead Time: ${v.vendorName}`,
        message: `${v.vendorName} averages ${v.avgLeadDays} days delivery (target: <=14 days).`,
        affectedVendor: v.vendorName,
        metadata: { avgLeadDays: v.avgLeadDays },
      })
    }

    // Alert: Critical stockouts
    const criticalStockouts = materialForecast.filter(m => m.urgency === 'critical')
    for (const m of criticalStockouts) {
      riskAlerts.push({
        type: 'stockout',
        severity: 'high',
        title: `Stock Depleted: ${m.productName}`,
        message: `${m.productName} is out of stock and below reorder point.`,
        affectedProduct: m.productName,
        metadata: {
          onHand: m.onHand,
          reorderPoint: m.reorderPoint,
          preferredVendor: m.preferredVendor,
        },
      })
    }

    // Alert: No data for vendors (potentially inactive or new)
    const trackedVendorIds = new Set(
      vendorConcentration.map(v => v.vendorId).concat(vendorScorecards.map(v => v.vendorId))
    )
    const untrackedVendors = allVendorsResult.filter(v => !trackedVendorIds.has(v.id))
    if (untrackedVendors.length > 0 && untrackedVendors.length <= 5) {
      for (const v of untrackedVendors) {
        riskAlerts.push({
          type: 'vendor_inactive',
          severity: 'low',
          title: `Inactive Vendor: ${v.name}`,
          message: `${v.name} has no POs in the last 12 months.`,
          affectedVendor: v.name,
        })
      }
    }

    return NextResponse.json({
      vendorConcentration,
      leadTimes: Object.fromEntries(leadTimesMap),
      poPipeline,
      materialForecast,
      vendorScorecards,
      riskAlerts,
      totalOpenPOValue,
      avgLeadDays: Math.round(avgLeadDaysOverall * 10) / 10,
      totalSpend,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error('Supply chain stats error:', error)
    return NextResponse.json(
      { error: 'Internal server error', details: String(error) },
      { status: 500 }
    )
  }
}
