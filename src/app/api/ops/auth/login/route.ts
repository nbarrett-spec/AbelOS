export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyPassword,
  createStaffToken,
  setStaffSessionCookie,
  StaffSessionPayload,
} from '@/lib/staff-auth'
import { authLimiter, getRateLimitHeaders } from '@/lib/rate-limit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/login — Staff login
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Rate limiting
    const ip = request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'
    const rateResult = await authLimiter.check(ip)
    if (!rateResult.success) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please try again later.' },
        { status: 429, headers: getRateLimitHeaders(rateResult, 10) }
      )
    }

    const body = await request.json()
    const { email, password } = body

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      )
    }

    // Find staff member by email
    let staff: any = null
    try {
      staff = await (prisma as any).staff.findUnique({
        where: { email: email.toLowerCase().trim() },
      })
    } catch (dbError: any) {
      console.error('Staff lookup DB error:', dbError.message)
      return NextResponse.json(
        { error: 'Login failed. Please try again.' },
        { status: 500 }
      )
    }

    if (!staff) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Check if account is active
    if (!staff.active) {
      return NextResponse.json(
        { error: 'Account is deactivated. Contact your administrator.' },
        { status: 403 }
      )
    }

    // Verify password
    const valid = await verifyPassword(password, staff.passwordHash)
    if (!valid) {
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Query all roles from StaffRoles join table (multi-role support)
    let allRoles: string[] = [staff.role] // fallback to primary role
    try {
      const roleRows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "role"::text FROM "StaffRoles" WHERE "staffId" = $1`,
        staff.id
      )
      if (roleRows.length > 0) {
        allRoles = roleRows.map((r: any) => r.role)
        // Ensure primary role is always included
        if (!allRoles.includes(staff.role)) {
          allRoles.unshift(staff.role)
        }
      }
    } catch (e) {
      // StaffRoles table might not exist yet — graceful fallback
      console.warn('StaffRoles query failed, using primary role only:', e)
    }

    // Create session token with all roles
    const payload: StaffSessionPayload = {
      staffId: staff.id,
      email: staff.email,
      firstName: staff.firstName,
      lastName: staff.lastName,
      role: staff.role,           // primary role (backward compat)
      roles: allRoles.join(','),  // all roles comma-separated
      department: staff.department,
      title: staff.title || null,
    }

    const token = await createStaffToken(payload)
    await setStaffSessionCookie(token)

    return NextResponse.json({
      success: true,
      staff: {
        id: staff.id,
        firstName: staff.firstName,
        lastName: staff.lastName,
        email: staff.email,
        role: staff.role,
        roles: allRoles,
        department: staff.department,
        title: staff.title,
      },
    })
  } catch (error: any) {
    console.error('Staff login error:', error)
    return NextResponse.json(
      { error: 'Login failed' },
      { status: 500 }
    )
  }
}
