#!/usr/bin/env node
/**
 * drift-fix-targeted.mjs — targeted fixes for residual Order drift, driven by
 * the classification produced by drift-deep-dive.mjs.
 *
 * Must run `drift-deep-dive.mjs` FIRST — this script reads drift-deep-dive.json.
 *
 * Fix policy per classification (mission-spec):
 *   - INFLOW_LEGACY            → leave alone (stored total is source of truth)
 *   - FORECAST_PLACEHOLDER     → leave alone (header-only by design)
 *   - EMPTY_ORDER              → leave alone (zero total, no items = legitimate)
 *   - MANUAL_ENTRY             → leave alone (stored header already self-reconciles)
 *   - MIGRATION                → leave alone (subtotal=0/total!=0, legacy)
 *   - MANUAL_ADJUSTMENT        → NOT CURRENTLY SEEN; would add an "adjustment" line item
 *                                rather than touching stored total (not auto-applied; needs
 *                                builder visibility)
 *   - PARTIAL_IMPORT_TRUST_STORED → recompute total = subtotal + tax + ship from STORED
 *                                    fields (items are the untrusted side). This is the
 *                                    "mission-spec PARTIAL_IMPORT fix."
 *   - STALE_SUBTOTAL_TRUST_ITEMS → not seen in current data; would recompute subtotal = items_sum
 *   - CORRUPT_HEADER_TRUST_ITEMS → DO NOT TOUCH. Dawn must review — header may be decimal-
 *                                  shifted / truncated but we won't overwrite a real total
 *                                  without human sign-off.
 *   - DATA_CORRUPTION / UNKNOWN  → DO NOT TOUCH
 *
 * Usage:
 *   node scripts/drift-fix-targeted.mjs            # dry run (default)
 *   node scripts/drift-fix-targeted.mjs --apply    # write changes
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const APPLY = process.argv.includes('--apply');
const MODE = APPLY ? 'APPLY' : 'DRY RUN';

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function loadDiag() {
  const p = join(__dirname, 'drift-deep-dive.json');
  try {
    return JSON.parse(readFileSync(p, 'utf-8'));
  } catch (e) {
    console.error('Could not read drift-deep-dive.json. Run `node scripts/drift-deep-dive.mjs` first.');
    process.exit(1);
  }
}

// Safe-to-auto-fix classifications
const AUTO_FIX = new Set(['PARTIAL_IMPORT_TRUST_STORED']);
// Leave-as-is (no fix needed)
const NO_OP = new Set([
  'INFLOW_LEGACY',
  'FORECAST_PLACEHOLDER',
  'EMPTY_ORDER',
  'MANUAL_ENTRY',
  'MIGRATION',
]);
// Flag for human review
const REVIEW = new Set([
  'CORRUPT_HEADER_TRUST_ITEMS',
  'DATA_CORRUPTION',
  'MANUAL_ADJUSTMENT', // would add adjustment line — needs review
  'STALE_SUBTOTAL_TRUST_ITEMS', // not seen, but if it appears, want eyes
  'UNKNOWN',
]);

async function main() {
  console.log(`── drift-fix-targeted (${MODE}) ──\n`);

  const diag = loadDiag();
  const allOrders = [...diag.bigDrift, ...diag.noItemDrift];

  const buckets = {};
  for (const o of allOrders) {
    (buckets[o.classification] ??= []).push(o);
  }

  console.log('Inputs from drift-deep-dive.json:');
  for (const [k, v] of Object.entries(buckets)) {
    const tag = AUTO_FIX.has(k) ? '[AUTO-FIX]' : NO_OP.has(k) ? '[NO-OP]' : '[REVIEW]';
    console.log(`  ${tag.padEnd(12)} ${k.padEnd(32)} ${v.length}`);
  }

  const actions = {
    fixed: [],        // orders whose header was recomputed
    leftAsIs: [],     // no-op
    needsReview: [],  // flagged for human
    errors: [],
  };

  // ── PARTIAL_IMPORT_TRUST_STORED: recompute total = subtotal + tax + ship from STORED ──
  const toFix = buckets['PARTIAL_IMPORT_TRUST_STORED'] || [];
  console.log(`\n[fix] PARTIAL_IMPORT_TRUST_STORED: ${toFix.length} orders`);
  for (const o of toFix) {
    const stored = await sql`
      SELECT id, "orderNumber", subtotal, "taxAmount", "shippingCost", total
      FROM "Order" WHERE id = ${o.id}`;
    if (stored.length === 0) {
      actions.errors.push({ id: o.id, error: 'order not found' });
      continue;
    }
    const s = stored[0];
    const newTotal = round2(Number(s.subtotal || 0) + Number(s.taxAmount || 0) + Number(s.shippingCost || 0));
    const oldTotal = round2(s.total);

    if (Math.abs(newTotal - oldTotal) < 0.01) {
      actions.leftAsIs.push({ id: o.id, orderNumber: s.orderNumber, reason: 'already matches' });
      continue;
    }

    if (APPLY) {
      try {
        await sql`UPDATE "Order" SET total = ${newTotal}, "updatedAt" = NOW() WHERE id = ${o.id}`;
        actions.fixed.push({
          id: o.id,
          orderNumber: s.orderNumber,
          oldTotal,
          newTotal,
          delta: round2(newTotal - oldTotal),
          classification: o.classification,
        });
      } catch (e) {
        actions.errors.push({ id: o.id, error: String(e) });
      }
    } else {
      actions.fixed.push({
        id: o.id,
        orderNumber: s.orderNumber,
        oldTotal,
        newTotal,
        delta: round2(newTotal - oldTotal),
        classification: o.classification,
        dryRun: true,
      });
    }
  }

  // ── NO-OP classes: just record ──
  for (const k of NO_OP) {
    for (const o of (buckets[k] || [])) {
      actions.leftAsIs.push({
        id: o.id,
        orderNumber: o.orderNumber,
        classification: k,
        total: o.total,
      });
    }
  }

  // ── REVIEW classes: record with reason ──
  for (const k of REVIEW) {
    for (const o of (buckets[k] || [])) {
      actions.needsReview.push({
        id: o.id,
        orderNumber: o.orderNumber,
        classification: k,
        total: o.total ?? null,
        itemsSum: o.itemsSum ?? null,
        delta: o.delta ?? null,
        itemCount: o.itemCount ?? 0,
        inflowOrderId: o.inflowOrderId ?? null,
        builder: o.builder ?? null,
        reason: o.reason,
      });
    }
  }

  // Orphan OrderItems — none were found, but fix script would handle them here.
  // Policy: orphan OrderItem.productId → flag for review; do NOT delete (line carries $ value).
  // Orphan OrderItem.orderId → delete (parent is gone, no reason to keep the row).
  const orphans = {
    orphanProduct: diag.orphanItemsTotal || 0,
    orphanOrder: diag.orphanParentlessItemsTotal || 0,
  };
  console.log(`\n[fix] Orphan OrderItem summary: productId=${orphans.orphanProduct}, orderId=${orphans.orphanOrder}`);

  // ── Summary ──
  console.log('\nResults:');
  console.log(`  Fixed (${APPLY ? 'written' : 'would-be-written'}): ${actions.fixed.length}`);
  console.log(`  Left as-is:                  ${actions.leftAsIs.length}`);
  console.log(`  Flagged for review:          ${actions.needsReview.length}`);
  console.log(`  Errors:                      ${actions.errors.length}`);

  if (actions.fixed.length > 0) {
    console.log('\nFixes:');
    for (const f of actions.fixed) {
      console.log(`  ${f.orderNumber}: $${f.oldTotal} → $${f.newTotal} (Δ ${f.delta >= 0 ? '+' : ''}$${f.delta})`);
    }
  }
  if (actions.errors.length > 0) {
    console.log('\nErrors:');
    for (const e of actions.errors) console.log(`  ${e.id}: ${e.error}`);
  }

  const report = {
    mode: MODE,
    generatedAt: new Date().toISOString(),
    inputBuckets: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
    actions,
    orphans,
  };
  const outPath = join(__dirname, 'drift-fix-targeted.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nWrote ${outPath}`);
  if (!APPLY) {
    console.log('\n(DRY RUN — no changes written. Re-run with --apply to commit.)');
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
