/**
 * scripts/etl-customer-portal-arch.ts
 *
 * Extracts the feature backlog from:
 *   "Abel Lumber Customer Portal — Architecture & Build Plan.docx"
 * and loads each feature as a MEDIUM-priority InboxItem with type=AGENT_TASK,
 * suitable for engineering triage on the Aegis customer portal.
 *
 * Source tag: CUSTOMER_PORTAL_ARCH
 *
 * Writes allowed (per task policy): InboxItem ONLY.
 *   - No writes to Builder, Product, InventoryItem, Vendor.
 *   - No edits to src/app/** or prisma/**.
 *
 * Idempotency:
 *   Deterministic id = `cparch-<slug>` so re-running `--commit` is a safe upsert.
 *
 * Cross-check:
 *   Each feature's description includes an AEGIS STATUS line noting whether
 *   a matching route already exists in src/app (checked at authorship time —
 *   this script does NOT touch src/app).
 *
 * Usage:
 *   tsx scripts/etl-customer-portal-arch.ts             # dry-run
 *   tsx scripts/etl-customer-portal-arch.ts --commit    # write
 */

import { PrismaClient } from '@prisma/client'

const DRY_RUN = !process.argv.includes('--commit')
const SOURCE_TAG = 'CUSTOMER_PORTAL_ARCH'
const SOURCE_DOC = 'Abel Lumber Customer Portal — Architecture & Build Plan.docx'

type Feature = {
  slug: string
  phase: 1 | 2 | 3 | 4 | 5 | 0
  title: string
  description: string
  /** 'BUILT' | 'PARTIAL' | 'MISSING' based on src/app cross-check at authorship */
  aegisStatus: 'BUILT' | 'PARTIAL' | 'MISSING'
  aegisNote: string
}

/**
 * Feature backlog — extracted from the 14-week plan DOCX.
 * aegisStatus was determined by inspecting src/app/** routes for matching
 * paths. See "AEGIS STATUS" line in each description.
 */
const FEATURES: Feature[] = [
  // ---- PHASE 1 — AI Blueprint Takeoff ----
  {
    slug: 'p1-blueprint-list-page',
    phase: 1,
    title: 'Customer: Blueprint list + saved takeoffs page',
    description:
      'Builder-facing /dashboard/blueprints page: list all takeoffs, filter, search, status badges, upload CTA. Pulls from /api/projects/[id]/blueprints and /api/ops/takeoffs filtered by builder.',
    aegisStatus: 'BUILT',
    aegisNote: 'src/app/dashboard/blueprints/page.tsx exists — verify it matches spec (filter by builder, status badges).',
  },
  {
    slug: 'p1-blueprint-upload-wizard',
    phase: 1,
    title: 'Customer: Blueprint upload wizard (drag-drop, multi-file, PDF/PNG/JPG/DWG)',
    description:
      '/dashboard/blueprints/new page with BlueprintUploader component. Drag-drop, multi-file, progress bar, preview thumbs. Max 50MB per file, malware-scan in Vercel Blob.',
    aegisStatus: 'BUILT',
    aegisNote: 'src/app/dashboard/blueprints/new/page.tsx exists — verify 50MB limit, malware scan, DWG support.',
  },
  {
    slug: 'p1-takeoff-detail-editable',
    phase: 1,
    title: 'Customer: Takeoff detail page with editable material list',
    description:
      '/dashboard/blueprints/[id] TakeoffTable component: inline qty edit, material swap (Good/Better/Best), confidence scores per line, live total recalc, flag < 80% confidence.',
    aegisStatus: 'BUILT',
    aegisNote: 'src/app/dashboard/blueprints/[id]/page.tsx exists — verify inline edit + confidence flagging.',
  },
  {
    slug: 'p1-blueprint-convert-endpoint',
    phase: 1,
    title: 'API: /api/blueprints/[id]/convert — takeoff → quote or order',
    description:
      'One-click conversion. Quote path routes to ops for approval; order path validates inventory then creates order. Confirmed inventory only for direct order.',
    aegisStatus: 'BUILT',
    aegisNote: 'src/app/api/blueprints/[id]/convert/route.ts exists — verify quote-vs-order branching + inventory check.',
  },
  {
    slug: 'p1-blueprint-adjust-endpoint',
    phase: 1,
    title: 'API: /api/blueprints/[id]/adjust — save customer qty/material adjustments',
    description:
      'PUT endpoint persisting customer edits to takeoff_adjustments table with diff JSON. Each call appends a new adjustment row (audit trail).',
    aegisStatus: 'MISSING',
    aegisNote: 'No src/app/api/blueprints/[id]/adjust/route.ts found — build new.',
  },
  {
    slug: 'p1-blueprint-duplicate-compare',
    phase: 1,
    title: 'API: /api/blueprints/[id]/duplicate + /compare — clone & diff takeoffs',
    description:
      'Duplicate clones a takeoff to a new job. Compare returns a side-by-side diff of two takeoff versions (line-by-line qty/price/material delta).',
    aegisStatus: 'MISSING',
    aegisNote: 'Not found under src/app/api/blueprints — build new pair.',
  },

  // ---- PHASE 2 — Elite Material Buying ----
  {
    slug: 'p2-catalog-realtime-inventory',
    phase: 2,
    title: 'Catalog: Real-time inventory by yard with SSE updates',
    description:
      'Enhance /dashboard/catalog: InventoryBadge per product (green/yellow/red), yard-level stock, SSE push on stock changes. Never let a builder order an unavailable item.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/catalog/page.tsx + src/app/api/catalog/inventory/route.ts exist — verify SSE and yard-level breakdown.',
  },
  {
    slug: 'p2-good-better-best-pricing',
    phase: 2,
    title: 'Catalog: Good/Better/Best price-tier selector on product detail',
    description:
      'PriceTierSelector component on /dashboard/catalog/[id]. Three tiers with feature-comparison table and one-click tier swap into cart/takeoff.',
    aegisStatus: 'MISSING',
    aegisNote: 'src/app/catalog/[id]/page.tsx exists but tiered pricing UX not confirmed — treat as missing, verify.',
  },
  {
    slug: 'p2-smart-search-faceted',
    phase: 2,
    title: 'Catalog: AI-powered faceted search with NL query',
    description:
      '/api/catalog/search with facets (category, brand, dim, spec) + "did-you-mean". Natural-language queries like "2x4 pressure treated 12 foot".',
    aegisStatus: 'MISSING',
    aegisNote: 'No src/app/api/catalog/search route found — build new.',
  },
  {
    slug: 'p2-saved-favorites',
    phase: 2,
    title: 'Catalog: Saved favorites synced across team members',
    description:
      'saved_favorites table + star UI on catalog. Favorites visible to all users on the same account.',
    aegisStatus: 'MISSING',
    aegisNote: 'No favorites routes found — build new.',
  },
  {
    slug: 'p2-quick-order-page',
    phase: 2,
    title: 'Quick-order page: reorder + template + SKU-paste + barcode',
    description:
      '/dashboard/quick-order: last 20 orders reorder, template apply with qty multiplier, SKU paste list, barcode scan via camera. Target < 3 min to complete order.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/quick-order/page.tsx exists (outside /dashboard) + src/app/dashboard/reorder — consolidate under /dashboard/quick-order per spec.',
  },
  {
    slug: 'p2-order-templates-crud',
    phase: 2,
    title: 'Order templates: CRUD + share + version history + CSV import/export',
    description:
      '/dashboard/templates + /api/templates. Variable qty multipliers (e.g. x1.1 waste), shared across team, version history, CSV round-trip for estimating software.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/dashboard/templates/page.tsx exists — verify CRUD API, versioning, CSV support.',
  },
  {
    slug: 'p2-bulk-purchasing-workflow',
    phase: 2,
    title: 'Bulk purchasing: volume tiers, split delivery, PO#, > $50K rep notify',
    description:
      '/api/orders/bulk. Volume discount tiers, multi-date split delivery, PO-number attachment, approval threshold per account, account-rep notification > $50K.',
    aegisStatus: 'MISSING',
    aegisNote: 'No bulk orders route found — build new.',
  },
  // ---- PHASE 3 — Job Scheduling & Delivery ----
  {
    slug: 'p3-gantt-schedule-page',
    phase: 3,
    title: 'Schedule: Gantt-style multi-job timeline with drag-drop reschedule',
    description:
      '/dashboard/schedule. GanttTimeline component, color-coded by project, daily→monthly zoom, drag to reschedule deliveries, inventory-availability check on drop.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/dashboard/schedule/page.tsx exists — verify Gantt UX + drag-drop + inventory check on drop.',
  },
  {
    slug: 'p3-schedule-job-detail',
    phase: 3,
    title: 'Schedule: Job detail page (milestones, deliveries, crews)',
    description:
      '/dashboard/schedule/[jobId] with milestone tracking (foundation, framing, drywall, trim), auto-linked deliveries, crew assignments.',
    aegisStatus: 'MISSING',
    aegisNote: 'No [jobId] route under src/app/dashboard/schedule found — build new.',
  },
  {
    slug: 'p3-delivery-live-tracking',
    phase: 3,
    title: 'Deliveries: Live GPS tracking page with ETA + driver contact',
    description:
      '/dashboard/deliveries/track/[id] — DeliveryMap with GPS truck position, ETA, route, driver name + contact. SSE for position updates.',
    aegisStatus: 'BUILT',
    aegisNote: 'src/app/dashboard/deliveries/track/[id]/page.tsx exists — verify SSE + real GPS (not polled).',
  },
  {
    slug: 'p3-delivery-photo-confirmation',
    phase: 3,
    title: 'Deliveries: Driver photo upload + push-notify on delivery complete',
    description:
      '/api/deliveries/[id]/photos: driver uploads completion photos (materials on site, signed receipt), triggers push notification to builder with photos.',
    aegisStatus: 'MISSING',
    aegisNote: 'No /api/deliveries/[id]/photos route found — build new.',
  },
  {
    slug: 'p3-delivery-slot-availability',
    phase: 3,
    title: 'API: /api/schedule/availability — delivery slot availability by fleet capacity',
    description:
      'Returns open delivery windows based on fleet capacity (reuses ops /api/crew/schedule). Used during order-placement delivery picker.',
    aegisStatus: 'MISSING',
    aegisNote: 'No /api/schedule/availability found — build new.',
  },
  // ---- PHASE 4 — Intelligence & Differentiation ----
  {
    slug: 'p4-ai-reorder-predictions',
    phase: 4,
    title: 'AI: Reorder predictions tied to project milestones',
    description:
      'Dashboard card: "You\'ll need framing lumber for Lot 12 in ~10 days. Reorder?" One-click add-to-cart with predicted quantities. Uses order history + milestone timeline.',
    aegisStatus: 'MISSING',
    aegisNote: 'No reorder-prediction surface found — build new (could live on /dashboard or /dashboard/intelligence).',
  },
  {
    slug: 'p4-3d-material-viz',
    phase: 4,
    title: '3D material visualization (WebGL) for framing/deck/trim',
    description:
      'Interactive 3D viewer on catalog pages for framing packages, deck systems, trim collections. e.g., preview Trex "Tiki Torch" vs "Island Mist" before ordering.',
    aegisStatus: 'MISSING',
    aegisNote: 'No 3D viewer found — build new.',
  },
  {
    slug: 'p4-multi-user-team-mgmt',
    phase: 4,
    title: 'Team: Multi-user account management with role-based perms',
    description:
      '/dashboard/team. team_members table. Roles (admin/purchaser/viewer), per-user purchase limits, approval chains, activity log, shared favorites/templates/takeoffs.',
    aegisStatus: 'MISSING',
    aegisNote: 'No src/app/dashboard/team route found — build new.',
  },
  {
    slug: 'p4-homeowner-portal-share',
    phase: 4,
    title: 'Homeowner portal: Shared project link (selections, timeline, payments)',
    description:
      '/dashboard/homeowner/[projectId]. Secure shareable link (no homeowner account). Shows material selections with photos, delivery schedule, change orders, payment milestones.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/homeowner/[token]/page.tsx + /api/homeowner/[token] exist — wire in /dashboard/homeowner/[projectId] launcher + share-link UX.',
  },
  {
    slug: 'p4-loyalty-rewards',
    phase: 4,
    title: 'Rewards: Loyalty tier (Silver/Gold/Plat) + points ledger + referrals',
    description:
      '/dashboard/rewards. loyalty_points ledger, tier status on annual spend, points per $, redemption for discounts/merch, referral bonuses, early access to promos.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/dashboard/referrals exists — /rewards page + loyalty_points table missing.',
  },
  {
    slug: 'p4-ai-chat-assistant',
    phase: 4,
    title: 'AI Chat widget (global, bottom-right, context-aware)',
    description:
      'Persistent ChatWidget on every page. Trained on catalog/pricing/policies. Queries real-time order & inventory. "When will my Lot 7 order arrive?" kind of questions.',
    aegisStatus: 'PARTIAL',
    aegisNote: 'src/app/dashboard/chat/page.tsx exists — promote to global floating widget with live-data context.',
  },

  // ---- PHASE 5 — Mobile, Performance, Polish ----
  {
    slug: 'p5-pwa-offline-background-sync',
    phase: 5,
    title: 'PWA: Install-to-home, offline cache, background sync for queued orders',
    description:
      'Service worker caches dashboard, orders, schedule, saved takeoffs. Background-sync queues offline order submissions. Install banner on iOS/Android.',
    aegisStatus: 'MISSING',
    aegisNote: 'No service worker / PWA manifest wiring detected beyond basic manifest.ts — build new.',
  },
  {
    slug: 'p5-push-notifications',
    phase: 5,
    title: 'Push notifications: delivery updates, quote approvals, schedule changes',
    description:
      'Web Push subscription + server push dispatch for delivery complete, quote approved, order confirmed, schedule change events.',
    aegisStatus: 'MISSING',
    aegisNote: 'src/app/dashboard/notifications page exists but no web-push wiring found — build new.',
  },
  {
    slug: 'p5-perf-budget-lighthouse-90',
    phase: 5,
    title: 'Perf: FCP<1.2s / LCP<2.5s / TTI<3.5s / CLS<0.1 / Lighthouse>90',
    description:
      'Edge caching (60s inventory, 5min catalog meta), streaming SSR, route-level code split, deferred hydration, image optimization, font-display: swap.',
    aegisStatus: 'MISSING',
    aegisNote: 'No perf budget enforcement found — add CI Lighthouse gate + edge-cache headers.',
  },

  // ---- Cross-cutting architecture / security ----
  {
    slug: 'arch-api-v2-namespace',
    phase: 0,
    title: 'Arch: Introduce /api/v2/* namespace for new endpoints',
    description:
      'All new customer endpoints prefixed /api/v2/ for graceful migration. Existing /api/* untouched. Consistent { success, data?, error? } envelope + pagination shape.',
    aegisStatus: 'MISSING',
    aegisNote: 'No /api/v2 tree found — establish namespace + response envelope helper.',
  },
  {
    slug: 'arch-rate-limiting-tiers',
    phase: 0,
    title: 'Security: Tiered rate limiting (blueprint 10/min, search 60/min, orders 5/min)',
    description:
      'Rate-limit middleware per route class: blueprint/analyze 10/min per account, catalog search 60/min, order submit 5/min, general API 120/min. Queue-with-backpressure for power users.',
    aegisStatus: 'MISSING',
    aegisNote: 'No per-account tiered rate limiter found — build middleware.',
  },
  {
    slug: 'arch-error-code-taxonomy',
    phase: 0,
    title: 'Arch: Standardized error-code taxonomy (INSUFFICIENT_INVENTORY, etc.)',
    description:
      'Enumerate error codes (INSUFFICIENT_INVENTORY, BLUEPRINT_ANALYSIS_FAILED, DELIVERY_SLOT_UNAVAILABLE, ...). Frontend surfaces contextual messages from code, not raw strings.',
    aegisStatus: 'MISSING',
    aegisNote: 'No central error-code module found — build new shared lib.',
  },
]

function buildDescription(f: Feature): string {
  return [
    f.description,
    '',
    `SOURCE: ${SOURCE_DOC}`,
    `PHASE: ${f.phase === 0 ? 'Cross-cutting' : `Phase ${f.phase}`}`,
    `AEGIS STATUS: ${f.aegisStatus} — ${f.aegisNote}`,
  ].join('\n')
}

async function main() {
  if (FEATURES.length > 30) {
    throw new Error(`Feature cap exceeded: ${FEATURES.length} > 30`)
  }

  console.log(`[${SOURCE_TAG}] ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'} — ${FEATURES.length} features`)
  console.log(`Source: ${SOURCE_DOC}`)
  console.log('')

  const byStatus = { BUILT: 0, PARTIAL: 0, MISSING: 0 }
  for (const f of FEATURES) byStatus[f.aegisStatus]++
  console.log(`Cross-check: BUILT=${byStatus.BUILT}  PARTIAL=${byStatus.PARTIAL}  MISSING=${byStatus.MISSING}`)
  console.log('')

  if (DRY_RUN) {
    for (const f of FEATURES) {
      console.log(`  [P${f.phase}] ${f.aegisStatus.padEnd(7)} cparch-${f.slug}`)
      console.log(`    ${f.title}`)
    }
    console.log('')
    console.log('DRY-RUN complete. Re-run with --commit to upsert InboxItems.')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  try {
    for (const f of FEATURES) {
      const id = `cparch-${f.slug}`
      const data = {
        type: 'AGENT_TASK',
        source: SOURCE_TAG.toLowerCase(),
        title: f.title,
        description: buildDescription(f),
        priority: 'MEDIUM',
        status: 'PENDING',
        actionData: {
          sourceTag: SOURCE_TAG,
          sourceDoc: SOURCE_DOC,
          phase: f.phase,
          slug: f.slug,
          aegisStatus: f.aegisStatus,
          aegisNote: f.aegisNote,
        } as any,
      }

      const existing = await prisma.inboxItem.findUnique({ where: { id } })
      if (existing) {
        await prisma.inboxItem.update({ where: { id }, data })
        updated++
      } else {
        await prisma.inboxItem.create({ data: { id, ...data } })
        created++
      }
    }
    console.log(`Committed: created=${created} updated=${updated}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
