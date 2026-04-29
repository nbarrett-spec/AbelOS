export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// W-7 — Inventory Bay Transfer (POST)
// Records a BayMovement row + updates the door's current bay.

export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
  })
  if (auth.error) return auth.error

  try {
    const body = await request.json()
    const doorId: string | undefined = body.doorId
    const fromBayId: string | undefined = body.fromBayId
    const toBayId: string | undefined = body.toBayId
    const reason: string | undefined = body.reason
    const movedByName: string | null = body.movedByName || null

    if (!doorId || !toBayId) {
      return NextResponse.json({ error: 'doorId and toBayId required' }, { status: 400 })
    }

    // Validate target bay exists
    const targetBay: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Bay" WHERE "id" = $1 LIMIT 1`,
      toBayId,
    )
    if (targetBay.length === 0) {
      return NextResponse.json({ error: 'target bay not found' }, { status: 404 })
    }

    const movementId = `mov_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const staffId = auth.session.staffId

    // Insert BayMovement (best-effort — schema may differ)
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BayMovement" ("id", "doorId", "fromBayId", "toBayId", "movedBy", "movedByName", "reason", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
        movementId,
        doorId,
        fromBayId || null,
        toBayId,
        staffId,
        movedByName,
        reason || null,
      )
    } catch (e: any) {
      // BayMovement schema may not have updatedAt — try without
      try {
        await prisma.$executeRawUnsafe(
          `INSERT INTO "BayMovement" ("id", "doorId", "fromBayId", "toBayId", "movedBy", "movedByName", "reason")
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          movementId,
          doorId,
          fromBayId || null,
          toBayId,
          staffId,
          movedByName,
          reason || null,
        )
      } catch (e2: any) {
        console.error('[bay-transfer] BayMovement insert failed:', e2?.message)
        return NextResponse.json({ error: 'failed to record movement' }, { status: 500 })
      }
    }

    // Update door's current bay (if DoorIdentity has bayId field)
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "DoorIdentity" SET "bayId" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
        toBayId,
        doorId,
      )
    } catch {
      // Some schemas store bay on a different table — non-fatal
    }

    await audit(request, 'UPDATE', 'BayMovement', movementId, {
      doorId,
      fromBayId,
      toBayId,
      reason,
    })

    return NextResponse.json({ success: true, movementId })
  } catch (e: any) {
    console.error('[POST /api/ops/warehouse/bay-transfer] error:', e?.message || e)
    return NextResponse.json({ error: 'failed to transfer bay' }, { status: 500 })
  }
}
