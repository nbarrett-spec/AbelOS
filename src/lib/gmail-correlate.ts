/**
 * Gmail → Job / Builder correlation engine
 *
 * Pure matcher: given a thread's text + metadata, return the best Job and/or
 * Builder match with a confidence score. Designed to be called from:
 *   - POST /api/integrations/gmail/correlate (backfill + on-demand)
 *   - A future cron that re-runs correlation on newly-synced CommunicationLog rows
 *
 * Matching rules (first rule to fire wins; confidence decreases as signal weakens):
 *
 *   1. Lot + community match         → 0.95   (Job.lotBlock + Job.community)
 *   2. Builder's PO number           → 0.92   (Job.bwpPoNumber)
 *   3. Abel PO number                → 0.90   (PurchaseOrder.poNumber → jobs via order? N/A — PO is vendor-side)
 *   4. Abel order number (SO)        → 0.88   (Order.orderNumber → Job via orderId)
 *   5. Job address / street match    → 0.75   (Job.jobAddress)
 *   6. Sender email domain → Builder → 0.60   (builder-only, no job)
 *   7. No match                      → 0.00
 *
 * Additive-only: no schema migrations; all reads are against existing tables.
 */

import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ThreadInput {
  subject?: string | null
  snippet?: string | null
  bodyText?: string | null
  fromEmail?: string | null
}

export type MatchReason =
  | 'LOT_COMMUNITY'
  | 'BUILDER_PO'
  | 'ABEL_PO'
  | 'ORDER_NUMBER'
  | 'JOB_ADDRESS'
  | 'SENDER_DOMAIN'
  | 'NONE'

export interface CorrelationResult {
  jobId?: string
  builderId?: string
  confidence: number
  matchedOn: MatchReason
  /** Human-readable trail for audit/debugging. */
  evidence?: string
}

// ──────────────────────────────────────────────────────────────────────────
// Normalization helpers (no external deps)
// ──────────────────────────────────────────────────────────────────────────

export function normalize(s: string | null | undefined): string {
  if (!s) return ''
  return s.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function squishSpaces(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

/** Concatenate all thread text we care about into one searchable blob. */
function haystack(t: ThreadInput): string {
  return squishSpaces(
    [t.subject ?? '', t.snippet ?? '', t.bodyText ?? ''].join(' ')
  )
}

/** Levenshtein distance (tiny, iterative, O(m*n)). Used sparingly for fuzzy street compares. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  const m = a.length
  const n = b.length
  const prev = new Array(n + 1)
  const curr = new Array(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j
  for (let i = 1; i <= m; i++) {
    curr[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j]
  }
  return prev[n]
}

// Treat two short strings as a fuzzy match if normalized-edit-distance ≤ ~15%
function fuzzyIncludes(haystackNorm: string, needleNorm: string): boolean {
  if (!needleNorm || needleNorm.length < 4) return false
  if (haystackNorm.includes(needleNorm)) return true
  // Sliding window over haystack, compare to needle with a small edit budget.
  const budget = Math.max(1, Math.floor(needleNorm.length * 0.15))
  const nLen = needleNorm.length
  // Speed: cap scan to first 4000 chars — email bodies can be huge.
  const hay = haystackNorm.slice(0, 4000)
  for (let start = 0; start <= hay.length - nLen; start += Math.max(1, Math.floor(nLen / 4))) {
    const slice = hay.slice(start, start + nLen + budget)
    if (levenshtein(slice.slice(0, nLen), needleNorm) <= budget) return true
  }
  return false
}

// ──────────────────────────────────────────────────────────────────────────
// Regex extractors — deliberately loose; we verify every hit by DB lookup.
// ──────────────────────────────────────────────────────────────────────────

// "Lot 4213", "Lot #4213", "lot 12b" (we keep the digits only)
const RE_LOT = /\blot\s*#?\s*(\d{1,5})\b/gi

// "PO# 12345", "PO-12345", "PO 12345", "P.O. 12345"  → 4-10 digits
const RE_PO = /\bp\.?o\.?[-\s#]*?(\d{4,10})\b/gi

// Abel-format sales order "ORD-2026-0001" or loose "Order #12345"
const RE_ORDER_STRICT = /\b(ORD[-\s]?\d{4}[-\s]?\d{3,6})\b/gi
const RE_ORDER_LOOSE = /\border\s*#?\s*(\d{4,10})\b/gi

// "PO-2026-0451" style Abel PO
const RE_ABEL_PO_STRICT = /\b(PO[-\s]?\d{4}[-\s]?\d{3,6})\b/gi

// Job number "JOB-2026-0142"
const RE_JOB_NUMBER = /\b(JOB[-\s]?\d{4}[-\s]?\d{3,6})\b/gi

// Street-ish phrase: "1234 Meadow Ridge Dr" → capture leading number + up to 4 words
const RE_STREET = /\b(\d{2,6})\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){0,3})\s+(dr|drive|st|street|ln|lane|rd|road|ct|court|blvd|boulevard|way|pl|place|ave|avenue|cir|circle|trl|trail)\b/gi

function extractFirstLot(text: string): string | undefined {
  const m = RE_LOT.exec(text)
  RE_LOT.lastIndex = 0
  return m ? m[1] : undefined
}

function extractAllMatches(re: RegExp, text: string): string[] {
  const out: string[] = []
  let m
  while ((m = re.exec(text)) !== null) out.push(m[1])
  re.lastIndex = 0
  return out
}

function domainOf(email: string | null | undefined): string | undefined {
  if (!email) return undefined
  const at = email.lastIndexOf('@')
  if (at < 0) return undefined
  return email.slice(at + 1).trim().toLowerCase()
}

// Free mail + internal domains that should NEVER be treated as builder-attribution.
const GENERIC_DOMAINS = new Set([
  'gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'live.com', 'aol.com',
  'icloud.com', 'me.com', 'msn.com', 'protonmail.com', 'proton.me',
  'abellumber.com', // our own domain is noise for this purpose
])

// ──────────────────────────────────────────────────────────────────────────
// Rule executors — each returns a result or null.
// ──────────────────────────────────────────────────────────────────────────

/** Rule 1 — lot number AND a community substring appearing in the haystack. */
async function tryLotCommunityMatch(hay: string): Promise<CorrelationResult | null> {
  const lot = extractFirstLot(hay)
  if (!lot) return null

  // Pull candidate jobs that mention the lot number anywhere in lotBlock.
  // We keep the set bounded — in prod the total Job count is in the thousands,
  // and an active lot appears in few rows.
  const candidates = await prisma.job.findMany({
    where: {
      lotBlock: { contains: lot, mode: 'insensitive' },
      community: { not: null },
    },
    select: { id: true, lotBlock: true, community: true, builderName: true },
    take: 50,
  })
  if (candidates.length === 0) return null

  const hayNorm = normalize(hay)
  // Walk candidates; accept only if the community name (or its first token)
  // is fuzzy-contained in the thread text.
  for (const job of candidates) {
    const community = (job.community ?? '').trim()
    if (!community) continue
    const commNorm = normalize(community)
    if (commNorm.length >= 4 && fuzzyIncludes(hayNorm, commNorm)) {
      return {
        jobId: job.id,
        confidence: 0.95,
        matchedOn: 'LOT_COMMUNITY',
        evidence: `lot=${lot} community="${community}" job=${job.id}`,
      }
    }
    // Fall back to the first token of the community (e.g. "Mobberly" for "Mobberly Farms")
    const firstToken = community.split(/\s+/)[0]
    if (firstToken && firstToken.length >= 5) {
      const tokenNorm = normalize(firstToken)
      if (hayNorm.includes(tokenNorm)) {
        return {
          jobId: job.id,
          confidence: 0.93,
          matchedOn: 'LOT_COMMUNITY',
          evidence: `lot=${lot} communityToken="${firstToken}" job=${job.id}`,
        }
      }
    }
  }
  return null
}

/** Rule 2 — Builder's PO number mentioned (Job.bwpPoNumber). */
async function tryBuilderPoMatch(hay: string): Promise<CorrelationResult | null> {
  const pos = extractAllMatches(RE_PO, hay)
  if (pos.length === 0) return null
  // Also check Abel-style PO strings (they are vendor-side, handled separately)
  for (const po of pos) {
    const job = await prisma.job.findFirst({
      where: { bwpPoNumber: { contains: po, mode: 'insensitive' } },
      select: { id: true, bwpPoNumber: true },
    })
    if (job) {
      return {
        jobId: job.id,
        confidence: 0.92,
        matchedOn: 'BUILDER_PO',
        evidence: `bwpPoNumber~="${po}" job=${job.id}`,
      }
    }
  }
  return null
}

/** Rule 3/4 — Abel order number → Job via Order.jobs relation. */
async function tryOrderNumberMatch(hay: string): Promise<CorrelationResult | null> {
  const strict = extractAllMatches(RE_ORDER_STRICT, hay)
  const loose = strict.length ? [] : extractAllMatches(RE_ORDER_LOOSE, hay)
  const candidates = [...strict, ...loose]
  if (candidates.length === 0) return null

  for (const raw of candidates) {
    // Tolerant match: search by contains on orderNumber (handles spacing/dash diffs).
    const order = await prisma.order.findFirst({
      where: { orderNumber: { contains: raw.replace(/\s/g, ''), mode: 'insensitive' } },
      select: { id: true, orderNumber: true, builderId: true, jobs: { select: { id: true }, take: 1 } },
    })
    if (order) {
      const jobId = order.jobs?.[0]?.id
      if (jobId) {
        return {
          jobId,
          builderId: order.builderId,
          confidence: 0.88,
          matchedOn: 'ORDER_NUMBER',
          evidence: `order=${order.orderNumber} job=${jobId}`,
        }
      }
      // Order found but no linked job → still credit the builder.
      return {
        builderId: order.builderId,
        confidence: 0.70,
        matchedOn: 'ORDER_NUMBER',
        evidence: `order=${order.orderNumber} (no job linked)`,
      }
    }
  }
  return null
}

/** Rule 5 — street/address match against Job.jobAddress. */
async function tryAddressMatch(hay: string): Promise<CorrelationResult | null> {
  // Only proceed if the thread text looks address-shaped.
  const addrMatch = RE_STREET.exec(hay)
  RE_STREET.lastIndex = 0
  if (!addrMatch) return null

  const streetNumber = addrMatch[1]
  const streetName = addrMatch[2]
  const streetNameNorm = normalize(streetName)
  if (!streetNumber || streetNameNorm.length < 4) return null

  // Pull a bounded set of jobs whose jobAddress contains the house number.
  // Most street-numbers are distinctive enough that the candidate set stays small.
  const candidates = await prisma.job.findMany({
    where: {
      jobAddress: { contains: streetNumber, mode: 'insensitive' },
    },
    select: { id: true, jobAddress: true, community: true },
    take: 25,
  })
  if (candidates.length === 0) return null

  for (const job of candidates) {
    const addr = (job.jobAddress ?? '').trim()
    if (!addr) continue
    const addrNorm = normalize(addr)
    if (addrNorm.includes(streetNameNorm)) {
      return {
        jobId: job.id,
        confidence: 0.75,
        matchedOn: 'JOB_ADDRESS',
        evidence: `address~="${streetNumber} ${streetName}" job=${job.id} jobAddress="${addr}"`,
      }
    }
  }
  return null
}

/** Rule 6 — sender domain → Builder (last-resort, builder-only, no job). */
async function trySenderDomainMatch(fromEmail: string | null | undefined): Promise<CorrelationResult | null> {
  const dom = domainOf(fromEmail || '')
  if (!dom || GENERIC_DOMAINS.has(dom)) return null

  // Builder.email is a single email per row (unique). We derive the domain
  // on the fly — no Builder.emailDomain column exists in schema.
  const builders = await prisma.builder.findMany({
    where: {
      email: { endsWith: `@${dom}`, mode: 'insensitive' },
    },
    select: { id: true, email: true },
    take: 5,
  })
  if (builders.length === 0) return null
  // Prefer exact-domain matches; we already filter by endsWith so take first.
  const b = builders[0]
  return {
    builderId: b.id,
    confidence: 0.60,
    matchedOn: 'SENDER_DOMAIN',
    evidence: `fromDomain=${dom} → builder=${b.id} via email=${b.email}`,
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Public entrypoint
// ──────────────────────────────────────────────────────────────────────────

/**
 * Correlate a single thread/email against Jobs + Builders in the DB.
 * Returns the first (highest-priority) rule that produced a match.
 */
export async function correlateThread(thread: ThreadInput): Promise<CorrelationResult> {
  const hay = haystack(thread)

  // Short-circuit: completely empty input yields no match.
  if (!hay && !thread.fromEmail) {
    return { confidence: 0, matchedOn: 'NONE' }
  }

  // Rule order is intentional — do NOT reorder without re-tuning confidence.
  const rules: Array<() => Promise<CorrelationResult | null>> = [
    () => tryLotCommunityMatch(hay),
    () => tryBuilderPoMatch(hay),
    () => tryOrderNumberMatch(hay),
    () => tryAddressMatch(hay),
    () => trySenderDomainMatch(thread.fromEmail ?? null),
  ]

  for (const rule of rules) {
    try {
      const r = await rule()
      if (r) return r
    } catch (e) {
      // A rule failure should never sink the whole correlation pass —
      // the next rule still deserves a shot.
      // eslint-disable-next-line no-console
      console.warn('[gmail-correlate] rule failed:', e instanceof Error ? e.message : String(e))
    }
  }

  return { confidence: 0, matchedOn: 'NONE' }
}

// ──────────────────────────────────────────────────────────────────────────
// Thin convenience for callers that want just a pure regex pass (no DB).
// Useful for tests, offline previews, and the UI "why did this match?" tooltip.
// ──────────────────────────────────────────────────────────────────────────

export interface ExtractedSignals {
  lots: string[]
  pos: string[]
  orders: string[]
  jobNumbers: string[]
  abelPos: string[]
  addresses: Array<{ number: string; name: string; type: string }>
  fromDomain?: string
}

export function extractSignals(thread: ThreadInput): ExtractedSignals {
  const hay = haystack(thread)
  const addresses: Array<{ number: string; name: string; type: string }> = []
  let m: RegExpExecArray | null
  RE_STREET.lastIndex = 0
  while ((m = RE_STREET.exec(hay)) !== null) {
    addresses.push({ number: m[1], name: m[2], type: m[3] })
  }
  RE_STREET.lastIndex = 0
  return {
    lots: extractAllMatches(RE_LOT, hay),
    pos: extractAllMatches(RE_PO, hay),
    orders: [...extractAllMatches(RE_ORDER_STRICT, hay), ...extractAllMatches(RE_ORDER_LOOSE, hay)],
    jobNumbers: extractAllMatches(RE_JOB_NUMBER, hay),
    abelPos: extractAllMatches(RE_ABEL_PO_STRICT, hay),
    addresses,
    fromDomain: domainOf(thread.fromEmail ?? undefined),
  }
}
