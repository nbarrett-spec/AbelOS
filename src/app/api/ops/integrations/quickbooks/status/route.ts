/**
 * GET /api/ops/integrations/quickbooks/status
 *
 * Returns QBO connection state for the /ops/integrations/quickbooks page.
 * Decision (2026-04-22): QBWC path killed; QBO OAuth2 is phase 2, so this
 * endpoint reports phase='phase2-stub' until we flip the switch.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'
import { getQboStatus } from '@/lib/integrations/quickbooks'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Best-effort read from IntegrationConfig — the row may not exist yet, which
  // is fine. Phase 2 will promote QUICKBOOKS_ONLINE into the provider enum; for
  // now we try-catch around the query so a missing enum value doesn't 500.
  let lastSync: { lastSyncAt?: Date | null; lastSyncStatus?: string | null; realmId?: string | null } | undefined
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "lastSyncAt", "lastSyncStatus", "companyId" AS "realmId"
       FROM "IntegrationConfig"
       WHERE "provider"::text = 'QUICKBOOKS_ONLINE'
       LIMIT 1`
    )
    if (rows.length > 0) {
      lastSync = {
        lastSyncAt: rows[0].lastSyncAt ? new Date(rows[0].lastSyncAt) : null,
        lastSyncStatus: rows[0].lastSyncStatus || null,
        realmId: rows[0].realmId || null,
      }
    }
  } catch {
    // Row / enum not present yet — fall through with undefined lastSync
  }

  const status = getQboStatus(lastSync)
  return NextResponse.json(status)
}
