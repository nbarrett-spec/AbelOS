// ──────────────────────────────────────────────────────────────────────────
// Hyphen correlation — match a HyphenDocument payload to an Aegis Job/Builder
//
// Ported from scripts/seed-builder-pricing.mjs fuzzy-match logic.
//
// Strategy (highest confidence first):
//   HIGH    — po_number matches Order.poNumber AND the Order has a jobId
//   MEDIUM  — normalized job_address ≈ Job.jobAddress AND builder matches
//   LOW     — normalized job_address ≈ Job.jobAddress alone
//   UNMATCHED
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'

export type MatchConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNMATCHED'
export type MatchMethod =
  | 'po_exact'
  | 'address_lot_builder'
  | 'address_builder'
  | 'address_only'
  | 'unmatched'

export interface CorrelationResult {
  jobId: string | null
  builderId: string | null
  matchConfidence: MatchConfidence
  matchMethod: MatchMethod
}

// ── normalizer (from seed-builder-pricing.mjs) ────────────────────
const STOP_WORDS = new Set([
  'homes', 'home', 'dfw', 'inc', 'inc.', 'llc', 'co', 'co.', 'corp', 'corp.',
  'the', 'and', '&', 'builders', 'builder', 'custom', 'doors', 'door',
  'trim', 'construction', 'group', 'company', 'development', 'developement',
  'design', 'designs', 'homebuilders', 'homebuilder',
  'properties', 'property', 'contractors', 'contracting', 'of', 'by',
  'a', 'an',
])

function normalizeStr(raw: string | null | undefined): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokenize(raw: string | null | undefined): string[] {
  return normalizeStr(raw)
    .split(' ')
    .filter((t) => t && !STOP_WORDS.has(t))
}

function compressed(raw: string | null | undefined): string {
  return tokenize(raw).join('')
}

/**
 * Normalize a street address for fuzzy comparison.
 * - drop punctuation, lowercase, collapse whitespace
 * - strip common suffixes (dr, drive, rd, road, etc.)
 * - drop zip codes
 */
export function normalizeAddress(raw: string | null | undefined): string {
  if (!raw) return ''
  let s = String(raw).toLowerCase()
  s = s.replace(/\b\d{5}(-\d{4})?\b/g, '') // zip
  s = s.replace(/[^a-z0-9\s]/g, ' ')
  s = s.replace(/\s+/g, ' ').trim()
  // collapse common street-suffix variations
  const suffixMap: Record<string, string> = {
    'drive': 'dr', 'road': 'rd', 'street': 'st', 'avenue': 'ave',
    'boulevard': 'blvd', 'lane': 'ln', 'court': 'ct', 'circle': 'cir',
    'place': 'pl', 'terrace': 'ter', 'parkway': 'pkwy', 'trail': 'trl',
  }
  const tokens = s.split(' ').map((t) => suffixMap[t] || t)
  return tokens.join(' ').trim()
}

interface BuilderRow { id: string; companyName: string }

/**
 * Match an incoming builder_name string against Builder.companyName.
 * Returns null if no confident match.
 */
export async function matchBuilder(
  builderName: string | null | undefined,
): Promise<BuilderRow | null> {
  const src = (builderName || '').trim()
  if (!src) return null

  const rows = await prisma.$queryRawUnsafe<BuilderRow[]>(`
    SELECT "id", "companyName"
    FROM "Builder"
    WHERE "companyName" IS NOT NULL AND "companyName" != ''
  `)

  const srcCompressed = compressed(src)
  const srcTokens = new Set(tokenize(src))
  if (!srcCompressed) return null

  const enriched = rows.map((b) => ({
    ...b,
    _tokens: new Set(tokenize(b.companyName)),
    _compressed: compressed(b.companyName),
  }))

  // 1. exact compressed
  const exact = enriched.find((b) => b._compressed === srcCompressed)
  if (exact) return { id: exact.id, companyName: exact.companyName }

  // 2. containment (len >= 3)
  const contained = enriched
    .filter(
      (b) =>
        b._compressed.length >= 3 &&
        srcCompressed.length >= 3 &&
        (b._compressed.includes(srcCompressed) ||
          srcCompressed.includes(b._compressed)),
    )
    .sort((a, b) => b._compressed.length - a._compressed.length)
  if (contained.length > 0)
    return { id: contained[0].id, companyName: contained[0].companyName }

  // 3. token overlap >= 2
  const withOverlap = enriched
    .map((b) => {
      let overlap = 0
      for (const t of b._tokens) if (srcTokens.has(t)) overlap++
      return { b, overlap }
    })
    .filter((x) => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap)
  if (withOverlap.length > 0)
    return { id: withOverlap[0].b.id, companyName: withOverlap[0].b.companyName }

  // 4. single distinctive token (len >= 5)
  const distinctive = enriched
    .map((b) => {
      for (const t of b._tokens) {
        if (t.length >= 5 && srcTokens.has(t)) return b
      }
      return null
    })
    .filter(Boolean) as typeof enriched
  if (distinctive.length === 1)
    return { id: distinctive[0].id, companyName: distinctive[0].companyName }
  if (distinctive.length > 1) {
    distinctive.sort((a, b) => a.companyName.length - b.companyName.length)
    return { id: distinctive[0].id, companyName: distinctive[0].companyName }
  }

  return null
}

interface CorrelateInput {
  poNumber?: string | null
  builderName?: string | null
  jobAddress?: string | null
  lotBlock?: string | null
  subdivision?: string | null
}

/**
 * Consult the HyphenCommunityAlias table to resolve a Hyphen portal
 * subdivision label (e.g. "The Grove Frisco 55s") to an Aegis Community.id
 * (e.g. "The Grove"). Returns null if the table is absent or no row matches.
 *
 * The table is created by scripts/seed-hyphen-community-aliases.mjs and is
 * maintained out-of-band; we tolerate its absence gracefully so this function
 * never breaks ingest.
 */
async function resolveCommunityIdFromSubdivision(
  subdivision: string | null | undefined,
): Promise<{ communityId: string | null; builderId: string | null; confidence: MatchConfidence } | null> {
  if (!subdivision || !subdivision.trim()) return null
  try {
    const rows = await prisma.$queryRawUnsafe<{
      aegisCommunityId: string | null
      builderId: string | null
      matchConfidence: string | null
    }[]>(
      `SELECT "aegisCommunityId", "builderId", "matchConfidence"
         FROM "HyphenCommunityAlias"
        WHERE "hyphenName" = $1
        LIMIT 1`,
      subdivision,
    )
    if (!rows.length || !rows[0].aegisCommunityId) return null
    const conf = (rows[0].matchConfidence || 'LOW') as MatchConfidence
    return { communityId: rows[0].aegisCommunityId, builderId: rows[0].builderId, confidence: conf }
  } catch {
    // Table may not exist in some environments — that's fine.
    return null
  }
}

/**
 * Given a Hyphen doc payload, resolve it to a Job + Builder.
 * Tiered: HIGH (po exact) → MEDIUM (address + builder) → LOW (address only).
 */
export async function correlateToJob(
  input: CorrelateInput,
): Promise<CorrelationResult> {
  const builderMatch = await matchBuilder(input.builderName)
  const builderId = builderMatch?.id ?? null

  // ── HIGH: PO match via Order.poNumber ──────────────────────────────
  if (input.poNumber) {
    // Order.poNumber is the builder-supplied PO string. If we find an Order
    // that has both this PO and a linked Job row, call it HIGH confidence.
    const orderMatch = await prisma.$queryRawUnsafe<{ jobId: string | null }[]>(`
      SELECT j."id" AS "jobId"
      FROM "Order" o
      LEFT JOIN "Job" j ON j."orderId" = o."id"
      WHERE o."poNumber" = $1 AND j."id" IS NOT NULL
      LIMIT 1
    `, input.poNumber)

    if (orderMatch.length > 0 && orderMatch[0].jobId) {
      return {
        jobId: orderMatch[0].jobId,
        builderId,
        matchConfidence: 'HIGH',
        matchMethod: 'po_exact',
      }
    }

    // Also try Job.bwpPoNumber directly (in case Job was created from PO
    // string before the Order row caught up)
    const jobByPo = await prisma.$queryRawUnsafe<{ id: string }[]>(`
      SELECT "id" FROM "Job"
      WHERE "bwpPoNumber" = $1 OR "hyphenJobId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 1
    `, input.poNumber)

    if (jobByPo.length > 0) {
      return {
        jobId: jobByPo[0].id,
        builderId,
        matchConfidence: 'HIGH',
        matchMethod: 'po_exact',
      }
    }
  }

  // ── Community alias bridge: Hyphen subdivision → Aegis Community ───
  // Resolved early so we can (a) scope address candidates to the right
  // community and (b) fall back to community-only matching when the street
  // address is a seed placeholder like "Copper Canyon - Lot 50".
  const communityAlias = await resolveCommunityIdFromSubdivision(input.subdivision)
  const resolvedBuilderId = builderId || communityAlias?.builderId || null

  // ── MEDIUM/LOW: address fuzzy match ────────────────────────────────
  const normalizedAddr = normalizeAddress(input.jobAddress)
  if (normalizedAddr && normalizedAddr.length >= 5) {
    // Pull candidate jobs (builder-scoped if we have one, wider otherwise).
    const candidates = await prisma.$queryRawUnsafe<{
      id: string
      jobAddress: string | null
      lotBlock: string | null
      builderName: string | null
      createdAt: Date
    }[]>(`
      SELECT "id", "jobAddress", "lotBlock", "builderName", "createdAt"
      FROM "Job"
      WHERE "jobAddress" IS NOT NULL
      ORDER BY "createdAt" DESC
      LIMIT 2000
    `)

    const normLot = normalizeStr(input.lotBlock)

    const hits: { jobId: string; score: number; builderHit: boolean; lotHit: boolean }[] = []
    for (const c of candidates) {
      const candAddr = normalizeAddress(c.jobAddress)
      if (!candAddr) continue
      let addrHit = false
      if (candAddr === normalizedAddr) {
        addrHit = true
      } else if (
        candAddr.length >= 6 && normalizedAddr.length >= 6 &&
        (candAddr.includes(normalizedAddr) || normalizedAddr.includes(candAddr))
      ) {
        addrHit = true
      }
      if (!addrHit) continue

      const builderHit =
        !!builderMatch &&
        compressed(c.builderName) === compressed(builderMatch.companyName)
      const lotHit =
        !!normLot && normalizeStr(c.lotBlock) === normLot
      const score = (addrHit ? 1 : 0) + (builderHit ? 2 : 0) + (lotHit ? 1 : 0)
      hits.push({ jobId: c.id, score, builderHit, lotHit })
    }

    if (hits.length > 0) {
      hits.sort((a, b) => b.score - a.score)
      const top = hits[0]
      if (top.builderHit && top.lotHit) {
        return { jobId: top.jobId, builderId: resolvedBuilderId, matchConfidence: 'MEDIUM', matchMethod: 'address_lot_builder' }
      }
      if (top.builderHit) {
        return { jobId: top.jobId, builderId: resolvedBuilderId, matchConfidence: 'MEDIUM', matchMethod: 'address_builder' }
      }
      return { jobId: top.jobId, builderId: resolvedBuilderId, matchConfidence: 'LOW', matchMethod: 'address_only' }
    }
  }

  // ── LOW: community-alias fallback ──────────────────────────────────
  // Address-based match failed. If we resolved a community from the Hyphen
  // subdivision label, try to match on Job.communityId (+ lot block when
  // present). This is how we pick up the 66 Brookfield Jobs whose jobAddress
  // is a seed placeholder without a street number.
  if (communityAlias?.communityId) {
    const normLot = normalizeStr(input.lotBlock)
    const commJobs = await prisma.$queryRawUnsafe<{
      id: string
      lotBlock: string | null
      jobAddress: string | null
    }[]>(
      `SELECT "id","lotBlock","jobAddress"
         FROM "Job"
        WHERE "communityId" = $1
        ORDER BY "createdAt" DESC
        LIMIT 500`,
      communityAlias.communityId,
    )

    if (commJobs.length) {
      // If we have a lot/block, try to narrow to the exact lot.
      if (normLot) {
        const lotHit = commJobs.find((j) => normalizeStr(j.lotBlock) === normLot)
        if (lotHit) {
          return {
            jobId: lotHit.id,
            builderId: resolvedBuilderId,
            matchConfidence: 'MEDIUM',
            matchMethod: 'address_lot_builder',
          }
        }
      }
      // No lot hit — return just the community linkage as LOW. Matcher is
      // non-deterministic (picks newest), so consumers should treat as hint.
      return {
        jobId: commJobs[0].id,
        builderId: resolvedBuilderId,
        matchConfidence: 'LOW',
        matchMethod: 'address_only',
      }
    }
  }

  return {
    jobId: null,
    builderId: resolvedBuilderId,
    matchConfidence: 'UNMATCHED',
    matchMethod: 'unmatched',
  }
}
