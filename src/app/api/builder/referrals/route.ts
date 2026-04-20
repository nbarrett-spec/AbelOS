export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { auditBuilder } from '@/lib/audit'

// Generate unique referral code: ABEL-{builderLastName}-{random4}
function generateReferralCode(builderName: string): string {
  const lastNamePart = builderName.split(' ').pop()?.substring(0, 3).toUpperCase() || 'BLD'
  const random = Math.random().toString(36).substring(2, 6).toUpperCase()
  return `ABEL-${lastNamePart}-${random}`
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const query = `
      SELECT
        br.id,
        br."referredCompany",
        br."referredContact",
        br."referredEmail",
        br."referralCode",
        br.status,
        br."creditAmount",
        br."referrerCredited",
        br."referreeCredited",
        br."createdAt",
        rb."companyName" as "referredCompanyActual"
      FROM "BuilderReferral" br
      LEFT JOIN "Builder" rb ON br."referredBuilderId" = rb.id
      WHERE br."referrerId" = $1
      ORDER BY br."createdAt" DESC
    `

    const referrals: any = await prisma.$queryRawUnsafe(query, session.builderId)

    const formatted = referrals.map((ref: any) => ({
      id: ref.id,
      referredCompany: ref.referredCompanyActual || ref.referredCompany,
      referredContact: ref.referredContact,
      referredEmail: ref.referredEmail,
      referralCode: ref.referralCode,
      status: ref.status,
      creditAmount: ref.creditAmount,
      referrerCredited: ref.referrerCredited,
      referreeCredited: ref.referreeCredited,
      createdAt: ref.createdAt,
    }))

    // Calculate totals
    const totalEarned = formatted
      .filter((r: any) => r.referrerCredited)
      .reduce((sum: number, r: any) => sum + r.creditAmount, 0)

    const pendingCredit = formatted
      .filter((r: any) => r.status === 'FIRST_ORDER' && !r.referrerCredited)
      .reduce((sum: number, r: any) => sum + r.creditAmount, 0)

    return NextResponse.json({
      referrals: formatted,
      stats: {
        totalEarned,
        pendingCredit,
        totalSubmitted: formatted.length,
      },
    })
  } catch (error) {
    console.error('Referrals GET error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch referrals' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    auditBuilder(session.builderId, session.companyName || 'Unknown', 'CREATE', 'Referral').catch(() => {});

    const { referredCompany, referredContact, referredEmail, referredPhone, notes } =
      await request.json()

    if (!referredCompany || !referredContact || !referredEmail || !referredPhone) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get builder info for referral code generation
    const builderQuery = `SELECT "contactName" FROM "Builder" WHERE id = $1`
    const builderResult: any = await prisma.$queryRawUnsafe(builderQuery, session.builderId)

    if (!builderResult || builderResult.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    const builderName = builderResult[0].contactName
    const referralCode = generateReferralCode(builderName)

    // Create referral
    const insertQuery = `
      INSERT INTO "BuilderReferral" (
        id, "referrerId", "referredCompany", "referredContact",
        "referredEmail", "referredPhone", "referralCode", notes, status, "createdAt", "updatedAt"
      )
      VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, $7, 'PENDING', NOW(), NOW())
      RETURNING id, "referralCode", "createdAt"
    `

    const result: any = await prisma.$executeRawUnsafe(
      insertQuery,
      session.builderId,
      referredCompany,
      referredContact,
      referredEmail,
      referredPhone,
      referralCode,
      notes || null
    )

    // Log activity (using Activity table)
    const activityQuery = `
      INSERT INTO "Activity" (
        id, "staffId", "builderId", "activityType", "subject", "notes", "createdAt"
      )
      VALUES (gen_random_uuid()::text, $1, $2, 'NOTE', 'Builder Referral Submitted', $3, NOW())
    `

    // Get a staff member for logging (use a default admin or skip if not available)
    const staffQuery = `SELECT id FROM "Staff" WHERE role::text IN ('ADMIN', 'MANAGER') LIMIT 1`
    const staffResult: any = await prisma.$queryRawUnsafe(staffQuery)

    if (staffResult && staffResult.length > 0) {
      await prisma.$executeRawUnsafe(
        activityQuery,
        staffResult[0].id,
        session.builderId,
        `Referral submitted for ${referredCompany} (${referredContact})`
      )
    }

    return NextResponse.json({
      success: true,
      referralCode: referralCode,
      message: 'Referral submitted successfully',
    })
  } catch (error) {
    console.error('Referrals POST error:', error)
    return NextResponse.json(
      { error: 'Failed to submit referral' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    auditBuilder(session.builderId, session.companyName || 'Unknown', 'UPDATE', 'Referral').catch(() => {});

    const { referralId, status } = await request.json()

    if (!referralId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Verify the referral belongs to this builder
    const checkQuery = `SELECT "referrerId" FROM "BuilderReferral" WHERE id = $1`
    const checkResult: any = await prisma.$queryRawUnsafe(checkQuery, referralId)

    if (!checkResult || checkResult.length === 0) {
      return NextResponse.json(
        { error: 'Referral not found' },
        { status: 404 }
      )
    }

    if (checkResult[0].referrerId !== session.builderId) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    // Update status
    const updateQuery = `
      UPDATE "BuilderReferral"
      SET status = $1, "updatedAt" = NOW()
      WHERE id = $2
    `

    await prisma.$executeRawUnsafe(updateQuery, status, referralId)

    return NextResponse.json({
      success: true,
      message: 'Referral status updated',
    })
  } catch (error) {
    console.error('Referrals PATCH error:', error)
    return NextResponse.json(
      { error: 'Failed to update referral' },
      { status: 500 }
    )
  }
}
