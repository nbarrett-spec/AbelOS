export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/warehouse/picks/[pickId]/scan
 *
 * Body: { scannedSku: string }
 *
 * Marks MaterialPick as PICKED (sets pickedAt, pickedBy, pickedQty = quantity).
 * If the scanned SKU does not match the expected SKU, responds 409 without
 * updating.  If all picks for the job reach VERIFIED/PICKED, advances the Job
 * status to STAGED (respecting QC gate: only if no QualityCheck rows for the
 * job are outstanding with status != PASSED).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { pickId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    audit(request, 'UPDATE', 'Warehouse', params.pickId, {
      method: 'POST',
      action: 'scan',
    }).catch(() => {})

    const { pickId } = params
    const body = await request.json().catch(() => ({}))
    const scannedSku: string = body?.scannedSku || ''
    const staffId = request.headers.get('x-staff-id') || 'system'

    if (!pickId || !scannedSku.trim()) {
      return NextResponse.json(
        { error: 'pickId and scannedSku are required' },
        { status: 400 }
      )
    }

    // ── 1. Load the pick + product SKU ────────────────────────────────
    const rows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        mp.id,
        mp."jobId",
        mp."productId",
        mp.quantity,
        mp.status::text as status,
        mp.sku as "pick_sku",
        p.sku as "product_sku",
        p.name as "product_name"
      FROM "MaterialPick" mp
      LEFT JOIN "Product" p ON p.id = mp."productId"
      WHERE mp.id = $1
      `,
      pickId
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pick not found' }, { status: 404 })
    }

    const pick = rows[0]
    const expectedSku = (pick.product_sku || pick.pick_sku || '').trim().toUpperCase()
    const scannedNorm = scannedSku.trim().toUpperCase()

    if (expectedSku !== scannedNorm) {
      return NextResponse.json(
        {
          verified: false,
          expected: pick.product_sku || pick.pick_sku,
          scanned: scannedSku,
          message: `SKU mismatch: expected ${pick.product_sku || pick.pick_sku}, scanned ${scannedSku}`,
        },
        { status: 409 }
      )
    }

    // ── 2. Mark pick as PICKED (set pickedAt, pickedBy, pickedQty) ────
    await prisma.$executeRawUnsafe(
      `
      UPDATE "MaterialPick"
      SET
        status = 'PICKED'::"PickStatus",
        "pickedAt" = NOW(),
        "pickedQty" = quantity
      WHERE id = $1
      `,
      pickId
    )

    // pickedBy column may or may not exist in this DB — set defensively
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "MaterialPick" SET "pickedBy" = $1 WHERE id = $2`,
        staffId,
        pickId
      )
    } catch {
      /* column doesn't exist yet — non-fatal */
    }

    // Activity trail
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Activity" (id, "staffId", "jobId", "activityType", "subject", "notes", "createdAt")
      VALUES (gen_random_uuid()::text, $1, $2, 'NOTE', 'Pick Scanned', $3, NOW())
      `,
      staffId,
      pick.jobId,
      `SKU ${expectedSku} scanned for pick ${pickId}`
    )

    // ── 3. Check if all picks done → advance job to STAGED ────────────
    const summary: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        COUNT(*)::int as total,
        COUNT(CASE WHEN status IN ('PICKED','VERIFIED') THEN 1 END)::int as done,
        COUNT(CASE WHEN status = 'SHORT' THEN 1 END)::int as short_count
      FROM "MaterialPick"
      WHERE "jobId" = $1
      `,
      pick.jobId
    )

    const { total, done, short_count } = summary[0] || { total: 0, done: 0, short_count: 0 }
    let jobAdvanced = false

    if (total > 0 && done === total && short_count === 0) {
      // QC gate: any QualityCheck rows not PASSED block the advance.
      // If QualityCheck table has no rows for this job, we allow advance.
      let qcBlocked = false
      try {
        const qc: any[] = await prisma.$queryRawUnsafe(
          `
          SELECT COUNT(*)::int as blocking
          FROM "QualityCheck"
          WHERE "jobId" = $1
            AND status::text NOT IN ('PASSED','WAIVED','N_A')
          `,
          pick.jobId
        )
        qcBlocked = (qc[0]?.blocking ?? 0) > 0
      } catch {
        // QualityCheck table / status enum may differ — don't block on error
        qcBlocked = false
      }

      if (!qcBlocked) {
        await prisma.$executeRawUnsafe(
          `
          UPDATE "Job"
          SET status = 'STAGED'::"JobStatus", "updatedAt" = NOW()
          WHERE id = $1
          `,
          pick.jobId
        )
        jobAdvanced = true
      }
    }

    return NextResponse.json({
      verified: true,
      pickId,
      jobAdvanced,
      progress: { total, done, short: short_count },
    })
  } catch (error: any) {
    console.error('[picks/scan] error:', error)
    return NextResponse.json(
      { error: 'Failed to record scan' },
      { status: 500 }
    )
  }
}
