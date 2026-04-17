export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/staff/[id]/reset-password — Admin resets a staff member's password
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Staff', undefined, { method: 'POST' }).catch(() => {})

    const staffId = params.id

    // Check the target staff member exists
    const staffRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "firstName", "lastName", "email" FROM "Staff" WHERE "id" = $1`,
      staffId
    )

    if (staffRows.length === 0) {
      return NextResponse.json({ error: 'Staff member not found' }, { status: 404 })
    }

    const staff = staffRows[0]

    // Generate random 12-char temporary password
    const tempPassword = crypto.randomBytes(8).toString('base64url').slice(0, 12)
    const passwordHash = await hashPassword(tempPassword)

    await prisma.$executeRawUnsafe(
      `UPDATE "Staff" SET "passwordHash" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      passwordHash,
      staffId
    )

    return NextResponse.json({
      message: 'Password reset successfully',
      temporaryPassword: tempPassword,
    })
  } catch (error: any) {
    console.error('Reset staff password error:', error)
    return NextResponse.json({ error: 'Failed to reset password' }, { status: 500 })
  }
}
