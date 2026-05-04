export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createToken, setSessionCookie } from '@/lib/auth'
import { loginSchema } from '@/lib/validations'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logger, getRequestId } from '@/lib/logger'
import { logSecurityEvent } from '@/lib/security-events'
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

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const ipAddress = clientIp(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'
  try {
    // Rate limit login attempts — logs a RATE_LIMIT SecurityEvent on rejection.
    const limited = await checkRateLimit(request, authLimiter, 10, 'builder-login')
    if (limited) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_RATE_LIMIT',
        entity: 'auth',
        details: { route: 'login', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {})
      return limited
    }

    const body = await request.json()
    const parsed = loginSchema.safeParse(body)

    if (!parsed.success) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_VALIDATION',
        entity: 'auth',
        details: { route: 'login', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})
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
        logAudit({
          staffId: 'unknown',
          action: 'FAIL_UNKNOWN_EMAIL',
          entity: 'auth',
          details: { route: 'login', email: mask(email), ip: ipAddress, userAgent },
          ipAddress,
          userAgent,
          severity: 'INFO',
        }).catch(() => {})
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      }

      const builder = builderRows[0]

      if (builder.status !== 'ACTIVE') {
        // Status-specific messaging: PENDING gets an encouraging "in review"
        // note; SUSPENDED/CLOSED/INACTIVE gets a terminal "contact support".
        // Generic catch-all retains the old wording for unknown states.
        const status = String(builder.status || '').toUpperCase()
        let userMessage: string
        let auditAction: string
        if (status === 'PENDING') {
          userMessage =
            'Your account is pending approval. Our team will notify you when activated (typically within 1-2 business days).'
          auditAction = 'FAIL_PENDING_APPROVAL'
        } else if (status === 'SUSPENDED' || status === 'CLOSED' || status === 'INACTIVE') {
          userMessage =
            'Your account has been deactivated. Contact support@abellumber.com to restore access.'
          auditAction = 'FAIL_DEACTIVATED_ACCOUNT'
        } else {
          userMessage = 'Account is not active. Please contact support.'
          auditAction = 'FAIL_INACTIVE_ACCOUNT'
        }
        logSecurityEvent({
          kind: 'AUTH_FAIL',
          path: '/api/auth/login',
          method: 'POST',
          ip: clientIp(request),
          userAgent: request.headers.get('user-agent'),
          requestId,
          details: { reason: 'inactive_account', status, builderId: builder.id },
        })
        logAudit({
          staffId: `builder:${builder.id}`,
          action: auditAction,
          entity: 'auth',
          entityId: builder.id,
          details: { route: 'login', userId: builder.id, status, email: mask(builder.email), ip: ipAddress, userAgent },
          ipAddress,
          userAgent,
          severity: 'WARN',
        }).catch(() => {})
        return NextResponse.json(
          { error: userMessage, status },
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
        logAudit({
          staffId: `builder:${builder.id}`,
          action: 'FAIL_WRONG_PASSWORD',
          entity: 'auth',
          entityId: builder.id,
          details: { route: 'login', userId: builder.id, email: mask(builder.email), ip: ipAddress, userAgent },
          ipAddress,
          userAgent,
          severity: 'WARN',
        }).catch(() => {})
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

      logAudit({
        staffId: `builder:${builder.id}`,
        action: 'LOGIN',
        entity: 'auth',
        entityId: builder.id,
        details: { userId: builder.id, email: mask(builder.email), ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})

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
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_DB_ERROR',
        entity: 'auth',
        details: { route: 'login', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {})
      return NextResponse.json({ error: 'Login failed' }, { status: 500 })
    }
  } catch (error) {
    logger.error('login_error', error, { requestId })
    logAudit({
      staffId: 'unknown',
      action: 'FAIL_ERROR',
      entity: 'auth',
      details: { route: 'login', ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {})
    return NextResponse.json({ error: 'Login failed' }, { status: 500 })
  }
}
