export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { pickFromJob } from '@/lib/allocation/pick'

/**
 * POST /api/ops/warehouse/picks/[jobId]/mark-picked
 *
 * Body: { lines: [{ productId, qty, pickedBy?: staffId }] }
 *
 * Flips RESERVED → PICKED allocations per line via pickFromJob(), which also
 * recomputes InventoryItem.committed. If every allocation for this Job is now
 * PICKED (zero RESERVED remaining), flag Job.pickListGenerated = true so the
 * downstream staging/delivery views know this job's material is pulled.
 *
 * One audit row per pick line so we can trace who pulled what.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { jobId } = params
  if (!jobId) {
    return NextResponse.json({ error: 'jobId is required' }, { status: 400 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const rawLines = Array.isArray(body?.lines) ? body.lines : []
  const lines = rawLines
    .map((l: any) => ({
      productId: String(l?.productId || '').trim(),
      qty: Number(l?.qty),
      pickedBy: l?.pickedBy ? String(l.pickedBy) : null,
    }))
    .filter((l: any) => l.productId && Number.isFinite(l.qty) && l.qty > 0)

  if (lines.length === 0) {
    return NextResponse.json(
      { error: 'No valid pick lines provided. Each line needs productId + qty > 0.' },
      { status: 400 }
    )
  }

  const staffId = request.headers.get('x-staff-id') || 'system'

  // Confirm the Job exists before we start flipping allocations.
  const jobRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "jobNumber", "builderName" FROM "Job" WHERE id = $1 LIMIT 1`,
    jobId
  )
  if (jobRows.length === 0) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 })
  }
  const job = jobRows[0]

  const results: any[] = []
  for (const line of lines) {
    try {
      const r = await pickFromJob(jobId, line.productId, line.qty)
      results.push({
        productId: line.productId,
        qtyRequested: line.qty,
        qtyPicked: r.quantityPicked,
        remainingReserved: r.remainingReservedAfter,
        reason: r.reason,
        ok: r.quantityPicked > 0,
      })

      // One audit row per line so Dawn / Nate can replay what Gunner did.
      await audit(request, 'PICK', 'InventoryAllocation', r.newAllocationRowId || `${jobId}:${line.productId}`, {
        jobId,
        jobNumber: job.jobNumber,
        productId: line.productId,
        qtyRequested: line.qty,
        qtyPicked: r.quantityPicked,
        remainingReserved: r.remainingReservedAfter,
        pickedBy: line.pickedBy || staffId,
        reason: r.reason,
      }).catch(() => {})
    } catch (e: any) {
      results.push({
        productId: line.productId,
        qtyRequested: line.qty,
        qtyPicked: 0,
        ok: false,
        reason: e?.message || 'pick_failed',
      })
    }
  }

  // If no RESERVED rows remain for this Job, flip pickListGenerated = true.
  // Any subsequent call will idempotently set it again.
  let allPicked = false
  try {
    const remainingRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int AS remaining
         FROM "InventoryAllocation"
        WHERE "jobId" = $1 AND status = 'RESERVED'`,
      jobId
    )
    const remaining = Number(remainingRows[0]?.remaining ?? 0)
    if (remaining === 0) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
            SET "pickListGenerated" = TRUE, "updatedAt" = NOW()
          WHERE id = $1`,
        jobId
      )
      allPicked = true
      await audit(request, 'PICK_COMPLETE', 'Job', jobId, {
        jobNumber: job.jobNumber,
        builderName: job.builderName,
        totalLines: lines.length,
      }).catch(() => {})
    }
  } catch (e: any) {
    console.warn('[picks/mark-picked] flagging pickListGenerated failed:', e?.message)
  }

  return NextResponse.json({
    jobId,
    jobNumber: job.jobNumber,
    lines: results,
    allPicked,
    pickedCount: results.filter((r: any) => r.ok).length,
    failedCount: results.filter((r: any) => !r.ok).length,
  })
}
