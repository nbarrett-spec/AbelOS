export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStaffSession } from '@/lib/staff-auth'
import bcrypt from 'bcryptjs'
import { audit } from '@/lib/audit'

// PATCH /api/ops/auth/profile — Update staff profile (own profile only)
export async function PATCH(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'UPDATE', 'Auth', undefined, { method: 'PATCH' }).catch(() => {})

    const session = await getStaffSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { firstName, lastName, phone, title } = body

    const setClauses: string[] = ['"updatedAt" = NOW()']
    const params: any[] = []
    let idx = 1

    if (firstName !== undefined) {
      setClauses.push(`"firstName" = $${idx}`)
      params.push(firstName)
      idx++
    }
    if (lastName !== undefined) {
      setClauses.push(`"lastName" = $${idx}`)
      params.push(lastName)
      idx++
    }
    if (phone !== undefined) {
      setClauses.push(`"phone" = $${idx}`)
      params.push(phone || null)
      idx++
    }
    if (title !== undefined) {
      setClauses.push(`"title" = $${idx}`)
      params.push(title || null)
      idx++
    }

    if (setClauses.length === 1) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    params.push(session.staffId)

    await prisma.$executeRawUnsafe(
      `UPDATE "Staff" SET ${setClauses.join(', ')} WHERE "id" = $${idx}`,
      ...params
    )

    return NextResponse.json({ success: true, message: 'Profile updated' })
  } catch (error: any) {
    console.error('PATCH /api/ops/auth/profile error:', error)
    return NextResponse.json({ error: 'Failed to update profile' }, { status: 500 })
  }
}

// POST /api/ops/auth/profile — Change staff password
export async function POST(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Auth', undefined, { method: 'POST' }).catch(() => {})

    const session = await getStaffSession()
    if (!session) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await request.json()
    const { currentPassword, newPassword } = body

    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: 'Current and new password are required' }, { status: 400 })
    }

    if (newPassword.length < 8) {
      return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
    }

    // Get current password hash
    const staff: any[] = await prisma.$queryRawUnsafe(
      `SELECT "passwordHash" FROM "Staff" WHERE "id" = $1`,
      session.staffId
    ) as any[]

    if (!staff.length) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    // Verify current password
    const isValid = await bcrypt.compare(currentPassword, staff[0].passwordHash)
    if (!isValid) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    // Hash new password and update
    const newHash = await bcrypt.hash(newPassword, 12)
    await prisma.$executeRawUnsafe(
      `UPDATE "Staff" SET "passwordHash" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
      newHash,
      session.staffId
    )

    return NextResponse.json({ success: true, message: 'Password changed successfully' })
  } catch (error: any) {
    console.error('POST /api/ops/auth/profile error:', error)
    return NextResponse.json({ error: 'Failed to change password' }, { status: 500 })
  }
}
