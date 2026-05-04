export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/auth'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import { sendApplicationApprovedSelfEmail } from '@/lib/email'
import { logger } from '@/lib/logger'

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Require staff authentication (not just any session)
    const authError = await checkStaffAuthWithFallback(request)
    if (authError) return authError

    const { id } = params

    // Get builder with all details
    const builderResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      companyName: string;
      contactName: string;
      email: string;
      phone: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      licenseNumber: string | null;
      paymentTerm: string;
      creditLimit: number | null;
      taxExempt: boolean;
      status: string;
      createdAt: Date;
      updatedAt: Date;
    }>>(
      `SELECT * FROM "Builder" WHERE id = $1`,
      id
    )

    const builder = builderResult?.[0]

    if (!builder) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    // Get builder's projects
    const projectsResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      status: string;
      createdAt: Date;
    }>>(
      `SELECT id, name, status, "createdAt" FROM "Project" WHERE "builderId" = $1 ORDER BY "createdAt" DESC`,
      id
    )

    // Get builder's custom pricing
    const customPricingResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      customPrice: number;
      sku: string;
      productName: string;
      basePrice: number;
    }>>(
      `SELECT cp.id, cp."customPrice", p.sku, p.name as "productName", p."basePrice"
       FROM "CustomPricing" cp
       JOIN "Product" p ON cp."productId" = p.id
       WHERE cp."builderId" = $1`,
      id
    )

    // Get builder's quotes
    const quotesResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      quoteNumber: string;
      total: number;
      status: string;
      createdAt: Date;
    }>>(
      `SELECT q.id, q."quoteNumber", q.total, q.status, q."createdAt"
       FROM "Quote" q
       JOIN "Project" p ON q."projectId" = p.id
       WHERE p."builderId" = $1
       ORDER BY q."createdAt" DESC
       LIMIT 10`,
      id
    )

    return NextResponse.json({
      builder: {
        ...builder,
        projects: projectsResult,
        customPricing: customPricingResult.map(cp => ({
          id: cp.id,
          customPrice: cp.customPrice,
          product: {
            sku: cp.sku,
            name: cp.productName,
            basePrice: cp.basePrice,
          },
        })),
        customPricingCount: customPricingResult.length,
      },
      quotes: quotesResult,
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
  // SECURITY: Require STAFF auth (not builder) to modify builder accounts
  const authError = await checkStaffAuthWithFallback(request)
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
    } = body

    // Snapshot the row before mutation so the audit trail can show before→after.
    const beforeRows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName", "contactName", email, phone, address, city, state, zip,
              "licenseNumber", "paymentTerm", "creditLimit", "taxExempt", status
         FROM "Builder" WHERE id = $1 LIMIT 1`,
      id
    )
    const before = beforeRows?.[0] ?? null

    // Validate paymentTerm if provided
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

    // Validate status if provided
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

    // Build update query dynamically
    const updates: string[] = []
    const values: any[] = [id]
    let paramIndex = 2

    if (companyName !== undefined) {
      updates.push(`"companyName" = $${paramIndex}`)
      values.push(companyName)
      paramIndex++
    }
    if (contactName !== undefined) {
      updates.push(`"contactName" = $${paramIndex}`)
      values.push(contactName)
      paramIndex++
    }
    if (email !== undefined) {
      updates.push(`email = $${paramIndex}`)
      values.push(email)
      paramIndex++
    }
    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex}`)
      values.push(phone)
      paramIndex++
    }
    if (address !== undefined) {
      updates.push(`address = $${paramIndex}`)
      values.push(address)
      paramIndex++
    }
    if (city !== undefined) {
      updates.push(`city = $${paramIndex}`)
      values.push(city)
      paramIndex++
    }
    if (state !== undefined) {
      updates.push(`state = $${paramIndex}`)
      values.push(state)
      paramIndex++
    }
    if (zip !== undefined) {
      updates.push(`zip = $${paramIndex}`)
      values.push(zip)
      paramIndex++
    }
    if (licenseNumber !== undefined) {
      updates.push(`"licenseNumber" = $${paramIndex}`)
      values.push(licenseNumber)
      paramIndex++
    }
    if (paymentTerm !== undefined) {
      updates.push(`"paymentTerm" = $${paramIndex}`)
      values.push(paymentTerm)
      paramIndex++
    }
    if (creditLimit !== undefined) {
      updates.push(`"creditLimit" = $${paramIndex}`)
      values.push(creditLimit)
      paramIndex++
    }
    if (taxExempt !== undefined) {
      updates.push(`"taxExempt" = $${paramIndex}`)
      values.push(taxExempt)
      paramIndex++
    }
    if (status !== undefined) {
      updates.push(`status = $${paramIndex}`)
      values.push(status)
      paramIndex++
    }

    // Only execute update if there are changes
    if (updates.length > 0) {
      updates.push(`"updatedAt" = NOW()`)

      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Builder" SET ${updates.join(', ')} WHERE id = $1`,
          ...values
        )
      } catch (error: any) {
        // Check for unique constraint violation on email
        if (error.message?.includes('duplicate key') && error.message?.includes('email')) {
          return NextResponse.json(
            { error: 'Email already exists' },
            { status: 400 }
          )
        }
        throw error
      }
    }

    // Get updated builder
    const updatedBuilderResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      companyName: string;
      contactName: string;
      email: string;
      phone: string | null;
      address: string | null;
      city: string | null;
      state: string | null;
      zip: string | null;
      licenseNumber: string | null;
      paymentTerm: string;
      creditLimit: number | null;
      taxExempt: boolean;
      status: string;
      updatedAt: Date;
    }>>(
      `SELECT id, "companyName", "contactName", email, phone, address, city, state, zip, "licenseNumber", "paymentTerm", "creditLimit", "taxExempt", status, "updatedAt" FROM "Builder" WHERE id = $1`,
      id
    )

    const updatedBuilder = updatedBuilderResult?.[0]

    if (!updatedBuilder) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    // Build a focused diff so the audit row shows only what actually changed.
    const trackedFields = [
      'companyName',
      'contactName',
      'email',
      'phone',
      'address',
      'city',
      'state',
      'zip',
      'licenseNumber',
      'paymentTerm',
      'creditLimit',
      'taxExempt',
      'status',
    ] as const
    const changes: Record<string, { from: any; to: any }> = {}
    if (before) {
      for (const f of trackedFields) {
        const beforeVal = (before as any)[f]
        const afterVal = (updatedBuilder as any)[f]
        if (afterVal !== undefined && String(beforeVal ?? '') !== String(afterVal ?? '')) {
          changes[f] = { from: beforeVal ?? null, to: afterVal ?? null }
        }
      }
    }

    await audit(
      request,
      'ADMIN_EDIT_BUILDER',
      'Builder',
      id,
      {
        builderId: id,
        changedFields: Object.keys(changes),
        changes,
      },
      'CRITICAL'
    ).catch(() => {})

    // Approval email: when status flips from non-ACTIVE → ACTIVE AND the
    // builder has a passwordHash (meaning they signed up themselves and just
    // got cleared by staff), let them know they can log in. Skipped when no
    // passwordHash — that's the staff-invite flow, which sends its own email
    // via /api/admin/builders/[id]/invite.
    const statusChange = changes.status
    if (
      statusChange &&
      statusChange.to === 'ACTIVE' &&
      statusChange.from !== 'ACTIVE' &&
      updatedBuilder.email
    ) {
      const pwRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "passwordHash" FROM "Builder" WHERE id = $1 LIMIT 1`,
        id,
      )
      const hasPassword = !!pwRows?.[0]?.passwordHash
      if (hasPassword) {
        sendApplicationApprovedSelfEmail({
          to: updatedBuilder.email,
          contactName: updatedBuilder.contactName,
          companyName: updatedBuilder.companyName,
        }).catch((err: any) => {
          logger.warn('builder_approval_email_failed', { msg: err?.message, builderId: id })
        })
      }
    }

    return NextResponse.json({
      builder: updatedBuilder,
    })
  } catch (error: any) {
    console.error('Failed to update builder:', error)

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
