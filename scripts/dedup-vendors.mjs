#!/usr/bin/env node
/**
 * Vendor dedup — merge duplicate Vendor records by case-insensitive name match.
 *
 * Canonical = the vendor with the most PurchaseOrders (tiebreak: oldest createdAt).
 * Idempotent. --dry-run available.
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

console.log(`\n── Vendor dedup ${DRY ? '(DRY RUN)' : '(LIVE)'} ──\n`);

// Discover FK tables referencing Vendor
const fkRefs = await sql.query(`
  SELECT tc.table_name, kcu.column_name
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
  JOIN information_schema.referential_constraints rc ON rc.constraint_name = tc.constraint_name
  JOIN information_schema.table_constraints ftc ON ftc.constraint_name = rc.unique_constraint_name
  WHERE ftc.table_name = 'Vendor' AND tc.constraint_type = 'FOREIGN KEY'
`);
console.log(`Tables referencing Vendor: ${fkRefs.length}`);
for (const r of fkRefs) console.log(`  ${r.table_name}.${r.column_name}`);

// Find dupes
const dupes = await sql.query(`
  WITH v AS (
    SELECT v.id, v.name, v.code, COUNT(po.id)::int AS po_count, v."createdAt"
    FROM "Vendor" v LEFT JOIN "PurchaseOrder" po ON po."vendorId"=v.id
    GROUP BY v.id
  )
  SELECT LOWER(TRIM(name)) AS norm,
         array_agg(id ORDER BY po_count DESC, "createdAt" ASC) AS ids,
         array_agg(name ORDER BY po_count DESC, "createdAt" ASC) AS names,
         array_agg(po_count ORDER BY po_count DESC, "createdAt" ASC) AS po_counts
  FROM v GROUP BY LOWER(TRIM(name))
  HAVING COUNT(*) > 1
`);
console.log(`\nFound ${dupes.length} duplicate groups.\n`);

let merged = 0; let repointed = 0; let failed = 0;

for (const g of dupes) {
  const [canonical, ...duplicates] = g.ids;
  const dupePos = g.po_counts.slice(1).reduce((a,v)=>a+v,0);
  console.log(`[${g.norm}] keep ${canonical} "${g.names[0]}" (${g.po_counts[0]} POs), merge ${duplicates.length} (${dupePos} POs)`);

  if (DRY) { merged += duplicates.length; repointed += dupePos; continue; }

  try {
    // VendorProduct unique on (vendorId, productId) — pre-delete conflicts
    await sql.query(
      `DELETE FROM "VendorProduct" t
       WHERE t."vendorId" = ANY($1::text[])
         AND EXISTS (SELECT 1 FROM "VendorProduct" c WHERE c."vendorId"=$2 AND c."productId"=t."productId")`,
      [duplicates, canonical]
    );

    // Bulk UPDATE all FK tables
    for (const r of fkRefs) {
      await sql.query(
        `UPDATE "${r.table_name}" SET "${r.column_name}" = $1 WHERE "${r.column_name}" = ANY($2::text[])`,
        [canonical, duplicates]
      );
    }
    // Delete orphans
    await sql.query(`DELETE FROM "Vendor" WHERE id = ANY($1::text[])`, [duplicates]);
    merged += duplicates.length; repointed += dupePos;
  } catch (e) {
    console.error(`  ❌ ${e.message}`);
    failed++;
  }
}

console.log(`\n── Summary ──`);
console.log(`Groups:   ${dupes.length}`);
console.log(`Merged:   ${merged}${DRY?' (would be)':''}`);
console.log(`Repoint:  ${repointed} POs`);
if (failed) console.log(`Failed:   ${failed}`);

if (!DRY) {
  const boise = await sql.query(`
    SELECT id, name, code, (SELECT COUNT(*) FROM "PurchaseOrder" po WHERE po."vendorId"=v.id)::int AS pos
    FROM "Vendor" v WHERE LOWER(TRIM(name)) = 'boise cascade'
  `);
  console.log(`\nBoise Cascade post-dedup:`);
  for (const r of boise) console.log(`  ${r.id} ${r.name} (${r.code}) — ${r.pos} POs`);
}
