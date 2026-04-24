export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken, setSessionCookie } from '@/lib/auth'
import { signupSchema } from '@/lib/validations'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logger, getRequestId } from '@/lib/logger'
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

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  const ipAddress = getIp(request)
  const userAgent = request.headers.get('user-agent') || 'unknown'
  try {
    const limited = await checkRateLimit(request, authLimiter, 10, 'builder-signup')
    if (limited) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_RATE_LIMIT',
        entity: 'auth',
        details: { route: 'signup', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {})
      return limited
    }

    const body = await request.json()
    const parsed = signupSchema.safeParse(body)

    if (!parsed.success) {
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_VALIDATION',
        entity: 'auth',
        details: { route: 'signup', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Validation failed', details: parsed.error.flatten() },
        { status: 400 }
      )
    }

    const {
      companyName,
      contactName,
      email,
      password,
      phone,
      paymentTerm,
      licenseNumber,
      taxId,
      taxExempt,
      address,
      city,
      state,
      zip,
    } = parsed.data

    try {
      // Check for existing account
      const existingRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id FROM "Builder" WHERE email = $1`,
        email
      )
      if (existingRows.length > 0) {
        logAudit({
          staffId: 'unknown',
          action: 'FAIL_EMAIL_EXISTS',
          entity: 'auth',
          details: { route: 'signup', email: mask(email), ip: ipAddress, userAgent },
          ipAddress,
          userAgent,
          severity: 'INFO',
        }).catch(() => {})
        return NextResponse.json(
          { error: 'An account with this email already exists' },
          { status: 409 }
        )
      }

      // Create builder account with raw SQL
      const passwordHash = await hashPassword(password)
      const builderId = crypto.randomUUID()

      await prisma.$executeRawUnsafe(
        `INSERT INTO "Builder"
         (id, "companyName", "contactName", email, "passwordHash", phone, "paymentTerm",
          "licenseNumber", "taxId", "taxExempt", address, city, state, zip,
          status, "emailVerified", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        builderId,
        companyName,
        contactName,
        email,
        passwordHash,
        phone,
        paymentTerm,
        licenseNumber,
        taxId,
        taxExempt,
        address,
        city,
        state,
        zip,
        'ACTIVE',
        true
      )

      // Create session
      const token = await createToken({
        builderId,
        email,
        companyName,
      })
      await setSessionCookie(token)

      logAudit({
        staffId: `builder:${builderId}`,
        action: 'SIGNUP',
        entity: 'auth',
        entityId: builderId,
        details: { userId: builderId, email: mask(email), ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})

      return NextResponse.json(
        {
          builder: {
            id: builderId,
            companyName,
            contactName,
            email,
            paymentTerm,
          },
        },
        { status: 201 }
      )
    } catch (dbError) {
      logger.error('signup_db_error', dbError, { requestId })
      logAudit({
        staffId: 'unknown',
        action: 'FAIL_DB_ERROR',
        entity: 'auth',
        details: { route: 'signup', email: mask(email), ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'WARN',
      }).catch(() => {})
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 }
      )
    }
  } catch (error) {
    logger.error('signup_error', error, { requestId })
    logAudit({
      staffId: 'unknown',
      action: 'FAIL_ERROR',
      entity: 'auth',
      details: { route: 'signup', ip: ipAddress, userAgent },
      ipAddress,
      userAgent,
      severity: 'WARN',
    }).catch(() => {})
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
