export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { recomputeAvgDailyUsage } from '@/lib/mrp'
import { audit } from '@/lib/audit'

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { status, pickedQty } = body
    const { id } = params

    const updateFields: string[] = []
    const updateParams: any[] = [id]
    let paramIndex = 2

    if (status) {
      updateFields.push(`status = $${paramIndex}`)
      updateParams.push(status)
      paramIndex++

      if (status === 'PICKED') {
        updateFields.push(`"pickedAt" = NOW()`)
      }
      if (status === 'VERIFIED') {
        updateFields.push(`"verifiedAt" = NOW()`)
      }
    }

    if (pickedQty !== undefined) {
      updateFields.push(`"pickedQty" = $${paramIndex}`)
      updateParams.push(pickedQty)
      paramIndex++
    }

    if (updateFields.length === 0) {
      // No updates to apply, fetch and return current record
      const fetchQuery = `SELECT * FROM "MaterialPick" WHERE id = $1`
      const picks: any = await prisma.$queryRawUnsafe(fetchQuery, id)
      return NextResponse.json(picks[0] || null)
    }

    const updateQuery = `
      UPDATE "MaterialPick"
      SET ${updateFields.join(', ')}
      WHERE id = $1
      RETURNING *
    `

    const picks: any = await prisma.$queryRawUnsafe(updateQuery, ...updateParams)
    const pick = picks[0] || null

    // ── MRP: refresh rolling avgDailyUsage when consumption is recorded ──
    if (pick?.productId && (status === 'PICKED' || status === 'VERIFIED')) {
      try {
        await recomputeAvgDailyUsage(pick.productId)
      } catch (mrpErr: any) {
        console.warn('[picks PATCH] recomputeAvgDailyUsage failed:', mrpErr?.message)
      }
    }

    await audit(request, 'UPDATE', 'MaterialPick', id, { status, pickedQty })

    return NextResponse.json(pick)
  } catch (error) {
    console.error('Pick update error:', error)
    return NextResponse.json(
      { error: 'Failed to update pick' },
      { status: 500 }
    )
  }
}
