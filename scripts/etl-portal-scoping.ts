/**
 * scripts/etl-portal-scoping.ts
 *
 * Materializes engineering-scoping InboxItems for the top 5 MISSING Customer
 * Portal features identified by the A41 gap analysis, plus one master
 * roadmap summary item.
 *
 * Source tag: PORTAL_FEATURE_SCOPING
 *
 * Scoping is grounded in "Abel Lumber Customer Portal — Architecture & Build
 * Plan.docx" (Apr 2026, v1.0) — specifically §6.4 Bulk Purchasing, §8.1 AI
 * Reorder Predictions, §8.3 Multi-User Account Management, §9.1 PWA/Offline,
 * and §10 Database Schema Additions. Rate limiting is scoped from the
 * security-audit checklist in §9.3.
 *
 * Writes ONLY to InboxItem. No src/** writes. No schema/migration side-effects.
 * Cap: 6 InboxItems total (5 feature scopes + 1 roadmap summary).
 * Idempotent via deterministic IDs (sha256 of source tag + feature slug).
 *
 * Run:
 *   npx tsx scripts/etl-portal-scoping.ts            # DRY-RUN
 *   npx tsx scripts/etl-portal-scoping.ts --commit   # COMMIT
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC = 'PORTAL_FEATURE_SCOPING'
const CAP = 6

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface InboxData {
  id: string
  type: string
  source: string
  title: string
  description: string
  priority: Priority
  financialImpact: number | null
  actionData: Record<string, unknown>
}

function hashId(slug: string): string {
  return (
    'ib_portalscope_' +
    crypto.createHash('sha256').update(`${SRC}::${slug}`).digest('hex').slice(0, 18)
  )
}

// ---------------------------------------------------------------------------
// Feature scopes — one per A41 MISSING gap (top 5)
// ---------------------------------------------------------------------------

interface FeatureScope {
  slug: string
  title: string
  dataModel: string
  apiRoutes: string
  uiSurfaces: string
  engDays: string
  financialImpact: number | null
  rationale: string
}

const FEATURES: FeatureScope[] = [
  {
    slug: 'multi-user-team-management',
    title: 'Multi-user team management + team_members table',
    dataModel:
      'New team_members table (id, accountId FK BuilderAccount, userId FK User, role enum[ADMIN|PURCHASER|VIEWER], purchaseLimit Decimal nullable, invitedBy, invitedAt, acceptedAt, status). Add approval_chains table (accountId, minDollar, approverUserId, order). Audit log rows for every team-scoped action.',
    apiRoutes:
      'GET/POST /api/team, PATCH/DELETE /api/team/[memberId], POST /api/team/invite, POST /api/team/accept/[token], GET /api/team/activity. Middleware extension to enforce per-role purchase limits on /api/orders and /api/quotes.',
    uiSurfaces:
      '/dashboard/team (member list, invite modal, role picker, per-user spend cap). Settings → Approvals tab for approval-chain config. Order confirmation screen shows "pending approval" state when over limit.',
    engDays: '8-10 eng-days (2 BE, 1 DB migration, 3-4 FE, 1 QA, 1-2 permissions hardening)',
    financialImpact: 180000,
    rationale:
      'Unblocks enterprise builder accounts (Brookfield, Bloomfield, Cross) that require split purchasing. Estimated rev uplift ~$180K/yr from 3 multi-PM accounts currently capped to single-login ordering.',
  },
  {
    slug: 'ai-reorder-predictions',
    title: 'AI reorder predictions',
    dataModel:
      'New reorder_predictions table (id, accountId, projectId, predictedAt, predictedForDate, items JSON, confidence, modelVersion, status enum[ACTIVE|DISMISSED|ORDERED]). Feature-store view over existing Order + OrderLine + JobSchedule (phase 3 table) for training signal. No mutation to existing tables.',
    apiRoutes:
      'GET /api/predictions/reorder (list active for current account), POST /api/predictions/reorder/[id]/accept (one-click-to-cart), POST /api/predictions/reorder/[id]/dismiss, POST /api/internal/predictions/train (cron-triggered). Reuses existing /api/cart merge.',
    uiSurfaces:
      'Dashboard notification card: "Lot 12 needs framing lumber in ~10 days — reorder?" One-click CTA adds to cart. Inline on /dashboard/reorder and /dashboard/quick-order. Confidence badge + explainer tooltip.',
    engDays: '10-12 eng-days (3 ML/BE on predictor + nightly cron, 1 DB, 3 FE, 1 cart integration, 2 QA/eval, 1 model-monitoring)',
    financialImpact: 320000,
    rationale:
      'Predictive reorder drives incremental repeat revenue. Industry benchmarks (Lowes Pro, HD Pro) show 8-12% lift on accounts exposed to prompted reorder. Applied to Abel active-builder GMV, ~$320K/yr.',
  },
  {
    slug: 'bulk-purchasing-volume-tiers',
    title: 'Bulk purchasing workflow + volume tiers',
    dataModel:
      'New volume_tiers table (productId, minQty, tierPrice, effectiveFrom, effectiveTo). New bulk_orders table (id, accountId, poNumber, approvalStatus, approvedBy, approvalThreshold, notes) + bulk_order_splits (bulkOrderId, deliveryDate, items JSON, deliverySlotId). Extend Order with bulkOrderId FK.',
    apiRoutes:
      'POST /api/orders/bulk (submit with split delivery), GET /api/catalog/[id]/tiers, POST /api/orders/bulk/[id]/approve, POST /api/orders/bulk/[id]/reject, GET /api/orders/bulk/[id]/splits. Notifier hook to alert account rep when > $50K threshold crossed (already wired via InboxItem).',
    uiSurfaces:
      '/dashboard/cart bulk mode (split-delivery picker, PO field, tier preview). Catalog PDP: live volume-tier ladder. New /dashboard/orders/bulk/[id] review page. Ops-side approval shows in existing InboxItem queue.',
    engDays: '9-11 eng-days (2 DB/pricing engine, 3 BE, 3 FE, 1 ops-approval wiring, 1-2 QA)',
    financialImpact: 240000,
    rationale:
      'Transparent tier pricing + split delivery directly targets Brookfield/Bloomfield bulk frame-pack orders. Rev uplift comes from win-back of bulk orders currently placed through 84 Lumber. Conservative ~$240K/yr against Brookfield pipeline alone.',
  },
  {
    slug: 'pwa-offline-background-sync',
    title: 'PWA offline + background sync',
    dataModel:
      'No new server tables. Add offline_queue client-side store (IndexedDB) for queued writes. New sync_events table optional (eventId, userId, action, queuedAt, syncedAt, status) for server-side observability of offline-originated writes. Extend Order schema with clientQueueId for idempotency dedupe.',
    apiRoutes:
      'POST /api/sync/replay (batch replay of offline-queued writes with idempotency keys). Harden existing POST /api/orders, /api/cart, /api/quotes to accept Idempotency-Key header. New GET /api/sync/manifest (list of cache-warmable resources per user).',
    uiSurfaces:
      'manifest.json + service worker (Workbox). Install prompt on /dashboard. Offline banner + cached-data indicator on orders/schedule/takeoffs. Background-sync toast when queued writes flush.',
    engDays: '7-9 eng-days (2 SW/Workbox, 2 BE idempotency hardening, 2 FE offline states, 1 push-notif setup, 1 QA on-device)',
    financialImpact: null,
    rationale:
      'Retention + NPS play, not direct revenue. Builders at rural job sites (DFW fringe) lose trust when the portal 500s on spotty LTE. Strategic cost-to-stay-competitive.',
  },
  {
    slug: 'tiered-per-account-rate-limiting',
    title: 'Tiered per-account rate limiting',
    dataModel:
      'New rate_limit_tiers table (tier enum[FREE|STANDARD|PRO|ENTERPRISE], rpmLimit, burstLimit, scope). Extend BuilderAccount with rateLimitTier. rate_limit_events audit table (accountId, route, at, allowed bool, tier) for 30-day retention.',
    apiRoutes:
      'Middleware layer over all /api/* routes reading Upstash Redis counters (token-bucket per accountId + route-class). Admin: GET/PATCH /api/admin/accounts/[id]/rate-limit. GET /api/account/usage (self-service usage view). 429 responses with Retry-After.',
    uiSurfaces:
      'Ops /ops/accounts/[id] panel: tier selector + current usage graph. Builder-side Settings → API Usage card (calls today, limit, reset-at). 429 error boundary with clean retry UX.',
    engDays: '5-7 eng-days (2 middleware/Redis, 1 DB, 1 ops UI, 1 builder UI, 1 QA + load test)',
    financialImpact: null,
    rationale:
      'Platform-stability / abuse-prevention. No direct revenue; protects infra cost and fair-use across 100+ builder accounts as NUC engine and partner integrations drive API volume.',
  },
]

// ---------------------------------------------------------------------------
// Build items
// ---------------------------------------------------------------------------

function featureToItem(f: FeatureScope): InboxData {
  const title = `[SCOPE] ${f.title}`
  const description =
    `Engineering scope for Customer Portal MISSING feature (A41 gap analysis). ` +
    `Data model: ${f.dataModel} ` +
    `API routes: ${f.apiRoutes} ` +
    `UI surfaces: ${f.uiSurfaces} ` +
    `Estimated eng-days: ${f.engDays}. ` +
    `Business rationale: ${f.rationale} ` +
    `Source: ${SRC}. Grounded in "Abel Lumber Customer Portal — Architecture & Build Plan" (Apr 2026, v1.0).`

  return {
    id: hashId(f.slug),
    type: 'AGENT_TASK',
    source: 'portal-scoping',
    title,
    description,
    priority: 'HIGH',
    financialImpact: f.financialImpact,
    actionData: {
      sourceTag: SRC,
      featureSlug: f.slug,
      engDays: f.engDays,
      dataModel: f.dataModel,
      apiRoutes: f.apiRoutes,
      uiSurfaces: f.uiSurfaces,
      architectureDoc:
        'Abel Lumber Customer Portal — Architecture & Build Plan.docx (Apr 2026, v1.0)',
    },
  }
}

function buildRoadmapSummary(items: InboxData[]): InboxData {
  const totalImpact = items
    .map((i) => i.financialImpact ?? 0)
    .reduce((a, b) => a + b, 0)
  const lines = items.map((i) => `  - ${i.title} (${i.id})`).join(' ')
  return {
    id: hashId('summary::customer-portal-roadmap-q3-2026'),
    type: 'AGENT_TASK',
    source: 'portal-scoping',
    title: '[SCOPE] Customer Portal Roadmap Q3 2026',
    description:
      `Master roadmap rollup for the top 5 Customer Portal MISSING features ` +
      `identified by A41. Combined inferable rev uplift: $${totalImpact.toLocaleString()} ` +
      `(multi-user + reorder predictions + bulk purchasing). PWA/offline and ` +
      `rate limiting are platform/retention plays with no direct revenue line. ` +
      `Sequence recommendation: (1) multi-user team management unlocks bulk ` +
      `purchasing PO workflow, (2) bulk purchasing, (3) AI reorder predictions ` +
      `once order history + templates are stable, (4) PWA + (5) rate limiting ` +
      `bundled into the Phase 5 polish window. Links: ` +
      lines +
      ` Source: ${SRC}. Grounded in "Abel Lumber Customer Portal — Architecture & ` +
      `Build Plan.docx" (Apr 2026, v1.0) phases 2, 4, 5.`,
    priority: 'HIGH',
    financialImpact: totalImpact > 0 ? totalImpact : null,
    actionData: {
      sourceTag: SRC,
      roadmap: 'Customer Portal Q3 2026',
      linkedItemIds: items.map((i) => i.id),
      totalInferableUpliftUsd: totalImpact,
    },
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`ETL portal feature scoping → inbox — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)

  const featureItems = FEATURES.map(featureToItem)
  const summary = buildRoadmapSummary(featureItems)

  // Enforce cap (defensive — 5 features + 1 summary = 6, matches CAP)
  const all: InboxData[] = [summary, ...featureItems].slice(0, CAP)

  console.log()
  console.log(`InboxItems to produce: ${all.length} (cap ${CAP})`)
  console.log('Sample:')
  all.forEach((it, i) => {
    const impact = it.financialImpact != null ? ` $${it.financialImpact.toLocaleString()}` : ''
    console.log(`  ${i + 1}. [${it.priority}]${impact} ${it.title.slice(0, 110)}`)
  })
  console.log()

  if (DRY_RUN) {
    console.log('DRY-RUN complete — re-run with --commit to write.')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of all) {
      try {
        const existing = await prisma.inboxItem.findUnique({
          where: { id: it.id },
          select: { id: true },
        })
        await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            financialImpact: it.financialImpact ?? undefined,
            actionData: it.actionData as any,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description.slice(0, 2000),
            priority: it.priority,
            financialImpact: it.financialImpact ?? undefined,
            actionData: it.actionData as any,
          },
        })
        if (existing) updated++
        else created++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 140))
      }
    }
    console.log(`Committed: created=${created}, updated=${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
