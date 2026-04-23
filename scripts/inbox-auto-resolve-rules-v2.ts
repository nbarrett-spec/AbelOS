// ─────────────────────────────────────────────────────────────────────────────
// inbox-auto-resolve-rules-v2.ts
// ─────────────────────────────────────────────────────────────────────────────
// Round 2 of InboxItem auto-resolve. Cowork's earlier pass (commit e380128,
// scripts/inbox-cleanup.mjs, marker 'inbox-cleanup-2026-04-23') handled:
//   - dupe-merge on (type, entityId)
//   - HW PPTX rollup
//   - [PIPELINE] empty deal rows
//   - SYSTEM_AUDIT_FINDING → auto-historical
//   - IMPROVEMENT_* → strategic-plan-moved
//   - Pulte SYSTEM below-cost pricing → customer-lost
//
// This round targets what's LEFT — stale items tied to events that have
// already happened (orders delivered, product restocked, customer lost POs
// now moot, strategic docs that don't belong in an actionable inbox).
//
// Nine rules, processed in order. Cap 200 resolutions per run.
// Only writes status / resolvedAt / resolvedBy.
//
// USAGE:
//   npx tsx scripts/inbox-auto-resolve-rules-v2.ts            # DRY-RUN
//   npx tsx scripts/inbox-auto-resolve-rules-v2.ts --commit   # APPLY
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}
const sql = neon(DATABASE_URL);

const COMMIT = process.argv.includes('--commit');
const MARKER = 'auto-resolve-v2';
const CAP = 200;
let budget = CAP;

function bar(s: string) {
  console.log('\n' + '═'.repeat(72) + '\n  ' + s + '\n' + '═'.repeat(72));
}
function mode() {
  return COMMIT ? 'COMMIT' : 'DRY-RUN';
}
function remaining() {
  return budget;
}

type RuleResult = { rule: string; criteria: string; matched: number; resolved: number; capped?: boolean };

// Shared resolver: takes an array of IDs and writes status/resolvedAt/resolvedBy.
// Respects the 200-item budget. Returns { resolved, capped }.
async function resolveIds(ids: string[]): Promise<{ resolved: number; capped: boolean }> {
  if (ids.length === 0) return { resolved: 0, capped: false };
  let capped = false;
  let toResolve = ids;
  if (ids.length > budget) {
    capped = true;
    toResolve = ids.slice(0, budget);
  }
  if (!COMMIT) {
    budget -= toResolve.length;
    return { resolved: toResolve.length, capped };
  }
  // UPDATE ... WHERE id = ANY(...) — single round-trip.
  await sql`
    UPDATE "InboxItem"
    SET status = 'RESOLVED',
        "resolvedAt" = now(),
        "resolvedBy" = ${MARKER}
    WHERE id = ANY(${toResolve}::text[])
      AND status = 'PENDING'
  `;
  budget -= toResolve.length;
  return { resolved: toResolve.length, capped };
}

// ─── R1: Orders now RECEIVED or DELIVERED ───────────────────────────────────
// SHIPPING_2WK / MATERIAL_ARRIVAL items whose linked Order has already
// been received or delivered. The ship-reminder is stale.
async function r1_ordersDelivered(): Promise<RuleResult> {
  bar('R1 — Orders now RECEIVED/DELIVERED (ship reminders stale)');
  const rows = await sql`
    SELECT ii.id
    FROM "InboxItem" ii
    INNER JOIN "Order" o ON o.id = ii."entityId"
    WHERE ii.status = 'PENDING'
      AND ii."entityType" = 'Order'
      AND o.status IN ('RECEIVED','DELIVERED')
      AND ii.source LIKE 'SHIPPING_2WK%'
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [entityType=Order AND Order.status IN (RECEIVED, DELIVERED) AND source LIKE 'SHIPPING_2WK%']`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED by budget)' : ''}`);
  return { rule: 'R1', criteria: 'SHIPPING_2WK items where Order status is RECEIVED/DELIVERED', matched: ids.length, resolved, capped };
}

// ─── R2: Backorder product now in stock ─────────────────────────────────────
// MATERIAL_ARRIVAL rows from BACKORDER_AUTOCOMPUTE whose linked Product.inStock
// is already true. The backorder cleared; no action needed.
async function r2_backorderRestocked(): Promise<RuleResult> {
  bar('R2 — Backorder auto-compute items where Product.inStock = true');
  if (budget <= 0) return { rule: 'R2', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const rows = await sql`
    SELECT ii.id
    FROM "InboxItem" ii
    INNER JOIN "Product" p ON p.id = ii."entityId"
    WHERE ii.status = 'PENDING'
      AND ii.source = 'BACKORDER_AUTOCOMPUTE'
      AND ii."entityType" = 'Product'
      AND p."inStock" = true
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [source=BACKORDER_AUTOCOMPUTE AND Product.inStock=true]`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R2', criteria: 'BACKORDER_AUTOCOMPUTE where linked Product.inStock=true', matched: ids.length, resolved, capped };
}

// ─── R3: Pulte wind-down POs (customer LOST 2026-04-20) ─────────────────────
// Every pulte-winddown row is an archival cleanup; Pulte is gone, no need to
// action these in the inbox. Cowork's op6 only hit SYSTEM below-cost, not
// PO_APPROVAL / DEAL_FOLLOWUP wind-down items.
async function r3_pulteWinddown(): Promise<RuleResult> {
  bar('R3 — Pulte wind-down inbox items (customer LOST 2026-04-20)');
  if (budget <= 0) return { rule: 'R3', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const rows = await sql`
    SELECT id
    FROM "InboxItem"
    WHERE status = 'PENDING'
      AND source = 'pulte-winddown'
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [source='pulte-winddown']`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R3', criteria: "source='pulte-winddown' (customer lost)", matched: ids.length, resolved, capped };
}

// ─── R4: Ship-date past, order CONFIRMED (item will ship on different SO) ───
async function r4_stalShipDate(): Promise<RuleResult> {
  bar('R4 — SHIPPING_2WK with dueBy > 7 days past and Order.status=CONFIRMED');
  if (budget <= 0) return { rule: 'R4', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const rows = await sql`
    SELECT ii.id
    FROM "InboxItem" ii
    INNER JOIN "Order" o ON o.id = ii."entityId"
    WHERE ii.status = 'PENDING'
      AND ii.source LIKE 'SHIPPING_2WK%'
      AND o.status = 'CONFIRMED'
      AND ii."dueBy" IS NOT NULL
      AND ii."dueBy" < now() - interval '7 days'
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [SHIPPING_2WK AND Order.status=CONFIRMED AND dueBy < now() - 7d]`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R4', criteria: 'ship reminder past dueBy + Order still CONFIRMED', matched: ids.length, resolved, capped };
}

// ─── R5: Duplicate Pulte Closed-Lost follow-ups (keep earliest) ─────────────
// Titles like "Mark Pulte HubSpot deal as Closed Lost", "Mark Pulte deal
// Closed Lost in HubSpot", "[BRAIN GAP] ... update HubSpot deal to Closed Lost".
// After R3 nukes pulte-winddown these may already be gone, but rule scans
// live so it only hits survivors.
async function r5_dupeClosedLost(): Promise<RuleResult> {
  bar('R5 — Dedupe Pulte "Closed Lost" HubSpot follow-ups');
  if (budget <= 0) return { rule: 'R5', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const rows = await sql`
    SELECT id, "createdAt"
    FROM "InboxItem"
    WHERE status = 'PENDING'
      AND title ILIKE '%Pulte%'
      AND (title ILIKE '%Closed Lost%' OR title ILIKE '%closed-lost%')
    ORDER BY "createdAt" ASC, id ASC
  `;
  const all = rows as { id: string; createdAt: Date }[];
  // Keep the earliest, resolve the rest.
  const extras = all.slice(1).map((r) => r.id);
  console.log(`found ${all.length} Pulte Closed-Lost rows; keep 1 survivor, resolve ${extras.length} extras`);
  const { resolved, capped } = await resolveIds(extras);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R5', criteria: 'dedupe Pulte Closed Lost HubSpot follow-ups', matched: extras.length, resolved, capped };
}

// ─── R6: Strategic / architecture AGENT_TASK docs ───────────────────────────
// Sources here are planning docs, not in-tray actions.
async function r6_strategicAgentTasks(): Promise<RuleResult> {
  bar('R6 — Strategic / architecture AGENT_TASK rows (docs, not actions)');
  if (budget <= 0) return { rule: 'R6', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const SOURCES = [
    'customer_portal_arch',
    'staff-onboarding',
    'delivery-outsourcing-eval',
  ];
  const rows = await sql`
    SELECT id FROM "InboxItem"
    WHERE status = 'PENDING'
      AND type = 'AGENT_TASK'
      AND source = ANY(${SOURCES}::text[])
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [type=AGENT_TASK AND source IN (${SOURCES.join(', ')})]`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R6', criteria: 'AGENT_TASK strategic doc sources', matched: ids.length, resolved, capped };
}

// ─── R7: Workspace-scan [REF] reference rows ────────────────────────────────
async function r7_workspaceScanRefs(): Promise<RuleResult> {
  bar('R7 — workspace-scan REFERENCE rows ([REF] catalog pointers)');
  if (budget <= 0) return { rule: 'R7', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const rows = await sql`
    SELECT id FROM "InboxItem"
    WHERE status = 'PENDING'
      AND type = 'REFERENCE'
      AND source = 'workspace-scan'
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [type=REFERENCE AND source='workspace-scan']`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R7', criteria: 'workspace-scan REFERENCE rows', matched: ids.length, resolved, capped };
}

// ─── R8: DFW-financial archive pointers ─────────────────────────────────────
async function r8_dfwFinancialArchive(): Promise<RuleResult> {
  bar('R8 — dfw-financial DATA_IMPORT archive pointers');
  if (budget <= 0) return { rule: 'R8', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const rows = await sql`
    SELECT id FROM "InboxItem"
    WHERE status = 'PENDING'
      AND type = 'DATA_IMPORT'
      AND source = 'dfw-financial'
      AND ("dueBy" IS NULL OR "dueBy" < now())
  `;
  const ids = (rows as { id: string }[]).map((r) => r.id);
  console.log(`would resolve ${ids.length} items matching [type=DATA_IMPORT AND source='dfw-financial' AND (dueBy IS NULL OR dueBy<now())]`);
  const { resolved, capped } = await resolveIds(ids);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R8', criteria: 'DFW financial archive DATA_IMPORT rows past due', matched: ids.length, resolved, capped };
}

// ─── R9: Exact-title duplicates across source tags (post-Cowork-dedup) ──────
// Cowork's op1 dedupes on (type, entityId). Some dupes survive because
// entityId is NULL but title is identical. Keep earliest per title.
async function r9_titleDupes(): Promise<RuleResult> {
  bar('R9 — Exact-title duplicates (entityId-null dupe survivors)');
  if (budget <= 0) return { rule: 'R9', criteria: 'skipped (budget)', matched: 0, resolved: 0 };
  const groups = await sql`
    SELECT title, array_agg(id ORDER BY "createdAt" ASC, id ASC) AS ids
    FROM "InboxItem"
    WHERE status = 'PENDING'
    GROUP BY title
    HAVING COUNT(*) > 1
  `;
  const extras: string[] = [];
  for (const g of groups as { title: string; ids: string[] }[]) {
    extras.push(...g.ids.slice(1));
  }
  console.log(`would resolve ${extras.length} items matching [title appears >1× among PENDING, keep earliest]`);
  const { resolved, capped } = await resolveIds(extras);
  console.log(`[${mode()}] resolved ${resolved}${capped ? ' (CAPPED)' : ''}`);
  return { rule: 'R9', criteria: 'exact-title duplicates, keep earliest', matched: extras.length, resolved, capped };
}

// ─── Main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n┌──────────────────────────────────────────────────────────────────┐`);
  console.log(`│  Inbox auto-resolve v2 — mode: ${mode().padEnd(33)}│`);
  console.log(`│  marker:    ${MARKER.padEnd(52)}│`);
  console.log(`│  cap:       ${String(CAP).padEnd(52)}│`);
  console.log(`└──────────────────────────────────────────────────────────────────┘`);

  const before = (
    (await sql`SELECT COUNT(*)::int AS c FROM "InboxItem" WHERE status='PENDING'`) as { c: number }[]
  )[0].c;
  console.log(`PENDING before: ${before}`);

  const results: RuleResult[] = [];
  results.push(await r1_ordersDelivered());
  results.push(await r2_backorderRestocked());
  results.push(await r3_pulteWinddown());
  results.push(await r4_stalShipDate());
  results.push(await r5_dupeClosedLost());
  results.push(await r6_strategicAgentTasks());
  results.push(await r7_workspaceScanRefs());
  results.push(await r8_dfwFinancialArchive());
  results.push(await r9_titleDupes());

  const after = (
    (await sql`SELECT COUNT(*)::int AS c FROM "InboxItem" WHERE status='PENDING'`) as { c: number }[]
  )[0].c;

  bar('Summary');
  console.log('mode:', mode());
  console.table(
    results.map((r) => ({
      rule: r.rule,
      matched: r.matched,
      resolved: r.resolved,
      capped: r.capped ? 'YES' : '',
      criteria: r.criteria,
    })),
  );
  const totalResolved = results.reduce((a, r) => a + r.resolved, 0);
  console.log(`total resolved this run: ${totalResolved} (cap ${CAP}, remaining ${remaining()})`);
  console.log(`PENDING: ${before} → ${after}  (−${before - after})`);
  if (!COMMIT) console.log('\n(DRY-RUN — re-run with --commit to apply.)');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
