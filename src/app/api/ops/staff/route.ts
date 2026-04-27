export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/staff-auth'
import { randomUUID } from 'crypto'
import { sendInviteEmail, getPublicAppUrl } from '@/lib/email'
import { audit } from '@/lib/audit'
import { requireStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/staff — List all staff with onboarding status
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // R7 — migrate from inline header check to the standard auth helper.
  // /api/ops/staff API_ACCESS prefix is [ADMIN, MANAGER]; canAccessAPI runs
  // automatically inside requireStaffAuth.
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    const allRoles = (request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || '').split(',').map(r => r.trim())
    const isAdmin = allRoles.includes('ADMIN')

    // Get all staff with onboarding status + hierarchy + comp
    const staff: any[] = await (prisma as any).$queryRawUnsafe(`
      SELECT
        s.id, s."firstName", s."lastName", s.email, s.phone,
        s.role::text AS role, s.department::text AS department, s.title,
        s.active, s."hireDate", s."hourlyRate",
        s.salary, s."payType"::text AS "payType",
        s."employmentType"::text AS "employmentType",
        s."employeeId", s."managerId",
        m."firstName" || ' ' || m."lastName" AS "managerName",
        s."inviteToken", s."inviteTokenExpiry",
        s."passwordHash", s."handbookSignedAt", s."handbookVersion",
        s."passwordSetAt", s."portalOverrides",
        s."createdAt", s."updatedAt"
      FROM "Staff" s
      LEFT JOIN "Staff" m ON s."managerId" = m.id
      ORDER BY s."lastName" ASC, s."firstName" ASC
    `)

    // Transform staff data to include status
    const enrichedStaff = staff.map((s: any) => {
      let status = 'Active'
      if (!s.active) {
        status = 'Deactivated'
      } else if (s.inviteToken && s.inviteTokenExpiry && new Date(s.inviteTokenExpiry) > new Date()) {
        status = 'Invited'
      } else if (!s.passwordSetAt || s.passwordHash === 'hashed_password_here') {
        status = 'Needs Setup'
      }

      return {
        id: s.id,
        employeeId: s.employeeId,
        firstName: s.firstName,
        lastName: s.lastName,
        email: s.email,
        phone: s.phone,
        role: s.role,
        department: s.department,
        title: s.title,
        active: s.active,
        hireDate: s.hireDate,
        // Reporting hierarchy
        managerId: s.managerId,
        managerName: s.managerName,
        // Compensation data: ADMIN only
        ...(isAdmin ? {
          hourlyRate: s.hourlyRate,
          salary: s.salary,
          payType: s.payType,
          employmentType: s.employmentType,
        } : {}),
        status,
        handbookSignedAt: s.handbookSignedAt,
        handbookVersion: s.handbookVersion,
        // Portal overrides: ADMIN only (managers can see staff but not modify access)
        ...(isAdmin ? { portalOverrides: s.portalOverrides || {} } : {}),
        inviteTokenExpiry: s.inviteTokenExpiry,
        createdAt: s.createdAt,
        // passwordHash is NEVER returned in API responses
      }
    })

    return NextResponse.json({
      success: true,
      data: enrichedStaff,
    })
  } catch (error: any) {
    console.error('Staff list error:', error)
    return NextResponse.json(
      { error: 'Failed to list staff' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/staff — Create new staff member with invite
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // R7 — migrate from inline header check to standard auth helper.
  const auth = await requireStaffAuth(request, { allowedRoles: ['ADMIN', 'MANAGER'] })
  if (auth.error) return auth.error

  try {
    // Audit log
    audit(request, 'CREATE', 'Staff', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { firstName, lastName, email, phone, staffRole, department, title, hireDate } = body

    // Validate required fields
    if (!firstName || !lastName || !email || !staffRole || !department) {
      return NextResponse.json(
        { error: 'Missing required fields: firstName, lastName, email, staffRole, department' },
        { status: 400 }
      )
    }

    // Check if email already exists
    const existingStaff: any[] = await (prisma as any).$queryRawUnsafe(
      `SELECT id FROM "Staff" WHERE email = $1`,
      email.toLowerCase().trim()
    )

    if (existingStaff.length > 0) {
      return NextResponse.json(
        { error: 'Email already exists' },
        { status: 409 }
      )
    }

    // Generate invite token and set expiry (7 days)
    const inviteToken = randomUUID()
    const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

    // Hash a random password (they'll set their own via invite)
    const randomPassword = randomUUID()
    const passwordHash = await hashPassword(randomPassword)

    // Create staff member
    const staffId = randomUUID()
    const createdStaff: any[] = await (prisma as any).$queryRawUnsafe(
      `INSERT INTO "Staff" (
        id,
        "firstName",
        "lastName",
        email,
        "passwordHash",
        phone,
        role,
        department,
        title,
        "hireDate",
        "inviteToken",
        "inviteTokenExpiry",
        active,
        "createdAt",
        "updatedAt"
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::"StaffRole", $8::"Department", $9, $10, $11, $12, true, NOW(), NOW()
      )
      RETURNING id, "firstName", "lastName", email, role::text, department::text`,
      staffId,
      firstName,
      lastName,
      email.toLowerCase().trim(),
      passwordHash,
      phone || null,
      staffRole,
      department,
      title || null,
      hireDate ? new Date(hireDate) : null,
      inviteToken,
      inviteTokenExpiry
    )

    const newStaff = createdStaff[0]
    const inviteUrl = `${getPublicAppUrl()}/ops/setup-account?token=${inviteToken}`

    // Send invitation email (non-blocking — don't fail if email service is down)
    try {
      await sendInviteEmail({
        to: email.toLowerCase().trim(),
        firstName,
        inviteUrl,
      })
    } catch (emailErr) {
      console.warn('Failed to send invite email:', emailErr)
    }

    return NextResponse.json({
      success: true,
      data: {
        id: newStaff.id,
        firstName: newStaff.firstName,
        lastName: newStaff.lastName,
        email: newStaff.email,
        role: newStaff.role,
        department: newStaff.department,
        inviteUrl,
        inviteToken,
        inviteTokenExpiry,
      },
    })
  } catch (error: any) {
    console.error('Staff creation error:', error)
    return NextResponse.json(
      { error: 'Failed to create staff member' },
      { status: 500 }
    )
  }
}
