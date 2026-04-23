/**
 * scripts/etl-aegis-rollout-docs.ts
 *
 * Consolidates the Aegis V2 rollout strategy docs into actionable InboxItems.
 * Source tag: AEGIS_V2_ROLLOUT
 *
 * Sources (all under the Abel Lumber OneDrive root):
 *   - AEGIS-TEAM-READINESS-PLAN.md      — 5 phases of data seeding + UI work
 *   - AEGIS-VS-LEGACY-GAP-ANALYSIS.md   — Phase 1/2/3 items for legacy kill
 *   - AEGIS_GLASS_ROLLOUT_PLAN.md       — Wave 1-4 UI rollout
 *   - AEGIS_LAUNCH_READINESS_PROMPT.md  — P0/P1 bugs and verification
 *   - Abel-OS-Go-Live-Action-Plan.md    — P0/P1/P2/P3 tiers
 *   - AEGIS-DEPLOY-NOTES-2026-04-22.md  — imminent deploy checklist (CRITICAL)
 *
 * Writes ONLY to InboxItem. Idempotent via deterministic IDs.
 * Cap: 40 items total, prioritizing CRITICAL > HIGH > MEDIUM.
 *
 * Run:
 *   npx ts-node scripts/etl-aegis-rollout-docs.ts            # DRY-RUN
 *   npx ts-node scripts/etl-aegis-rollout-docs.ts --commit   # COMMIT
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC = 'AEGIS_V2_ROLLOUT'
const CAP = 40

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface InboxData {
  id: string
  type: string
  source: string
  title: string
  description?: string
  priority: Priority
  dueBy?: Date
  dedupKey: string // used to drop cross-doc duplicates before insert
}

function hashId(key: string): string {
  return 'ib_aegis_' + crypto.createHash('sha256').update(`${SRC}::${key}`).digest('hex').slice(0, 20)
}

const DUE_IMMINENT = new Date('2026-04-23T23:00:00Z') // deploy today/tomorrow
const DUE_WEEK = new Date('2026-04-29T23:00:00Z')     // within a week
const DUE_MONTH = new Date('2026-05-22T23:00:00Z')    // within a month

// ---------------------------------------------------------------------------
// AEGIS-DEPLOY-NOTES-2026-04-22.md — imminent deploy checklist (each = CRITICAL)
// ---------------------------------------------------------------------------
function deployChecklist(): InboxData[] {
  const items: Array<{ key: string; title: string; description: string }> = [
    {
      key: 'deploy-commit-main',
      title: '[DEPLOY] Commit all staged Aegis v2 changes to main',
      description: 'Cowork audit session left 14+12 file fixes uncommitted. Commit to main (direct push OK per Nate). Includes null safety, auth cookie lookup, login contrast, dev-login gate, tel: links, debounce, timezone fix.',
    },
    {
      key: 'deploy-push-origin',
      title: '[DEPLOY] Push commits to origin to trigger Vercel',
      description: 'After commit, `git push origin main`. Vercel auto-deploys. Watch for build errors before running migrations.',
    },
    {
      key: 'deploy-migration-staff-hierarchy',
      title: '[DEPLOY] Run Neon migration: add_staff_hierarchy_and_comp.sql',
      description: 'Staff schema changes (hierarchy + comp fields). File: prisma/migrations/add_staff_hierarchy_and_comp.sql. Must run against prod Neon before seed-employees.',
    },
    {
      key: 'deploy-migration-agent-hub',
      title: '[DEPLOY] POST /api/ops/migrate-agent-hub (creates agent tables)',
      description: 'Creates BuilderIntelligence, AgentTask, AgentSession tables. Must run after the staff migration.',
    },
    {
      key: 'deploy-seed-employees',
      title: '[DEPLOY] POST /api/ops/seed-employees (24 employees)',
      description: 'Seeds the full 24-employee roster with hierarchy and comp. Depends on staff-hierarchy migration.',
    },
    {
      key: 'deploy-seed-demo-data',
      title: '[DEPLOY] POST /api/ops/seed-demo-data (500+ records)',
      description: 'Comprehensive demo data across 30 tables. Run after seed-employees. NUC real-data seeds should run AFTER this so live IDs overwrite seed_ prefixed demo records.',
    },
    {
      key: 'deploy-env-elevenlabs',
      title: '[DEPLOY] Set ELEVENLABS_API_KEY in Vercel env',
      description: 'Nate needs to rotate and set. Required for TTS routes (delivery notify, collections run-cycle, daily-brief, order audio).',
    },
    {
      key: 'deploy-env-resend',
      title: '[DEPLOY] Set RESEND_API_KEY in Vercel env',
      description: 'Required for staff email invitations and all outbound email. Without this, seeding staff produces no invite emails.',
    },
    {
      key: 'deploy-env-google-sa',
      title: '[DEPLOY] Set GOOGLE_SERVICE_ACCOUNT_KEY in Vercel env',
      description: 'Master NUC chat identified this as required for Gmail sync cron. Use 1Password pointer; never paste plaintext into a file.',
    },
  ]
  return items.map((it) => ({
    id: hashId(it.key),
    type: 'AGENT_TASK',
    source: 'aegis-deploy',
    title: it.title,
    description: it.description,
    priority: 'CRITICAL' as Priority,
    dueBy: DUE_IMMINENT,
    dedupKey: it.key,
  }))
}

// ---------------------------------------------------------------------------
// AEGIS_LAUNCH_READINESS_PROMPT.md — P0 bugs (CRITICAL)
// ---------------------------------------------------------------------------
function launchReadinessP0(): InboxData[] {
  const items: Array<{ key: string; title: string; description: string }> = [
    {
      key: 'p0-vercel-deploy-loop',
      title: '[P0] Resolve Vercel deploy loop (project-waqs0)',
      description: 'Deploy loop from 4/17-4/18 — confirm builds green. If still failing, roll back to dpl_7DRR9PiVQfzZ3KK2yTpywCRch4pS (commit af06780) and diagnose root cause.',
    },
    {
      key: 'p0-disable-supabase-gha',
      title: '[P0] Disable Sync Neon→Supabase GitHub Action',
      description: 'Workflow fails every commit. Supabase project hmevllertlhgawqsktmh is on the pause-to-stop-billing list. Delete or comment out the workflow file in .github/workflows/.',
    },
    {
      key: 'p0-parse-dollar-hyphen',
      title: '[P0] Fix parseDollar bug in src/app/api/ops/import-hyphen/route.ts',
      description: 'Parenthesized-negative handling too aggressive — `(1,234.56)` must parse to -1234.56 without corrupting other values. Test with Hyphen export data before re-enabling the hourly cron.',
    },
    {
      key: 'p0-orphan-hyphen-payment',
      title: '[P0] Delete orphan HyphenPayment row (builderName=null, amount=0)',
      description: 'Summary-row artifact polluting HyphenPayment. Single row, safe to delete directly.',
    },
    {
      key: 'p0-dev-login-prod-gate',
      title: '[P0] Verify /dev-login is blocked on app.abellumber.com',
      description: 'Production hostname gate was added in the Cowork audit — confirm it actually blocks after deploy. /dev-login must not be publicly reachable.',
    },
    {
      key: 'p0-rotate-secrets',
      title: '[P0] Verify .env.local never committed; rotate if so',
      description: 'If .env.local was ever in a commit, rotate JWT_SECRET, DATABASE_URL creds, and any API keys immediately. Follow brain/secrets/POLICY.md.',
    },
    {
      key: 'p0-resend-domain-verify',
      title: '[P0] Verify Resend domain (SPF/DKIM/DMARC for abellumber.com)',
      description: '15-minute DNS task. Without it: no alert emails, no quote follow-ups, no outreach, no morning briefing. Smoke test via POST /api/admin/test-alert-notify after.',
    },
    {
      key: 'p0-complete-stub-apis',
      title: '[P0] Complete 7 stub API routes (collections, invoices, smart-po, etc.)',
      description: 'Stubs that will break user flows: /api/ops/invoices, /api/ops/collections, /api/ops/collections/run-cycle, /api/ops/notifications, /api/ops/procurement-intelligence/smart-po, /api/ops/procurement-intelligence/vendor-scoring, /api/ops/sales/outreach-engine, /api/ops/integrations/quickbooks/setup.',
    },
    {
      key: 'p0-order-assignment-audit',
      title: '[P0] Run auditOrderAssignments for InFlow default-builder misassignments',
      description: 'Dry-run first, then fix. Checks for orders incorrectly attached to a default/fallback builder from InFlow sync.',
    },
  ]
  return items.map((it) => ({
    id: hashId(it.key),
    type: 'AGENT_TASK',
    source: 'aegis-launch',
    title: it.title,
    description: it.description,
    priority: 'CRITICAL' as Priority,
    dueBy: DUE_IMMINENT,
    dedupKey: it.key,
  }))
}

// ---------------------------------------------------------------------------
// AEGIS-TEAM-READINESS-PLAN.md — Phase 1 seeding priorities
// ---------------------------------------------------------------------------
function teamReadinessSeeds(): InboxData[] {
  const items: Array<{ key: string; title: string; description: string; pri: Priority }> = [
    {
      key: 'seed-builders-100',
      title: '[SEED] Populate Builder table from brain_export/customers.jsonl (100)',
      description: 'Map name→companyName, payment_terms→paymentTerm enum, classify builderType PRODUCTION vs CUSTOM (Pulte/Brookfield/Bloomfield/Toll etc PRODUCTION). Default creditLimit $50K prod / $25K custom, territory DFW. FORBIDDEN for NUC session — NUC owns Builder writes.',
      pri: 'CRITICAL',
    },
    {
      key: 'seed-products-3093',
      title: '[SEED] Populate Product table from brain_export/products.jsonl (3,093)',
      description: 'SKU, cost, basePrice, minMargin. Parse attributes from name (doorSize 2068/2868/3068, handing LH/RH/LHIS/RHIS, core HC/SC, panel, jamb, material, fireRating). FORBIDDEN for NUC session.',
      pri: 'CRITICAL',
    },
    {
      key: 'seed-staff-44',
      title: '[SEED] Populate Staff table (44 people) with role + department',
      description: 'Nate ADMIN/EXECUTIVE, Clint ADMIN/OPS, Dawn MANAGER/ACCOUNTING, Dalton MANAGER/SALES, Sean MANAGER/CS, PMs PROJECT_MANAGER/OPS, Lisa ESTIMATOR, Jordyn MANAGER/LOGISTICS, production WAREHOUSE_TECH, drivers DRIVER/LOGISTICS. Manager hierarchy: everyone→Nate, production→Clint, drivers→Jordyn.',
      pri: 'CRITICAL',
    },
    {
      key: 'seed-vendors-64',
      title: '[SEED] Populate Vendor table from brain_export/vendors.jsonl (64)',
      description: 'name, contactName, email, phone, address, avgLeadDays, code (first 2-4 chars e.g. Boise Cascade → BC). FORBIDDEN for NUC session.',
      pri: 'HIGH',
    },
    {
      key: 'seed-builder-pricing-8k',
      title: '[SEED] Populate BuilderPricing (~8,000 rows)',
      description: 'For each product with builder_prices dict, fuzzy-match Builder by companyName, link productId, insert customPrice, compute margin=(customPrice-cost)/customPrice. Depends on builder + product seeds.',
      pri: 'HIGH',
    },
    {
      key: 'seed-inventory-2110',
      title: '[SEED] Populate InventoryItem from brain_export/products_inventory.jsonl (2,110)',
      description: 'sku→productId lookup, onHand from quantity, available=onHand, status IN_STOCK/OUT_OF_STOCK. FORBIDDEN for NUC session — NUC owns Inventory writes.',
      pri: 'HIGH',
    },
    {
      key: 'seed-vendor-products-1400',
      title: '[SEED] Populate VendorProduct (~1,400 links)',
      description: 'For each product with a vendor field, fuzzy-match Vendor, insert VendorProduct with vendorSku + vendorCost.',
      pri: 'HIGH',
    },
    {
      key: 'seed-financial-collection-rules',
      title: '[SEED] Create FinancialSnapshot baseline + 4 CollectionRules',
      description: 'Snapshot 2026-04-22: arTotal, dso, overdueARPct. CollectionRules: Day 15 REMINDER email, Day 30 PAST_DUE email+phone, Day 45 FINAL_NOTICE phone, Day 60 ACCOUNT_HOLD phone.',
      pri: 'MEDIUM',
    },
    {
      key: 'fix-471-jobs-missing-dates',
      title: '[FIX] 471 Jobs missing scheduledDate',
      description: 'Cross-reference Bolt work orders. Remaining: set scheduledDate = createdAt + 14 days default. Flag still-null as NEEDS_REVIEW.',
      pri: 'CRITICAL',
    },
    {
      key: 'kill-dead-models',
      title: '[FIX] Kill 5 dead models + fix OutreachSequence schema drift',
      description: 'Delete AccountReviewTrigger, AccountTouchpoint, DealActivity, DocumentRequest, QBSyncQueue (unless building Sales CRM or QB sync). Move OutreachSequence/Step/Enrollment from raw SQL into Prisma schema. Note: prisma/** edits pending migration blocked in this session.',
      pri: 'HIGH',
    },
  ]
  return items.map((it) => ({
    id: hashId(it.key),
    type: it.key.startsWith('seed-') ? 'AGENT_TASK' : 'SYSTEM',
    source: 'aegis-seed',
    title: it.title,
    description: it.description,
    priority: it.pri,
    dueBy: DUE_WEEK,
    dedupKey: it.key,
  }))
}

// ---------------------------------------------------------------------------
// AEGIS-VS-LEGACY-GAP-ANALYSIS.md — Phase 1 (unblocks InFlow kill)
// ---------------------------------------------------------------------------
function legacyGapPhase1(): InboxData[] {
  const items: Array<{ key: string; title: string; description: string; pri: Priority }> = [
    {
      key: 'gap-auto-reorder-po',
      title: '[GAP] Auto-reorder PO generation (reorderPoint → draft PO)',
      description: 'Buyers currently manually check stock and create POs. Build auto-trigger: when InventoryItem.onHand < reorderPoint, create draft PurchaseOrder for SmartPO queue. Unblocks InFlow kill.',
      pri: 'HIGH',
    },
    {
      key: 'gap-stock-transfer-ui',
      title: '[GAP] Build Stock Transfer UI + transaction audit',
      description: 'Bin/zone location exists but no transfer UI, no audit log, no damage tracking. Required for InFlow kill.',
      pri: 'HIGH',
    },
    {
      key: 'gap-inventory-valuation',
      title: '[GAP] Inventory valuation report (weighted average cost)',
      description: 'unitCost field exists but no FIFO/avg method, no valuation report, no aged inventory. Required for InFlow kill.',
      pri: 'HIGH',
    },
    {
      key: 'gap-credit-hold-enforcement',
      title: '[GAP] Credit hold enforcement on order creation',
      description: 'Orders can currently be created even when builder exceeds credit limit or AR > 30 days. Block at API level with override flag for ADMIN.',
      pri: 'HIGH',
    },
    {
      key: 'gap-job-costing-labor',
      title: '[GAP] Job costing with labor hours + WIP',
      description: 'Job model supports it, API stub exists. Need labor cost tracking, WIP, phase-based revenue recognition. Phase 2 — unblocks ECI Bolt kill.',
      pri: 'MEDIUM',
    },
    {
      key: 'gap-landed-cost',
      title: '[GAP] Landed cost tracking on POs (freight/tariff/duty)',
      description: 'Margins understated 2-5% without allocation. Phase 2 of legacy kill plan.',
      pri: 'MEDIUM',
    },
    {
      key: 'gap-qb-decision',
      title: '[GAP] QuickBooks Desktop sync: build or kill decision',
      description: 'Sync queue + models exist but no journal/AR/AP sync. CLAUDE.md flags this as pending decision. Decide; if kill, delete QBSyncQueue model.',
      pri: 'MEDIUM',
    },
  ]
  return items.map((it) => ({
    id: hashId(it.key),
    type: 'AGENT_TASK',
    source: 'aegis-gap',
    title: it.title,
    description: it.description,
    priority: it.pri,
    dueBy: DUE_MONTH,
    dedupKey: it.key,
  }))
}

// ---------------------------------------------------------------------------
// AEGIS_GLASS_ROLLOUT_PLAN.md — Wave 1/2/3 items
// ---------------------------------------------------------------------------
function glassRollout(): InboxData[] {
  const items: Array<{ key: string; title: string; description: string; pri: Priority }> = [
    {
      key: 'glass-fix-ops-auth',
      title: '[GLASS W1] Fix ops Stytch auth redirect loop',
      description: 'src/app/ops/layout.tsx redirects to /ops/login on any 401/403 from /api/ops/auth/me. Diagnose session cookie, API route misconfig, or redirect loop. Gating change for Glass rollout.',
      pri: 'HIGH',
    },
    {
      key: 'glass-tokens-fonts',
      title: '[GLASS W2] Foundation: tokens (globals.css) + fonts (Outfit/Azeret/Instrument Serif)',
      description: '4 files cascade to ~40% of pages. Add --glass, --c1-c4, --bp-fine/major/annotation/redline, --grad. Keep old --gold/--walnut aliases for backward compat.',
      pri: 'HIGH',
    },
    {
      key: 'glass-aegis-background',
      title: '[GLASS W2] Build <AegisBackground /> + <SystemPulse />',
      description: 'Gradient orbs + animated blueprint grid + 12 door SVGs watermark + ambient particles proportional to order volume. Respects prefers-reduced-motion, hides on mobile.',
      pri: 'HIGH',
    },
    {
      key: 'glass-color-migration',
      title: '[GLASS W2] Migrate 13,825 hardcoded color instances (Tier A shared components first)',
      description: '9,207 Tailwind + 1,102 hex + 3,460 inline style objects across 160+ files. Codemod 80%, manual 20%. Start with 15 shared components/layouts.',
      pri: 'MEDIUM',
    },
    {
      key: 'glass-error-boundaries',
      title: '[GLASS W3] Add error boundaries to all 31 layouts',
      description: 'Glass card fallback with door blueprint SVG drawing in behind error message. Logs to Sentry. Currently zero of 31 layouts have one.',
      pri: 'MEDIUM',
    },
    {
      key: 'glass-empty-states',
      title: '[GLASS W3] Add EmptyState + BlueprintAnimation to ~50 list/table pages',
      description: 'Every empty list gets door-plan SVG drawing in over 9s. Seeded by route path so it is consistent. Abel fingerprint everywhere.',
      pri: 'MEDIUM',
    },
    {
      key: 'glass-stagger-animations',
      title: '[GLASS W3] Staggered entry animations on 92 pages with zero animation',
      description: 'One .stagger-enter + .stagger-N utility system applied to KPI row / charts / tables in all 264 pages.',
      pri: 'MEDIUM',
    },
    {
      key: 'glass-command-centers',
      title: '[GLASS W3] Build 6 Tier-1 command center pages with signature graphics',
      description: '/ops (hero), /ops/executive, /ops/finance, /ops/sales, /ops/manufacturing, /ops/delivery. Animated gauges, Sankey, P&L waterfall, pipeline funnel. ~8hr.',
      pri: 'MEDIUM',
    },
    {
      key: 'glass-keyboard-a11y',
      title: '[GLASS W3] Keyboard nav + a11y for gradient text + focus rings',
      description: 'Screen readers cannot parse gradient clips — aria-label on every text-gradient. Focus ring: gradient glow. Skip-to-content link. DataTable arrow-key row nav.',
      pri: 'MEDIUM',
    },
    {
      key: 'glass-theme-escape',
      title: '[GLASS W1] Theme escape hatch: ?theme=drafting-room',
      description: 'localStorage-backed toggle loads old walnut/gold tokens. Users with issues switch back without a deploy. Low-risk safety net for rollout.',
      pri: 'LOW',
    },
  ]
  return items.map((it) => ({
    id: hashId(it.key),
    type: 'AGENT_TASK',
    source: 'aegis-glass',
    title: it.title,
    description: it.description,
    priority: it.pri,
    dueBy: DUE_MONTH,
    dedupKey: it.key,
  }))
}

// ---------------------------------------------------------------------------
// Abel-OS-Go-Live-Action-Plan.md — P1/P2 items not already covered
// ---------------------------------------------------------------------------
function goLivePlan(): InboxData[] {
  const items: Array<{ key: string; title: string; description: string; pri: Priority }> = [
    {
      key: 'golive-csv-pdf-export',
      title: '[P1] CSV/PDF export on reports and financial data',
      description: 'Currently display-only. Finance needs exportable AR aging, P&L, PO summaries. Reports pages are built; need server-side export endpoints.',
      pri: 'HIGH',
    },
    {
      key: 'golive-mobile-responsive',
      title: '[P1] Mobile/tablet responsive pass on high-traffic pages',
      description: 'Orders, inventory, quotes — ops staff use tablets on the floor. Verify touch targets >=48px, horizontal scroll on tables, sticky first column.',
      pri: 'HIGH',
    },
    {
      key: 'golive-job-costing-pnl',
      title: '[P2] Job costing P&L rollup',
      description: 'Per-job materials + labor + overhead vs invoice. Manufacturing page has pieces but no consolidated view.',
      pri: 'MEDIUM',
    },
    {
      key: 'golive-audit-trail-ui',
      title: '[P2] Audit trail UI page',
      description: 'AuditLog model exists but no admin page to view it. Compliance teams will ask. CLAUDE.md flags audit-log sweep → 100% as P0 priority already.',
      pri: 'MEDIUM',
    },
    {
      key: 'golive-multi-location-inventory',
      title: '[P2] Multi-location inventory segmentation',
      description: 'Locations page exists but inventory not segmented by location. Required if Abel operates multiple yards/warehouses.',
      pri: 'LOW',
    },
    {
      key: 'golive-hyphen-job-linker',
      title: '[P1] Hyphen → Job linker (0/80 match rate)',
      description: 'Build community-mapping lookup table: Hyphen community name → Abel community/project IDs. Or document manual linking requirement. Brookfield integration partially broken.',
      pri: 'HIGH',
    },
  ]
  return items.map((it) => ({
    id: hashId(it.key),
    type: 'AGENT_TASK',
    source: 'aegis-golive',
    title: it.title,
    description: it.description,
    priority: it.pri,
    dueBy: DUE_MONTH,
    dedupKey: it.key,
  }))
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function priorityRank(p: Priority): number {
  return p === 'CRITICAL' ? 0 : p === 'HIGH' ? 1 : p === 'MEDIUM' ? 2 : 3
}

async function main() {
  console.log(`ETL Aegis rollout docs — source tag: ${SRC} — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log()

  const batches = [
    { name: 'Deploy Checklist (CRITICAL)', items: deployChecklist() },
    { name: 'Launch Readiness P0', items: launchReadinessP0() },
    { name: 'Team Readiness Seeds', items: teamReadinessSeeds() },
    { name: 'Legacy Gap Phase 1/2', items: legacyGapPhase1() },
    { name: 'Glass Rollout W1-W3', items: glassRollout() },
    { name: 'Go-Live Action Plan P1/P2', items: goLivePlan() },
  ]

  let preDedup = 0
  for (const b of batches) {
    console.log(`  ${b.name}: ${b.items.length} items`)
    preDedup += b.items.length
  }
  console.log(`Pre-dedup total: ${preDedup}`)

  // Dedupe across docs on dedupKey (first occurrence wins — keeps earlier higher-pri batch)
  const seen = new Set<string>()
  const deduped: InboxData[] = []
  for (const b of batches) {
    for (const it of b.items) {
      if (seen.has(it.dedupKey)) continue
      seen.add(it.dedupKey)
      deduped.push(it)
    }
  }
  console.log(`Post-dedup total: ${deduped.length}`)

  // Sort CRITICAL first, then HIGH, MEDIUM, LOW. Cap at CAP.
  deduped.sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority))
  const final = deduped.slice(0, CAP)

  const byPriority = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }
  for (const it of final) byPriority[it.priority]++
  console.log(`Capped to ${CAP} — priority mix:`, byPriority)
  console.log()

  const crits = final.filter((i) => i.priority === 'CRITICAL')
  console.log(`Top ${Math.min(10, crits.length)} CRITICAL items:`)
  crits.slice(0, 10).forEach((it, i) => {
    console.log(`  ${String(i + 1).padStart(2)}. ${it.title.slice(0, 110)}`)
  })
  console.log()

  if (DRY_RUN) {
    console.log('DRY-RUN — re-run with --commit to write.')
    return
  }

  const prisma = new PrismaClient()
  let created = 0
  let updated = 0
  let failed = 0
  try {
    for (const it of final) {
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
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            dueBy: it.dueBy,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            dueBy: it.dueBy,
          },
        })
        if (existing) updated++
        else created++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 160))
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
