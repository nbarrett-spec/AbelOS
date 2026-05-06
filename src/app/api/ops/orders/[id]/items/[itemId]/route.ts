export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/orders/[id]/items/[itemId]
//
// Update mutable fields on an OrderItem. Currently supports:
//   • doorMaterial — strike-type spec for dunnage / Final Front items
//                    (WOOD | FIBERGLASS | METAL | null to clear)
//
// Validation:
//   • Item must belong to the order in the URL.
//   • doorMaterial must be one of the DoorMaterial enum values.
//
// Audit: every change is logged via the standard audit() helper so we can
// trace "who set strike type WOOD on order X line Y".
// ──────────────────────────────────────────────────────────────────────────

interface RouteParams {
  params: { id: string; itemId: string }
}

const DOOR_MATERIALS = new Set(['WOOD', 'FIBERGLASS', 'METAL'])

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id: orderId, itemId } = params
    const body = await request.json()
    const { doorMaterial } = body

    // Confirm the line belongs to this order.
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "orderId", "doorMaterial"::text AS "doorMaterial"
       FROM "OrderItem" WHERE "id" = $1 AND "orderId" = $2`,
      itemId, orderId,
    )
    if (rows.length === 0) {
      return NextResponse.json({ error: 'Order item not found' }, { status: 404 })
    }
    const previous = rows[0]

    const setClauses: string[] = []

    // doorMaterial — accept WOOD | FIBERGLASS | METAL, or null/'' to clear.
    if (doorMaterial !== undefined) {
      if (doorMaterial === null || doorMaterial === '') {
        setClauses.push(`"doorMaterial" = NULL`)
      } else if (DOOR_MATERIALS.has(doorMaterial)) {
        setClauses.push(`"doorMaterial" = '${doorMaterial}'::"DoorMaterial"`)
      } else {
        return NextResponse.json(
          { error: `Invalid doorMaterial: ${doorMaterial}. Must be WOOD, FIBERGLASS, or METAL.` },
          { status: 400 },
        )
      }
    }

    if (setClauses.length === 0) {
      return NextResponse.json({ error: 'No mutable fields supplied' }, { status: 400 })
    }

    await prisma.$executeRawUnsafe(
      `UPDATE "OrderItem" SET ${setClauses.join(', ')} WHERE "id" = $1`,
      itemId,
    )

    await audit(request, 'UPDATE', 'OrderItem', itemId, {
      orderId,
      ...(doorMaterial !== undefined && {
        doorMaterial: { from: previous.doorMaterial, to: doorMaterial || null },
      }),
    })

    const updatedRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "orderId", "productId", "description", "quantity",
              "unitPrice", "lineTotal",
              "doorMaterial"::text AS "doorMaterial"
       FROM "OrderItem" WHERE "id" = $1`,
      itemId,
    )

    return NextResponse.json(updatedRows[0] || {})
  } catch (error: any) {
    console.error('PATCH /api/ops/orders/[id]/items/[itemId] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
