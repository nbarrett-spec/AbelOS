export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { logger, getRequestId } from '@/lib/logger'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'

// POST /api/auth/reset-password — validate token and set new password
export async function POST(request: NextRequest) {
  // Rate limit by IP — stops token brute-force and mass-reset abuse
  const limited = await checkRateLimit(request, authLimiter, 10, 'reset-password')
  if (limited) return limited

  const requestId = getRequestId(request)
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

    // Find builder with valid reset token
    const builders: any[] = await prisma.$queryRaw`
      SELECT "id", "email", "contactName", "resetTokenExpiry"
      FROM "Builder"
      WHERE "resetToken" = ${token}
      LIMIT 1
    ` as any[]

    if (builders.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired reset link. Please request a new one.' },
        { status: 400 }
      )
    }

    const builder = builders[0]

    // Check if token has expired
    if (builder.resetTokenExpiry && new Date(builder.resetTokenExpiry) < new Date()) {
      // Clear the expired token
      await prisma.$queryRaw`
        UPDATE "Builder"
        SET "resetToken" = NULL, "resetTokenExpiry" = NULL
        WHERE "id" = ${builder.id}
      `
      return NextResponse.json(
        { error: 'This reset link has expired. Please request a new one.' },
        { status: 400 }
      )
    }

    // Hash the new password
    const passwordHash = await hashPassword(password)

    // Update password and clear reset token
    await prisma.$queryRaw`
      UPDATE "Builder"
      SET "passwordHash" = ${passwordHash},
          "resetToken" = NULL,
          "resetTokenExpiry" = NULL
      WHERE "id" = ${builder.id}
    `

    return NextResponse.json({
      message: 'Password reset successfully. You can now sign in with your new password.',
    })
  } catch (error: any) {
    logger.error('reset_password_error', error, { requestId })
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
