export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback, requireStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    // Single query: get all builders with aggregated stats (no N+1)
    const builders = await prisma.$queryRawUnsafe<Array<any>>(
      `SELECT
        b.id,
        b."companyName",
        b."contactName",
        b.email,
        b.phone,
        b."paymentTerm",
        b.status,
        b."createdAt",
        COALESCE((SELECT COUNT(*)::int FROM "Project" WHERE "builderId" = b.id), 0) as "totalProjects",
        COALESCE((SELECT COUNT(*)::int FROM "Order" WHERE "builderId" = b.id), 0) as "totalOrders",
        COALESCE(qs."quoteCount", 0)::int as "totalQuotes",
        COALESCE(qs."quoteRevenue", 0)::numeric as "totalRevenue"
       FROM "Builder" b
       LEFT JOIN LATERAL (
         SELECT COUNT(q.id) as "quoteCount", COALESCE(SUM(q.total), 0) as "quoteRevenue"
         FROM "Quote" q
         JOIN "Project" p ON q."projectId" = p.id
         WHERE p."builderId" = b.id
       ) qs ON true
       ORDER BY b."createdAt" DESC`
    )

    return NextResponse.json({ builders })
  } catch (error: any) {
    console.error('[Admin Builders GET]', error?.message || error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/admin/builders — create a new builder.
// ADMIN/MANAGER only. Validates paymentTerm + status enums (mirrors PATCH).
// Returns 409 if email already exists. Audited as ADMIN_CREATE_BUILDER.
export async function POST(request: NextRequest) {
  const auth = await requireStaffAuth(request, {
    allowedRoles: ['ADMIN', 'MANAGER'] as any,
  })
  if (auth.error) return auth.error

  try {
    const body = await request.json().catch(() => ({}))
    const {
      companyName,
      contactName,
      email,
      phone,
      address,
      city,
      state,
      zip,
      paymentTerm,
      creditLimit,
      taxExempt,
      status,
    } = body || {}

    // Required fields
    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return NextResponse.json({ error: 'companyName is required' }, { status: 400 })
    }
    if (!contactName || typeof contactName !== 'string' || !contactName.trim()) {
      return NextResponse.json({ error: 'contactName is required' }, { status: 400 })
    }
    if (!email || typeof email !== 'string' || !email.trim()) {
      return NextResponse.json({ error: 'email is required' }, { status: 400 })
    }

    const validPaymentTerms = ['PAY_AT_ORDER', 'PAY_ON_DELIVERY', 'NET_15', 'NET_30']
    const finalPaymentTerm = paymentTerm ?? 'NET_30'
    if (!validPaymentTerms.includes(finalPaymentTerm)) {
      return NextResponse.json(
        { error: `Invalid paymentTerm. Must be one of: ${validPaymentTerms.join(', ')}` },
        { status: 400 }
      )
    }

    const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']
    const finalStatus = status ?? 'PENDING'
    if (!validStatuses.includes(finalStatus)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const normalizedEmail = email.trim().toLowerCase()

    // Pre-check for existing email (and rely on DB unique constraint as backstop).
    const existing = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Builder" WHERE LOWER(email) = $1 LIMIT 1`,
      normalizedEmail
    )
    if (existing && existing.length > 0) {
      return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
    }

    // Staff-created builders have no portal password yet — use the 'NOLOGIN'
    // sentinel (matches the InFlow import + invite flow conventions). Builder
    // can be onboarded later via /api/admin/builders/[id]/invite, which sets a
    // resetToken so they can pick their own password.
    const creditLimitNum =
      creditLimit !== undefined && creditLimit !== null && creditLimit !== ''
        ? Number(creditLimit)
        : null
    if (creditLimitNum !== null && Number.isNaN(creditLimitNum)) {
      return NextResponse.json({ error: 'creditLimit must be a number' }, { status: 400 })
    }

    let created: any
    try {
      const inserted = await prisma.$queryRawUnsafe<Array<any>>(
        `INSERT INTO "Builder" (
            id, "companyName", "contactName", email, "passwordHash",
            phone, address, city, state, zip,
            "paymentTerm", "creditLimit", "taxExempt", status,
            "createdAt", "updatedAt"
         )
         VALUES (
            gen_random_uuid()::text, $1, $2, $3, 'NOLOGIN',
            $4, $5, $6, $7, $8,
            $9::"PaymentTerm", $10, $11, $12::"AccountStatus",
            NOW(), NOW()
         )
         RETURNING id, "companyName", "contactName", email, phone, address, city, state, zip,
                   "paymentTerm", "creditLimit", "taxExempt", status, "createdAt"`,
        companyName.trim(),
        contactName.trim(),
        normalizedEmail,
        phone || null,
        address || null,
        city || null,
        state || null,
        zip || null,
        finalPaymentTerm,
        creditLimitNum,
        taxExempt === true,
        finalStatus
      )
      created = inserted?.[0]
    } catch (error: any) {
      const msg = typeof error?.message === 'string' ? error.message : ''
      if (
        error?.code === 'P2002' ||
        (msg.includes('duplicate key') && msg.includes('email'))
      ) {
        return NextResponse.json({ error: 'Email already exists' }, { status: 409 })
      }
      throw error
    }

    if (!created) {
      return NextResponse.json({ error: 'Failed to create builder' }, { status: 500 })
    }

    await audit(
      request,
      'ADMIN_CREATE_BUILDER',
      'Builder',
      created.id,
      {
        builderId: created.id,
        companyName: created.companyName,
        email: created.email,
        paymentTerm: created.paymentTerm,
        status: created.status,
      },
      'CRITICAL'
    ).catch(() => {})

    return NextResponse.json({ builder: created }, { status: 201 })
  } catch (error: any) {
    console.error('[Admin Builders POST]', error?.message || error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
