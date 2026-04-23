#!/usr/bin/env node
/**
 * seed-deals.mjs — Populate the Deal pipeline with active prospects.
 *
 * Phase 1.9 of AEGIS-TEAM-READINESS-PLAN.md: gets the Sales Pipeline Kanban
 * off of an empty state with 10 active prospect deals.
 *
 * Behavior:
 *  - Idempotent: INSERT ... WHERE NOT EXISTS on companyName (no unique
 *    constraint on that column in the live schema).
 *  - Owner: Dalton Whatley (Business Development / SALES_REP). Falls back
 *    to any SALES_REP, then any Staff row, in that order.
 *  - Source data: CLAUDE.md active-prospect list. If a brain export appears
 *    at NUC_CLUSTER/brain_export/opportunities.jsonl we log it for
 *    reference, but the manual CLAUDE.md list is the source of truth here.
 *
 * Run:  node scripts/seed-deals.mjs
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── Load DATABASE_URL from .env (don't pull in dotenv just for this) ──
function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(repoRoot, '.env');
  if (!existsSync(envPath)) throw new Error(`No .env at ${envPath} and no DATABASE_URL in environment`);
  const raw = readFileSync(envPath, 'utf8');
  const m = raw.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in .env');
  return m[1];
}

const DATABASE_URL = loadDatabaseUrl();
const sql = neon(DATABASE_URL);

// ── Brain export (optional; informational only) ──────────────────────
const brainPath = join(
  repoRoot,
  '..',
  'NUC_CLUSTER',
  'brain_export',
  'opportunities.jsonl',
);
if (existsSync(brainPath)) {
  const lines = readFileSync(brainPath, 'utf8').split(/\r?\n/).filter(Boolean);
  console.log(`[info] brain export present (${lines.length} opportunities at ${brainPath})`);
  console.log('[info] using CLAUDE.md active-prospect list as source of truth for this seed');
} else {
  console.log('[info] no brain export found; seeding from CLAUDE.md list');
}

// ── Resolve owner (Dalton Whatley) ───────────────────────────────────
async function resolveOwnerId() {
  const dalton = await sql`
    SELECT id FROM "Staff"
    WHERE "firstName" ILIKE 'Dalton'
      AND "lastName"  ILIKE 'Whatley'
      AND role = 'SALES_REP'
    LIMIT 1
  `;
  if (dalton[0]?.id) return { id: dalton[0].id, label: 'Dalton Whatley (SALES_REP)' };

  const anySales = await sql`
    SELECT id, "firstName", "lastName" FROM "Staff"
    WHERE role = 'SALES_REP' OR title ILIKE '%sales%'
    ORDER BY "createdAt" NULLS LAST
    LIMIT 1
  `;
  if (anySales[0]?.id) {
    return {
      id: anySales[0].id,
      label: `fallback sales rep: ${anySales[0].firstName} ${anySales[0].lastName}`,
    };
  }

  const anyone = await sql`SELECT id FROM "Staff" LIMIT 1`;
  if (anyone[0]?.id) return { id: anyone[0].id, label: 'fallback: first Staff row' };

  throw new Error('No Staff rows exist — cannot set Deal.ownerId (NOT NULL)');
}

// ── Next deal number (DEAL-YYYY-####) ────────────────────────────────
async function nextDealNumber(year) {
  const prefix = `DEAL-${year}-`;
  const rows = await sql`
    SELECT "dealNumber" FROM "Deal"
    WHERE "dealNumber" LIKE ${prefix + '%'}
    ORDER BY "dealNumber" DESC
    LIMIT 1
  `;
  let next = 1;
  if (rows[0]?.dealNumber) {
    const n = parseInt(rows[0].dealNumber.slice(prefix.length), 10);
    if (!Number.isNaN(n)) next = n + 1;
  }
  return (seq = next++) => `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── Seed list (from CLAUDE.md active prospects) ──────────────────────
// dealValue = realistic annualized revenue estimate ($50K–$500K range).
// expectedCloseDate = days out from today based on probability/stage.
const todayOffset = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10); // date-only; Postgres will cast
};

const DEALS = [
  {
    companyName: 'Cross Custom Homes',
    contactName: 'Cross Custom — TBD',
    stage: 'DISCOVERY',
    probability: 40,
    dealValue: 180_000,
    closeInDays: 90,
    description: 'Custom homebuilder in DFW. Warm prospect — in play per CLAUDE.md.',
    notes: 'Already added to HubSpot CRM. SO-003933 deposit follow-up outstanding.',
  },
  {
    companyName: 'Lennar DFW',
    contactName: 'Lennar DFW — Purchasing TBD',
    stage: 'PROSPECT',
    probability: 20,
    dealValue: 450_000,
    closeInDays: 180,
    description: 'National production builder. Cold prospect — no engagement yet.',
    notes: 'Needs cold outreach to identify DFW division procurement contact.',
  },
  {
    companyName: 'KB Home DFW',
    contactName: 'KB Home DFW — Purchasing TBD',
    stage: 'PROSPECT',
    probability: 20,
    dealValue: 350_000,
    closeInDays: 180,
    description: 'National production builder, DFW division. Cold prospect.',
    notes: 'Cold outreach needed. Standard plan library — candidate for tiered pricing pitch.',
  },
  {
    companyName: 'Meritage Homes',
    contactName: 'Meritage Homes — Purchasing TBD',
    stage: 'DISCOVERY',
    probability: 35,
    dealValue: 300_000,
    closeInDays: 120,
    description: 'Production builder with DFW presence. Warm prospect.',
    notes: 'Warm — leverage Brookfield reference and Rev 4 Plan Breakdown methodology.',
  },
  {
    companyName: 'Ashton Woods',
    contactName: 'Ashton Woods — Purchasing TBD',
    stage: 'PROSPECT',
    probability: 25,
    dealValue: 220_000,
    closeInDays: 150,
    description: 'DFW production builder. Cold prospect.',
    notes: 'Cold outreach — target procurement lead for DFW region.',
  },
  {
    companyName: 'Highland Homes',
    contactName: 'Highland Homes — Purchasing TBD',
    stage: 'DISCOVERY',
    probability: 35,
    dealValue: 260_000,
    closeInDays: 120,
    description: 'Texas production builder. Warm prospect.',
    notes: 'Warm — prior quote activity. Re-engage with current Abel pricing sheet (Apr 2026).',
  },
  {
    companyName: 'Grand Homes Expansion',
    contactName: 'Grand Homes — Purchasing TBD',
    stage: 'DISCOVERY',
    probability: 40,
    dealValue: 150_000,
    closeInDays: 90,
    description: 'Existing builder — expansion / upsell deal for additional communities.',
    notes: 'Upsell: already a builder. Target new communities coming online in 2026.',
  },
  {
    companyName: 'Trophy Signature',
    contactName: 'Trophy Signature — Purchasing TBD',
    stage: 'PROSPECT',
    probability: 25,
    dealValue: 200_000,
    closeInDays: 150,
    description: 'DFW production/custom builder. Cold prospect.',
    notes: 'Cold outreach — verify decision-maker via LinkedIn before first touch.',
  },
  {
    companyName: 'Bloomfield Expansion',
    contactName: 'Bloomfield Homes — Purchasing TBD',
    stage: 'NEGOTIATION',
    probability: 55,
    dealValue: 275_000,
    closeInDays: 60,
    description: 'Active account — expansion into additional communities. Hot prospect.',
    notes: 'Hot — already active. Folder populated 2026-04-20. Upsell on additional communities.',
  },
  {
    companyName: 'Brookfield Value Engineering',
    contactName: 'Amanda Barham (Brookfield / BWP)',
    stage: 'NEGOTIATION',
    probability: 65,
    dealValue: 420_000,
    closeInDays: 45,
    description:
      'Active BWP value-engineering workstream — Rev 4 Plan Breakdown delivered 2026-04-20. ' +
      'In-flight pricing negotiation on plan-by-plan breakdown.',
    notes: 'Rev 4 sent 2026-04-20. Hyphen integration still partially broken (0/80 linked).',
  },
];

// ── Insert ───────────────────────────────────────────────────────────
async function main() {
  const owner = await resolveOwnerId();
  console.log(`[info] owner: ${owner.label} (${owner.id})`);

  const year = new Date().getFullYear();
  const nextNum = await nextDealNumber(year);

  let inserted = 0;
  let skipped = 0;
  const report = [];

  for (const d of DEALS) {
    // Case-insensitive dedup on companyName (per task spec: DO NOTHING on conflict)
    const existing = await sql`
      SELECT id, "dealNumber" FROM "Deal" WHERE LOWER("companyName") = LOWER(${d.companyName})
    `;
    if (existing.length) {
      skipped++;
      report.push({ company: d.companyName, status: 'skipped', reason: `exists as ${existing[0].dealNumber}` });
      continue;
    }

    const dealNumber = nextNum();
    const closeDate = todayOffset(d.closeInDays);

    await sql`
      INSERT INTO "Deal" (
        id, "dealNumber", "companyName", "contactName",
        stage, probability, "dealValue", source,
        "expectedCloseDate", "ownerId",
        description, notes,
        "createdAt", "updatedAt"
      ) VALUES (
        'deal_seed_' || substr(md5(random()::text || clock_timestamp()::text), 1, 16),
        ${dealNumber},
        ${d.companyName},
        ${d.contactName},
        ${d.stage}::"DealStage",
        ${d.probability},
        ${d.dealValue},
        'OUTBOUND'::"DealSource",
        ${closeDate}::timestamp,
        ${owner.id},
        ${d.description},
        ${d.notes},
        NOW(), NOW()
      )
    `;
    inserted++;
    report.push({ company: d.companyName, status: 'inserted', dealNumber, stage: d.stage, value: d.dealValue });
  }

  console.log('\n── seed-deals report ────────────────────────────────');
  for (const r of report) {
    if (r.status === 'inserted') {
      console.log(`  + ${r.dealNumber}  ${r.company.padEnd(32)}  ${r.stage.padEnd(12)}  $${r.value.toLocaleString()}`);
    } else {
      console.log(`  = SKIP        ${r.company.padEnd(32)}  (${r.reason})`);
    }
  }
  const total = await sql`SELECT COUNT(*)::int AS n FROM "Deal"`;
  console.log('─────────────────────────────────────────────────────');
  console.log(`inserted: ${inserted}   skipped: ${skipped}   total Deal rows now: ${total[0].n}`);
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
