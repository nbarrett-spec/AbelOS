/**
 * Brain → Aegis: Manual Sync Trigger
 *
 * POST: Triggers both brain-sync crons from the ops dashboard.
 *       Calls the cron endpoints internally with CRON_SECRET auth.
 *
 * Auth: Staff session (x-staff-id from middleware) — admin only
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

export async function POST(request: NextRequest) {
  // Require staff auth
  const staffId = request.headers.get('x-staff-id')
  if (!staffId) {
    return NextResponse.json({ error: 'Unauthorized — staff session required' }, { status: 401 })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'https://app.abellumber.com'

  const headers = {
    Authorization: `Bearer ${cronSecret}`,
    'Content-Type': 'application/json',
  }

  const results: Record<string, any> = {}
  const started = Date.now()

  // Trigger brain-sync (products, customers, vendors, inventory, communities, scores)
  try {
    const res = await fetch(`${baseUrl}/api/cron/brain-sync`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(120000),
    })
    results.brainSync = {
      status: res.status,
      ok: res.ok,
      data: res.ok ? await res.json().catch(() => null) : await res.text().catch(() => null),
    }
  } catch (err: any) {
    results.brainSync = { status: 0, ok: false, error: err.message }
  }

  // Trigger brain-sync-staff (staff, deals, financial)
  try {
    const res = await fetch(`${baseUrl}/api/cron/brain-sync-staff`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(120000),
    })
    results.brainSyncStaff = {
      status: res.status,
      ok: res.ok,
      data: res.ok ? await res.json().catch(() => null) : await res.text().catch(() => null),
    }
  } catch (err: any) {
    results.brainSyncStaff = { status: 0, ok: false, error: err.message }
  }

  const elapsed = Date.now() - started

  logger.info('brain_manual_sync_triggered', {
    staffId,
    elapsed,
    brainSyncOk: results.brainSync?.ok,
    brainSyncStaffOk: results.brainSyncStaff?.ok,
  })

  await audit(request, 'TRIGGER', 'BrainSync', 'manual', {
    elapsed,
    results: {
      brainSync: results.brainSync?.ok ? 'success' : 'failed',
      brainSyncStaff: results.brainSyncStaff?.ok ? 'success' : 'failed',
    },
  })

  return NextResponse.json({
    success: results.brainSync?.ok || results.brainSyncStaff?.ok,
    elapsed,
    results,
  })
}
