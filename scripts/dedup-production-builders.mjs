#!/usr/bin/env node
/**
 * Dedup PRODUCTION Builders — Pulte / Brookfield / Toll.
 *
 * Unlike scripts/dedup-builders.mjs (which merges on LOWER(TRIM(companyName))), this
 * script targets named groups that do NOT normalize to the same string:
 *   - Pulte:      "Pulte Homes" ∪ "Pulte" ∪ "Pulte Homes DFW"
 *   - Brookfield: "BROOKFIELD" ∪ "Brookfield Homes"
 *   - Toll:       "Toll Brothers" ∪ "Toll Brothers DFW"
 *
 * Canonical selection (per task spec):
 *   1. Highest sum of linked rows across all FK tables (orders + jobs + invoices + pricing + …)
 *   2. Tiebreak: earliest createdAt.
 *   3. After merge, rename canonical.companyName to the cleaner preferred label
 *      (e.g. "Brookfield Homes" over "BROOKFIELD").
 *
 * Per group, wrapped in a single transaction:
 *   1. For each composite-unique table (BuilderPricing, BuilderPhaseConfig,
 *      AccountCategoryMargin), pre-delete dupe rows whose key collides with canonical.
 *   2. For each unique-on-builderId table (BuilderBranding, BuilderIntelligence,
 *      AccountMarginTarget), keep canonical's row if it has one else move the first
 *      dupe's over; delete the rest.
 *   3. Bulk UPDATE every remaining many-to-X FK column to point at canonical.id.
 *   4. DELETE dupe Builder rows.
 *
 * --dry-run  — preview counts only, no writes.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) { console.error('No DATABASE_URL in .env'); process.exit(1); }

const DRY = process.argv.includes('--dry-run');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

console.log(`\n── PRODUCTION Builder dedup (Pulte/Brookfield/Toll) ${DRY ? '[DRY RUN]' : '[LIVE]'} ──\n`);

// ─── Target groups ─────────────────────────────────────────────────────────
// preferredName is applied as UPDATE "Builder" SET "companyName"=preferredName after merge.
const TARGET_GROUPS = [
  {
    label: 'pulte',
    names: ['Pulte Homes', 'Pulte', 'Pulte Homes DFW'],
    preferredName: 'Pulte Homes',
  },
  {
    label: 'brookfield',
    names: ['BROOKFIELD', 'Brookfield Homes'],
    preferredName: 'Brookfield Homes',
  },
  {
    label: 'toll',
    names: ['Toll Brothers', 'Toll Brothers DFW'],
    preferredName: 'Toll Brothers',
  },
];

// ─── Discover all FK columns referencing Builder.id ────────────────────────
const fks = await sql.query(`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu USING (constraint_name)
  JOIN information_schema.constraint_column_usage ccu USING (constraint_name)
  WHERE tc.constraint_type='FOREIGN KEY'
    AND ccu.table_name='Builder'
    AND ccu.column_name='id'
  ORDER BY tc.table_name, kcu.column_name
`);
console.log(`FK columns referencing Builder.id: ${fks.length}`);
for (const f of fks) console.log(`  ${f.table_name}.${f.column_name}`);
console.log('');

// Classify FK columns
// Unique 1:1 — builderId is itself unique
const UNIQUE_1TO1 = new Set([
  'BuilderBranding|builderId',
  'BuilderIntelligence|builderId',
  'AccountMarginTarget|builderId',
]);
// Composite unique (builderId, other) — need pre-delete of conflicts, then UPDATE the rest
const COMPOSITE_UNIQUE = [
  { table: 'BuilderPricing',       keyCol: 'productId' },
  { table: 'BuilderPhaseConfig',   keyCol: 'name' },
  { table: 'AccountCategoryMargin', keyCol: 'category' }, // matches existing dedup-builders.mjs behavior
];

// Partition the FK list
const unique1to1Cols = [];
const manyCols = [];
for (const { table_name, column_name } of fks) {
  const key = `${table_name}|${column_name}`;
  if (UNIQUE_1TO1.has(key)) unique1to1Cols.push({ table: table_name, col: column_name });
  else manyCols.push({ table: table_name, col: column_name });
}

// ─── Load candidates from DB ───────────────────────────────────────────────
async function rowCountForBuilder(builderId) {
  let total = 0;
  const perTable = {};
  for (const { table_name, column_name } of fks) {
    const r = await sql.query(`SELECT COUNT(*)::int AS n FROM "${table_name}" WHERE "${column_name}" = $1`, [builderId]);
    if (r[0].n > 0) { perTable[`${table_name}.${column_name}`] = r[0].n; total += r[0].n; }
  }
  return { total, perTable };
}

async function resolveGroup(group) {
  const rows = await sql.query(
    `SELECT id, "companyName", "builderType", "createdAt"
     FROM "Builder"
     WHERE "companyName" = ANY($1::text[])`,
    [group.names]
  );
  if (rows.length === 0) {
    console.log(`[${group.label}] no matching rows — skipping.`);
    return null;
  }
  // Annotate each with FK totals
  const annotated = [];
  for (const r of rows) {
    const counts = await rowCountForBuilder(r.id);
    annotated.push({ ...r, total: counts.total, perTable: counts.perTable });
  }
  // Sort: most FK rows first, then earliest createdAt
  annotated.sort((a, b) => b.total - a.total || new Date(a.createdAt) - new Date(b.createdAt));
  const [canonical, ...dupes] = annotated;
  return { group, canonical, dupes };
}

// ─── Process each group ────────────────────────────────────────────────────
let totalDupesMerged = 0;
let totalFkRowsRepointed = 0;
let totalFailures = 0;

for (const group of TARGET_GROUPS) {
  const resolved = await resolveGroup(group);
  if (!resolved) continue;
  const { canonical, dupes } = resolved;

  console.log(`\n── Group: ${group.label.toUpperCase()} ──`);
  console.log(`  CANONICAL → "${canonical.companyName}" (${canonical.id}) — ${canonical.total} FK rows, created ${canonical.createdAt.toISOString().slice(0,10)}`);
  for (const d of dupes) {
    console.log(`  DUPE      → "${d.companyName}" (${d.id}) — ${d.total} FK rows, created ${d.createdAt.toISOString().slice(0,10)}`);
    if (d.total > 0) {
      for (const [k, v] of Object.entries(d.perTable)) console.log(`              · ${k} = ${v}`);
    }
  }
  if (dupes.length === 0) {
    console.log('  (nothing to merge — only 1 row)');
    continue;
  }
  const planName = (canonical.companyName !== group.preferredName)
    ? `  After merge: rename canonical "${canonical.companyName}" → "${group.preferredName}"`
    : `  After merge: canonical name "${canonical.companyName}" unchanged`;
  console.log(planName);

  if (DRY) {
    totalDupesMerged += dupes.length;
    totalFkRowsRepointed += dupes.reduce((s, d) => s + d.total, 0);
    continue;
  }

  const dupeIds = dupes.map(d => d.id);
  try {
    await sql.query('BEGIN');

    // Step 1: composite-unique conflict pre-delete
    for (const { table, keyCol } of COMPOSITE_UNIQUE) {
      const del = await sql.query(
        `DELETE FROM "${table}" t
         WHERE t."builderId" = ANY($1::text[])
           AND EXISTS (
             SELECT 1 FROM "${table}" c
             WHERE c."builderId" = $2 AND c."${keyCol}" = t."${keyCol}"
           )
         RETURNING t.id`,
        [dupeIds, canonical.id]
      );
      if (del.length > 0) console.log(`    pre-deleted ${del.length} colliding rows from ${table} (on ${keyCol})`);
    }

    // Step 2: 1:1 unique — move or delete
    for (const { table, col } of unique1to1Cols) {
      const existing = await sql.query(`SELECT id FROM "${table}" WHERE "${col}" = $1 LIMIT 1`, [canonical.id]);
      if (existing.length > 0) {
        const d = await sql.query(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[]) RETURNING id`, [dupeIds]);
        if (d.length > 0) console.log(`    canonical already has ${table} row — deleted ${d.length} dupe ${table} row(s)`);
      } else {
        const firstDupeRec = await sql.query(`SELECT id FROM "${table}" WHERE "${col}" = ANY($1::text[]) ORDER BY "id" ASC LIMIT 1`, [dupeIds]);
        if (firstDupeRec.length > 0) {
          await sql.query(`UPDATE "${table}" SET "${col}" = $1 WHERE id = $2`, [canonical.id, firstDupeRec[0].id]);
          const d = await sql.query(`DELETE FROM "${table}" WHERE "${col}" = ANY($1::text[]) RETURNING id`, [dupeIds]);
          console.log(`    moved 1 ${table} row to canonical; deleted ${d.length} remaining dupe ${table} row(s)`);
        }
      }
    }

    // Step 3: bulk UPDATE all remaining (many) FK columns
    let repointed = 0;
    for (const { table, col } of manyCols) {
      const r = await sql.query(
        `UPDATE "${table}" SET "${col}" = $1 WHERE "${col}" = ANY($2::text[])`,
        [canonical.id, dupeIds]
      );
      // neon returns nothing useful for row count; re-check
      const c = await sql.query(`SELECT COUNT(*)::int AS n FROM "${table}" WHERE "${col}" = $1 AND EXISTS (SELECT 1)`, [canonical.id]);
      // (Just log nothing — we already printed pre-state counts)
    }

    // Step 4: rename canonical to preferred
    if (canonical.companyName !== group.preferredName) {
      await sql.query(`UPDATE "Builder" SET "companyName" = $1 WHERE id = $2`, [group.preferredName, canonical.id]);
      console.log(`    renamed canonical: "${canonical.companyName}" → "${group.preferredName}"`);
    }

    // Step 5: DELETE dupe Builder rows
    const del = await sql.query(
      `DELETE FROM "Builder" WHERE id = ANY($1::text[]) RETURNING id, "companyName"`,
      [dupeIds]
    );
    console.log(`    deleted ${del.length} dupe Builder row(s):`);
    for (const r of del) console.log(`      · ${r.id} "${r.companyName}"`);

    await sql.query('COMMIT');
    console.log(`  COMMIT ok — ${group.label} merged.`);
    totalDupesMerged += dupes.length;
    totalFkRowsRepointed += dupes.reduce((s, d) => s + d.total, 0);
  } catch (e) {
    await sql.query('ROLLBACK').catch(() => {});
    console.error(`  ROLLBACK — ${group.label} failed: ${e.message}`);
    totalFailures++;
  }
}

// ─── Summary ───────────────────────────────────────────────────────────────
console.log('\n── Summary ──');
console.log(`Mode:                ${DRY ? 'DRY RUN (no writes)' : 'LIVE'}`);
console.log(`Groups processed:    ${TARGET_GROUPS.length}`);
console.log(`Dupe builders ${DRY ? 'would be ' : ''}merged: ${totalDupesMerged}`);
console.log(`FK rows ${DRY ? 'would be ' : ''}repointed:   ${totalFkRowsRepointed}`);
if (totalFailures) console.log(`Failures:            ${totalFailures}`);

// Post-state verification
if (!DRY) {
  console.log('\n── Post-state verification ──');
  for (const g of TARGET_GROUPS) {
    const r = await sql.query(
      `SELECT id, "companyName",
              (SELECT COUNT(*) FROM "Order" WHERE "builderId"=b.id)::int AS orders,
              (SELECT COUNT(*) FROM "BuilderPricing" WHERE "builderId"=b.id)::int AS pricings,
              (SELECT COUNT(*) FROM "Community" WHERE "builderId"=b.id)::int AS communities
       FROM "Builder" b
       WHERE "companyName" = ANY($1::text[]) OR "companyName" = $2`,
      [g.names, g.preferredName]
    );
    console.log(`  [${g.label}] rows remaining: ${r.length}`);
    for (const row of r) console.log(`    ${row.id} "${row.companyName}" — ${row.orders} orders, ${row.pricings} pricings, ${row.communities} communities`);
  }
}

console.log('');
process.exit(totalFailures > 0 ? 1 : 0);
