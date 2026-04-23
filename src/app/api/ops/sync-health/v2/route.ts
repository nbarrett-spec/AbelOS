export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { INTEGRATIONS } from '@/lib/integrations/registry'
import { getQuickBooksStatus } from '@/lib/integrations/quickbooks'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/sync-health/v2
//
// Returns the canonical list of integrations (see registry), each enriched
// with live status from IntegrationConfig + SyncLog. Designed to drive
// Dawn's sync-health dashboard.
//
// Shape per row:
//   { key, label, description, category,
//     provider, status: 'green'|'amber'|'red'|'unknown',
//     lastSync: { at, status, recordsProcessed } | null,
//     errorMessage,
//     staleHours, isStale, staleReason,
//     configPath, retryPath }
//
// Plus: stale summary (how many stale?) and alert copy for banner.
//
// GET /api/ops/sync-health/v2?provider=INFLOW  → returns last 20 SyncLogs
// for drill-down.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const provider = searchParams.get('provider')

    // Drill-down mode — return recent SyncLogs for a specific provider
    if (provider) {
      const logs: any[] = await prisma.$queryRawUnsafe(`
        SELECT id, provider, "syncType", direction, status, "recordsProcessed",
               "recordsCreated", "recordsUpdated", "recordsFailed", "errorMessage",
               "startedAt", "completedAt", "durationMs"
        FROM "SyncLog"
        WHERE provider = $1
        ORDER BY "completedAt" DESC
        LIMIT 20
      `, provider.toUpperCase())
      return NextResponse.json({ provider, logs })
    }

    // Load IntegrationConfig rows for all known providers (enum-backed)
    const configs: any[] = await prisma.$queryRawUnsafe(`
      SELECT provider::text as provider, name, status::text as status,
             "syncEnabled", "lastSyncAt", "lastSyncStatus"
      FROM "IntegrationConfig"
    `)
    const configByProvider = new Map(configs.map((c: any) => [c.provider, c]))

    // Last sync per provider from SyncLog (more recent than IntegrationConfig.lastSyncAt
    // when manual syncs have run)
    const latest: any[] = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON (provider)
        provider, status, "recordsProcessed", "errorMessage", "completedAt"
      FROM "SyncLog"
      ORDER BY provider, "completedAt" DESC
    `)
    const latestByProvider = new Map(latest.map((l: any) => [l.provider, l]))

    const now = new Date()
    const rows = await Promise.all(INTEGRATIONS.map(async (spec) => {
      const cfg = configByProvider.get(spec.dbProvider)
      const last = latestByProvider.get(spec.dbProvider)

      // QBO status injection
      let qbStatus = null
      if (spec.dbProvider === 'QUICKBOOKS_ONLINE') {
        qbStatus = await getQuickBooksStatus({
          lastSyncAt: cfg?.lastSyncAt ? new Date(cfg.lastSyncAt) : null,
          lastSyncStatus: cfg?.lastSyncStatus ?? null,
        })
      }

      const lastSyncAt = last?.completedAt ? new Date(last.completedAt) : (cfg?.lastSyncAt ? new Date(cfg.lastSyncAt) : null)
      const ageMs = lastSyncAt ? now.getTime() - lastSyncAt.getTime() : null
      const staleMs = spec.staleHours * 3600 * 1000
      const isStale = ageMs === null ? true : ageMs > staleMs

      let status: 'green' | 'amber' | 'red' | 'unknown' = 'unknown'
      if (!cfg) {
        // No config row — not connected yet
        status = 'unknown'
      } else if (cfg.status === 'ERROR' || last?.status === 'FAILED') {
        status = 'red'
      } else if (isStale || last?.status === 'PARTIAL') {
        status = 'amber'
      } else if (cfg.status === 'CONNECTED') {
        status = 'green'
      } else {
        status = 'unknown'
      }

      return {
        key: spec.key,
        label: spec.label,
        description: spec.description,
        category: spec.category,
        provider: spec.dbProvider,
        status,
        configured: !!cfg,
        syncEnabled: cfg?.syncEnabled ?? false,
        lastSync: lastSyncAt ? {
          at: lastSyncAt.toISOString(),
          status: last?.status ?? cfg?.lastSyncStatus ?? 'UNKNOWN',
          recordsProcessed: last?.recordsProcessed ? Number(last.recordsProcessed) : 0,
          ageMs,
          ageHuman: formatAge(ageMs),
        } : null,
        errorMessage: last?.errorMessage ?? null,
        staleHours: spec.staleHours,
        isStale,
        staleReason: isStale
          ? (ageMs === null ? 'Never synced' : `Last synced ${formatAge(ageMs)} ago (threshold ${spec.staleHours}h)`)
          : null,
        configPath: spec.configPath,
        retryPath: spec.retryPath,
        qbStatus,
      }
    }))

    const staleCount = rows.filter(r => r.isStale && r.configured).length
    const errorCount = rows.filter(r => r.status === 'red').length
    const alertBanner = buildAlert(rows, staleCount, errorCount)

    return NextResponse.json({
      asOf: now.toISOString(),
      rows,
      summary: {
        total: rows.length,
        green: rows.filter(r => r.status === 'green').length,
        amber: rows.filter(r => r.status === 'amber').length,
        red: errorCount,
        unknown: rows.filter(r => r.status === 'unknown').length,
        stale: staleCount,
      },
      alertBanner,
    })
  } catch (err: any) {
    console.error('[sync-health/v2]', err)
    return NextResponse.json({ error: err?.message || 'failed' }, { status: 500 })
  }
}

function formatAge(ms: number | null): string {
  if (ms === null) return 'never'
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  if (ms < 86400000) return `${(ms / 3600000).toFixed(1)}h`
  return `${(ms / 86400000).toFixed(1)}d`
}

function buildAlert(rows: any[], stale: number, errors: number): string | null {
  if (errors > 0) {
    const names = rows.filter(r => r.status === 'red').map(r => r.label).slice(0, 3)
    return `${errors} integration${errors === 1 ? '' : 's'} failing: ${names.join(', ')}${errors > 3 ? '…' : ''}`
  }
  if (stale > 0) {
    const stalest = rows
      .filter(r => r.isStale && r.configured && r.lastSync)
      .sort((a, b) => (b.lastSync?.ageMs ?? 0) - (a.lastSync?.ageMs ?? 0))[0]
    if (stalest) {
      return `${stale} source${stale === 1 ? ' is' : 's are'} stale — ${stalest.label} hasn't synced in ${stalest.lastSync?.ageHuman}.`
    }
    return `${stale} source${stale === 1 ? ' is' : 's are'} stale.`
  }
  return null
}
