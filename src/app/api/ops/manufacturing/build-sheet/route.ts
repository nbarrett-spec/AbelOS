export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'

/**
 * GET /api/ops/manufacturing/build-sheet?jobId=xxx
 *
 * Returns a complete build sheet for a job:
 * - Job header (number, builder, community, dates)
 * - Order line items (what was ordered)
 * - BOM-expanded pick list grouped by parent product (assembly units)
 * - Inventory status per component
 * - QC checks completed
 * - Validation gate status
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const jobId = searchParams.get('jobId')

    if (!jobId) {
      return NextResponse.json({ error: 'jobId query parameter required' }, { status: 400 })
    }

    // ── Job header ─────────────────────────────────────────────────────
    const jobs: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        j.id, j."jobNumber", j."builderName", j.community, j."lotBlock",
        j."jobAddress", j."scopeType"::text as "scopeType", j."dropPlan",
        j.status::text as status, j."scheduledDate", j."orderId",
        j."readinessCheck", j."materialsLocked", j."loadConfirmed",
        j."pickListGenerated", j."allMaterialsAllocated", j."qcRequired",
        j."buildSheetNotes", j."assignedPMId",
        j."createdAt", j."updatedAt",
        s."firstName" || ' ' || s."lastName" as "pmName"
      FROM "Job" j
      LEFT JOIN "Staff" s ON j."assignedPMId" = s.id
      WHERE j.id = $1
    `, jobId)

    if (jobs.length === 0) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404 })
    }

    const job = jobs[0]

    // ── Order items (what was ordered) ─────────────────────────────────
    let orderItems: any[] = []
    if (job.orderId) {
      orderItems = await prisma.$queryRawUnsafe(`
        SELECT
          oi.id, oi."productId", oi.description, oi.quantity, oi."unitPrice", oi."lineTotal",
          p.sku, p.name as "productName", p.category, p."doorSize", p.handing,
          p."coreType", p."panelStyle", p."jambSize", p."casingCode",
          p."hardwareFinish", p.material, p."fireRating", p."imageUrl"
        FROM "OrderItem" oi
        JOIN "Product" p ON oi."productId" = p.id
        WHERE oi."orderId" = $1
        ORDER BY oi.id
      `, job.orderId)
    }

    // ── Material picks grouped by parent product ───────────────────────
    const picks: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        mp.id, mp."productId", mp.sku, mp.description, mp.quantity,
        mp."pickedQty", mp.status::text as status, mp.zone,
        mp."orderItemId", mp."bomEntryId", mp."parentProductId",
        mp."pickedAt", mp."verifiedAt", mp."allocationId",
        mp."createdAt",
        ii."onHand" as "invOnHand", ii."available" as "invAvailable",
        ii."warehouseZone" as "invZone", ii."binLocation" as "invBin"
      FROM "MaterialPick" mp
      LEFT JOIN "InventoryItem" ii ON ii."productId" = mp."productId"
      WHERE mp."jobId" = $1
      ORDER BY mp."parentProductId" NULLS LAST, mp."bomEntryId", mp.sku
    `, jobId)

    // Group picks by parent product (assembly unit)
    const assemblyGroups: Record<string, { parent: any; components: any[] }> = {}
    const directPicks: any[] = []

    for (const pick of picks) {
      if (pick.parentProductId) {
        if (!assemblyGroups[pick.parentProductId]) {
          // Find the order item for this parent
          const orderItem = orderItems.find(oi => oi.productId === pick.parentProductId)
          assemblyGroups[pick.parentProductId] = {
            parent: {
              productId: pick.parentProductId,
              sku: orderItem?.sku || 'N/A',
              name: orderItem?.productName || orderItem?.description || 'Unknown Product',
              orderQty: orderItem?.quantity || 0,
              doorSize: orderItem?.doorSize,
              handing: orderItem?.handing,
              coreType: orderItem?.coreType,
              panelStyle: orderItem?.panelStyle,
              jambSize: orderItem?.jambSize,
              imageUrl: orderItem?.imageUrl,
            },
            components: [],
          }
        }
        assemblyGroups[pick.parentProductId].components.push(pick)
      } else {
        directPicks.push(pick)
      }
    }

    // ── QC checks ──────────────────────────────────────────────────────
    const qcChecks: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        qc.id, qc."checkType"::text as "checkType", qc.result::text as result,
        qc.notes, qc."defectCodes", qc.photos, qc."createdAt",
        s."firstName" || ' ' || s."lastName" as "inspectorName"
      FROM "QualityCheck" qc
      JOIN "Staff" s ON qc."inspectorId" = s.id
      WHERE qc."jobId" = $1
      ORDER BY qc."createdAt" DESC
    `, jobId)

    // ── Validation gate status ─────────────────────────────────────────
    const totalPicks = picks.length
    const shortPicks = picks.filter(p => p.status === 'SHORT').length
    const pendingPicks = picks.filter(p => p.status === 'PENDING').length
    const pickingPicks = picks.filter(p => p.status === 'PICKING').length
    const pickedPicks = picks.filter(p => p.status === 'PICKED').length
    const verifiedPicks = picks.filter(p => p.status === 'VERIFIED').length

    const hasPreProductionQC = qcChecks.some(qc =>
      ['PRE_PRODUCTION', 'IN_PROCESS'].includes(qc.checkType) &&
      ['PASS', 'CONDITIONAL_PASS'].includes(qc.result)
    )
    const hasFinalUnitQC = qcChecks.some(qc =>
      qc.checkType === 'FINAL_UNIT' &&
      ['PASS', 'CONDITIONAL_PASS'].includes(qc.result)
    )
    const hasPreDeliveryQC = qcChecks.some(qc =>
      qc.checkType === 'PRE_DELIVERY' &&
      ['PASS', 'CONDITIONAL_PASS'].includes(qc.result)
    )

    const gates = {
      pickListGenerated: job.pickListGenerated || false,
      allMaterialsAllocated: shortPicks === 0 && totalPicks > 0,
      allPicksVerified: verifiedPicks === totalPicks && totalPicks > 0,
      preProductionQCPassed: hasPreProductionQC,
      finalUnitQCPassed: hasFinalUnitQC,
      preDeliveryQCPassed: hasPreDeliveryQC,
    }

    return safeJson({
      job,
      orderItems,
      assemblyGroups: Object.values(assemblyGroups),
      directPicks,
      pickSummary: {
        total: totalPicks,
        short: shortPicks,
        pending: pendingPicks,
        picking: pickingPicks,
        picked: pickedPicks,
        verified: verifiedPicks,
        percentComplete: totalPicks > 0 ? Math.round((verifiedPicks / totalPicks) * 100) : 0,
      },
      qcChecks,
      gates,
    })
  } catch (error: any) {
    console.error('[Build Sheet API] Error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch build sheet', details: error.message },
      { status: 500 }
    )
  }
}
