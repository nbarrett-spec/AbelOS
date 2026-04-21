#!/usr/bin/env node
/**
 * Builder dedup — merge duplicate Builder records by case-insensitive companyName.
 *
 * For each group:
 *   1. Pick canonical = the builder with the most Orders (tiebreak: oldest createdAt, so stable)
 *   2. For each FK table, UPDATE ... SET builderId = canonical.id WHERE builderId IN (dupes)
 *   3. For 1:1 relations (BuilderBranding, BuilderIntelligence, BuilderOrganization,
 *      AccountMarginTarget), delete the dupes' records if canonical already has one;
 *      otherwise move the dupe's record over.
 *   4. Delete the now-orphaned duplicate Builder rows.
 *
 * Idempotent — safe to re-run.
 * --dry-run mode prints what would change without mutating.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const DRY = process.argv.includes('--dry-run');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

console.log(`\n── Builder dedup ${DRY ? '(DRY RUN)' : '(LIVE)'} ──\n`);

// Tables referencing Builder (many-to-X — safe bulk UPDATE)
const manyTables = [
  'AccountCategoryMargin',
  'AgentConversation',
  'AgentEmailLog',
  'AgentSmsLog',
  'BTProjectMapping',
  'BuilderCatalog',
  'BuilderContact',
  'BuilderPricing',
  'BuilderScheduleShare',
  'CommunicationLog',
  'Community',
  'HomeownerAccess',
  'LienRelease',
  'MessageReadReceipt',
  'Order',
  'OrderTemplate',
  'Project',
  'ReorderSuggestion',
  'SavedCart',
  'ScheduleChangeRequest',
  'SubcontractorPricing',
];
// 1:1 or unique relations — need care
const uniqueTables = [
  'BuilderBranding',
  'BuilderIntelligence',
  'AccountMarginTarget',
];
// Special: TradeReview has builderReviewerId instead of builderId
const specialCols = [
  { table: 'TradeReview', column: 'builderReviewerId' },
];

// Find duplicate groups
const dupes = await sql.query(`
  WITH b AS (
    SELECT b.id, b."companyName", COUNT(o.id)::int AS order_count, b."createdAt"
    FROM "Builder" b LEFT JOIN "Order" o ON o."builderId"=b.id
    GROUP BY b.id
  )
  SELECT LOWER(TRIM("companyName")) AS norm,
         array_agg(id ORDER BY order_count DESC, "createdAt" ASC) AS ids,
         array_agg("companyName" ORDER BY order_count DESC, "createdAt" ASC) AS names,
         array_agg(order_count ORDER BY order_count DESC, "createdAt" ASC) AS order_counts
  FROM b
  GROUP BY LOWER(TRIM("companyName"))
  HAVING COUNT(*) > 1
`);
console.log(`Found ${dupes.length} duplicate groups.\n`);

let mergedCount = 0;
let orderRepoints = 0;
let failed = 0;

for (const group of dupes) {
  const [canonical, ...duplicates] = group.ids;
  const canonicalName = group.names[0];
  const dupeOrderCount = group.order_counts.slice(1).reduce((a,v)=>a+v, 0);

  console.log(`[${group.norm}] keeping ${canonical} "${canonicalName}" (${group.order_counts[0]} orders), merging ${duplicates.length} dupe(s) with ${dupeOrderCount} orders`);

  if (DRY) { mergedCount += duplicates.length; orderRepoints += dupeOrderCount; continue; }

  try {
    // Step 0: for tables with (builderId, X) unique constraints, pre-delete dupe rows that would
    // conflict with an existing canonical row on the same (X).
    const compositeUnique = [
      { table: 'BuilderPricing', keyCol: 'productId' },
      { table: 'AccountCategoryMargin', keyCol: 'category' },
    ];
    for (const { table, keyCol } of compositeUnique) {
      await sql.query(
        `DELETE FROM "${table}" t
         WHERE t."builderId" = ANY($1::text[])
           AND EXISTS (
             SELECT 1 FROM "${table}" c
             WHERE c."builderId" = $2 AND c."${keyCol}" = t."${keyCol}"
           )`,
        [duplicates, canonical]
      );
    }

    // Step 1: bulk UPDATE all many-to-X tables
    for (const table of manyTables) {
      const res = await sql.query(
        `UPDATE "${table}" SET "builderId" = $1 WHERE "builderId" = ANY($2::text[])`,
        [canonical, duplicates]
      );
    }
    // TradeReview uses a different column name
    for (const { table, column } of specialCols) {
      await sql.query(
        `UPDATE "${table}" SET "${column}" = $1 WHERE "${column}" = ANY($2::text[])`,
        [canonical, duplicates]
      );
    }

    // Step 2: 1:1 unique relations — for each, move or delete
    for (const table of uniqueTables) {
      // Does canonical already have a record?
      const existing = await sql.query(
        `SELECT id FROM "${table}" WHERE "builderId" = $1 LIMIT 1`,
        [canonical]
      );
      if (existing.length > 0) {
        // Canonical has one — delete dupe records
        await sql.query(
          `DELETE FROM "${table}" WHERE "builderId" = ANY($1::text[])`,
          [duplicates]
        );
      } else {
        // Canonical has none — move first dupe's record over, delete rest
        const firstDupeRec = await sql.query(
          `SELECT id FROM "${table}" WHERE "builderId" = ANY($1::text[]) ORDER BY "createdAt" ASC LIMIT 1`,
          [duplicates]
        );
        if (firstDupeRec.length > 0) {
          await sql.query(
            `UPDATE "${table}" SET "builderId" = $1 WHERE id = $2`,
            [canonical, firstDupeRec[0].id]
          );
          // Delete any remaining dupe records
          await sql.query(
            `DELETE FROM "${table}" WHERE "builderId" = ANY($1::text[])`,
            [duplicates]
          );
        }
      }
    }

    // Step 3: delete the now-orphaned duplicate Builder rows
    await sql.query(
      `DELETE FROM "Builder" WHERE id = ANY($1::text[])`,
      [duplicates]
    );

    mergedCount += duplicates.length;
    orderRepoints += dupeOrderCount;
  } catch (e) {
    console.error(`  ❌ Failed: ${e.message}`);
    failed++;
  }
}

console.log(`\n── Summary ──`);
console.log(`Groups processed:    ${dupes.length}`);
console.log(`Duplicate builders:  ${mergedCount} ${DRY ? '(would be)' : ''}merged`);
console.log(`Orders repointed:    ${orderRepoints}`);
if (failed) console.log(`Failed groups:       ${failed}`);

if (!DRY) {
  const after = await sql.query(`
    SELECT COUNT(*) FILTER (WHERE n > 1)::int AS remaining
    FROM (SELECT LOWER(TRIM("companyName")) AS cn, COUNT(*)::int AS n FROM "Builder" GROUP BY 1) x
  `);
  console.log(`Remaining dupe groups: ${after[0].remaining}`);

  // Verify Toll Brothers is now one row
  const toll = await sql.query(`
    SELECT b.id, b."companyName", COUNT(o.id)::int AS orders, ROUND(SUM(o.total)::numeric,0) AS rev
    FROM "Builder" b LEFT JOIN "Order" o ON o."builderId"=b.id
    WHERE LOWER(TRIM(b."companyName")) = 'toll brothers'
    GROUP BY b.id
  `);
  console.log(`\nToll Brothers post-dedup:`);
  for (const r of toll) console.log(`  ${r.id} ${r.companyName} — ${r.orders} orders, $${r.rev}`);
}
