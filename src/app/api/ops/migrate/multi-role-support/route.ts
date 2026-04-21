export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/ops/migrate/multi-role-support
 *
 * Adds multi-role support columns to Staff table:
 *  - roles: comma-separated list of all assigned roles
 *  - portalOverrides: JSON object for per-staff portal access overrides
 * Backfills existing staff with their current single role.
 * Safe to re-run.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'RUN_MIGRATE_MULTI_ROLE_SUPPORT', 'Database', undefined, { migration: 'RUN_MIGRATE_MULTI_ROLE_SUPPORT' }, 'CRITICAL').catch(() => {})

  const results: { step: string; status: string }[] = []

  async function run(step: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step, status: 'OK' })
    } catch (e: any) {
      const msg = e?.message || ''
      if (msg.includes('already exists')) {
        results.push({ step, status: 'SKIPPED (already exists)' })
      } else {
        results.push({ step, status: `ERROR: ${msg.slice(0, 200)}` })
      }
    }
  }

  // Step 1: Add roles column
  await run('Add roles column', `
    ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "roles" TEXT;
  `)

  // Step 2: Add portalOverrides column
  await run('Add portalOverrides column', `
    ALTER TABLE "Staff" ADD COLUMN IF NOT EXISTS "portalOverrides" JSONB DEFAULT '{}'::jsonb;
  `)

  // Step 3: Backfill roles from single role field
  await run('Backfill roles from role', `
    UPDATE "Staff" SET "roles" = "role" WHERE "roles" IS NULL AND "role" IS NOT NULL;
  `)

  // Step 4: Create index for role lookups
  await run('Index on roles', `
    CREATE INDEX IF NOT EXISTS "Staff_roles_idx" ON "Staff"("roles");
  `)

  const passed = results.filter(r => r.status === 'OK').length
  const skipped = results.filter(r => r.status.startsWith('SKIPPED')).length
  const failed = results.filter(r => r.status.startsWith('ERROR')).length

  return NextResponse.json({
    success: failed === 0,
    summary: { passed, skipped, failed, total: results.length },
    results,
  })
}
