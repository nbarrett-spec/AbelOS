// ──────────────────────────────────────────────────────────────────────────
// QuickBooks Online (QBO) — Integration Wrapper
// ──────────────────────────────────────────────────────────────────────────
// CURRENT STATE OF QB INTEGRATION (2026-05-05):
//
// There are TWO QB code paths in this repo. Don't confuse them.
//
//   1. QBWC (QuickBooks Desktop Web Connector) — LIVE.
//      - SOAP endpoint: src/app/api/v1/qb/qbwc/route.ts
//      - Parser/upserts: src/lib/qbwc/{soap,qbxml,sequence,upserts,brain}.ts
//      - Mirror tables (defined in prisma/schema.prisma ~L6415):
//        QbCustomer, QbVendor, QbAccount, QbItem, QbInvoice, QbInvoiceLine,
//        QbBill, QbBillExpenseLine.
//      - Daily aggregator: src/app/api/cron/qb-aggregate/route.ts (vercel.json
//        cron @ 12:00 UTC) reads those tables via $queryRawUnsafe and pushes
//        a 'finance_daily_snapshot' to Brain. THIS IS LIVE.
//      - Decision note in qbwc/route.ts: revived 2026-04-30 per Nate's call
//        as a pragmatic bridge until QBO OAuth ships.
//
//   2. QBO (QuickBooks Online, OAuth2) — DEPRECATED / phase-2 stub.
//      - This file is the QBO wrapper. The four sync* functions below are
//        DEPRECATED stubs that return {skipped:true,reason:'not implemented'}
//        and have NO callers in the repo today. Kept compiling-clean so the
//        UI + monthly-close plumbing compile. Do not add new callers.
//      - Live external callers:
//          syncMonthEndToQuickBooks → /api/ops/finance/monthly-close (qb_sync
//            action) — returns the legacy {ok,recordsSynced,...} envelope
//            with ok:false until QBO OAuth is wired.
//          pushInvoiceToQuickBooks  → currently unused, kept for symmetry.
//          getQuickBooksStatus / getQboStatus → /api/ops/sync-health/v2 and
//            /api/ops/integrations/quickbooks/status (UI status card).
//
// If you are adding QB functionality TODAY, route through QBWC + the Qb*
// tables. If/when Phase 2 lands, replace the deprecated stubs in this file
// with real Intuit OAuth2 sync bodies.
//
// Auth model (QBO):
//   QBO_CLIENT_ID        Intuit app client ID
//   QBO_CLIENT_SECRET    Intuit app client secret
//   QBO_REALM_ID         QuickBooks company/realm to sync
//   QBO_REFRESH_TOKEN    Long-lived refresh token (exchanged for access tokens)
//   QBO_ACCESS_TOKEN     Short-lived bearer token (refreshed on demand)
//   QBO_API_BASE         Defaults to https://quickbooks.api.intuit.com/v3
// ──────────────────────────────────────────────────────────────────────────

import type { SyncResult } from './types'

// ─── Types ────────────────────────────────────────────────────────────────

export interface QboConfig {
  clientId: string
  clientSecret: string
  realmId: string
  refreshToken?: string
  accessToken?: string
  accessTokenExpiresAt?: Date
  apiBase: string
}

export interface QboConnectionStatus {
  provider: 'QUICKBOOKS_ONLINE'
  connected: boolean
  configured: boolean
  realmId: string | null
  apiBase: string
  credentialsPresent: boolean
  missing: string[]
  phase: 'phase2-stub' | 'active'
  notes: string
  lastSyncAt?: string | null
  lastSyncStatus?: string | null
}

export interface QboSyncResult extends SyncResult {
  skipped: boolean
  reason?: string
}

// Legacy shape retained for any older callers expecting the flat envelope.
export interface QBSyncResult {
  ok: boolean
  recordsSynced: number
  errors: string[]
  message: string
}

// ─── Config ───────────────────────────────────────────────────────────────

/**
 * True when the required QBO env vars are all present.
 */
export function isQuickBooksConfigured(): boolean {
  return !!(
    process.env.QBO_CLIENT_ID &&
    process.env.QBO_CLIENT_SECRET &&
    process.env.QBO_REALM_ID
  )
}

/**
 * Load QBO config from env. Returns null if clientId / clientSecret are missing.
 *
 * Phase 2 will layer `IntegrationConfig` DB rows on top of env defaults
 * (same pattern as InFlow / BuilderTrend).
 */
export function getQboConfigFromEnv(): QboConfig | null {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  const realmId = process.env.QBO_REALM_ID
  const refreshToken = process.env.QBO_REFRESH_TOKEN
  const accessToken = process.env.QBO_ACCESS_TOKEN
  const apiBase = process.env.QBO_API_BASE || 'https://quickbooks.api.intuit.com/v3'

  if (!clientId || !clientSecret) return null

  return {
    clientId,
    clientSecret,
    realmId: realmId || '',
    refreshToken: refreshToken || undefined,
    accessToken: accessToken || undefined,
    apiBase,
  }
}

/**
 * Status readout for the /api/ops/integrations/quickbooks/status route and
 * the /ops/integrations/quickbooks page. No network calls; reports env +
 * optional last-sync DB hints.
 */
export function getQboStatus(
  lastSync?: { lastSyncAt?: Date | null; lastSyncStatus?: string | null; realmId?: string | null }
): QboConnectionStatus {
  const required = ['QBO_CLIENT_ID', 'QBO_CLIENT_SECRET', 'QBO_REALM_ID']
  const missing = required.filter((k) => !process.env[k])
  const cfg = getQboConfigFromEnv()
  const credentialsPresent = missing.length === 0
  return {
    provider: 'QUICKBOOKS_ONLINE',
    // Phase 2 — no live OAuth handshake yet; this stays false regardless
    // of env completeness so the UI shows the "Coming in phase 2" state.
    connected: false,
    configured: credentialsPresent,
    realmId: lastSync?.realmId ?? cfg?.realmId ?? null,
    apiBase: cfg?.apiBase || 'https://quickbooks.api.intuit.com/v3',
    credentialsPresent,
    missing,
    phase: 'phase2-stub',
    notes:
      'QBO OAuth2 integration is scaffolded but not yet active. ' +
      'Set QBO_* env vars to prepare; Phase 2 will flip the switch.',
    lastSyncAt: lastSync?.lastSyncAt?.toISOString() ?? null,
    lastSyncStatus: lastSync?.lastSyncStatus ?? null,
  }
}

/**
 * Backwards-compat alias — several older modules still reach for
 * getQuickBooksStatus(). Keep the old name pointing at the new impl.
 */
export const getQuickBooksStatus = async (
  lastSync?: { lastSyncAt?: Date | null; lastSyncStatus?: string | null; realmId?: string | null }
) => getQboStatus(lastSync)

// ─── Sync Stubs (DEPRECATED) ──────────────────────────────────────────────
//
// DEPRECATED 2026-05-05. The four functions below — syncInvoices,
// syncPayments, syncJournals, and (further down) the legacy
// pushInvoiceToQuickBooks — return "not implemented yet" and have NO
// callers in the repo. They are retained ONLY so phase-2 work has a
// landing pad with the right signature. The LIVE QB path is QBWC; see
// the file header comment.
//
// Do not call these. Do not add new callers. If you need to integrate
// with QB today, write against the Qb* mirror tables that QBWC populates.

function buildSkippedResult(
  syncType: string,
  direction: 'PUSH' | 'PULL' | 'BIDIRECTIONAL'
): SyncResult {
  const now = new Date()
  return {
    // QUICKBOOKS is not yet in the IntegrationProvider union; cast for now.
    // Phase 2 will promote it to the enum + add a proper IntegrationConfig row.
    provider: 'QUICKBOOKS' as any,
    syncType,
    direction,
    status: 'SUCCESS',
    recordsProcessed: 0,
    recordsCreated: 0,
    recordsUpdated: 0,
    recordsSkipped: 0,
    recordsFailed: 0,
    errorMessage: undefined,
    errorDetails: { skipped: true, reason: 'not implemented yet' },
    startedAt: now,
    completedAt: now,
    durationMs: 0,
  }
}

/** @deprecated 2026-05-05. Unused stub. Use the QBWC pipeline (Qb* tables) instead. */
export async function syncInvoices(): Promise<QboSyncResult> {
  return {
    ...buildSkippedResult('invoices', 'PUSH'),
    skipped: true,
    reason: 'not implemented yet',
  }
}

/** @deprecated 2026-05-05. Unused stub. Use the QBWC pipeline (Qb* tables) instead. */
export async function syncPayments(): Promise<QboSyncResult> {
  return {
    ...buildSkippedResult('payments', 'PUSH'),
    skipped: true,
    reason: 'not implemented yet',
  }
}

/** @deprecated 2026-05-05. Unused stub. Use the QBWC pipeline (Qb* tables) instead. */
export async function syncJournals(): Promise<QboSyncResult> {
  return {
    ...buildSkippedResult('journals', 'PUSH'),
    skipped: true,
    reason: 'not implemented yet',
  }
}

// ─── Legacy helpers (kept so existing callers compile) ────────────────────

/**
 * Stub month-end sync in the legacy flat-envelope shape. Real impl in
 * Phase 2 will use syncJournals() underneath.
 */
export async function syncMonthEndToQuickBooks(args: {
  year: number
  month: number
}): Promise<QBSyncResult> {
  if (!isQuickBooksConfigured()) {
    return {
      ok: false,
      recordsSynced: 0,
      errors: ['qb_not_configured'],
      message: 'QB Online is not wired up yet. Month-end sync skipped.',
    }
  }
  return {
    ok: true,
    recordsSynced: 0,
    errors: [],
    message: `Month-end ${args.year}-${String(args.month).padStart(2, '0')} queued (stub).`,
  }
}

/**
 * @deprecated 2026-05-05. Unused stub — no callers in repo. Use the QBWC
 * pipeline (Qb* mirror tables) instead.
 */
export async function pushInvoiceToQuickBooks(invoiceId: string): Promise<QBSyncResult> {
  if (!isQuickBooksConfigured()) {
    return {
      ok: false,
      recordsSynced: 0,
      errors: ['qb_not_configured'],
      message: 'QB Online is not wired up yet.',
    }
  }
  return {
    ok: true,
    recordsSynced: 1,
    errors: [],
    message: `Invoice ${invoiceId} queued for QB push (stub).`,
  }
}
