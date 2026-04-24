/**
 * The 27-account starter roster — the "hive" — classified by tier.
 *
 * Source of truth is the Tenant + TenantProfile rows in Neon once migrated.
 * Until then, this file is the seed and the fallback for demo renders.
 *
 * Reference: AEGIS_TIER_DRIVEN_BUILD_PLAN.md §5.
 */

import type {
  BuildModel,
  IntegrationKey,
  IntegrationMaturity,
  SizeBand,
  TenantStatus,
  TierBucket,
} from './builder-tiers'

export interface RosterEntry {
  slug: string
  name: string
  model: BuildModel
  size: SizeBand
  integration: IntegrationMaturity
  tier: TierBucket
  status: TenantStatus
  startsPerYear: number
  integrations: IntegrationKey[]
  primaryColor?: string
  churnReason?: string
  notes?: string
}

export const ROSTER: RosterEntry[] = [
  // ── T0 — Abel ─────────────────────────────────────────────────────────
  {
    slug: 'abel',
    name: 'Abel Lumber',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T0_ABEL_INTERNAL',
    status: 'ACTIVE',
    startsPerYear: 1200,
    integrations: ['HYPHEN', 'BUILDERTREND', 'QUICKBOOKS', 'STRIPE', 'RESEND', 'STYTCH'],
    primaryColor: '#3E2A1E',
    notes: 'Customer zero — Abel runs its own ops portal on the same tenant architecture.',
  },

  // ── T6 — Enterprise ───────────────────────────────────────────────────
  {
    slug: 'pulte',
    name: 'PulteGroup (Centex + Del Webb)',
    model: 'PRODUCTION',
    size: 'XXL',
    integration: 'EDI_NATIVE',
    tier: 'T6_PRODUCTION_ENTERPRISE',
    status: 'CHURNED',
    startsPerYear: 29000,
    integrations: ['EDI_850', 'EDI_855', 'EDI_856', 'EDI_810', 'NEWSTAR'],
    primaryColor: '#003A5D',
    churnReason: 'Lost 2026-04-20 to 84 Lumber / Treeline. Preserved for Q3 win-back.',
  },
  {
    slug: 'lennar',
    name: 'Lennar',
    model: 'PRODUCTION',
    size: 'XXL',
    integration: 'PM_INTEGRATED',
    tier: 'T6_PRODUCTION_ENTERPRISE',
    status: 'TRIAL',
    startsPerYear: 70000,
    integrations: ['NEWSTAR', 'PROCORE'],
    primaryColor: '#1F3A5F',
    notes: 'Submitted 45% · $10.9M potential. Demo tenant pre-loaded with DFW communities.',
  },

  // ── T5 — Production · Large ───────────────────────────────────────────
  {
    slug: 'brookfield',
    name: 'Brookfield Residential',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'ACTIVE',
    startsPerYear: 900,
    integrations: ['HYPHEN', 'QUICKBOOKS'],
    primaryColor: '#0F4F3A',
    notes: 'Top active builder. Hyphen link rate at 0/80 pre-fix; Day-1 fix sprint parallel.',
  },
  {
    slug: 'toll-brothers',
    name: 'Toll Brothers DFW',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'ACTIVE',
    startsPerYear: 600,
    integrations: ['NEWSTAR', 'PROCORE'],
    primaryColor: '#7A2A2A',
    notes: 'Contracted Feb 2026 · $1.8M base.',
  },
  {
    slug: 'perry',
    name: 'Perry Homes',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 1500,
    integrations: ['MARKSYSTEMS'],
    notes: 'Finalizing bid · 50% · $1.15M.',
  },
  {
    slug: 'highland',
    name: 'Highland Homes',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 2200,
    integrations: ['MARKSYSTEMS'],
  },
  {
    slug: 'first-texas',
    name: 'First Texas Homes',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 800,
    integrations: ['BUILDERTREND'],
  },
  {
    slug: 'taylor-morrison',
    name: 'Taylor Morrison DFW',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 1200,
    integrations: ['NEWSTAR'],
  },
  {
    slug: 'david-weekley',
    name: 'David Weekley Homes',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 1800,
    integrations: ['MARKSYSTEMS'],
  },
  {
    slug: 'tri-pointe',
    name: 'Tri Pointe Homes',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 900,
    integrations: ['NEWSTAR'],
    notes: 'Submitted 50% · $2.65M.',
  },
  {
    slug: 'meritage',
    name: 'Meritage Homes',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 1100,
    integrations: ['NEWSTAR'],
    notes: 'Ready to submit · 45% · $3.4M.',
  },
  {
    slug: 'ashton-woods',
    name: 'Ashton Woods',
    model: 'PRODUCTION',
    size: 'L',
    integration: 'PM_INTEGRATED',
    tier: 'T5_PRODUCTION_LARGE',
    status: 'TRIAL',
    startsPerYear: 700,
    integrations: ['NEWSTAR'],
  },

  // ── T4 — Production · Mid ─────────────────────────────────────────────
  {
    slug: 'bloomfield',
    name: 'Bloomfield Homes',
    model: 'PRODUCTION',
    size: 'M',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T4_PRODUCTION_MID',
    status: 'TRIAL',
    startsPerYear: 350,
    integrations: ['BUILDERTREND'],
    notes: 'Onboarding · 85% probability · $5.6M potential. Ideal Phase-0 second test tenant.',
  },
  {
    slug: 'grand',
    name: 'Grand Homes',
    model: 'PRODUCTION',
    size: 'M',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T4_PRODUCTION_MID',
    status: 'TRIAL',
    startsPerYear: 200,
    integrations: ['BUILDERTREND'],
  },
  {
    slug: 'davidson',
    name: 'Davidson Homes',
    model: 'PRODUCTION',
    size: 'M',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T4_PRODUCTION_MID',
    status: 'TRIAL',
    startsPerYear: 180,
    integrations: ['BUILDERTREND'],
    notes: 'Submitted · 45% · $1.3M.',
  },

  // ── T3 — Production · Small ───────────────────────────────────────────
  {
    slug: 'shaddock',
    name: 'Shaddock Homes',
    model: 'PRODUCTION',
    size: 'S',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T3_PRODUCTION_SMALL',
    status: 'ACTIVE',
    startsPerYear: 60,
    integrations: ['BUILDERTREND', 'QUICKBOOKS'],
    notes: 'Contracted Mar 2026 · $3.0M base — largest contracted account.',
  },
  {
    slug: 'olerio',
    name: 'Olerio Homes',
    model: 'PRODUCTION',
    size: 'S',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T3_PRODUCTION_SMALL',
    status: 'ACTIVE',
    startsPerYear: 45,
    integrations: ['BUILDERTREND'],
    notes: 'Contracted Mar 2026 · $2.1M base.',
  },
  {
    slug: 'msr',
    name: 'MSR (Sorovar-Frisco)',
    model: 'PRODUCTION',
    size: 'S',
    integration: 'PORTAL_ONLY',
    tier: 'T3_PRODUCTION_SMALL',
    status: 'ACTIVE',
    startsPerYear: 30,
    integrations: [],
    notes: 'Contracted Mar 2026 · $1.4M.',
  },
  {
    slug: 'trophy-signature',
    name: 'Trophy Signature Homes',
    model: 'PRODUCTION',
    size: 'S',
    integration: 'LIGHT_INTEGRATED',
    tier: 'T3_PRODUCTION_SMALL',
    status: 'ACTIVE',
    startsPerYear: 70,
    integrations: ['BUILDERTREND'],
    notes: 'Program won; contract value TBD.',
  },

  // ── T2 — Semi-Custom · Small ──────────────────────────────────────────
  {
    slug: 'joseph-paul',
    name: 'Joseph Paul Homes',
    model: 'SEMI_CUSTOM',
    size: 'S',
    integration: 'PORTAL_ONLY',
    tier: 'T2_SEMI_CUSTOM_SMALL',
    status: 'ACTIVE',
    startsPerYear: 25,
    integrations: [],
    notes: 'Contracted · $234K.',
  },
  {
    slug: 'rdr',
    name: 'RDR Development',
    model: 'SEMI_CUSTOM',
    size: 'S',
    integration: 'PORTAL_ONLY',
    tier: 'T2_SEMI_CUSTOM_SMALL',
    status: 'ACTIVE',
    startsPerYear: 20,
    integrations: [],
    notes: 'Contracted · $380K.',
  },
  {
    slug: 'true-grit',
    name: 'True Grit',
    model: 'SEMI_CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T2_SEMI_CUSTOM_SMALL',
    status: 'ACTIVE',
    startsPerYear: 12,
    integrations: [],
    notes: 'Contracted · $210K.',
  },
  {
    slug: 'imagination',
    name: 'Imagination Homes',
    model: 'SEMI_CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T2_SEMI_CUSTOM_SMALL',
    status: 'ACTIVE',
    startsPerYear: 14,
    integrations: [],
    notes: 'Contracted Jan 2026 · $297K.',
  },

  // ── T1 — Custom · Boutique ────────────────────────────────────────────
  {
    slug: 'desco',
    name: 'Desco Fine Homes',
    model: 'CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T1_CUSTOM_BOUTIQUE',
    status: 'TRIAL',
    startsPerYear: 8,
    integrations: [],
    notes: 'Custom builder push, April 2026.',
  },
  {
    slug: 'bella-custom',
    name: 'Bella Custom Homes',
    model: 'CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T1_CUSTOM_BOUTIQUE',
    status: 'TRIAL',
    startsPerYear: 6,
    integrations: [],
  },
  {
    slug: 'alford',
    name: 'Alford Homes',
    model: 'CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T1_CUSTOM_BOUTIQUE',
    status: 'TRIAL',
    startsPerYear: 5,
    integrations: [],
  },
  {
    slug: 'lingenfelter',
    name: 'Lingenfelter Luxury Homes',
    model: 'CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T1_CUSTOM_BOUTIQUE',
    status: 'TRIAL',
    startsPerYear: 4,
    integrations: [],
  },
  {
    slug: 'homes-j-anthony',
    name: 'Homes by J. Anthony',
    model: 'CUSTOM',
    size: 'XS',
    integration: 'PORTAL_ONLY',
    tier: 'T1_CUSTOM_BOUTIQUE',
    status: 'TRIAL',
    startsPerYear: 10,
    integrations: [],
  },
]

export function rosterBySlug(slug: string): RosterEntry | undefined {
  return ROSTER.find(r => r.slug === slug)
}

export function rosterByTier(tier: TierBucket): RosterEntry[] {
  return ROSTER.filter(r => r.tier === tier)
}

export function rosterSummary(): Record<TierBucket, number> {
  return ROSTER.reduce((acc, r) => {
    acc[r.tier] = (acc[r.tier] ?? 0) + 1
    return acc
  }, {} as Record<TierBucket, number>)
}
