#!/usr/bin/env node
/**
 * fix-community-totallots.mjs
 *
 * Community.totalLots schema drift fix.
 *
 * prisma/schema.prisma declares:
 *   totalLots  Int  @default(0)   // NOT NULL, default 0
 *
 * Live DB has NULLs in this column, which blocks `prisma db push` from
 * tightening the column to NOT NULL.
 *
 * Strategy (Option A): backfill NULL rows with 0 (matches @default(0)).
 * This does not alter schema.prisma — schema/DB nullability reconciliation
 * is handled by `prisma db push` once the data is clean.
 *
 * Usage:
 *   node scripts/fix-community-totallots.mjs          # dry run (default)
 *   node scripts/fix-community-totallots.mjs --commit # apply UPDATE
 */

import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const COMMIT = process.argv.includes('--commit');
const DEFAULT_VALUE = 0; // matches prisma @default(0)

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL not set in env');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function main() {
  console.log('=== Community.totalLots backfill ===');
  console.log('Mode:', COMMIT ? 'COMMIT (will write)' : 'DRY RUN (no writes)');
  console.log('Default value:', DEFAULT_VALUE);
  console.log();

  // Pre-fix stats
  const before = await sql`SELECT COUNT(*)::int AS n FROM "Community" WHERE "totalLots" IS NULL`;
  const total = await sql`SELECT COUNT(*)::int AS n FROM "Community"`;
  const nonNullStats = await sql`
    SELECT MIN("totalLots")::int AS min,
           MAX("totalLots")::int AS max,
           AVG("totalLots")::int AS avg,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "totalLots")::int AS median
    FROM "Community"
    WHERE "totalLots" IS NOT NULL
  `;

  console.log('Total Community rows       :', total[0].n);
  console.log('Rows with NULL totalLots   :', before[0].n);
  console.log('Non-null totalLots stats   :', JSON.stringify(nonNullStats[0]));
  console.log();

  if (before[0].n === 0) {
    console.log('No NULLs to fix. Exiting.');
    return;
  }

  // Show affected rows
  const sample = await sql`
    SELECT id, name, "builderId", "totalLots"
    FROM "Community"
    WHERE "totalLots" IS NULL
    ORDER BY name
    LIMIT 20
  `;
  console.log('Rows to be updated (up to 20 shown):');
  for (const row of sample) {
    console.log(`  ${row.id}  ${row.name}  (builderId=${row.builderId})`);
  }
  console.log();

  if (!COMMIT) {
    console.log(`DRY RUN: would UPDATE ${before[0].n} row(s) SET "totalLots" = ${DEFAULT_VALUE}`);
    console.log('Run with --commit to apply.');
    return;
  }

  // Apply the fix
  const result = await sql`
    UPDATE "Community"
    SET "totalLots" = ${DEFAULT_VALUE}
    WHERE "totalLots" IS NULL
  `;
  console.log('UPDATE executed.');

  const after = await sql`SELECT COUNT(*)::int AS n FROM "Community" WHERE "totalLots" IS NULL`;
  console.log('Rows with NULL totalLots (after):', after[0].n);

  if (after[0].n !== 0) {
    console.error('WARNING: NULLs remain after update. Investigate.');
    process.exit(2);
  }
  console.log('Drift cleared. You can now run: npx prisma db push');
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
