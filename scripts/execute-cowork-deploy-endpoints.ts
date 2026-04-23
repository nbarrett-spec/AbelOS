/**
 * execute-cowork-deploy-endpoints.ts
 *
 * Source tag: COWORK_DEPLOY_APR2026
 *
 * Cowork queued three post-deploy endpoints that still need to run against
 * production:
 *   1. POST /api/ops/migrate-agent-hub  -> creates AgentTask / AgentMessage /
 *                                          AgentSession / AgentConfig /
 *                                          BuilderIntelligence tables + seeds
 *                                          6 agent sessions, default configs,
 *                                          6 agent Staff accounts.
 *   2. POST /api/ops/seed-employees    -> deletes test staff, deactivates 11
 *                                          departed emails, upserts 24 active
 *                                          Abel employees, wires managerId FKs.
 *   3. POST /api/ops/seed-demo-data    -> wipes every "seed_%" row across 40+
 *                                          tables, then bulk-inserts 10 demo
 *                                          builders, 25 products, 7 vendors,
 *                                          plus 500+ child rows (orders,
 *                                          quotes, jobs, invoices, etc.).
 *
 * All three require staff auth cookies. We do NOT POST from CLI.
 *
 * WHY NOT JUST RUN THE SQL HERE?
 * --------------------------------
 *   - (1) is table-creation + config-seed only. It is safe in isolation BUT
 *     it also inserts 6 rows into the production `Staff` table with the
 *     `*.agent@abellumber.com` addresses. The NUC brain already seeds Staff
 *     accounts for agent roles. Duplicating that from here risks collisions
 *     with whatever NUC's own onboarding path creates, and the passwordHash
 *     baked into the route (AgentAccess2026!) is a hardcoded secret we do not
 *     want pinned into a CLI script.
 *   - (2) mutates Staff in ways tied to real people (deactivating departed
 *     emails, changing roles/payType/salary). This needs an authenticated
 *     admin trigger, not a silent CLI run.
 *   - (3) unconditionally deletes every row whose id starts with `seed_`
 *     across 40+ tables, including Builder, Product, Order, Invoice, etc.
 *     Running that from a local CLI while Nate has a prod DB_URL in .env
 *     would be irreversible if the filter were ever typo'd.
 *
 * WHAT THIS SCRIPT DOES
 * ---------------------
 * Read-only:
 *   1. Prints a DRY-RUN summary of what each endpoint will do when Nate POSTs
 *      it from an authenticated browser session.
 *   2. Creates three CRITICAL InboxItems so the work does not get forgotten.
 *      dueBy = tomorrow.
 *
 * Usage:
 *   npx tsx scripts/execute-cowork-deploy-endpoints.ts
 *
 * It does NOT:
 *   - POST to any of the three endpoints
 *   - CREATE or MODIFY any Staff / Builder / Product rows
 *   - Run any destructive SQL
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type EndpointPlan = {
  key: string
  path: string
  tables: string[]
  rows: string
  risks: string[]
  dryRunNotes: string[]
}

const PLAN: EndpointPlan[] = [
  {
    key: 'migrate-agent-hub',
    path: '/api/ops/migrate-agent-hub',
    tables: ['AgentTask', 'AgentMessage', 'AgentSession', 'AgentConfig', 'BuilderIntelligence'],
    rows: '5 CREATE TABLE IF NOT EXISTS, 14 CREATE INDEX, 6 AgentSession seeds, 14 AgentConfig defaults, 6 Staff agent accounts',
    risks: [
      'Drops AgentMessage before recreating (CASCADE) - acceptable, table is unused pre-cutover',
      'Inserts 6 Staff rows with hardcoded bcrypt hash for password "AgentAccess2026!"',
      'Potential conflict if NUC brain has already seeded agent Staff accounts under different emails',
    ],
    dryRunNotes: [
      'CREATE TABLE IF NOT EXISTS is idempotent - safe to re-run',
      'Agent Staff INSERTs use ON CONFLICT (email) DO NOTHING - idempotent',
      'AgentSession and AgentConfig seeds use ON CONFLICT (...) DO NOTHING - idempotent',
    ],
  },
  {
    key: 'seed-employees',
    path: '/api/ops/seed-employees',
    tables: ['Staff'],
    rows: '11 departed staff deactivated, 24 active employees upserted, manager FK graph rebuilt, test @abel-ops.com / @example.com rows DELETEd',
    risks: [
      'Hard DELETE of any Staff row whose email ends in @abel-ops.com or @example.com - will cascade to any FK-dependent audit rows that lack ON DELETE SET NULL',
      'Overwrites role/department/title/salary for every active employee based on the hardcoded ACTIVE_EMPLOYEES array in the route',
      'Requires requireDevAdmin - only Nate (n.barrett@abellumber.com) can trigger',
    ],
    dryRunNotes: [
      'UPDATE branch preserves passwordHash for existing staff',
      'INSERT branch uses defaultPasswordHash bcrypt("abel2026", 12) for new hires',
      'managerId graph rebuilt via email lookup - tolerant to row ordering',
    ],
  },
  {
    key: 'seed-demo-data',
    path: '/api/ops/seed-demo-data',
    tables: ['Builder', 'Product', 'Vendor', 'Project', 'Quote', 'Takeoff', 'Order', 'OrderItem', 'Invoice', 'InvoiceItem', 'Payment', 'Job', 'Delivery', 'Crew', 'Deal', 'PurchaseOrder', 'Community', 'Activity', 'Notification', '+20 more'],
    rows: '10 builders, 25 products, 7 vendors, 500+ child rows (orders, quotes, jobs, invoices, etc.)',
    risks: [
      'Executes DELETE FROM "<table>" WHERE "id" LIKE \'seed_%\' across 40+ tables before re-inserting',
      'Idempotent as long as the "seed_%" id prefix convention is never violated',
      'Do NOT run on a DB that contains real production Builder rows whose ids happen to start with "seed_"',
    ],
    dryRunNotes: [
      'All demo ids follow pattern seed_<prefix>_<nnn> - safe to distinguish from real data',
      'Cleanup phase wraps each DELETE in try/catch - tolerant of missing tables',
      'Phase 1-N ordering matches FK topology (Product -> Vendor -> Builder -> Project -> Order -> OrderItem -> Invoice -> Payment)',
    ],
  },
]

async function checkDbState() {
  const [staffCount, builderCount, productCount, agentSessionCount, inboxPending] = await Promise.all([
    prisma.staff.count(),
    prisma.builder.count(),
    prisma.product.count(),
    prisma.$queryRawUnsafe<Array<{ count: bigint }>>(`SELECT COUNT(*)::bigint AS count FROM "AgentSession"`).catch(() => [{ count: 0n }]),
    prisma.inboxItem.count({ where: { status: 'PENDING' } }),
  ])
  return {
    staff: staffCount,
    builders: builderCount,
    products: productCount,
    agentSessions: Number((agentSessionCount as any)[0]?.count ?? 0),
    inboxPending,
  }
}

async function createInboxItems() {
  const now = new Date()
  const dueBy = new Date(now.getTime() + 24 * 60 * 60 * 1000)
  let created = 0
  const results: Array<{ path: string; id: string }> = []

  for (const plan of PLAN) {
    // Idempotency: skip if an open InboxItem for this endpoint already exists.
    const existing = await prisma.inboxItem.findFirst({
      where: {
        source: 'cowork-deploy',
        entityType: 'DeployEndpoint',
        entityId: plan.path,
        status: { in: ['PENDING', 'SNOOZED'] },
      },
    })
    if (existing) {
      results.push({ path: plan.path, id: `${existing.id} (existing)` })
      continue
    }

    const item = await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: 'cowork-deploy',
        title: `Log into Aegis as ADMIN and POST to ${plan.path}`,
        description: [
          `Post-deploy endpoint queued by Cowork on 2026-04-22 still needs to run.`,
          ``,
          `What it does: ${plan.rows}`,
          `Tables touched: ${plan.tables.join(', ')}`,
          ``,
          `How to run:`,
          `  1. Log in at https://app.abellumber.com with n.barrett@abellumber.com`,
          `  2. Open browser devtools -> Network tab`,
          `  3. POST ${plan.path} with credentials: 'include'`,
          `     (or use a curl with the session cookie copied from devtools)`,
          ``,
          `Risks:`,
          ...plan.risks.map(r => `  - ${r}`),
        ].join('\n'),
        priority: 'CRITICAL',
        status: 'PENDING',
        entityType: 'DeployEndpoint',
        entityId: plan.path,
        dueBy,
        actionData: {
          method: 'POST',
          endpoint: plan.path,
          requires: plan.path === '/api/ops/seed-employees' ? 'DEV_ADMIN' : 'STAFF_AUTH',
          source: 'COWORK_DEPLOY_APR2026',
          tables: plan.tables,
        },
      },
    })
    created++
    results.push({ path: plan.path, id: item.id })
  }

  return { created, results }
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log(' COWORK POST-DEPLOY ENDPOINT RUNNER  (DRY-RUN MODE)')
  console.log(' Source tag: COWORK_DEPLOY_APR2026')
  console.log('═══════════════════════════════════════════════════════════════════')
  console.log()
  console.log('This script does NOT POST to any endpoint. It:')
  console.log('  1. Prints what each endpoint would do.')
  console.log('  2. Creates CRITICAL InboxItems so Nate will not forget.')
  console.log()

  const state = await checkDbState()
  console.log('Current DB snapshot:')
  console.log(`  Staff rows:           ${state.staff}`)
  console.log(`  Builder rows:         ${state.builders}`)
  console.log(`  Product rows:         ${state.products}`)
  console.log(`  AgentSession rows:    ${state.agentSessions}`)
  console.log(`  InboxItem PENDING:    ${state.inboxPending}`)
  console.log()

  for (const plan of PLAN) {
    console.log(`── ${plan.path} ─────────────────────────────────────────`)
    console.log(`  Tables:  ${plan.tables.join(', ')}`)
    console.log(`  Effect:  ${plan.rows}`)
    console.log(`  Risks:`)
    for (const r of plan.risks) console.log(`    - ${r}`)
    console.log(`  Notes:`)
    for (const n of plan.dryRunNotes) console.log(`    - ${n}`)
    console.log()
  }

  console.log('── Creating / verifying InboxItems ─────────────────────────────────')
  const { created, results } = await createInboxItems()
  for (const r of results) {
    console.log(`  [${r.id}]  ${r.path}`)
  }
  console.log()
  console.log(`Created ${created} new InboxItem(s). Existing PENDING items reused where present.`)
  console.log()
  console.log('NEXT: Nate logs into Aegis and POSTs each endpoint in order above.')
}

main()
  .catch(err => {
    console.error('execute-cowork-deploy-endpoints failed:', err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
