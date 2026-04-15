export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createToken, setSessionCookie } from '@/lib/auth'
import { loginSchema } from '@/lib/validations'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logger, getRequestId } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    // Rate limit login attempts — logs a RATE_LIMIT SecurityEvent on rejection.
    const limited = await checkRateLimit(request, authLimiter, 10, 'builder-login')
    if (limited) return limited

    const body = await request.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 400 }
      )
    }

    const { email, password } = parsed.data

    try {
      const builderRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "passwordHash", "companyName", "contactName", "paymentTerm", status FROM "Builder" WHERE email = $1`,
        email
      )

      if (builderRows.length === 0) {
        logSecurityEvent({
          kind: 'AUTH_FAIL',
          path: '/api/auth/login',
          method: 'POST',
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent'),
          requestId,
          details: { reason: 'unknown_email', emailPrefix: email.slice(0, 2) },
        })
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      }

      const builder = builderRows[0]

      if (builder.status !== 'ACTIVE') {
        logSecurityEvent({
          kind: 'AUTH_FAIL',
          path: '/api/auth/login',
          method: 'POST',
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent'),
          requestId,
          details: { reason: 'inactive_account', builderId: builder.id },
        })
        return NextResponse.json(
          { error: 'Account is not active. Please contact support.' },
          { status: 403 }
        )
      }

      const isValid = await verifyPassword(password, builder.passwordHash)
      if (!isValid) {
        logSecurityEvent({
          kind: 'AUTH_FAIL',
          path: '/api/auth/login',
          method: 'POST',
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent'),
          requestId,
          details: { reason: 'bad_password', builderId: builder.id },
        })
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      }

      const token = await createToken({
        builderId: builder.id,
        email: builder.email,
        companyName: builder.companyName,
      })
      await setSessionCookie(token, body.rememberMe === true)

      return NextResponse.json({
        builder: {
          id: builder.id,
          companyName: builder.companyName,
          contactName: builder.contactName,
          email: builder.email,
          paymentTerm: builder.paymentTerm,
        },
      })
    } catch (dbError) {
      logger.error('login_db_error', dbError, { requestId })
      return NextResponse.json({ error: 'Login failed' }, { status: 500 })
    }
  } catch (error) {
    logger.error('login_error', error, { requestId })
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
