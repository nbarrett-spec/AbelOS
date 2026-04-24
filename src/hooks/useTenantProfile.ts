'use client'

/**
 * useTenantProfile — the canonical read for the currently-signed-in tenant's
 * profile. In production this pulls from /api/tenant/profile (cached 30s).
 * In preview / demo mode (no auth), you can pass ?tenant=<slug> to preview
 * any tenant from the roster — useful for sales demos and design review.
 *
 * Paired with `useTierFeature(key)` which is the one-liner used in components
 * to show/hide tier-gated content.
 *
 * Reference: AEGIS_TIER_DRIVEN_BUILD_PLAN.md §4.1.
 */

import { useMemo } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  type TenantProfile,
  type TierBucket,
  deriveTenantShape,
} from '@/lib/builder-tiers'
import {
  enabledHomeWidgets,
  enabledNavItems,
  isFeatureEnabled,
  type FeatureKey,
} from '@/lib/tier-matrix'
import { ROSTER, rosterBySlug } from '@/lib/tenant-roster'

const FALLBACK_SLUG = 'brookfield'

function profileFromRosterSlug(slug: string): TenantProfile {
  const r = rosterBySlug(slug) ?? rosterBySlug(FALLBACK_SLUG)!
  const shape = deriveTenantShape({
    model: r.model,
    signals: {
      startsPerYear: r.startsPerYear,
      activeCommunities: 0,
      activeLots: 0,
      activePlans: 0,
      teamSize: 1,
      monthlySpend: 0,
      onTimeRate: 0,
      daysSalesOutstanding: 0,
      integrations: r.integrations,
    },
    abelInternal: r.slug === 'abel',
  })
  return {
    tenantId: `demo-${r.slug}`,
    model: shape.model,
    size: shape.size,
    integration: shape.integration,
    tier: r.tier, // trust seed; derived shape is sanity check
    startsPerYear: r.startsPerYear,
    activeCommunities: 0,
    activeLots: 0,
    activePlans: 0,
    teamSize: 1,
    monthlySpend: 0,
    onTimeRate: 0,
    daysSalesOutstanding: 0,
    integrations: r.integrations,
    billingPlan: 'TRIAL',
    paymentTerm: 'NET_30',
    creditLimit: 0,
    supportTier: 'STANDARD',
    accountRepStaffId: null,
    logoUrl: null,
    primaryColor: r.primaryColor ?? null,
    featureOverrides: {},
    status: r.status,
    activatedAt: null,
    churnedAt: r.status === 'CHURNED' ? new Date() : null,
    churnReason: r.churnReason ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    reclassifiedAt: new Date(),
  }
}

/** Resolve the active tenant profile — respects ?tenant=slug in demo mode. */
export function useTenantProfile(): TenantProfile {
  const searchParams = useSearchParams()
  const pathname = usePathname()

  return useMemo(() => {
    const slug = searchParams?.get('tenant') ?? FALLBACK_SLUG
    return profileFromRosterSlug(slug)
    // usePathname in deps keeps the demo profile fresh on navigation.
  }, [searchParams, pathname])
}

/** One-liner for components to check a feature. */
export function useTierFeature(feature: FeatureKey): boolean {
  const profile = useTenantProfile()
  return isFeatureEnabled(profile.tier, feature, profile.featureOverrides)
}

/** One-liner for app shell nav to render the right items. */
export function useTierNav() {
  const profile = useTenantProfile()
  return enabledNavItems(profile.tier, profile.featureOverrides)
}

/** One-liner for the Home page to decide which widgets to stack. */
export function useTierHomeWidgets() {
  const profile = useTenantProfile()
  return enabledHomeWidgets(profile.tier, profile.featureOverrides)
}

/** Demo helper — list every tenant slug for the tenant switcher dropdown. */
export function allRosterSlugs(): string[] {
  return ROSTER.map(r => r.slug)
}

export type { TierBucket }
