export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// PATCH /api/ops/lien-releases/[id] — Update lien release (issue, sign, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { status, issuedDate, signedDate, signedBy, signatureData, documentUrl, notes, amount, throughDate } = body

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const values: any[] = []
    let paramIdx = 1

    if (status !== undefined) { setClauses.push(`"status" = $${paramIdx++}`); values.push(status) }
    if (issuedDate !== undefined) { setClauses.push(`"issuedDate" = $${paramIdx++}::date`); values.push(issuedDate) }
    if (signedDate !== undefined) { setClauses.push(`"signedDate" = $${paramIdx++}::date`); values.push(signedDate) }
    if (signedBy !== undefined) { setClauses.push(`"signedBy" = $${paramIdx++}`); values.push(signedBy) }
    if (signatureData !== undefined) { setClauses.push(`"signatureData" = $${paramIdx++}`); values.push(signatureData) }
    if (documentUrl !== undefined) { setClauses.push(`"documentUrl" = $${paramIdx++}`); values.push(documentUrl) }
    if (notes !== undefined) { setClauses.push(`"notes" = $${paramIdx++}`); values.push(notes) }
    if (amount !== undefined) { setClauses.push(`"amount" = $${paramIdx++}`); values.push(amount) }
    if (throughDate !== undefined) { setClauses.push(`"throughDate" = $${paramIdx++}::date`); values.push(throughDate) }

    // Auto-set issuedDate when status = ISSUED
    if (status === 'ISSUED') {
      setClauses.push(`"issuedDate" = COALESCE("issuedDate", CURRENT_DATE)`)
    }
    // Auto-set signedDate when status = SIGNED
    if (status === 'SIGNED') {
      setClauses.push(`"signedDate" = COALESCE("signedDate", CURRENT_DATE)`)
    }

    const result: any[] = await prisma.$queryRawUnsafe(
      `UPDATE "LienRelease" SET ${setClauses.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      ...values, params.id
    )

    if (result.length === 0) {
      return NextResponse.json({ error: 'Lien release not found' }, { status: 404 })
    }

    return NextResponse.json({ release: result[0] })
  } catch (error: any) {
    console.error('[LienRelease PATCH]', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
