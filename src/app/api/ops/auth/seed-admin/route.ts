export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import bcrypt from 'bcryptjs'
import { logAudit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/seed-admin — Bootstrap or reset the admin account
//
// TWO modes:
//   1. BOOTSTRAP: If no ADMIN staff exist → creates admin without auth
//   2. RESET:     If admin exists but can't log in → resets password
//
// Both require the ADMIN_SEED_KEY env var (or fallback seed key).
// After first successful login, DELETE THIS FILE for security.
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { seedKey, password } = body

    // Validate seed key — env var takes priority, fallback for bootstrap
    const validKey = process.env.ADMIN_SEED_KEY || 'abel-lumber-seed-2024'
    if (seedKey !== validKey) {
      return NextResponse.json({ error: 'Invalid seed key' }, { status: 401 })
    }

    // Check if any admin staff exist
    const adminCount: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as count FROM "Staff" WHERE "role" = 'ADMIN' AND "active" = true`
    )
    const hasAdmins = adminCount[0]?.count > 0

    // Check if Nate's record exists at all
    const nateRecord: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "role", "active", "passwordHash" FROM "Staff" WHERE "email" = 'n.barrett@abellumber.com' LIMIT 1`
    )

    const newPassword = password || 'AbelLumber2024!'
    const passwordHash = await bcrypt.hash(newPassword, 12)

    let staff: any

    if (nateRecord.length > 0) {
      // Nate exists — reset password and ensure admin + active
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET
          "passwordHash" = $1,
          "role" = 'ADMIN',
          "active" = true,
          "passwordSetAt" = NOW(),
          "updatedAt" = NOW()
        WHERE "email" = 'n.barrett@abellumber.com'`,
        passwordHash
      )
      staff = nateRecord[0]

      logAudit({
        staffId: staff.id,
        staffName: 'Nate Barrett',
        action: 'ADMIN_PASSWORD_RESET_VIA_SEED',
        entity: 'Staff',
        entityId: staff.id,
        ipAddress:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          request.headers.get('x-real-ip') ||
          undefined,
        severity: 'CRITICAL',
      }).catch(() => {})

      return NextResponse.json({
        success: true,
        mode: 'reset',
        message: `Admin password reset for ${staff.email}. Log in at /ops/login`,
        staffId: staff.id,
        email: staff.email,
      })
    } else {
      // Nate doesn't exist — create from scratch
      staff = await (prisma as any).staff.create({
        data: {
          firstName: 'Nate',
          lastName: 'Barrett',
          email: 'n.barrett@abellumber.com',
          passwordHash,
          role: 'ADMIN',
          department: 'EXECUTIVE',
          title: 'Owner / GM',
          active: true,
          hireDate: new Date('2021-01-01'),
        },
      })

      logAudit({
        staffId: staff.id,
        staffName: 'Nate Barrett',
        action: 'ADMIN_BOOTSTRAP_VIA_SEED',
        entity: 'Staff',
        entityId: staff.id,
        ipAddress:
          request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          request.headers.get('x-real-ip') ||
          undefined,
        severity: 'CRITICAL',
      }).catch(() => {})

      return NextResponse.json({
        success: true,
        mode: 'bootstrap',
        message: `Admin account created for ${staff.email}. Log in at /ops/login`,
        staffId: staff.id,
        email: staff.email,
      })
    }
  } catch (error: any) {
    console.error('Seed admin error:', error)
    return NextResponse.json(
      { error: 'Seed failed', detail: error.message },
      { status: 500 }
    )
  }
}

// GET — quick diagnostic: does the admin account exist?
export async function GET() {
  try {
    const result: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id", "email", "role", "active", "passwordSetAt", "updatedAt"
       FROM "Staff"
       WHERE "email" = 'n.barrett@abellumber.com'
       LIMIT 1`
    )

    if (result.length === 0) {
      return NextResponse.json({
        exists: false,
        message: 'No admin account found. POST to this endpoint with { "seedKey": "..." } to create one.',
      })
    }

    const staff = result[0]
    return NextResponse.json({
      exists: true,
      id: staff.id,
      email: staff.email,
      role: staff.role,
      active: staff.active,
      passwordSetAt: staff.passwordSetAt,
      lastUpdated: staff.updatedAt,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: 'Check failed', detail: error.message },
      { status: 500 }
    )
  }
}
