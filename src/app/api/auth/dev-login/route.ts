export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createToken, setSessionCookie } from '@/lib/auth'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'

/**
 * DEV-ONLY: Test login endpoint that bypasses password verification.
 *
 * POST /api/auth/dev-login
 * Body: { email: string } — or empty to auto-pick the first active builder
 *
 * Hard-gated on NODE_ENV !== 'production' (returns 404 in prod) AND
 * rate-limited with authLimiter as defense-in-depth if the env check is
 * ever bypassed or misconfigured.
 */
function isDevEnv(): boolean {
  return process.env.NODE_ENV !== 'production'
}

export async function POST(request: NextRequest) {
  if (!isDevEnv()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const limited = await checkRateLimit(request, authLimiter, 10, 'dev-login')
  if (limited) return limited

  try {
    const body = await request.json().catch(() => ({}))
    const email = body.email || null

    let builder: any

    if (email) {
      // Find specific builder by email
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "companyName", "contactName", "paymentTerm", status
         FROM "Builder" WHERE email = $1 LIMIT 1`,
        email
      )
      builder = rows[0]
    } else {
      // Pick the first active builder
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "companyName", "contactName", "paymentTerm", status
         FROM "Builder" WHERE status = 'ACTIVE' ORDER BY "createdAt" ASC LIMIT 1`
      )
      builder = rows[0]
    }

    if (!builder) {
      // No builders in DB — list what's available
      const allBuilders: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "companyName", status FROM "Builder" ORDER BY "createdAt" ASC LIMIT 20`
      )
      return NextResponse.json({
        error: 'No matching builder found',
        availableBuilders: allBuilders.map(b => ({
          id: b.id,
          email: b.email,
          company: b.companyName,
          status: b.status,
        })),
      }, { status: 404 })
    }

    // Create session token (no password check)
    const token = await createToken({
      builderId: builder.id,
      email: builder.email,
      companyName: builder.companyName,
    })
    await setSessionCookie(token, true)

    return NextResponse.json({
      success: true,
      message: '⚠️ DEV LOGIN — remove before production',
      builder: {
        id: builder.id,
        companyName: builder.companyName,
        contactName: builder.contactName,
        email: builder.email,
        paymentTerm: builder.paymentTerm,
        status: builder.status,
      },
    })
  } catch (error: any) {
    console.error('Dev login error:', error)
    return NextResponse.json({
      error: 'Dev login failed',
      details: error.message,
    }, { status: 500 })
  }
}

/**
 * GET /api/auth/dev-login
 * Lists all builders in the database for easy testing. Dev-only.
 */
export async function GET() {
  if (!isDevEnv()) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  try {
    const builders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, email, "companyName", "contactName", "pricingTier", status, "paymentTerm",
              (SELECT COUNT(*)::int FROM "Order" WHERE "builderId" = b.id) as "orderCount",
              (SELECT COALESCE(SUM(total), 0)::float FROM "Order" WHERE "builderId" = b.id) as "totalSpend"
       FROM "Builder" b
       ORDER BY "createdAt" ASC
       LIMIT 50`
    )

    return NextResponse.json({
      message: '⚠️ DEV ENDPOINT — remove before production',
      count: builders.length,
      builders: builders.map(b => ({
        id: b.id,
        email: b.email,
        company: b.companyName,
        contact: b.contactName,
        tier: b.pricingTier,
        status: b.status,
        paymentTerm: b.paymentTerm,
        orderCount: b.orderCount,
        totalSpend: b.totalSpend,
      })),
      usage: 'POST /api/auth/dev-login with { "email": "builder@example.com" } to log in as that builder',
    })
  } catch (error: any) {
    console.error('Dev login list error:', error)
    return NextResponse.json({
      error: 'Failed to list builders',
      details: error.message,
    }, { status: 500 })
  }
}
