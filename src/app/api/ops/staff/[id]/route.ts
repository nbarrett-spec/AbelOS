export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/staff-auth'
import { randomUUID } from 'crypto'

// Extract role from header
function getStaffRole(request: NextRequest): string | null {
  return request.headers.get('x-staff-role')
}

// Check if user has required role
function hasRequiredRole(role: string | null): boolean {
  return role === 'ADMIN' || role === 'MANAGER'
}

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/staff/[id] — Get single staff member details
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const role = getStaffRole(request)
    if (!hasRequiredRole(role)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const staff: any[] = await (prisma as any).$queryRawUnsafe(
      `SELECT * FROM "Staff" WHERE id = $1`,
      id
    )

    if (staff.length === 0) {
      return NextResponse.json(
        { error: 'Staff member not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: staff[0],
    })
  } catch (error: any) {
    console.error('Staff detail error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch staff member' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH /api/ops/staff/[id] — Update staff fields
// ──────────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const role = getStaffRole(request)
    if (!hasRequiredRole(role)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const body = await request.json()

    // Build dynamic UPDATE statement
    const updates: string[] = []
    const updateParams: any[] = []
    let paramIndex = 1

    const allowedFields = ['firstName', 'lastName', 'phone', 'role', 'department', 'title', 'active', 'hireDate']

    for (const field of allowedFields) {
      if (field in body) {
        updates.push(`"${field}" = $${paramIndex}`)
        updateParams.push(body[field])
        paramIndex++
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      )
    }

    updates.push(`"updatedAt" = NOW()`)
    updateParams.push(id)

    const updateSql = `UPDATE "Staff" SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`

    const updatedStaff: any[] = await (prisma as any).$queryRawUnsafe(updateSql, ...updateParams)

    if (updatedStaff.length === 0) {
      return NextResponse.json(
        { error: 'Staff member not found' },
        { status: 404 }
      )
    }

    return NextResponse.json({
      success: true,
      data: updatedStaff[0],
    })
  } catch (error: any) {
    console.error('Staff update error:', error)
    return NextResponse.json(
      { error: 'Failed to update staff member' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/staff/[id] — Special actions (reset password, resend invite)
// ──────────────────────────────────────────────────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const role = getStaffRole(request)
    if (!hasRequiredRole(role)) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      )
    }

    const { id } = params
    const body = await request.json()
    const { action } = body

    if (action === 'reset-password') {
      // Generate new invite token for password reset
      const resetToken = randomUUID()
      const resetTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      await (prisma as any).$queryRawUnsafe(
        `UPDATE "Staff" SET "resetToken" = $1, "resetTokenExpiry" = $2, "updatedAt" = NOW() WHERE id = $3`,
        resetToken,
        resetTokenExpiry,
        id
      )

      const resetUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/ops/reset-password?token=${resetToken}`

      return NextResponse.json({
        success: true,
        data: { resetUrl, resetToken, resetTokenExpiry },
      })
    } else if (action === 'resend-invite') {
      // Generate new invite token
      const inviteToken = randomUUID()
      const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      const updatedStaff: any[] = await (prisma as any).$queryRawUnsafe(
        `UPDATE "Staff" SET "inviteToken" = $1, "inviteTokenExpiry" = $2, "updatedAt" = NOW() WHERE id = $3 RETURNING id, email, "firstName", "lastName"`,
        inviteToken,
        inviteTokenExpiry,
        id
      )

      if (updatedStaff.length === 0) {
        return NextResponse.json(
          { error: 'Staff member not found' },
          { status: 404 }
        )
      }

      const inviteUrl = `${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/ops/setup-account?token=${inviteToken}`

      return NextResponse.json({
        success: true,
        data: {
          inviteUrl,
          inviteToken,
          inviteTokenExpiry,
          staff: updatedStaff[0],
        },
      })
    } else {
      return NextResponse.json(
        { error: 'Unknown action' },
        { status: 400 }
      )
    }
  } catch (error: any) {
    console.error('Staff action error:', error)
    return NextResponse.json(
      { error: 'Failed to perform action' },
      { status: 500 }
    )
  }
}
