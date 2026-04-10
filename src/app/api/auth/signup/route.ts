export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword, createToken, setSessionCookie } from '@/lib/auth'
import { signupSchema } from '@/lib/validations'
import { authLimiter, getRateLimitHeaders } from '@/lib/rate-limit'

export async function POST(request: NextRequest) {
  try {
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const rl = await authLimiter.check(ip)
    if (!rl.success) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429, headers: getRateLimitHeaders(rl, 10) }
      )
    }

    const body = await request.json()
    const parsed = signupSchema.safeParse(body)

    if (!parsed.success) {
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
      console.error('Database error during signup:', dbError)
      return NextResponse.json(
        { error: 'Failed to create account' },
        { status: 500 }
      )
    }
  } catch (error) {
    console.error('Signup error:', error)
    return NextResponse.json(
      { error: 'Failed to create account' },
      { status: 500 }
    )
  }
}
