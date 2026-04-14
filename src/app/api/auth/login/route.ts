export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyPassword, createToken, setSessionCookie } from '@/lib/auth'
import { loginSchema } from '@/lib/validations'
import { authLimiter, getRateLimitHeaders } from '@/lib/rate-limit'
import { logger, getRequestId } from '@/lib/logger'

export async function POST(request: NextRequest) {
  const requestId = getRequestId(request)
  try {
    // Rate limit login attempts
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const rateLimitResult = await authLimiter.check(ip)
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: getRateLimitHeaders(rateLimitResult, 10) }
      )
    }

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
        return NextResponse.json(
          { error: 'Invalid email or password' },
          { status: 401 }
        )
      }

      const builder = builderRows[0]

      if (builder.status !== 'ACTIVE') {
        return NextResponse.json(
          { error: 'Account is not active. Please contact support.' },
          { status: 403 }
        )
      }

      const isValid = await verifyPassword(password, builder.passwordHash)
      if (!isValid) {
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
