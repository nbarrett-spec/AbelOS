/**
 * Tier Matrix — the single source of truth for "what's enabled at each tier".
 *
 * Import from here in: middleware.ts (route gates), components (show/hide),
 * billing (plan mapping), Copilot system prompt, onboarding adapter.
 *
 * Reference: AEGIS_TIER_DRIVEN_BUILD_PLAN.md §3.1–§3.4.
 * Update discipline: a change here must be paired with an update to the
 * corresponding table in the plan doc and with a Chromatic baseline refresh.
 */

import type { TierBucket, IntegrationKey, BillingPlan, SupportTier } from './builder-tiers'

// ── Feature keys — the unit of toggling ───────────────────────────────────

export type FeatureKey =
  // Data model depth
  | 'project'
  | 'plan'
  | 'plan.version'
  | 'community'
  | 'phase'
  | 'lot.lifecycle'
  | 'option.minimal'
  | 'option.full'
  | 'vpo.desk'
  | 'change.order'
  | 'bom.version'
  | 'takeoff.approval'
  | 'po.typed'
  | 'org.unit'
  // Nav + home
  | 'nav.projects'
  | 'nav.communities'
  | 'nav.lots'
  | 'nav.plans'
  | 'nav.options'
  | 'nav.pos'
  | 'nav.schedule'
  | 'nav.invoices'
  | 'nav.messages'
  | 'nav.documents'
  | 'nav.reports'
  | 'nav.analytics'
  | 'nav.integrations'
  | 'nav.developer'
  | 'nav.edi'
  | 'home.projects'
  | 'home.schedule_confidence'
  | 'home.plan_revision_queue'
  | 'home.options_queue'
  | 'home.division_scorecard'
  // Integrations
  | 'integ.stripe'
  | 'integ.quickbooks'
  | 'integ.hyphen'
  | 'integ.buildertrend'
  | 'integ.procore'
  | 'integ.marksystems'
  | 'integ.newstar'
  | 'integ.edi'
  | 'api.read'
  | 'api.write'
  | 'webhooks'
  | 'sso'

// ── Per-tier feature map ──────────────────────────────────────────────────

type TierFeatures = Record<FeatureKey, boolean>

function mk(flags: Partial<TierFeatures>): TierFeatures {
  const all: TierFeatures = {
    project: false, plan: false, 'plan.version': false, community: false,
    phase: false, 'lot.lifecycle': false, 'option.minimal': false,
    'option.full': false, 'vpo.desk': false, 'change.order': false,
    'bom.version': false, 'takeoff.approval': false, 'po.typed': false,
    'org.unit': false,

    'nav.projects': false, 'nav.communities': false, 'nav.lots': false,
    'nav.plans': false, 'nav.options': false, 'nav.pos': false,
    'nav.schedule': false, 'nav.invoices': false, 'nav.messages': false,
    'nav.documents': false, 'nav.reports': false, 'nav.analytics': false,
    'nav.integrations': false, 'nav.developer': false, 'nav.edi': false,

    'home.projects': false, 'home.schedule_confidence': false,
    'home.plan_revision_queue': false, 'home.options_queue': false,
    'home.division_scorecard': false,

    'integ.stripe': false, 'integ.quickbooks': false, 'integ.hyphen': false,
    'integ.buildertrend': false, 'integ.procore': false,
    'integ.marksystems': false, 'integ.newstar': false, 'integ.edi': false,
    'api.read': false, 'api.write': false, 'webhooks': false, 'sso': false,
  }
  return { ...all, ...flags }
}

export const TIER_FEATURES: Record<TierBucket, TierFeatures> = {
  T0_ABEL_INTERNAL: mk({
    project: true, plan: true, 'plan.version': true, community: true,
    phase: true, 'lot.lifecycle': true, 'option.minimal': true,
    'option.full': true, 'vpo.desk': true, 'change.order': true,
    'bom.version': true, 'takeoff.approval': true, 'po.typed': true,
    'org.unit': true,
    'nav.projects': true, 'nav.communities': true, 'nav.lots': true,
    'nav.plans': true, 'nav.options': true, 'nav.pos': true,
    'nav.schedule': true, 'nav.invoices': true, 'nav.messages': true,
    'nav.documents': true, 'nav.reports': true, 'nav.analytics': true,
    'nav.integrations': true, 'nav.developer': true, 'nav.edi': true,
    'home.projects': true, 'home.schedule_confidence': true,
    'home.plan_revision_queue': true, 'home.options_queue': true,
    'home.division_scorecard': true,
    'integ.stripe': true, 'integ.quickbooks': true, 'integ.hyphen': true,
    'integ.buildertrend': true, 'integ.procore': true,
    'integ.marksystems': true, 'integ.newstar': true, 'integ.edi': true,
    'api.read': true, 'api.write': true, 'webhooks': true, 'sso': true,
  }),

  T1_CUSTOM_BOUTIQUE: mk({
    project: true, 'change.order': true,
    'nav.projects': true, 'nav.pos': true, 'nav.schedule': true,
    'nav.invoices': true, 'nav.messages': true, 'nav.documents': true,
    'home.projects': true,
    'integ.stripe': true,
  }),

  T2_SEMI_CUSTOM_SMALL: mk({
    project: true, plan: true, 'option.minimal': true, 'change.order': true,
    'nav.projects': true, 'nav.plans': true, 'nav.pos': true,
    'nav.schedule': true, 'nav.invoices': true, 'nav.messages': true,
    'nav.documents': true,
    'home.projects': true, 'home.plan_revision_queue': true,
    'integ.stripe': true, 'integ.quickbooks': true, 'integ.buildertrend': true,
  }),

  T3_PRODUCTION_SMALL: mk({
    project: true, plan: true, 'plan.version': true, community: true,
    'lot.lifecycle': true, 'option.minimal': true, 'change.order': true,
    'bom.version': true, 'takeoff.approval': true,
    'nav.communities': true, 'nav.lots': true, 'nav.plans': true,
    'nav.pos': true, 'nav.schedule': true, 'nav.invoices': true,
    'nav.messages': true, 'nav.documents': true, 'nav.reports': true,
    'nav.integrations': true,
    'home.schedule_confidence': true, 'home.plan_revision_queue': true,
    'integ.stripe': true, 'integ.quickbooks': true, 'integ.buildertrend': true,
  }),

  T4_PRODUCTION_MID: mk({
    project: true, plan: true, 'plan.version': true, community: true,
    phase: true, 'lot.lifecycle': true, 'option.full': true,
    'change.order': true, 'bom.version': true, 'takeoff.approval': true,
    'po.typed': true,
    'nav.communities': true, 'nav.lots': true, 'nav.plans': true,
    'nav.options': true, 'nav.pos': true, 'nav.schedule': true,
    'nav.invoices': true, 'nav.messages': true, 'nav.documents': true,
    'nav.reports': true, 'nav.analytics': true, 'nav.integrations': true,
    'home.schedule_confidence': true, 'home.plan_revision_queue': true,
    'home.options_queue': true,
    'integ.stripe': true, 'integ.quickbooks': true, 'integ.hyphen': true,
    'integ.buildertrend': true, 'integ.procore': true,
    'api.read': true, 'webhooks': true, 'sso': true,
  }),

  T5_PRODUCTION_LARGE: mk({
    project: true, plan: true, 'plan.version': true, community: true,
    phase: true, 'lot.lifecycle': true, 'option.full': true, 'vpo.desk': true,
    'change.order': true, 'bom.version': true, 'takeoff.approval': true,
    'po.typed': true,
    'nav.communities': true, 'nav.lots': true, 'nav.plans': true,
    'nav.options': true, 'nav.pos': true, 'nav.schedule': true,
    'nav.invoices': true, 'nav.messages': true, 'nav.documents': true,
    'nav.reports': true, 'nav.analytics': true, 'nav.integrations': true,
    'nav.developer': true,
    'home.schedule_confidence': true, 'home.plan_revision_queue': true,
    'home.options_queue': true,
    'integ.stripe': true, 'integ.quickbooks': true, 'integ.hyphen': true,
    'integ.buildertrend': true, 'integ.procore': true,
    'integ.marksystems': true, 'integ.newstar': true,
    'api.read': true, 'api.write': true, 'webhooks': true, 'sso': true,
  }),

  T6_PRODUCTION_ENTERPRISE: mk({
    project: true, plan: true, 'plan.version': true, community: true,
    phase: true, 'lot.lifecycle': true, 'option.full': true, 'vpo.desk': true,
    'change.order': true, 'bom.version': true, 'takeoff.approval': true,
    'po.typed': true, 'org.unit': true,
    'nav.communities': true, 'nav.lots': true, 'nav.plans': true,
    'nav.options': true, 'nav.pos': true, 'nav.schedule': true,
    'nav.invoices': true, 'nav.messages': true, 'nav.documents': true,
    'nav.reports': true, 'nav.analytics': true, 'nav.integrations': true,
    'nav.developer': true, 'nav.edi': true,
    'home.schedule_confidence': true, 'home.plan_revision_queue': true,
    'home.options_queue': true, 'home.division_scorecard': true,
    'integ.stripe': true, 'integ.quickbooks': true, 'integ.hyphen': true,
    'integ.buildertrend': true, 'integ.procore': true,
    'integ.marksystems': true, 'integ.newstar': true, 'integ.edi': true,
    'api.read': true, 'api.write': true, 'webhooks': true, 'sso': true,
  }),
}

// ── Public API for components and middleware ──────────────────────────────

export function isFeatureEnabled(
  tier: TierBucket,
  feature: FeatureKey,
  overrides: Record<string, boolean> = {},
): boolean {
  if (feature in overrides) return overrides[feature]!
  return TIER_FEATURES[tier][feature] ?? false
}

export function enabledNavItems(
  tier: TierBucket,
  overrides: Record<string, boolean> = {},
): Array<{ key: string; label: string; href: string }> {
  const nav = [
    { key: 'nav.projects',     label: 'Projects',    href: '/dashboard/projects'     },
    { key: 'nav.communities',  label: 'Communities', href: '/dashboard/communities'  },
    { key: 'nav.lots',         label: 'Lots',        href: '/dashboard/lots'         },
    { key: 'nav.plans',        label: 'Plans',       href: '/dashboard/blueprints'   },
    { key: 'nav.options',      label: 'Options',     href: '/dashboard/options'      },
    { key: 'nav.pos',          label: 'POs',         href: '/dashboard/orders'       },
    { key: 'nav.schedule',     label: 'Schedule',    href: '/dashboard/schedule'     },
    { key: 'nav.invoices',     label: 'Invoices',    href: '/dashboard/invoices'     },
    { key: 'nav.messages',     label: 'Messages',    href: '/dashboard/messages'     },
    { key: 'nav.documents',    label: 'Documents',   href: '/dashboard/documents'    },
    { key: 'nav.reports',      label: 'Reports',     href: '/dashboard/reports'      },
    { key: 'nav.analytics',    label: 'Analytics',   href: '/dashboard/analytics'    },
    { key: 'nav.integrations', label: 'Integrations',href: '/dashboard/integrations' },
    { key: 'nav.developer',    label: 'Developer',   href: '/dashboard/developer'    },
    { key: 'nav.edi',          label: 'EDI',         href: '/dashboard/edi'          },
  ] as const
  return nav.filter(n => isFeatureEnabled(tier, n.key as FeatureKey, overrides))
}

export function enabledHomeWidgets(
  tier: TierBucket,
  overrides: Record<string, boolean> = {},
): string[] {
  const widgets = [
    'home.projects',
    'home.schedule_confidence',
    'home.plan_revision_queue',
    'home.options_queue',
    'home.division_scorecard',
  ] as const
  return widgets.filter(w => isFeatureEnabled(tier, w as FeatureKey, overrides))
}

// ── Billing + support matrices (mirrors plan doc §3.4) ────────────────────

export const TIER_BILLING: Record<TierBucket, {
  defaultPlan: BillingPlan
  publicPrice: string
  seats: number
  communities: number | 'unlimited'
}> = {
  T0_ABEL_INTERNAL:         { defaultPlan: 'ABEL_INTERNAL', publicPrice: 'internal', seats: 999,  communities: 'unlimited' },
  T1_CUSTOM_BOUTIQUE:       { defaultPlan: 'STARTER',       publicPrice: '$0',       seats: 1,    communities: 0           },
  T2_SEMI_CUSTOM_SMALL:     { defaultPlan: 'STARTER',       publicPrice: '$99',      seats: 3,    communities: 0           },
  T3_PRODUCTION_SMALL:      { defaultPlan: 'PRO',           publicPrice: '$299',     seats: 8,    communities: 3           },
  T4_PRODUCTION_MID:        { defaultPlan: 'PRO',           publicPrice: '$799',     seats: 20,   communities: 10          },
  T5_PRODUCTION_LARGE:      { defaultPlan: 'PRO',           publicPrice: '$2,499',   seats: 60,   communities: 40          },
  T6_PRODUCTION_ENTERPRISE: { defaultPlan: 'ENTERPRISE',    publicPrice: 'custom',   seats: 200,  communities: 'unlimited' },
}

export const TIER_SUPPORT: Record<TierBucket, {
  support: SupportTier
  uptime: string
  sev1: string
}> = {
  T0_ABEL_INTERNAL:         { support: 'WHITE_GLOVE', uptime: '—',       sev1: '—'      },
  T1_CUSTOM_BOUTIQUE:       { support: 'COMMUNITY',   uptime: 'none',    sev1: '24h'    },
  T2_SEMI_CUSTOM_SMALL:     { support: 'STANDARD',    uptime: '99.5%',   sev1: '8h'     },
  T3_PRODUCTION_SMALL:      { support: 'STANDARD',    uptime: '99.9%',   sev1: '4h'     },
  T4_PRODUCTION_MID:        { support: 'PRIORITY',    uptime: '99.9%',   sev1: '2h'     },
  T5_PRODUCTION_LARGE:      { support: 'PRIORITY',    uptime: '99.95%',  sev1: '1h'     },
  T6_PRODUCTION_ENTERPRISE: { support: 'WHITE_GLOVE', uptime: '99.99%',  sev1: '30 min' },
}

// ── Route-gate helper (for middleware.ts) ─────────────────────────────────

export const ROUTE_TIER_GATES: Record<string, FeatureKey> = {
  '/dashboard/projects':     'nav.projects',
  '/dashboard/communities':  'nav.communities',
  '/dashboard/lots':         'nav.lots',
  '/dashboard/blueprints':   'nav.plans',
  '/dashboard/options':      'nav.options',
  '/dashboard/orders':       'nav.pos',
  '/dashboard/schedule':     'nav.schedule',
  '/dashboard/invoices':     'nav.invoices',
  '/dashboard/messages':     'nav.messages',
  '/dashboard/documents':    'nav.documents',
  '/dashboard/reports':      'nav.reports',
  '/dashboard/analytics':    'nav.analytics',
  '/dashboard/integrations': 'nav.integrations',
  '/dashboard/developer':    'nav.developer',
  '/dashboard/edi':          'nav.edi',
}

/** True if the tenant's tier allows this route. */
export function routeAllowedForTier(
  pathname: string,
  tier: TierBucket,
  overrides: Record<string, boolean> = {},
): boolean {
  // Find the longest-matching gate prefix
  const match = Object.keys(ROUTE_TIER_GATES)
    .filter(p => pathname === p || pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length)[0]
  if (!match) return true
  return isFeatureEnabled(tier, ROUTE_TIER_GATES[match], overrides)
}
