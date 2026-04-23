#!/usr/bin/env node
/**
 * Migrate PurchaseOrder.category — enum + column + classify existing POs.
 *
 * Phase A (schema): create POCategory enum + add PurchaseOrder.category column
 *   (NOT NULL DEFAULT 'GENERAL'). Additive, idempotent.
 *
 * Phase B (classify): walk every PO and its items/notes, pick a category with
 *   the ruleset below, UPDATE in batches of 100.
 *
 *   Classification ruleset (first match wins):
 *     1. notes reference "punch" → PUNCH
 *     2. SKU prefix 'FINA', 'EXT-', 'TRIM', 'LABO', 'PUNC' → corresponding
 *     3. items are front-door related (notes say "front", description has
 *        "final front", "front door", OR SKU starts 'FD-') → FINAL_FRONT
 *     4. all items are labor/install AND notes say "trim 1" → TRIM_1_LABOR
 *     5. all items are labor/install AND notes say "trim 2" → TRIM_2_LABOR
 *     6. any items are labor/install only (no non-labor items) → leave via
 *        general labor hint: if notes say "trim" pick TRIM_*_LABOR, else GENERAL
 *     7. items contain doors + frames/sill/weatherstrip/jamb → EXTERIOR
 *     8. items contain casing + base + crown-type trim →
 *        - TRIM_1 if notes say "trim 1", else TRIM_2
 *     9. notes reference "exterior" → EXTERIOR
 *    10. default → GENERAL
 *
 * Usage:
 *   node scripts/migrate-po-category.mjs            # dry-run preview
 *   node scripts/migrate-po-category.mjs --apply    # apply schema + writes
 *
 * Idempotent. No drops.
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPLY = process.argv.includes('--apply');

// -------- env / db --------
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) {
  console.error('No DATABASE_URL in .env');
  process.exit(1);
}
const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

// -------- constants --------
const CATEGORIES = [
  'EXTERIOR',
  'TRIM_1',
  'TRIM_1_LABOR',
  'TRIM_2',
  'TRIM_2_LABOR',
  'FINAL_FRONT',
  'PUNCH',
  'GENERAL',
];

const BATCH_SIZE = 100;

// -------- classifier --------
function isLaborDesc(desc) {
  if (!desc) return false;
  const d = desc.toLowerCase();
  return (
    d.includes('labor') ||
    d.includes('install') ||
    d.includes('service/labor') ||
    d.includes('labor-only')
  );
}

function classify(po) {
  const notes = (po.notes || '').toLowerCase();
  const items = po.items || [];
  const skus = items.map((i) => (i.vendorSku || '').toUpperCase());
  const descs = items.map((i) => (i.description || '').toLowerCase());
  const laborFlags = descs.map(isLaborDesc);
  const allLabor = items.length > 0 && laborFlags.every((f) => f);
  const anyLabor = laborFlags.some((f) => f);
  const hasNonLabor = laborFlags.some((f) => !f);

  // 1. PUNCH — notes say punch
  if (notes.includes('punch')) return 'PUNCH';

  // 2. explicit SKU prefixes
  if (skus.some((s) => s.startsWith('PUNC'))) return 'PUNCH';
  if (skus.some((s) => s.startsWith('FINA'))) return 'FINAL_FRONT';
  if (skus.some((s) => s.startsWith('EXT-'))) return 'EXTERIOR';

  // TRIM / LABO prefix — combine with notes for trim-1/2 disambiguation
  const skuHasTrim = skus.some((s) => s.startsWith('TRIM'));
  const skuHasLabo = skus.some((s) => s.startsWith('LABO'));
  const notesTrim1 = notes.includes('trim 1') || notes.includes('trim1');
  const notesTrim2 = notes.includes('trim 2') || notes.includes('trim2');

  if (skuHasLabo || allLabor) {
    if (notesTrim1) return 'TRIM_1_LABOR';
    if (notesTrim2) return 'TRIM_2_LABOR';
    // All-labor POs default to TRIM_2_LABOR per ops convention (trim 2 is the
    // heavier install phase). If this is wrong for individual POs the ops team
    // can reclassify in the UI.
    if (allLabor) return 'TRIM_2_LABOR';
  }
  if (skuHasTrim) {
    if (notesTrim1) return 'TRIM_1';
    return 'TRIM_2';
  }

  // 3. Front door cues
  const descSaysFront = descs.some(
    (d) =>
      d.includes('final front') ||
      d.includes('front door') ||
      d.includes('final-front') ||
      /\bfd[- ]/i.test(d)
  );
  const skuSaysFront = skus.some((s) => s.startsWith('FD-'));
  if (descSaysFront || skuSaysFront || notes.includes('front door') || notes.includes('final front')) {
    return 'FINAL_FRONT';
  }

  // 4. Labor-only with trim-phase note
  if (allLabor && notesTrim1) return 'TRIM_1_LABOR';
  if (allLabor && notesTrim2) return 'TRIM_2_LABOR';

  // 7. Exterior — doors + frame/sill/weatherstrip/jamb/therma material
  const extHitCount = descs.filter(
    (d) =>
      d.includes('weatherstrip') ||
      d.includes('sill') ||
      d.includes('therma') ||
      d.includes('fiber-classic') ||
      d.includes('fiber classic') ||
      d.includes('fiberglass') ||
      d.includes('jmb') ||
      d.includes(' jamb') ||
      d.includes('frame') ||
      d.includes('brickmold') ||
      d.includes('brick mould') ||
      d.includes('brick mold')
  ).length;
  if (extHitCount >= 2 || (extHitCount >= 1 && descs.some((d) => /\b\d{4}\b/.test(d) && d.includes('door')))) {
    return 'EXTERIOR';
  }

  // 8. Trim material — casing / base / crown
  const trimHitCount = descs.filter(
    (d) =>
      d.includes('casing') ||
      d.includes(' base ') ||
      d.startsWith('base ') ||
      d.includes('crown') ||
      /\bwm[- ]?\d/.test(d) ||
      /\bb[- ]?2\d\d/.test(d) ||
      /\bc[- ]?\d{3}/.test(d)
  ).length;
  if (trimHitCount >= 1) {
    if (notesTrim1) return 'TRIM_1';
    if (notesTrim2) return 'TRIM_2';
    return 'TRIM_2';
  }

  // 9. Notes-only exterior hint
  if (notes.includes('exterior')) return 'EXTERIOR';

  // 10. Default
  return 'GENERAL';
}

// -------- phase A: schema --------
async function applySchema() {
  console.log('\n── Phase A: schema migration (enum + column) ──\n');
  const steps = [
    {
      name: 'Create POCategory enum (if missing)',
      sql: `DO $$ BEGIN
              CREATE TYPE "POCategory" AS ENUM ('EXTERIOR', 'TRIM_1', 'TRIM_1_LABOR', 'TRIM_2', 'TRIM_2_LABOR', 'FINAL_FRONT', 'PUNCH', 'GENERAL');
            EXCEPTION WHEN duplicate_object THEN NULL;
            END $$;`,
    },
    {
      name: 'Add PurchaseOrder.category (NOT NULL DEFAULT GENERAL)',
      sql: `ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "category" "POCategory" NOT NULL DEFAULT 'GENERAL';`,
    },
    {
      name: 'Index PurchaseOrder(category)',
      sql: `CREATE INDEX IF NOT EXISTS "PurchaseOrder_category_idx" ON "PurchaseOrder" ("category");`,
    },
  ];
  for (const step of steps) {
    if (APPLY) {
      await sql.query(step.sql);
      console.log(`  OK   ${step.name}`);
    } else {
      console.log(`  DRY  ${step.name}`);
    }
  }
}

// -------- phase B: classify --------
async function classifyAll() {
  console.log('\n── Phase B: classify existing POs ──\n');

  // Pull every PO + its items in one shot.
  const pos = await sql.query(`
    SELECT "id", "notes"
    FROM "PurchaseOrder"
    ORDER BY "createdAt" ASC
  `);

  const items = await sql.query(`
    SELECT "purchaseOrderId", "vendorSku", "description", "productId"
    FROM "PurchaseOrderItem"
  `);

  const itemsByPo = new Map();
  for (const it of items) {
    if (!itemsByPo.has(it.purchaseOrderId)) itemsByPo.set(it.purchaseOrderId, []);
    itemsByPo.get(it.purchaseOrderId).push(it);
  }

  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  const updates = []; // { id, category }
  for (const po of pos) {
    const poWithItems = { ...po, items: itemsByPo.get(po.id) || [] };
    const cat = classify(poWithItems);
    counts[cat]++;
    updates.push({ id: po.id, category: cat });
  }

  console.log('Preview — classification counts:');
  for (const c of CATEGORIES) {
    console.log(`  ${c.padEnd(14)} ${String(counts[c]).padStart(6)}`);
  }
  console.log(`  ${'TOTAL'.padEnd(14)} ${String(updates.length).padStart(6)}`);

  if (!APPLY) {
    console.log('\nDry-run — no writes. Re-run with --apply to persist.');
    return;
  }

  console.log(`\nWriting updates in batches of ${BATCH_SIZE}…`);
  let written = 0;
  // Group by category to use simple IN(...) batched UPDATEs.
  const byCat = Object.fromEntries(CATEGORIES.map((c) => [c, []]));
  for (const u of updates) byCat[u.category].push(u.id);

  for (const cat of CATEGORIES) {
    const ids = byCat[cat];
    if (ids.length === 0) continue;
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      const batch = ids.slice(i, i + BATCH_SIZE);
      await sql.query(
        `UPDATE "PurchaseOrder" SET "category" = $1::"POCategory" WHERE "id" = ANY($2::text[])`,
        [cat, batch]
      );
      written += batch.length;
    }
    console.log(`  ${cat.padEnd(14)} wrote ${ids.length}`);
  }
  console.log(`\nTotal rows updated: ${written}`);

  // Final tally straight from DB.
  const verify = await sql.query(`
    SELECT "category"::text, COUNT(*)::int AS n
    FROM "PurchaseOrder"
    GROUP BY "category"
    ORDER BY "category"
  `);
  console.log('\nPost-apply DB tally:');
  for (const r of verify) console.log(`  ${r.category.padEnd(14)} ${String(r.n).padStart(6)}`);
}

// -------- main --------
(async () => {
  console.log(APPLY ? '>>> MODE: APPLY' : '>>> MODE: DRY-RUN');
  await applySchema();
  await classifyAll();
  console.log('\nDone.');
})().catch((e) => {
  console.error('migrate-po-category failed:', e);
  process.exit(1);
});
