export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/auth'
import { signupSchema } from '@/lib/validations'
import { signupResetLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logger, getRequestId } from '@/lib/logger'
import { logAudit } from '@/lib/audit'
import { sendApplicationReceivedEmail } from '@/lib/email'

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
    // A-SEC-7: signup uses tighter 5/min/IP cap (was 10) — account-creation
    // is high-cost and abuse-prone; 5 leaves headroom for genuine typos.
    const limited = await checkRateLimit(request, signupResetLimiter, 5, 'builder-signup')
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

      // Create builder account with raw SQL.
      //
      // ⚠ Approval gate: new self-registered builders land in PENDING.
      // A staff member must flip the status to ACTIVE on /admin/builders/[id]
      // before they can log in. The login route returns a friendly 403 with
      // "pending approval" until then. emailVerified=false because the new
      // account hasn't proven the inbox owns the address yet — separate flow.
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
        'PENDING',
        false
      )

      // Application reference number — short user-visible identifier in case
      // they call/email Abel about their pending application.
      const refNumber = `APP-${new Date().getFullYear()}-${builderId.slice(0, 8).toUpperCase()}`

      logAudit({
        staffId: `builder:${builderId}`,
        action: 'SIGNUP',
        entity: 'auth',
        entityId: builderId,
        details: { userId: builderId, email: mask(email), refNumber, status: 'PENDING', ip: ipAddress, userAgent },
        ipAddress,
        userAgent,
        severity: 'INFO',
      }).catch(() => {})

      // Send application-received email so the user knows what to expect.
      // Fire-and-forget — a Resend hiccup must not break signup.
      sendApplicationReceivedEmail({
        to: email,
        contactName,
        companyName,
        refNumber,
      }).catch((err: any) => {
        logger.warn('signup_email_send_failed', { msg: err?.message, requestId, builderId })
      })

      // Note: NO session is created. PENDING builders can't log in yet.
      // The 201 response just confirms receipt; the UI redirects to
      // /signup/pending-approval (or shows an inline confirmation).
      return NextResponse.json(
        {
          status: 'PENDING_APPROVAL',
          refNumber,
          message: 'Your application has been received. Our team will review and activate your account within 1-2 business days.',
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
