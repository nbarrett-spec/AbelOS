export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { audit } from '@/lib/audit'

// Extract role from header
function getStaffRole(request: NextRequest): string | null {
  return request.headers.get('x-staff-role')
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/staff/fix-passwords — Fix employees with bad password hashes
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Staff', undefined, { method: 'POST' }).catch(() => {})

    const role = getStaffRole(request)
    if (role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Unauthorized. Only ADMIN can fix passwords.' },
        { status: 403 }
      )
    }

    // Find all staff with the literal string 'hashed_password_here'
    const brokenStaff: any[] = await (prisma as any).$queryRawUnsafe(
      `SELECT id, email, "firstName", "lastName" FROM "Staff" WHERE "passwordHash" = 'hashed_password_here'`
    )

    if (brokenStaff.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No staff members with broken passwords found',
        data: [],
      })
    }

    // Generate invite tokens for each broken staff member
    const fixedStaff = []

    for (const member of brokenStaff) {
      const inviteToken = randomUUID()
      const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      await (prisma as any).$queryRawUnsafe(
        `UPDATE "Staff" SET
          "inviteToken" = $1,
          "inviteTokenExpiry" = $2,
          "updatedAt" = NOW()
        WHERE id = $3`,
        inviteToken,
        inviteTokenExpiry,
        member.id
      )

      const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_BASE_URL || 'https://app.abellumber.com'}/ops/setup-account?token=${inviteToken}`

      fixedStaff.push({
        id: member.id,
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        inviteUrl,
        inviteToken,
        inviteTokenExpiry,
      })
    }

    return NextResponse.json({
      success: true,
      message: `Generated invite tokens for ${fixedStaff.length} staff members`,
      data: fixedStaff,
    })
  } catch (error: any) {
    console.error('Fix passwords error:', error)
    return NextResponse.json(
      { error: 'Failed to fix passwords' },
      { status: 500 }
    )
  }
}
