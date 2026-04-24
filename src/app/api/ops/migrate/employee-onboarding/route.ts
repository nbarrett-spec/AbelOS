import { audit } from '@/lib/audit'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { randomUUID } from 'crypto'
import { getPublicAppUrl } from '@/lib/email'

/**
 * POST /api/ops/migrate/employee-onboarding
 *
 * One-time migration to add employee onboarding fields to the Staff table.
 * Also generates invite tokens for any staff with broken 'hashed_password_here' passwords.
 *
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export async function POST(request: NextRequest) {
  try {
    audit(request, 'RUN_MIGRATE_EMPLOYEE_ONBOARDING', 'Database', undefined, { migration: 'RUN_MIGRATE_EMPLOYEE_ONBOARDING' }, 'CRITICAL').catch(() => {})
    const results: string[] = []

    // Step 1: Add new columns
    const columns = [
      { name: 'inviteToken', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "inviteToken" VARCHAR(255) UNIQUE' },
      { name: 'inviteTokenExpiry', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "inviteTokenExpiry" TIMESTAMP' },
      { name: 'resetToken', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "resetToken" VARCHAR(255) UNIQUE' },
      { name: 'resetTokenExpiry', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP' },
      { name: 'handbookSignedAt', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "handbookSignedAt" TIMESTAMP' },
      { name: 'handbookVersion', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "handbookVersion" VARCHAR(50)' },
      { name: 'passwordSetAt', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "passwordSetAt" TIMESTAMP' },
      { name: 'mustChangePassword', sql: 'ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "mustChangePassword" BOOLEAN DEFAULT false' },
    ]

    for (const col of columns) {
      try {
        await prisma.$executeRawUnsafe(col.sql)
        results.push(`Added column: ${col.name}`)
      } catch (e: any) {
        results.push(`Column ${col.name}: ${e.message || 'already exists'}`)
      }
    }

    // Step 2: Create indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS "Staff_inviteToken_idx" ON "Staff"("inviteToken")',
      'CREATE INDEX IF NOT EXISTS "Staff_resetToken_idx" ON "Staff"("resetToken")',
    ]

    for (const sql of indexes) {
      try {
        await prisma.$executeRawUnsafe(sql)
        results.push('Created index')
      } catch (e: any) {
        results.push(`Index: ${e.message || 'already exists'}`)
      }
    }

    // Step 3: Fix broken passwords — generate invite tokens for staff with 'hashed_password_here'
    let fixedCount = 0
    const fixedStaff: Array<{ email: string; inviteUrl: string }> = []

    try {
      const brokenStaff: any[] = await prisma.$queryRawUnsafe(
        `SELECT id, email, "firstName", "lastName" FROM "Staff" WHERE "passwordHash" = 'hashed_password_here'`
      )

      for (const member of brokenStaff) {
        const inviteToken = randomUUID()
        const inviteTokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

        await prisma.$executeRawUnsafe(
          `UPDATE "Staff" SET
            "inviteToken" = $1,
            "inviteTokenExpiry" = $2,
            "updatedAt" = NOW()
          WHERE id = $3`,
          inviteToken,
          inviteTokenExpiry,
          member.id
        )

        const inviteUrl = `${getPublicAppUrl()}/ops/setup-account?token=${inviteToken}`
        fixedStaff.push({ email: member.email, inviteUrl })
        fixedCount++
      }

      results.push(`Fixed ${fixedCount} staff with broken passwords`)
    } catch (e: any) {
      results.push(`Password fix: ${e.message}`)
    }

    return NextResponse.json({
      success: true,
      message: 'Employee onboarding migration complete',
      results,
      fixedStaff,
      fixedCount,
    })
  } catch (error: any) {
    console.error('Employee onboarding migration error:', error)
    return NextResponse.json(
      { error: 'Migration failed'},
      { status: 500 }
    )
  }
}
