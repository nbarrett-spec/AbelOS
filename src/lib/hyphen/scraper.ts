// ──────────────────────────────────────────────────────────────────────────
// Hyphen portal scraper
//
// Hyphen SupplyPro doesn't expose a public REST surface for schedules,
// closing dates, red-line markup PDFs, plan sets, or change-order PDFs.
// The only reliable way to pull these is to log in through the builder
// portal and scrape. This file is the seam for that work.
//
// Current state:
//   - Playwright is NOT installed in the repo (checked against package.json
//     at the time of authoring — see report). Rather than add a heavy
//     dependency pre-launch, this module ships as a STUB that degrades
//     gracefully in three ways:
//       1. HYPHEN_USERNAME / HYPHEN_PASSWORD missing → every fetch returns
//          { ok: false, reason: 'HYPHEN_CREDS_MISSING' }
//       2. Credentials present but playwright not installed → every fetch
//          returns { ok: false, reason: 'PLAYWRIGHT_NOT_INSTALLED',
//          message: 'npm i playwright && npx playwright install chromium' }
//       3. Any unexpected scrape failure is caught and returned as
//          { ok: false, reason: 'SCRAPE_ERROR', message }
//
// When Nate installs playwright on the NUC and sets the env vars, the
// `isEnabled()` guard flips to true and the stubs should be replaced with
// real implementations. The method surface below is the contract callers
// (job-sync.ts) depend on — don't change signatures without updating them.
//
// References:
//   - docs/HYPHEN_SPCONNECT_SETUP.md (adjacent SPConnect / OAuth surface)
//   - src/lib/hyphen/processor.ts    (how structured order data flows)
// ──────────────────────────────────────────────────────────────────────────

import { logger } from '@/lib/logger'

export type ScrapeReason =
  | 'HYPHEN_CREDS_MISSING'
  | 'PLAYWRIGHT_NOT_INSTALLED'
  | 'HYPHEN_URL_MISSING'
  | 'SCRAPE_ERROR'
  | 'RATE_LIMITED'
  | 'NOT_FOUND'

export interface ScrapeFailure {
  ok: false
  reason: ScrapeReason
  message?: string
}

export interface ScheduleResult {
  ok: true
  jobId: string
  requestedStart: string | null
  requestedEnd: string | null
  acknowledgedStart: string | null
  acknowledgedEnd: string | null
  actualStart: string | null
  actualEnd: string | null
  notes: string | null
  fetchedAt: string
}

export interface ClosingDateResult {
  ok: true
  jobId: string
  closingDate: string | null // ISO date
  source: string // e.g. "Job Details > Closing"
  fetchedAt: string
}

export interface PdfDoc {
  url: string
  fileName: string | null
  kind: 'red_line' | 'plan_group_1' | 'plan_group_2' | 'change_order' | 'other'
  sha256?: string | null
  sizeBytes?: number | null
  metadata?: Record<string, any>
}

export interface DocListResult {
  ok: true
  jobId: string
  documents: PdfDoc[]
  fetchedAt: string
}

export interface ChangeOrderEntry {
  coNumber: string
  pdfUrl: string | null
  summary: string | null
  netValueChange: number | null
  reason: string | null
  fetchedAt: string
}

export interface ChangeOrderListResult {
  ok: true
  jobId: string
  changeOrders: ChangeOrderEntry[]
  fetchedAt: string
}

// ──────────────────────────────────────────────────────────────────────────
// Feature gating
// ──────────────────────────────────────────────────────────────────────────

export interface HyphenScraperConfig {
  username: string | null
  password: string | null
  baseUrl: string | null
  hasCreds: boolean
  hasUrl: boolean
  playwrightInstalled: boolean
}

export function getScraperConfig(): HyphenScraperConfig {
  const username = process.env.HYPHEN_USERNAME?.trim() || null
  const password = process.env.HYPHEN_PASSWORD?.trim() || null
  const baseUrl =
    process.env.HYPHEN_URL?.trim() ||
    process.env.HYPHEN_BASE_URL?.trim() ||
    process.env.HYPHEN_PORTAL_URL?.trim() ||
    null
  const hasCreds = !!(username && password)
  const hasUrl = !!baseUrl

  // Resolve lazily — require.resolve throws when the module isn't present,
  // which is the expected state pre-launch. We never import playwright from
  // this file to keep the bundle clean.
  let playwrightInstalled = false
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require.resolve('playwright')
    playwrightInstalled = true
  } catch {
    playwrightInstalled = false
  }

  return { username, password, baseUrl, hasCreds, hasUrl, playwrightInstalled }
}

export function isScraperEnabled(): boolean {
  const cfg = getScraperConfig()
  return cfg.hasCreds && cfg.hasUrl && cfg.playwrightInstalled
}

function disabledReason(cfg: HyphenScraperConfig): ScrapeFailure {
  if (!cfg.hasCreds) {
    return {
      ok: false,
      reason: 'HYPHEN_CREDS_MISSING',
      message: 'Set HYPHEN_USERNAME and HYPHEN_PASSWORD env vars to enable the scraper',
    }
  }
  if (!cfg.hasUrl) {
    return {
      ok: false,
      reason: 'HYPHEN_URL_MISSING',
      message: 'Set HYPHEN_URL env var (or HYPHEN_BASE_URL / HYPHEN_PORTAL_URL) to the builder portal base',
    }
  }
  if (!cfg.playwrightInstalled) {
    return {
      ok: false,
      reason: 'PLAYWRIGHT_NOT_INSTALLED',
      message: 'Hyphen scraper requires playwright — run: npm i playwright && npx playwright install chromium',
    }
  }
  return { ok: false, reason: 'SCRAPE_ERROR', message: 'Scraper disabled for unknown reason' }
}

// ──────────────────────────────────────────────────────────────────────────
// Public surface — every method returns a discriminated union so callers
// never have to throw/try. When `ok:false` the caller should record the
// reason and move on (partial-failure pattern used throughout Aegis).
// ──────────────────────────────────────────────────────────────────────────

export async function fetchJobSchedule(
  jobId: string,
): Promise<ScheduleResult | ScrapeFailure> {
  const cfg = getScraperConfig()
  if (!isScraperEnabled()) return disabledReason(cfg)

  // Real implementation would:
  //   1. new Browser via dynamic import('playwright')
  //   2. login(cfg.username, cfg.password, cfg.baseUrl)
  //   3. navigate to /jobs/<jobId>/schedule
  //   4. parse schedule table into ScheduleResult
  //
  // Until that lands, every call fails loudly (but gracefully) with the
  // PLAYWRIGHT_NOT_INSTALLED path — which means isScraperEnabled() will
  // have short-circuited above. This block is reserved for the real impl.
  try {
    throw new Error('NotImplementedError: fetchJobSchedule requires playwright — install and implement')
  } catch (e: any) {
    logger.error('hyphen_scrape_schedule_failed', e, { jobId })
    return { ok: false, reason: 'SCRAPE_ERROR', message: e?.message || 'fetchJobSchedule not implemented' }
  }
}

export async function fetchJobClosingDate(
  jobId: string,
): Promise<ClosingDateResult | ScrapeFailure> {
  const cfg = getScraperConfig()
  if (!isScraperEnabled()) return disabledReason(cfg)
  try {
    throw new Error('NotImplementedError: fetchJobClosingDate requires playwright — install and implement')
  } catch (e: any) {
    logger.error('hyphen_scrape_closing_failed', e, { jobId })
    return { ok: false, reason: 'SCRAPE_ERROR', message: e?.message || 'fetchJobClosingDate not implemented' }
  }
}

export async function fetchJobRedLines(
  jobId: string,
): Promise<DocListResult | ScrapeFailure> {
  const cfg = getScraperConfig()
  if (!isScraperEnabled()) return disabledReason(cfg)
  try {
    throw new Error('NotImplementedError: fetchJobRedLines requires playwright — install and implement')
  } catch (e: any) {
    logger.error('hyphen_scrape_redlines_failed', e, { jobId })
    return { ok: false, reason: 'SCRAPE_ERROR', message: e?.message || 'fetchJobRedLines not implemented' }
  }
}

export async function fetchJobPlanSet(
  jobId: string,
  group: 1 | 2,
): Promise<DocListResult | ScrapeFailure> {
  const cfg = getScraperConfig()
  if (!isScraperEnabled()) return disabledReason(cfg)
  try {
    throw new Error(`NotImplementedError: fetchJobPlanSet(group=${group}) requires playwright — install and implement`)
  } catch (e: any) {
    logger.error('hyphen_scrape_planset_failed', e, { jobId, group })
    return { ok: false, reason: 'SCRAPE_ERROR', message: e?.message || 'fetchJobPlanSet not implemented' }
  }
}

export async function fetchJobChangeOrders(
  jobId: string,
): Promise<ChangeOrderListResult | ScrapeFailure> {
  const cfg = getScraperConfig()
  if (!isScraperEnabled()) return disabledReason(cfg)
  try {
    throw new Error('NotImplementedError: fetchJobChangeOrders requires playwright — install and implement')
  } catch (e: any) {
    logger.error('hyphen_scrape_co_failed', e, { jobId })
    return { ok: false, reason: 'SCRAPE_ERROR', message: e?.message || 'fetchJobChangeOrders not implemented' }
  }
}
