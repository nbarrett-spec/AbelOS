export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface JobMaterialLine {
  productId: string
  sku: string
  name: string
  category: string | null
  quantity: number
  onHand: number
  available: number
  committed: number
  status: 'OK' | 'SHORT' | 'NEEDS_PO'
  shortBy: number
  preferredVendor: { name: string; leadTimeDays: number | null } | null
}

/**
 * GET /api/ops/mrp/job-materials/[jobId]
 *
 * Returns the BOM-expanded material requirement list for a single job, with
 * per-line readiness status. Used by the job-detail page and T-72 readiness check.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params

  try {
    // Job header
    const jobs = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        jobNumber: string
        status: string
        scheduledDate: Date | null
        builderName: string
        community: string | null
        lotBlock: string | null
      }>
    >(
      `SELECT "id", "jobNumber", "status", "scheduledDate", "builderName", "community", "lotBlock"
       FROM "Job" WHERE "id" = $1`,
      jobId
    )

    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }
    const job = jobs[0]

    // BOM-expanded line items for this job
    const lines = await prisma.$queryRawUnsafe<
      Array<{
        productId: string
        sku: string
        name: string
        category: string | null
        quantity: number
        onHand: number
        committed: number
        available: number
        vendorName: string | null
        leadTimeDays: number | null
      }>
    >(
      `
      WITH RECURSIVE
      job_demand AS (
        SELECT oi."productId" as product_id, oi."quantity"::float as qty, 0 as depth
        FROM "Job" j
        JOIN "OrderItem" oi ON oi."orderId" = j."orderId"
        WHERE j."id" = $1

        UNION ALL

        SELECT b."componentId", jd.qty * b."quantity", jd.depth + 1
        FROM job_demand jd
        JOIN "BomEntry" b ON b."parentId" = jd.product_id
        WHERE jd.depth < 4
      ),
      has_children AS (
        SELECT DISTINCT "parentId" as product_id FROM "BomEntry"
      ),
      aggregated AS (
        SELECT
          jd.product_id,
          SUM(jd.qty) as total_qty
        FROM job_demand jd
        LEFT JOIN has_children hc ON hc.product_id = jd.product_id
        WHERE hc.product_id IS NULL OR jd.depth > 0
        GROUP BY jd.product_id
      )
      SELECT
        a.product_id as "productId",
        p."sku" as sku,
        p."name" as name,
        p."category" as category,
        a.total_qty::int as quantity,
        COALESCE(i."onHand", 0)::int as "onHand",
        COALESCE(i."committed", 0)::int as committed,
        COALESCE(i."onHand", 0)::int - COALESCE(i."committed", 0)::int as available,
        v."name" as "vendorName",
        vp."leadTimeDays" as "leadTimeDays"
      FROM aggregated a
      JOIN "Product" p ON p."id" = a.product_id
      LEFT JOIN "InventoryItem" i ON i."productId" = a.product_id
      LEFT JOIN LATERAL (
        SELECT vp.* FROM "VendorProduct" vp
        WHERE vp."productId" = a.product_id
        ORDER BY vp."preferred" DESC NULLS LAST
        LIMIT 1
      ) vp ON true
      LEFT JOIN "Vendor" v ON v."id" = vp."vendorId"
      ORDER BY p."name"
      `,
      jobId
    )

    const materials: JobMaterialLine[] = lines.map((l) => {
      let status: JobMaterialLine['status'] = 'OK'
      let shortBy = 0
      if (l.available < l.quantity) {
        shortBy = l.quantity - l.available
        status = l.onHand >= l.quantity ? 'OK' : 'SHORT'
        if (l.onHand < l.quantity) status = 'NEEDS_PO'
      }
      return {
        productId: l.productId,
        sku: l.sku,
        name: l.name,
        category: l.category,
        quantity: l.quantity,
        onHand: l.onHand,
        available: l.available,
        committed: l.committed,
        status,
        shortBy,
        preferredVendor: l.vendorName
          ? { name: l.vendorName, leadTimeDays: l.leadTimeDays }
          : null,
      }
    })

    const summary = {
      totalLines: materials.length,
      okLines: materials.filter((m) => m.status === 'OK').length,
      shortLines: materials.filter((m) => m.status === 'SHORT').length,
      needsPoLines: materials.filter((m) => m.status === 'NEEDS_PO').length,
      readyForLock: materials.every((m) => m.status === 'OK'),
    }

    return NextResponse.json({
      job,
      summary,
      materials,
    })
  } catch (error: any) {
    console.error('[mrp/job-materials] error:', error)
    return NextResponse.json(
      { error: 'Failed to compute job materials', details: String(error?.message || error) },
      { status: 500 }
    )
  }
}
