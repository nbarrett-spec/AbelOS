export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notifications'
import { sendApplicationReceivedEmail } from '@/lib/email'
import { publicFormLimiter, checkRateLimit } from '@/lib/rate-limit'

// Validation helper
function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return emailRegex.test(email)
}

// POST /api/builders/register — Public builder self-registration
export async function POST(request: NextRequest) {
  const limited = await checkRateLimit(request, publicFormLimiter, 5, 'builder-register')
  if (limited) return limited

  try {
    const body = await request.json()

    // Validate required fields
    const { companyName, contactName, contactEmail, contactPhone, address, city, state, zip, businessLicense, taxId, estimatedAnnualVolume, referralSource, notes } = body

    // Check required fields
    if (!companyName || !contactName || !contactEmail) {
      return NextResponse.json(
        { error: 'Company name, contact name, and email are required' },
        { status: 400 }
      )
    }

    // Validate email format
    if (!validateEmail(contactEmail)) {
      return NextResponse.json(
        { error: 'Invalid email format' },
        { status: 400 }
      )
    }

    // Check for duplicate email in Builder table
    const existingBuilder = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Builder" WHERE "email" = $1 LIMIT 1`,
      contactEmail
    )

    if (Array.isArray(existingBuilder) && existingBuilder.length > 0) {
      return NextResponse.json(
        { error: 'An account with this email already exists' },
        { status: 409 }
      )
    }

    // Generate application reference number
    const refNumber = 'APP' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 8).toUpperCase()

    // Insert into Builder table with PENDING_APPROVAL status
    const builderId = 'bld' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Builder" ("id", "companyName", "contactName", "email", "passwordHash", "phone", "address", "city", "state", "zip", "taxId", "licenseNumber", "status", "paymentTerm", "accountBalance", "taxExempt", "emailVerified", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING'::"AccountStatus", 'NET_15'::"PaymentTerm", 0, false, false, NOW(), NOW())`,
      builderId,
      companyName,
      contactName,
      contactEmail,
      'pending_hash_placeholder',
      contactPhone || null,
      address || null,
      city || null,
      state || null,
      zip || null,
      taxId || null,
      businessLicense || null
    )

    // Insert into BuilderApplication table
    const applicationId = 'app' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderApplication" ("id", "builderId", "referenceNumber", "companyName", "contactName", "contactEmail", "contactPhone", "address", "city", "state", "zip", "businessLicense", "taxId", "estimatedAnnualVolume", "referralSource", "notes", "status", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW(), NOW())`,
      applicationId,
      builderId,
      refNumber,
      companyName,
      contactName,
      contactEmail,
      contactPhone || null,
      address || null,
      city || null,
      state || null,
      zip || null,
      businessLicense || null,
      taxId || null,
      estimatedAnnualVolume || null,
      referralSource || null,
      notes || null,
      'PENDING_APPROVAL'
    )

    // Find all ADMIN and MANAGER staff members
    const staffMembers = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Staff" WHERE "role"::text IN ('ADMIN', 'MANAGER')`
    ) as Array<{ id: string }>

    // Queue notifications for all ADMIN/MANAGER staff
    for (const staff of staffMembers) {
      await createNotification({
        staffId: staff.id,
        type: 'SYSTEM',
        title: 'New Builder Registration',
        message: `${companyName} (${contactName}) has applied to join the platform`,
        link: `/ops/builders/applications/${applicationId}`
      })
    }

    // Send confirmation email to the applicant
    try {
      await sendApplicationReceivedEmail({
        to: contactEmail,
        contactName,
        companyName,
        refNumber,
      })
    } catch (emailErr: any) {
      console.warn('[Builder Register] Failed to send confirmation email:', emailErr?.message)
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Application submitted successfully',
        refNumber: refNumber,
        applicationId: applicationId
      },
      { status: 201 }
    )
  } catch (error: any) {
    console.error('Builder registration error:', error)
    return NextResponse.json(
      { error: 'Failed to submit registration. Please try again.' },
      { status: 500 }
    )
  }
}
