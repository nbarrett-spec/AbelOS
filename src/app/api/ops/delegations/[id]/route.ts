export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { safeJson } from '@/lib/safe-json'
import { audit } from '@/lib/audit'

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Delegation', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const { status, endDate, notes, scope, reason } = body
    const id = params.id

    const updates: string[] = []
    const values: any[] = []
    let paramIdx = 1

    if (status) { updates.push(`status = $${paramIdx++}`); values.push(status) }
    if (endDate) { updates.push(`"endDate" = $${paramIdx++}`); values.push(new Date(endDate)) }
    if (notes !== undefined) { updates.push(`notes = $${paramIdx++}`); values.push(notes) }
    if (scope) { updates.push(`scope = $${paramIdx++}`); values.push(scope) }
    if (reason) { updates.push(`reason = $${paramIdx++}`); values.push(reason) }
    updates.push(`"updatedAt" = NOW()`)

    if (updates.length <= 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    values.push(id)
    const result = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "WorkloadDelegation" SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      ...values
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Delegation not found' }, { status: 404 })
    }

    return safeJson({ delegation: result[0], message: 'Delegation updated' })
  } catch (error: any) {
    console.error('Delegation PATCH error:', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'DELETE', 'Delegation', undefined, { method: 'DELETE' }).catch(() => {})

    const result = await prisma.$queryRawUnsafe<any[]>(
      `UPDATE "WorkloadDelegation" SET status = 'CANCELLED', "updatedAt" = NOW() WHERE id = $1 RETURNING id`,
      params.id
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Delegation not found' }, { status: 404 })
    }

    return safeJson({ message: 'Delegation cancelled' })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
