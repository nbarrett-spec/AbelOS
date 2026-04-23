export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/warehouse/picks/[pickId]/short
 *
 * Body: { reason?: string, shortQty?: number }
 *
 * Marks the MaterialPick status=SHORT and opens an InboxItem of type
 * "SHORT_PICK" for purchasing to re-order the shortfall.
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
      action: 'short',
    }).catch(() => {})

    const { pickId } = params
    const body = await request.json().catch(() => ({}))
    const reason: string = (body?.reason || '').toString().trim() || 'Warehouse short-pick'
    const shortQty: number | null =
      typeof body?.shortQty === 'number' && body.shortQty > 0 ? body.shortQty : null
    const staffId = request.headers.get('x-staff-id') || 'system'

    if (!pickId) {
      return NextResponse.json({ error: 'pickId is required' }, { status: 400 })
    }

    // ── 1. Load the pick ──────────────────────────────────────────────
    const rows: any[] = await prisma.$queryRawUnsafe(
      `
      SELECT
        mp.id,
        mp."jobId",
        mp."productId",
        mp.sku,
        mp.description,
        mp.quantity,
        mp."pickedQty",
        mp.status::text as status,
        j."jobNumber",
        j."builderName"
      FROM "MaterialPick" mp
      LEFT JOIN "Job" j ON j.id = mp."jobId"
      WHERE mp.id = $1
      `,
      pickId
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Pick not found' }, { status: 404 })
    }

    const pick = rows[0]
    const shortfall = shortQty ?? Math.max(0, (pick.quantity ?? 0) - (pick.pickedQty ?? 0))

    // ── 2. Mark pick as SHORT with reason in notes ────────────────────
    await prisma.$executeRawUnsafe(
      `
      UPDATE "MaterialPick"
      SET
        status = 'SHORT'::"PickStatus",
        notes = COALESCE(notes, '') || CASE WHEN notes IS NULL OR notes = '' THEN '' ELSE E'\\n' END || $1
      WHERE id = $2
      `,
      `SHORT: ${reason} (shortfall ${shortfall})`,
      pickId
    )

    // ── 3. Open InboxItem for purchasing ──────────────────────────────
    const title = `Short-pick: ${pick.sku} on ${pick.jobNumber ?? pick.jobId}`
    const description = `${pick.description || pick.sku} — need ${pick.quantity}, short by ${shortfall}.  Reason: ${reason}.  Builder: ${pick.builderName || 'unknown'}.`

    const inbox: any[] = await prisma.$queryRawUnsafe(
      `
      INSERT INTO "InboxItem"
        (id, type, source, title, description, priority, status,
         "entityType", "entityId", "actionData", "createdAt", "updatedAt")
      VALUES
        (gen_random_uuid()::text, 'SHORT_PICK', 'warehouse-pick-scanner',
         $1, $2, 'HIGH', 'PENDING',
         'MaterialPick', $3, $4::jsonb, NOW(), NOW())
      RETURNING id
      `,
      title,
      description,
      pickId,
      JSON.stringify({
        pickId,
        jobId: pick.jobId,
        jobNumber: pick.jobNumber,
        productId: pick.productId,
        sku: pick.sku,
        needed: pick.quantity,
        shortfall,
        reason,
        reportedBy: staffId,
      })
    )

    // ── 4. Activity trail ─────────────────────────────────────────────
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Activity" (id, "staffId", "jobId", "activityType", "subject", "notes", "createdAt")
      VALUES (gen_random_uuid()::text, $1, $2, 'NOTE', 'Pick Short', $3, NOW())
      `,
      staffId,
      pick.jobId,
      `Pick ${pickId} (${pick.sku}) marked SHORT by ${staffId}. Shortfall ${shortfall}. Reason: ${reason}`
    )

    return NextResponse.json({
      success: true,
      pickId,
      inboxItemId: inbox[0]?.id ?? null,
      shortfall,
    })
  } catch (error: any) {
    console.error('[picks/short] error:', error)
    return NextResponse.json(
      { error: 'Failed to mark short' },
      { status: 500 }
    )
  }
}
