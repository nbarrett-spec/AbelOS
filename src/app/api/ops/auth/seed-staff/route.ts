export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/staff-auth'
import { requireDevAdmin } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// POST /api/ops/auth/seed-staff — Create staff accounts (dev only, ADMIN only)
export async function POST(request: NextRequest) {
  try {
    const guard = requireDevAdmin(request)
    if (guard) return guard

    // SECURITY: Extra confirmation — only ADMIN role can seed staff
    const staffRole = request.headers.get('x-staff-role')
    if (staffRole !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const { staff } = await request.json()

    if (!staff || !Array.isArray(staff)) {
      return NextResponse.json({ error: 'staff array required' }, { status: 400 })
    }

    const results: any[] = []

    for (const s of staff) {
      try {
        const hash = await hashPassword(s.password || 'Abel2026!')

        // Use raw SQL since prisma generate can't run
        const id = 'staff_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

        // Validate role and department against allowed values
        const VALID_ROLES = ['ADMIN', 'PM', 'WAREHOUSE', 'SALES', 'DRIVER', 'VIEWER']
        const VALID_DEPARTMENTS = ['MANAGEMENT', 'SALES', 'WAREHOUSE', 'DELIVERY', 'OFFICE', 'FIELD']
        if (!VALID_ROLES.includes(s.role)) {
          throw new Error(`Invalid role: ${s.role}`)
        }
        if (!VALID_DEPARTMENTS.includes(s.department)) {
          throw new Error(`Invalid department: ${s.department}`)
        }

        await prisma.$executeRawUnsafe(
          `INSERT INTO "Staff" ("id", "firstName", "lastName", "email", "passwordHash", "phone", "role", "department", "title", "active", "hireDate", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, COALESCE($10::timestamptz, CURRENT_TIMESTAMP), CURRENT_TIMESTAMP)
          ON CONFLICT ("email") DO UPDATE SET
            "passwordHash" = EXCLUDED."passwordHash",
            "role" = EXCLUDED."role",
            "department" = EXCLUDED."department",
            "title" = EXCLUDED."title",
            "active" = true,
            "updatedAt" = CURRENT_TIMESTAMP`,
          id,
          s.firstName || '',
          s.lastName || '',
          (s.email || '').toLowerCase(),
          hash,
          s.phone || null,
          s.role,
          s.department,
          s.title || null,
          s.hireDate || null
        )

        results.push({ email: s.email, status: 'ok' })
      } catch (e: any) {
        results.push({ email: s.email, status: 'error', error: e.message?.substring(0, 100) })
      }
    }

    audit(request, 'SEED_STAFF', 'Staff', undefined, {
      count: results.length,
      okCount: results.filter((r) => r.status === 'ok').length,
    }, 'CRITICAL').catch(() => {})

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
