export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// Ops-side builder detail — staff auth via cookie (no builder session needed)

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Fetch builder
    const builders = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        id, "companyName", "contactName", email, phone, address, city, state, zip,
        "licenseNumber", "paymentTerm", "creditLimit", "taxExempt", "taxId", status,
        "accountBalance", "pricingTier", "createdAt", "updatedAt"
      FROM "Builder"
      WHERE id = $1`,
      id
    )

    if (builders.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    const builder = builders[0]

    // Fetch projects with quote counts
    const projectsWithCounts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        p.id, p.name, p.status::text, p."createdAt",
        COUNT(q.id)::int as "quoteCount"
      FROM "Project" p
      LEFT JOIN "Quote" q ON q."projectId" = p.id
      WHERE p."builderId" = $1
      GROUP BY p.id, p.name, p.status, p."createdAt"
      ORDER BY p."createdAt" DESC`,
      id
    )

    // Transform projects to include _count
    const projects = projectsWithCounts.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      createdAt: p.createdAt,
      _count: { quotes: p.quoteCount },
    }))

    // Fetch custom pricing with product info
    const customPricing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        bp.id, bp."customPrice",
        p.sku, p.name, p."basePrice"
      FROM "BuilderPricing" bp
      JOIN "Product" p ON p.id = bp."productId"
      WHERE bp."builderId" = $1`,
      id
    )

    const customPricingFormatted = customPricing.map((cp) => ({
      id: cp.id,
      customPrice: cp.customPrice,
      product: {
        sku: cp.sku,
        name: cp.name,
        basePrice: cp.basePrice,
      },
    }))

    // Count aggregates
    const counts = await prisma.$queryRawUnsafe<any[]>(
      `SELECT
        (SELECT COUNT(*)::int FROM "Project" WHERE "builderId" = $1) as "projectCount",
        (SELECT COUNT(*)::int FROM "Order" WHERE "builderId" = $1) as "orderCount",
        (SELECT COUNT(*)::int FROM "BuilderPricing" WHERE "builderId" = $1) as "customPricingCount"`,
      id
    )

    const countData = counts[0]

    // Fetch quotes via project
    const quotes = await prisma.$queryRawUnsafe<any[]>(
      `SELECT q.id, q."quoteNumber", q.total, q.status::text, q."createdAt"
      FROM "Quote" q
      JOIN "Project" p ON p.id = q."projectId"
      WHERE p."builderId" = $1
      ORDER BY q."createdAt" DESC
      LIMIT 10`,
      id
    )

    return NextResponse.json({
      builder: {
        ...builder,
        projects,
        customPricing: customPricingFormatted,
        customPricingCount: customPricingFormatted.length,
        _count: {
          projects: countData.projectCount,
          orders: countData.orderCount,
          customPricing: countData.customPricingCount,
        },
      },
      quotes,
    })
  } catch (error) {
    console.error('Failed to fetch builder:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()
    const {
      companyName,
      contactName,
      email,
      phone,
      address,
      city,
      state,
      zip,
      licenseNumber,
      paymentTerm,
      creditLimit,
      taxExempt,
      status,
      pricingTier,
    } = body

    if (paymentTerm) {
      const validPaymentTerms = [
        'PAY_AT_ORDER',
        'PAY_ON_DELIVERY',
        'NET_15',
        'NET_30',
      ]
      if (!validPaymentTerms.includes(paymentTerm)) {
        return NextResponse.json(
          {
            error: `Invalid paymentTerm. Must be one of: ${validPaymentTerms.join(
              ', '
            )}`,
          },
          { status: 400 }
        )
      }
    }

    if (status) {
      const validStatuses = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED']
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          {
            error: `Invalid status. Must be one of: ${validStatuses.join(
              ', '
            )}`,
          },
          { status: 400 }
        )
      }
    }

    // Build dynamic SET clauses
    const setClauses: string[] = []
    const queryParams: any[] = [id]
    let paramIndex = 2

    if (companyName !== undefined) {
      setClauses.push(`"companyName" = $${paramIndex}`)
      queryParams.push(companyName)
      paramIndex++
    }
    if (contactName !== undefined) {
      setClauses.push(`"contactName" = $${paramIndex}`)
      queryParams.push(contactName)
      paramIndex++
    }
    if (email !== undefined) {
      setClauses.push(`email = $${paramIndex}`)
      queryParams.push(email)
      paramIndex++
    }
    if (phone !== undefined) {
      setClauses.push(`phone = $${paramIndex}`)
      queryParams.push(phone)
      paramIndex++
    }
    if (address !== undefined) {
      setClauses.push(`address = $${paramIndex}`)
      queryParams.push(address)
      paramIndex++
    }
    if (city !== undefined) {
      setClauses.push(`city = $${paramIndex}`)
      queryParams.push(city)
      paramIndex++
    }
    if (state !== undefined) {
      setClauses.push(`state = $${paramIndex}`)
      queryParams.push(state)
      paramIndex++
    }
    if (zip !== undefined) {
      setClauses.push(`zip = $${paramIndex}`)
      queryParams.push(zip)
      paramIndex++
    }
    if (licenseNumber !== undefined) {
      setClauses.push(`"licenseNumber" = $${paramIndex}`)
      queryParams.push(licenseNumber)
      paramIndex++
    }
    if (paymentTerm !== undefined) {
      setClauses.push(`"paymentTerm" = $${paramIndex}::"PaymentTerm"`)
      queryParams.push(paymentTerm)
      paramIndex++
    }
    if (creditLimit !== undefined) {
      setClauses.push(`"creditLimit" = $${paramIndex}`)
      queryParams.push(creditLimit)
      paramIndex++
    }
    if (taxExempt !== undefined) {
      setClauses.push(`"taxExempt" = $${paramIndex}`)
      queryParams.push(taxExempt)
      paramIndex++
    }
    if (status !== undefined) {
      setClauses.push(`status = $${paramIndex}::"AccountStatus"`)
      queryParams.push(status)
      paramIndex++
    }
    if (pricingTier !== undefined) {
      setClauses.push(`"pricingTier" = $${paramIndex}`)
      queryParams.push(pricingTier)
      paramIndex++
    }

    // Always update updatedAt
    setClauses.push(`"updatedAt" = NOW()`)

    if (setClauses.length === 1) {
      // Only updatedAt changed, just fetch current builder
      const builders = await prisma.$queryRawUnsafe<any[]>(
        `SELECT
          id, "companyName", "contactName", email, phone, address, city, state, zip,
          "licenseNumber", "paymentTerm", "creditLimit", "taxExempt", status, "pricingTier", "updatedAt"
        FROM "Builder"
        WHERE id = $1`,
        id
      )

      if (builders.length === 0) {
        return NextResponse.json(
          { error: 'Builder not found' },
          { status: 404 }
        )
      }

      return NextResponse.json({
        builder: builders[0],
      })
    }

    // Execute update
    const query = `UPDATE "Builder" SET ${setClauses.join(', ')} WHERE id = $1 RETURNING id, "companyName", "contactName", email, phone, address, city, state, zip, "licenseNumber", "paymentTerm", "creditLimit", "taxExempt", status, "pricingTier", "updatedAt"`

    const updatedBuilders = await prisma.$queryRawUnsafe<any[]>(query, ...queryParams)

    if (updatedBuilders.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    await audit(request, 'UPDATE', 'Builder', id, body)

    return NextResponse.json({
      builder: updatedBuilders[0],
    })
  } catch (error: any) {
    console.error('Failed to update builder:', error)

    if (
      error.code === '23505' &&
      error.detail &&
      error.detail.includes('email')
    ) {
      return NextResponse.json(
        { error: 'Email already exists' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const staffId = request.headers.get('x-staff-id')

    if (!staffId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    // Check builder exists
    const builders = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id FROM "Builder" WHERE id = $1`,
      id
    )

    if (builders.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    // Soft delete: update status to CLOSED
    await prisma.$executeRawUnsafe(
      `UPDATE "Builder" SET status = 'CLOSED'::"AccountStatus", "updatedAt" = NOW() WHERE id = $1`,
      id
    )

    await audit(request, 'DELETE', 'Builder', id, {})

    return NextResponse.json({
      message: 'Builder archived',
      id,
    })
  } catch (error: any) {
    console.error('Failed to delete builder:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
