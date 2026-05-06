export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { logger, getRequestId } from '@/lib/logger'
import { signupResetLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logAudit } from '@/lib/audit'

// Fire-and-forget audit call. logAudit() internally try/catches + returns ''
// on any failure, and we attach .catch(() => {}) defensively so a rejected
// promise can never bubble up and break the auth response. Audit logging
// MUST NOT fail the request. Not awaited — keeps response timing unchanged.
const mask = (e: string) => {
  const [u, d] = (e || '').split('@')
  if (!d) return '***'
  return u.length <= 2 ? '***@' + d : u.slice(0, 2) + '***@' + d
}
function getIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

// POST /api/auth/reset-password — validate token and set new password
export async function POST(request: NextRequest) {
  const ipAddress = getIp(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'

  // Rate limit by IP — stops token brute-force and mass-reset abuse.
  // A-SEC-7: tightened to 5/min (was 10). Legitimate users only hit this
  // route once per reset; the tighter cap raises the cost of token
  // brute-force from "trivially fast" to "noticeably slow".
  const limited = await checkRateLimit(request, signupResetLimiter, 5, 'reset-password')
  if (limited) {
    logAudit({
      staffId: 'unknown',
      action: 'FAIL_RATE_LIMIT',
      entity: 'auth',
      details: { route: 'reset-password', ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {})
    return limited
  }

  const requestId = getRequestId(request)
  try {
    const { token, password } = await request.json()

    if (!token || !password) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_VALIDATION',
        entity: 'auth',
        details: { route: 'reset-password', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Token and password are required' },
        { status: 400 }
      )
    }

    if (password.length < 8) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_PASSWORD_POLICY',
        entity: 'auth',
        details: { route: 'reset-password', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})
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
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_INVALID_TOKEN',
        entity: 'auth',
        details: { route: 'reset-password', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {})
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
      logAudit({
        staffId: `builder:${builder.id}`,
        action: 'FAIL_TOKEN_EXPIRED',
        entity: 'auth',
        entityId: builder.id,
        details: { route: 'reset-password', userId: builder.id, email: mask(builder.email), ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {})
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

    logAudit({
      staffId: `builder:${builder.id}`,
      action: 'RESET_PASSWORD',
      entity: 'auth',
      entityId: builder.id,
      details: { userId: builder.id, email: mask(builder.email), ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {})

    return NextResponse.json({
      message: 'Password reset successfully. You can now sign in with your new password.',
    })
  } catch (error: any) {
    logger.error('reset_password_error', error, { requestId })
    logAudit({
      staffId: 'unknown',
      action: 'FAIL_ERROR',
      entity: 'auth',
      details: { route: 'reset-password', ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {})
    return NextResponse.json(
      { error: 'Something went wrong. Please try again.' },
      { status: 500 }
    )
  }
}
