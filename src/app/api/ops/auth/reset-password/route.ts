export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { signupResetLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'

// POST /api/ops/auth/reset-password — validate token and set new password for staff
export async function POST(request: NextRequest) {
  // A-SEC-7: 5/min/IP for staff reset — same logic as builder side; raises
  // brute-force cost on the staff token namespace.
  const limited = await checkRateLimit(request, signupResetLimiter, 5, 'ops-reset-password')
  if (limited) return limited

  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Find staff with valid reset token
    const staffRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "firstName", "resetTokenExpiry"
       FROM "Staff"
       WHERE "resetToken" = $1
       LIMIT 1`,
      token
    )

    if (staffRows.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    const staff = staffRows[0]

    // Check if token has expired
    if (staff.resetTokenExpiry && new Date(staff.resetTokenExpiry) < new Date()) {
      // Clear the expired token
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET "resetToken" = NULL, "resetTokenExpiry" = NULL WHERE "id" = $1`,
        staff.id
      )
      return NextResponse.json(
        { error: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // Hash the new password
    const passwordHash = await bcrypt.hash(password, 12)

    // Update password and clear reset token
    await prisma.$executeRawUnsafe(
      `UPDATE "Staff"
       SET "passwordHash" = $1, "resetToken" = NULL, "resetTokenExpiry" = NULL, "updatedAt" = NOW()
       WHERE "id" = $2`,
      passwordHash,
      staff.id
    )

    // Audit: CRITICAL — password was actually changed via the token flow.
    logAudit({
      staffId: staff.id,
      staffName: staff.firstName,
      action: 'RESET_PASSWORD',
      entity: 'Staff',
      entityId: staff.id,
      ipAddress:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'CRITICAL',
    }).catch(() => {})

    return NextResponse.json({
      message: 'Password reset successfully. You can now sign in with your new password.',
    })
  } catch (error: any) {
    console.error('Staff reset password error:', error)
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
