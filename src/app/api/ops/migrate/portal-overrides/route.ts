import { audit } from '@/lib/audit'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

/**
 * POST /api/ops/migrate/portal-overrides
 *
 * Adds portalOverrides JSONB column to the Staff table.
 * This allows admins to grant/revoke individual portal access per employee,
 * overriding the role-based defaults.
 *
 * Safe to run multiple times (uses IF NOT EXISTS).
 */
export async function POST(request: NextRequest) {
  try {
    audit(request, 'RUN_MIGRATE_PORTAL_OVERRIDES', 'Database', undefined, { migration: 'RUN_MIGRATE_PORTAL_OVERRIDES' }, 'CRITICAL').catch(() => {})
    const results: string[] = []

    // Add portalOverrides JSONB column
    try {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "portalOverrides" JSONB DEFAULT '{}'::jsonb`
      )
      results.push('Added column: portalOverrides')
    } catch (e: any) {
      results.push(`Column portalOverrides: ${e.message || 'already exists'}`)
    }

    return NextResponse.json({
      success: true,
      message: 'Portal overrides migration complete',
      results,
    })
  } catch (error: any) {
    console.error('Portal overrides migration error:', error)
    return NextResponse.json(
      { error: 'Migration failed', details: error.message },
      { status: 500 }
    )
  }
}
