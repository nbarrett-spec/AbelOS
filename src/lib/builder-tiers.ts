/**
 * Aegis Builder Tier System — the canonical classification engine.
 *
 * One structure, the TenantProfile, drives every surface in the product:
 * nav, home widgets, billing, support, integrations, Copilot prompts.
 * Tier is *derived*, not set — a nightly cron recomputes from usage signals.
 *
 * Reference: AEGIS_TIER_DRIVEN_BUILD_PLAN.md §1–§4.
 */

// ── Axes ──────────────────────────────────────────────────────────────────

export type BuildModel = 'CUSTOM' | 'SEMI_CUSTOM' | 'PRODUCTION'

export type SizeBand = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL'

export type IntegrationMaturity =
  | 'PORTAL_ONLY'
  | 'LIGHT_INTEGRATED'
  | 'PM_INTEGRATED'
  | 'EDI_NATIVE'

export type TierBucket =
  | 'T0_ABEL_INTERNAL'
  | 'T1_CUSTOM_BOUTIQUE'
  | 'T2_SEMI_CUSTOM_SMALL'
  | 'T3_PRODUCTION_SMALL'
  | 'T4_PRODUCTION_MID'
  | 'T5_PRODUCTION_LARGE'
  | 'T6_PRODUCTION_ENTERPRISE'

export type TenantStatus =
  | 'TRIAL'
  | 'ACTIVE'
  | 'PAST_DUE'
  | 'SUSPENDED'
  | 'CHURNED'

export type BillingPlan =
  | 'TRIAL'
  | 'STARTER'
  | 'PRO'
  | 'ENTERPRISE'
  | 'ABEL_INTERNAL'

export type PaymentTerm =
  | 'PAY_AT_ORDER'
  | 'PAY_ON_DELIVERY'
  | 'NET_15'
  | 'NET_30'
  | 'NET_45'
  | 'NET_60'

export type SupportTier =
  | 'COMMUNITY'
  | 'STANDARD'
  | 'PRIORITY'
  | 'WHITE_GLOVE'

export type IntegrationKey =
  | 'HYPHEN'
  | 'BUILDERTREND'
  | 'PROCORE'
  | 'MARKSYSTEMS'
  | 'NEWSTAR'
  | 'QUICKBOOKS'
  | 'STRIPE'
  | 'RESEND'
  | 'STYTCH'
  | 'EDI_850'
  | 'EDI_855'
  | 'EDI_856'
  | 'EDI_810'

// ── Signals (recomputed nightly from Staff-OS data) ───────────────────────

export interface TenantSignals {
  startsPerYear: number
  activeCommunities: number
  activeLots: number
  activePlans: number
  teamSize: number
  monthlySpend: number
  onTimeRate: number
  daysSalesOutstanding: number
  integrations: IntegrationKey[]
}

export interface TenantProfile extends TenantSignals {
  tenantId: string
  model: BuildModel
  size: SizeBand
  integration: IntegrationMaturity
  tier: TierBucket

  billingPlan: BillingPlan
  paymentTerm: PaymentTerm
  creditLimit: number

  supportTier: SupportTier
  accountRepStaffId: string | null

  logoUrl: string | null
  primaryColor: string | null
  featureOverrides: Record<string, boolean>

  status: TenantStatus
  activatedAt: Date | null
  churnedAt: Date | null
  churnReason: string | null

  createdAt: Date
  updatedAt: Date
  reclassifiedAt: Date
}

// ── Derivation: size band from starts-per-year ────────────────────────────

export function deriveSizeBand(startsPerYear: number): SizeBand {
  if (startsPerYear <= 15)     return 'XS'
  if (startsPerYear <= 75)     return 'S'
  if (startsPerYear <= 500)    return 'M'
  if (startsPerYear <= 2_500)  return 'L'
  if (startsPerYear <= 10_000) return 'XL'
  return 'XXL'
}

// ── Derivation: integration maturity from integration list ────────────────

export function deriveIntegrationMaturity(
  integrations: IntegrationKey[],
): IntegrationMaturity {
  const has = (k: IntegrationKey) => integrations.includes(k)
  if (has('EDI_850') || has('EDI_855') || has('EDI_856') || has('EDI_810')) {
    return 'EDI_NATIVE'
  }
  if (has('HYPHEN') || has('PROCORE') || has('MARKSYSTEMS') || has('NEWSTAR')) {
    return 'PM_INTEGRATED'
  }
  if (has('BUILDERTREND') || has('QUICKBOOKS')) {
    return 'LIGHT_INTEGRATED'
  }
  return 'PORTAL_ONLY'
}

// ── Derivation: tier bucket from (model, size, integration) ───────────────

export function deriveTier(
  model: BuildModel,
  size: SizeBand,
  integration: IntegrationMaturity,
  opts?: { abelInternal?: boolean },
): TierBucket {
  if (opts?.abelInternal) return 'T0_ABEL_INTERNAL'

  if (model === 'CUSTOM') return 'T1_CUSTOM_BOUTIQUE'

  if (model === 'SEMI_CUSTOM') {
    // Semi-custom maxes at T2 — if they grow into production, reclassify axis A too.
    return 'T2_SEMI_CUSTOM_SMALL'
  }

  // PRODUCTION: size + integration decide
  if (size === 'XS' || size === 'S') return 'T3_PRODUCTION_SMALL'
  if (size === 'M') return 'T4_PRODUCTION_MID'

  // L / XL / XXL split by integration
  if (integration === 'EDI_NATIVE') return 'T6_PRODUCTION_ENTERPRISE'
  if (size === 'XXL') return 'T6_PRODUCTION_ENTERPRISE'
  return 'T5_PRODUCTION_LARGE'
}

// ── Convenience: derive full tenant tier shape from raw signals ───────────

export function deriveTenantShape(input: {
  model: BuildModel
  signals: TenantSignals
  abelInternal?: boolean
}): { model: BuildModel; size: SizeBand; integration: IntegrationMaturity; tier: TierBucket } {
  const size = deriveSizeBand(input.signals.startsPerYear)
  const integration = deriveIntegrationMaturity(input.signals.integrations)
  const tier = deriveTier(input.model, size, integration, { abelInternal: input.abelInternal })
  return { model: input.model, size, integration, tier }
}

// ── Auto-promotion ────────────────────────────────────────────────────────

const TIER_ORDER: TierBucket[] = [
  'T1_CUSTOM_BOUTIQUE',
  'T2_SEMI_CUSTOM_SMALL',
  'T3_PRODUCTION_SMALL',
  'T4_PRODUCTION_MID',
  'T5_PRODUCTION_LARGE',
  'T6_PRODUCTION_ENTERPRISE',
]

export function tierRank(tier: TierBucket): number {
  if (tier === 'T0_ABEL_INTERNAL') return -1
  return TIER_ORDER.indexOf(tier)
}

export function isPromotion(from: TierBucket, to: TierBucket): boolean {
  return tierRank(to) > tierRank(from)
}

export function nextTier(current: TierBucket): TierBucket | null {
  const i = TIER_ORDER.indexOf(current)
  if (i < 0 || i >= TIER_ORDER.length - 1) return null
  return TIER_ORDER[i + 1]
}

/**
 * Nightly reclassification rule. Recomputes tier from current model + signals.
 * We never *auto-demote* — customers downgrade explicitly or churn. This
 * prevents a slow quarter from silently stripping features.
 */
export function reclassifyTier(args: {
  currentTier: TierBucket
  model: BuildModel
  signals: TenantSignals
  abelInternal?: boolean
}): { tier: TierBucket; promoted: boolean } {
  const derived = deriveTenantShape({
    model: args.model,
    signals: args.signals,
    abelInternal: args.abelInternal,
  })
  const promoted = isPromotion(args.currentTier, derived.tier)
  const tier = promoted ? derived.tier : args.currentTier // no auto-demote
  return { tier, promoted }
}

// ── Display helpers ───────────────────────────────────────────────────────

export function tierLabel(tier: TierBucket): string {
  switch (tier) {
    case 'T0_ABEL_INTERNAL':         return 'Abel Internal'
    case 'T1_CUSTOM_BOUTIQUE':       return 'Custom · Boutique'
    case 'T2_SEMI_CUSTOM_SMALL':     return 'Semi-Custom · Small'
    case 'T3_PRODUCTION_SMALL':      return 'Production · Small'
    case 'T4_PRODUCTION_MID':        return 'Production · Mid'
    case 'T5_PRODUCTION_LARGE':      return 'Production · Large'
    case 'T6_PRODUCTION_ENTERPRISE': return 'Production · Enterprise'
  }
}

export function tierShortLabel(tier: TierBucket): string {
  switch (tier) {
    case 'T0_ABEL_INTERNAL':         return 'Abel'
    case 'T1_CUSTOM_BOUTIQUE':       return 'T1'
    case 'T2_SEMI_CUSTOM_SMALL':     return 'T2'
    case 'T3_PRODUCTION_SMALL':      return 'T3'
    case 'T4_PRODUCTION_MID':        return 'T4'
    case 'T5_PRODUCTION_LARGE':      return 'T5'
    case 'T6_PRODUCTION_ENTERPRISE': return 'T6'
  }
}

export function sizeBandLabel(s: SizeBand): string {
  switch (s) {
    case 'XS':  return '≤ 15 starts/yr'
    case 'S':   return '16–75 starts/yr'
    case 'M':   return '76–500 starts/yr'
    case 'L':   return '501–2,500 starts/yr'
    case 'XL':  return '2,501–10,000 starts/yr'
    case 'XXL': return '10,000+ starts/yr'
  }
}

export function integrationLabel(m: IntegrationMaturity): string {
  switch (m) {
    case 'PORTAL_ONLY':       return 'Portal only'
    case 'LIGHT_INTEGRATED':  return 'Light integrations'
    case 'PM_INTEGRATED':     return 'PM-integrated'
    case 'EDI_NATIVE':        return 'EDI-native'
  }
}
