/**
 * page-backgrounds.ts — route → section key mapper for <PageBackground>.
 *
 * Given a pathname, return the best-fit PageSection so the right animated
 * SVG blueprint renders behind the page content.
 *
 * Rules are ordered most-specific first — the first prefix that matches wins.
 * Keep this file alphabetically organized within each portal block when you
 * can, and prefer explicit prefixes over clever regexes.
 */

import type { PageSection } from '@/components/PageBackground'

export type { PageSection }

// Ordered list of (prefix → section). First match wins.
// Exact matches are written as `path === '...'` in the switch below.
const PREFIX_RULES: ReadonlyArray<readonly [string, PageSection]> = [
  // ── Ops: manufacturing ──────────────────────────────────────────────────
  ['/ops/manufacturing/qc', 'quality'],
  ['/ops/manufacturing', 'manufacturing'],
  ['/ops/mrp', 'manufacturing'],

  // ── Ops: delivery / logistics ────────────────────────────────────────────
  ['/ops/delivery', 'delivery'],
  ['/ops/fleet', 'delivery'],
  ['/ops/live-map', 'delivery'],
  ['/ops/locations', 'delivery'],
  ['/ops/route-optimizer', 'delivery'],

  // ── Ops: warehouse / inventory ───────────────────────────────────────────
  ['/ops/inventory', 'warehouse'],
  ['/ops/warehouse', 'warehouse'],
  ['/ops/floor-plans', 'warehouse'],
  ['/ops/staging', 'warehouse'],

  // ── Ops: finance ─────────────────────────────────────────────────────────
  ['/ops/finance', 'finance'],
  ['/ops/collections', 'finance'],
  ['/ops/invoices', 'finance'],
  ['/ops/cash-flow-optimizer', 'finance'],
  ['/ops/lien-releases', 'finance'],
  ['/ops/margin-rules', 'finance'],

  // ── Ops: purchasing ──────────────────────────────────────────────────────
  ['/ops/auto-po', 'purchasing'],
  ['/ops/contracts', 'purchasing'],
  ['/ops/catalog', 'purchasing'],
  ['/ops/customer-catalog', 'purchasing'],

  // ── Ops: sales / growth ──────────────────────────────────────────────────
  ['/ops/sales', 'sales'],
  ['/ops/growth', 'sales'],
  ['/ops/outreach', 'sales'],
  ['/ops/marketing', 'sales'],
  ['/ops/accounts/applications', 'sales'],
  ['/ops/accounts/proactive', 'sales'],
  ['/ops/accounts', 'sales'],
  ['/ops/customers', 'sales'],
  ['/ops/organizations', 'sales'],

  // ── Ops: jobs / projects ─────────────────────────────────────────────────
  ['/ops/jobs', 'jobs'],
  ['/ops/communities', 'jobs'],
  ['/ops/builder-health', 'jobs'],

  // ── Ops: quality / inspection ────────────────────────────────────────────
  ['/ops/inspections', 'quality'],
  ['/ops/audit', 'quality'],

  // ── Ops: AI ──────────────────────────────────────────────────────────────
  ['/ops/ai', 'ai'],
  ['/ops/agent', 'ai'],
  ['/ops/automations', 'ai'],
  ['/ops/delegations', 'ai'],
  ['/ops/admin/ai-usage', 'ai'],
  ['/ops/admin/trends', 'ai'],

  // ── Ops: communications / inbox ──────────────────────────────────────────
  ['/ops/inbox', 'communications'],
  ['/ops/messages', 'communications'],
  ['/ops/gchat', 'communications'],
  ['/ops/builder-messages', 'communications'],
  ['/ops/communication-log', 'communications'],
  ['/ops/notifications', 'communications'],

  // ── Ops: documents ───────────────────────────────────────────────────────
  ['/ops/documents', 'documents'],
  ['/ops/blueprints', 'documents'],
  ['/ops/imports', 'documents'],

  // ── Ops: hr / crew management ────────────────────────────────────────────
  ['/ops/crews', 'hr'],
  ['/ops/homeowner-access', 'hr'],

  // ── Ops: integrations ────────────────────────────────────────────────────
  ['/ops/integrations', 'integrations'],
  ['/ops/admin/crons', 'integrations'],

  // ── Ops: reporting / executive ───────────────────────────────────────────
  ['/ops/kpis', 'reporting'],
  ['/ops/executive', 'reporting'],
  ['/ops/command-center', 'reporting'],
  ['/ops/my-day', 'reporting'],

  // ── Admin portal ─────────────────────────────────────────────────────────
  ['/admin/builders', 'admin-builders'],
  ['/admin/products', 'admin-products'],
  ['/admin/health', 'admin-monitoring'],
  ['/admin/errors', 'admin-monitoring'],
  ['/admin/alert-history', 'admin-monitoring'],
  ['/admin/timeline', 'admin-monitoring'],
  ['/admin/slo', 'admin-monitoring'],
  ['/admin/webhooks', 'admin-monitoring'],
  ['/admin/crons', 'admin-monitoring'],
  ['/admin/hyphen', 'integrations'],
  ['/admin/quotes', 'documents'],

  // ── Builder portal (dashboard/*) ─────────────────────────────────────────
  ['/dashboard/orders', 'builder-orders'],
  ['/dashboard/cart', 'builder-orders'],
  ['/dashboard/reorder', 'builder-orders'],
  ['/dashboard/bulk-order', 'builder-orders'],
  ['/dashboard/deliveries', 'delivery'],
  ['/dashboard/projects', 'builder-projects'],
  ['/dashboard/blueprints', 'builder-projects'],
  ['/dashboard/schedule', 'builder-projects'],
  ['/dashboard/templates', 'builder-projects'],
  ['/dashboard/invoices', 'builder-finance'],
  ['/dashboard/payments', 'builder-finance'],
  ['/dashboard/statement', 'builder-finance'],
  ['/dashboard/savings', 'builder-finance'],
  ['/dashboard/settings', 'builder-account'],
  ['/dashboard/onboarding', 'builder-account'],
  ['/dashboard/referrals', 'builder-account'],
  ['/dashboard/warranty', 'builder-account'],
  ['/dashboard/profile', 'builder-account'],
  ['/dashboard/messages', 'communications'],
  ['/dashboard/chat', 'communications'],
  ['/dashboard/notifications', 'communications'],
  ['/dashboard/quotes', 'documents'],
  ['/dashboard/analytics', 'reporting'],
  ['/dashboard/intelligence', 'reporting'],
  ['/dashboard/activity', 'reporting'],

  // ── Sales portal ────────────────────────────────────────────────────────
  ['/sales', 'sales'],

  // ── Crew portal ──────────────────────────────────────────────────────────
  ['/crew/briefing', 'jobs'],
  ['/crew/delivery', 'delivery'],
  ['/crew/install', 'manufacturing'],
  ['/crew/route', 'delivery'],
  ['/crew/profile', 'crew'],
  ['/crew', 'crew'],

  // ── Other ────────────────────────────────────────────────────────────────
  ['/executive', 'reporting'],
  ['/catalog', 'admin-products'],
  ['/apply', 'builder-account'],
  ['/bulk-order', 'builder-orders'],
  ['/get-quote', 'documents'],
  ['/homeowner', 'builder-account'],
]

/**
 * Map a Next.js pathname to a PageSection key.
 *
 * Handles exact matches for portal roots (e.g. /ops, /admin, /dashboard) and
 * falls back to longest-prefix match across PREFIX_RULES. Returns 'default'
 * if nothing matches.
 */
export function getSectionForPath(pathname: string | null | undefined): PageSection {
  if (!pathname) return 'default'

  // Strip trailing slash (except root) for consistent matching
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname

  // Exact portal-root matches
  switch (path) {
    case '/':
      return 'default'
    case '/ops':
      return 'reporting'
    case '/admin':
      return 'reporting'
    case '/dashboard':
      return 'default'
    case '/sales':
      return 'sales'
    case '/crew':
      return 'crew'
  }

  // Longest-prefix wins — iterate all rules, keep best match
  let bestMatch: PageSection = 'default'
  let bestLen = 0
  for (const [prefix, section] of PREFIX_RULES) {
    if ((path === prefix || path.startsWith(prefix + '/')) && prefix.length > bestLen) {
      bestMatch = section
      bestLen = prefix.length
    }
  }

  return bestMatch
}
