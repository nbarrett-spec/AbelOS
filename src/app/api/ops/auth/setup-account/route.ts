export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/staff-auth'
import { logAudit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/setup-account — Complete employee account setup
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { token, password, handbookAgreed, signatureName } = body

    // Validate required fields
    if (!token || !password) {
      return NextResponse.json(
        { error: 'Missing required fields: token, password' },
        { status: 400 }
      )
    }

    if (!handbookAgreed) {
      return NextResponse.json(
        { error: 'You must agree to the employee handbook' },
        { status: 400 }
      )
    }

    if (!signatureName) {
      return NextResponse.json(
        { error: 'Signature is required' },
        { status: 400 }
      )
    }

    // Validate password length
    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters' },
        { status: 400 }
      )
    }

    // Find staff by invite token
    const staff: any[] = await (prisma as any).$queryRawUnsafe(
      `SELECT id, email, "firstName", "lastName", "inviteTokenExpiry" FROM "Staff" WHERE "inviteToken" = $1`,
      token
    )

    if (staff.length === 0) {
      return NextResponse.json(
        { error: 'Invalid or expired invitation token' },
        { status: 401 }
      )
    }

    const member = staff[0]

    // Check if token is expired
    if (member.inviteTokenExpiry && new Date(member.inviteTokenExpiry) < new Date()) {
      return NextResponse.json(
        { error: 'Invitation token has expired' },
        { status: 401 }
      )
    }

    // Hash the password
    const passwordHash = await hashPassword(password)

    // Update the staff record
    const updatedStaff: any[] = await (prisma as any).$queryRawUnsafe(
      `UPDATE "Staff" SET
        "passwordHash" = $1,
        "passwordSetAt" = NOW(),
        "handbookSignedAt" = NOW(),
        "handbookVersion" = '2025-v1',
        "inviteToken" = NULL,
        "inviteTokenExpiry" = NULL,
        "updatedAt" = NOW()
      WHERE id = $2
      RETURNING id, email, "firstName", "lastName"`,
      passwordHash,
      member.id
    )

    if (updatedStaff.length === 0) {
      return NextResponse.json(
        { error: 'Failed to complete setup' },
        { status: 500 }
      )
    }

    const completedStaff = updatedStaff[0]

    logAudit({
      staffId: completedStaff.id,
      staffName: `${completedStaff.firstName} ${completedStaff.lastName}`.trim(),
      action: 'COMPLETE_ACCOUNT_SETUP',
      entity: 'Staff',
      entityId: completedStaff.id,
      details: { signatureName, handbookVersion: '2025-v1' },
      ipAddress:
        request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
        request.headers.get('x-real-ip') ||
        undefined,
      userAgent: request.headers.get('user-agent') || undefined,
      severity: 'CRITICAL',
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Account setup completed successfully',
      data: {
        id: completedStaff.id,
        email: completedStaff.email,
        firstName: completedStaff.firstName,
        lastName: completedStaff.lastName,
      },
    })
  } catch (error: any) {
    console.error('Setup account error:', error)
    return NextResponse.json(
      { error: 'Failed to complete account setup' },
      { status: 500 }
    )
  }
}
