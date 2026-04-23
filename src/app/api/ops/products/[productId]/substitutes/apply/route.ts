export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/products/[productId]/substitutes/apply
//
// Body: {
//   jobId: string,                     // required
//   substituteProductId: string,       // required — must be an active sub for productId
//   quantity: number,                  // required, > 0
//   allocationId?: string,             // optional — an existing allocation row
// }
//
// Behavior:
//   - If allocationId is provided AND status is RESERVED/BACKORDERED:
//       * Mark the existing allocation RELEASED with a note
//       * Create a NEW allocation against the substitute product
//   - If no allocationId is provided (pre-allocation phase):
//       * Simply create a new allocation against the substitute
//
// This keeps the ledger clean — the original demand record is preserved in
// RELEASED state so audit can reconstruct the swap after the fact.
// ──────────────────────────────────────────────────────────────────────────

interface Body {
  jobId?: string
  substituteProductId?: string
  quantity?: number
  allocationId?: string
}

export async function POST(
  request: NextRequest,
  { params }: { params: { productId: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { productId } = params
  let body: Body
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { jobId, substituteProductId, quantity, allocationId } = body
  if (!jobId || !substituteProductId || !quantity || quantity <= 0) {
    return NextResponse.json(
      { error: 'jobId, substituteProductId and quantity (>0) are required' },
      { status: 400 }
    )
  }

  try {
    // Verify the substitute is actually a valid substitute for productId
    const match: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "substitutionType", "conditions"
         FROM "ProductSubstitution"
        WHERE "primaryProductId" = $1
          AND "substituteProductId" = $2
          AND active = true
        LIMIT 1`,
      productId,
      substituteProductId
    )
    if (match.length === 0) {
      return NextResponse.json(
        { error: 'Substitute is not registered for this primary product' },
        { status: 400 }
      )
    }

    const staffId = request.headers.get('x-staff-id') ?? 'system'
    const note = `Substitute applied (from ${productId}) — ${match[0].substitutionType}${
      match[0].conditions ? ` — ${match[0].conditions}` : ''
    }`

    const result = await prisma.$transaction(async (tx) => {
      let releasedId: string | null = null
      if (allocationId) {
        const existing: any[] = await tx.$queryRawUnsafe(
          `SELECT id, status, quantity, "productId", "jobId"
             FROM "InventoryAllocation"
            WHERE id = $1
            LIMIT 1`,
          allocationId
        )
        if (existing.length > 0) {
          const alloc = existing[0]
          if (alloc.jobId !== jobId) {
            throw new Error(`allocationId ${allocationId} belongs to a different job`)
          }
          if (['RESERVED', 'BACKORDERED'].includes(alloc.status)) {
            await tx.$executeRawUnsafe(
              `UPDATE "InventoryAllocation"
                  SET status = 'RELEASED',
                      "releasedAt" = NOW(),
                      notes = COALESCE(notes || E'\\n', '') || $2,
                      "updatedAt" = NOW()
                WHERE id = $1`,
              allocationId,
              `Released for substitute: ${substituteProductId}`
            )
            releasedId = allocationId
          }
        }
      }

      // Create the new allocation against the substitute product.
      const newAlloc: any[] = await tx.$queryRawUnsafe(
        `INSERT INTO "InventoryAllocation"
           ("productId", "jobId", quantity, "allocationType", status, "allocatedBy", notes, "allocatedAt")
         VALUES ($1, $2, $3, 'SUBSTITUTE', 'RESERVED', $4, $5, NOW())
         RETURNING id, status, quantity, "productId", "jobId"`,
        substituteProductId,
        jobId,
        quantity,
        staffId,
        note
      )

      return { releasedId, newAllocation: newAlloc[0] }
    })

    return NextResponse.json({
      ok: true,
      ...result,
    })
  } catch (err: any) {
    console.error('[substitutes/apply POST]', err)
    return NextResponse.json(
      { error: 'Failed to apply substitute', details: err?.message },
      { status: 500 }
    )
  }
}
