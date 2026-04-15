export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  verifyPassword,
  createStaffToken,
  setStaffSessionCookie,
  StaffSessionPayload,
} from '@/lib/staff-auth'
import { authLimiter, checkRateLimit } from '@/lib/rate-limit'
import { logSecurityEvent } from '@/lib/security-events'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/login — Staff login
// ──────────────────────────────────────────────────────────────────────────

function clientIp(request: NextRequest): string {
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown'
  )
}

export async function POST(request: NextRequest) {
  try {
    // Rate limiting — logs RATE_LIMIT SecurityEvent on rejection.
    const limited = await checkRateLimit(request, authLimiter, 10, 'staff-login')
    if (limited) return limited

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
      logSecurityEvent({
        kind: 'AUTH_FAIL',
        path: '/api/ops/auth/login',
        method: 'POST',
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        requestId: request.headers.get('x-request-id'),
        details: {
          reason: 'unknown_email',
          emailPrefix: String(email).slice(0, 2),
        },
      })
      return NextResponse.json(
        { error: 'Invalid email or password' },
        { status: 401 }
      )
    }

    // Check if account is active
    if (!staff.active) {
      logSecurityEvent({
        kind: 'AUTH_FAIL',
        path: '/api/ops/auth/login',
        method: 'POST',
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        requestId: request.headers.get('x-request-id'),
        details: { reason: 'inactive_account', staffId: staff.id },
      })
      return NextResponse.json(
        { error: 'Account is deactivated. Contact your administrator.' },
        { status: 403 }
      )
    }

    // Verify password
    const valid = await verifyPassword(password, staff.passwordHash)
    if (!valid) {
      logSecurityEvent({
        kind: 'AUTH_FAIL',
        path: '/api/ops/auth/login',
        method: 'POST',
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
        requestId: request.headers.get('x-request-id'),
        details: { reason: 'bad_password', staffId: staff.id },
      })
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
