export const dynamic = 'force-dynamic'
export const maxDuration = 300

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { logAudit } from '@/lib/audit'
import {
  syncJob,
  syncAllActiveJobs,
  ensureHyphenJobDocumentTable,
} from '@/lib/hyphen/job-sync'
import { getScraperConfig, isScraperEnabled } from '@/lib/hyphen/scraper'

// POST /api/integrations/hyphen/sync
//   ?jobId=<id>    → sync one Job
//   ?all=true      → sync every active Job (capped at 100)
//   (neither)      → error 400
//
// Behavior:
//   - Staff-auth gated (checkStaffAuth)
//   - Off-switch via FEATURE_HYPHEN_SYNC=off (default = enabled)
//   - Graceful degradation when creds missing or playwright absent:
//     returns 200 with { ok:true, skipped:true, reason } instead of failing
//   - Every call emits an AuditLog entry tagged 'hyphen_sync'
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Off-switch — default enabled; set to "off" (case-insensitive) to disable.
  const featureFlag = (process.env.FEATURE_HYPHEN_SYNC || '').trim().toLowerCase()
  if (featureFlag === 'off') {
    return NextResponse.json(
      {
        ok: true,
        skipped: true,
        reason: 'FEATURE_DISABLED',
        message: 'FEATURE_HYPHEN_SYNC=off — unset or set to any other value to re-enable',
      },
      { status: 200 }
    )
  }

  const url = new URL(request.url)
  const jobId = url.searchParams.get('jobId')
  const all = url.searchParams.get('all') === 'true' || url.searchParams.get('all') === '1'

  if (!jobId && !all) {
    return NextResponse.json(
      { ok: false, error: 'Provide ?jobId=<id> or ?all=true' },
      { status: 400 }
    )
  }

  // Ensure the destination table exists before any work. This is idempotent
  // and cheap; doing it here means the orchestrator doesn't have to.
  try {
    await ensureHyphenJobDocumentTable()
  } catch {
    // non-fatal — persistDoc will surface any real conflict
  }

  const scraperEnabled = isScraperEnabled()
  const cfg = getScraperConfig()

  // Single job path
  if (jobId) {
    try {
      const result = await syncJob(jobId)
      await logAudit({
        staffId: request.headers.get('x-staff-id') || '',
        staffName:
          `${request.headers.get('x-staff-firstname') || ''} ${request.headers.get('x-staff-lastname') || ''}`.trim() || undefined,
        action: 'SYNC',
        entity: 'hyphen_sync',
        entityId: jobId,
        details: {
          mode: 'single',
          scraperEnabled,
          skipped: result.skipped,
          skippedReason: result.skippedReason,
          wrote: result.wrote,
          errorCount: result.errors.length,
        },
        severity: result.errors.length > 0 ? 'WARN' : 'INFO',
      }).catch(() => {})
      return NextResponse.json({
        ok: true,
        jobsSynced: result.skipped ? 0 : 1,
        result,
        errors: result.errors,
      })
    } catch (e: any) {
      await logAudit({
        staffId: request.headers.get('x-staff-id') || '',
        action: 'FAIL',
        entity: 'hyphen_sync',
        entityId: jobId,
        details: { mode: 'single', error: e?.message || String(e) },
        severity: 'WARN',
      }).catch(() => {})
      // Task spec: graceful degradation. Even on an internal throw, return
      // ok:true with the reason — the caller can inspect `errors`.
      return NextResponse.json({
        ok: true,
        jobsSynced: 0,
        errors: [{ jobId, step: 'orchestrator', message: e?.message || String(e) }],
      })
    }
  }

  // All-active path
  try {
    const summary = await syncAllActiveJobs()
    await logAudit({
      staffId: request.headers.get('x-staff-id') || '',
      staffName:
        `${request.headers.get('x-staff-firstname') || ''} ${request.headers.get('x-staff-lastname') || ''}`.trim() || undefined,
      action: 'SYNC',
      entity: 'hyphen_sync',
      details: {
        mode: 'all',
        scraperEnabled,
        skippedReason: summary.skippedReason,
        jobsSynced: summary.jobsSynced,
        totalWritten: summary.totalWritten,
        errorCount: summary.errors.length,
      },
      severity: summary.errors.length > 0 ? 'WARN' : 'INFO',
    }).catch(() => {})

    if (summary.skippedReason) {
      return NextResponse.json({
        ok: true,
        skipped: true,
        reason: summary.skippedReason,
        jobsSynced: 0,
        errors: [],
        config: {
          hasCreds: cfg.hasCreds,
          hasUrl: cfg.hasUrl,
          playwrightInstalled: cfg.playwrightInstalled,
        },
      })
    }

    return NextResponse.json({
      ok: true,
      jobsSynced: summary.jobsSynced,
      totalWritten: summary.totalWritten,
      errors: summary.errors,
    })
  } catch (e: any) {
    await logAudit({
      staffId: request.headers.get('x-staff-id') || '',
      action: 'FAIL',
      entity: 'hyphen_sync',
      details: { mode: 'all', error: e?.message || String(e) },
      severity: 'WARN',
    }).catch(() => {})
    return NextResponse.json({
      ok: true,
      jobsSynced: 0,
      errors: [{ step: 'orchestrator', message: e?.message || String(e) }],
    })
  }
}

// Allow GET for convenience when an admin hits the route in a browser with
// ?jobId=... — behavior mirrors POST exactly.
export async function GET(request: NextRequest) {
  return POST(request)
}
