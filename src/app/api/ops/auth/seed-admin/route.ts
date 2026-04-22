export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ONE-TIME seed endpoint — create the initial admin account
// DELETE THIS FILE after use for security

export async function POST(request: NextRequest) {
  // SECURITY: Check authentication first
  const authCheck = checkStaffAuth(request)
  if (authCheck) return authCheck

  // SECURITY: Only ADMIN can seed admin accounts
  const staffRole = request.headers.get('x-staff-role')
  if (staffRole !== 'ADMIN') {
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  try {
    const body = await request.json()
    const { seedKey } = body

    // Simple protection so only you can call this
    if (seedKey !== 'abel-lumber-seed-2024') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const passwordHash = await bcrypt.hash('AbelLumber2024!', 12)

    const staff = await (prisma as any).staff.upsert({
      where: { email: 'n.barrett@abellumber.com' },
      update: { passwordHash, active: true },
      create: {
        firstName: 'Nate',
        lastName: 'Barrett',
        email: 'n.barrett@abellumber.com',
        passwordHash,
        role: 'ADMIN',
        department: 'EXECUTIVE',
        title: 'Owner',
        active: true,
        hireDate: new Date(),
      },
    })

    audit(request, 'SEED_ADMIN_ACCOUNT', 'Staff', staff.id, { email: staff.email, role: staff.role }, 'CRITICAL').catch(() => {})

    return NextResponse.json({
      success: true,
      message: 'Admin account created',
      staffId: staff.id,
      email: staff.email,
      role: staff.role,
    })
  } catch (error: any) {
    console.error('Seed error:', error)
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
