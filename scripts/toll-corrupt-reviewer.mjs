#!/usr/bin/env node
/**
 * toll-corrupt-reviewer.mjs — READ-ONLY diagnostic helper.
 *
 * Walks the 10 CORRUPT_HEADER_TRUST_ITEMS orders surfaced by
 * scripts/drift-deep-dive.mjs (7 Toll Brothers + 3 others) and prints a
 * reviewer-friendly summary: stored vs computed header, item count, delta.
 * Useful for eyeballing the queue before opening the UI at
 * /ops/admin/data-repair.
 *
 * Does NOT mutate anything. This is an accessory to the HITL UI — the fix is
 * only applied when Dawn clicks "Accept Fix" in the browser.
 *
 * Usage:
 *   node scripts/toll-corrupt-reviewer.mjs                       # all flagged
 *   node scripts/toll-corrupt-reviewer.mjs --builder "Toll"      # filter
 *   node scripts/toll-corrupt-reviewer.mjs --order SO-003418     # single
 *   node scripts/toll-corrupt-reviewer.mjs --json                # machine
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) {
  console.error('No DATABASE_URL found in .env');
  process.exit(1);
}

const args = process.argv.slice(2);
const builderFilter = argValue('--builder');
const orderFilter = argValue('--order');
const jsonOut = args.includes('--json');

function argValue(name) {
  const idx = args.indexOf(name);
  return idx >= 0 ? args[idx + 1] : null;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;
const money = (n) => `$${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

function classify({ storedTotal, itemsSum, tax, ship, itemCount }) {
  const absStored = Math.abs(storedTotal);
  const expected = itemsSum + tax + ship;
  const absDrift = Math.abs(storedTotal - expected);
  const ratio = itemsSum > 0 ? absStored / itemsSum : 0;
  if (itemsSum > 1000 && ratio < 0.25 && absDrift > 10000 && itemCount > 0) {
    return 'CORRUPT_HEADER_TRUST_ITEMS';
  }
  return null;
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const rows = await sql`
  SELECT
    o.id, o."orderNumber", o."builderId",
    b."companyName" AS builder,
    o.subtotal, o."taxAmount" AS tax, o."shippingCost" AS ship, o.total,
    o."createdAt",
    COALESCE((SELECT SUM("lineTotal") FROM "OrderItem" WHERE "orderId" = o.id), 0)::float AS items_sum,
    (SELECT COUNT(*)::int FROM "OrderItem" WHERE "orderId" = o.id) AS item_count
  FROM "Order" o
  LEFT JOIN "Builder" b ON b.id = o."builderId"
  WHERE EXISTS (SELECT 1 FROM "OrderItem" WHERE "orderId" = o.id)
    AND ABS(o.total - (
      COALESCE((SELECT SUM("lineTotal") FROM "OrderItem" WHERE "orderId" = o.id), 0)
      + COALESCE(o."taxAmount", 0)
      + COALESCE(o."shippingCost", 0)
    )) > 10000
  ORDER BY o."orderNumber"
`;

const flagged = [];
for (const r of rows) {
  const classification = classify({
    storedTotal: Number(r.total),
    itemsSum: Number(r.items_sum),
    tax: Number(r.tax || 0),
    ship: Number(r.ship || 0),
    itemCount: Number(r.item_count),
  });
  if (classification !== 'CORRUPT_HEADER_TRUST_ITEMS') continue;

  if (builderFilter && !(r.builder || '').toLowerCase().includes(builderFilter.toLowerCase())) continue;
  if (orderFilter && r.orderNumber !== orderFilter) continue;

  const itemsSum = round2(r.items_sum);
  const tax = round2(r.tax || 0);
  const ship = round2(r.ship || 0);
  const storedTotal = round2(r.total);
  const computedTotal = round2(itemsSum + tax + ship);
  flagged.push({
    orderId: r.id,
    orderNumber: r.orderNumber,
    builder: r.builder,
    storedSubtotal: round2(r.subtotal),
    storedTax: tax,
    storedShipping: ship,
    storedTotal,
    computedItemSum: itemsSum,
    computedTotal,
    delta: round2(computedTotal - storedTotal),
    itemCount: Number(r.item_count),
    createdAt: r.createdAt,
  });
}

if (jsonOut) {
  process.stdout.write(JSON.stringify({ flagged, count: flagged.length }, null, 2) + '\n');
  process.exit(0);
}

console.log('── toll-corrupt-reviewer (READ-ONLY) ──\n');
console.log(`Found ${flagged.length} CORRUPT_HEADER_TRUST_ITEMS orders\n`);

if (flagged.length === 0) {
  console.log('Nothing flagged. Either the UI already cleared these or filters excluded everything.');
  process.exit(0);
}

const totalHidden = flagged.reduce((s, f) => s + Math.max(0, f.delta), 0);
console.log(`Hidden revenue (sum of positive deltas): ${money(totalHidden)}\n`);

// Builder grouping
const perBuilder = new Map();
for (const f of flagged) {
  const key = f.builder || 'Unknown';
  const cur = perBuilder.get(key) || { count: 0, hidden: 0 };
  cur.count += 1;
  cur.hidden += Math.max(0, f.delta);
  perBuilder.set(key, cur);
}
console.log('By builder:');
for (const [b, v] of [...perBuilder.entries()].sort((a, b) => b[1].hidden - a[1].hidden)) {
  console.log(`  ${b.padEnd(30)} ${String(v.count).padStart(3)} orders   ${money(v.hidden).padStart(14)}`);
}
console.log();

// Per-order table
const pad = (s, n) => String(s).padEnd(n);
const padR = (s, n) => String(s).padStart(n);
console.log(
  pad('Order', 12) + pad('Builder', 28) + padR('Stored', 14) + padR('Computed', 14) + padR('Delta', 14) + padR('Items', 7),
);
console.log('─'.repeat(89));
for (const f of flagged) {
  console.log(
    pad(f.orderNumber, 12) +
      pad((f.builder || '—').slice(0, 26), 28) +
      padR(money(f.storedTotal), 14) +
      padR(money(f.computedTotal), 14) +
      padR((f.delta > 0 ? '+' : '') + money(f.delta), 14) +
      padR(f.itemCount, 7),
  );
}
console.log('\nReview at: /ops/admin/data-repair');
