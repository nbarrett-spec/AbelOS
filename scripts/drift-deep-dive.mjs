#!/usr/bin/env node
/**
 * drift-deep-dive.mjs — READ-ONLY diagnostic for residual Order drift.
 *
 * Scope (3 classes of leftover drift from the integrity audit):
 *   1. Orders with drift > $10K (auto-repair skipped these)
 *   2. Orders with drift but ZERO OrderItems (auto-repair skipped these)
 *   3. Orphaned OrderItem rows where productId no longer points to an existing Product
 *
 * Writes: scripts/drift-deep-dive.json (machine-readable output consumed by
 * drift-fix-targeted.mjs).
 *
 * Usage: node scripts/drift-deep-dive.mjs
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const round2 = (n) => Math.round(Number(n) * 100) / 100;

function classifyWithItems({ storedSubtotal, storedTax, storedShipping, storedTotal, itemsSum, itemCount }) {
  const storedTaxN = Number(storedTax || 0);
  const storedShipN = Number(storedShipping || 0);
  // Expected total using stored components: items + tax + shipping
  const expectedFromItems = itemsSum + storedTaxN + storedShipN;
  // Expected total using stored fields alone (no items): subtotal + tax + shipping
  const expectedFromStored = Number(storedSubtotal || 0) + storedTaxN + storedShipN;

  const driftFromItems = storedTotal - expectedFromItems;
  const driftFromStored = storedTotal - expectedFromStored;
  const absDriftItems = Math.abs(driftFromItems);
  const absDriftStored = Math.abs(driftFromStored);

  // RULE ORDER matters: check "which side looks more real" FIRST, self-reconciling second.
  // A header can self-reconcile (subtotal+tax+ship=total) but still be garbage — e.g. a
  // decimal-shifted total of $78 is internally consistent but obviously wrong.

  // Stored total is a tiny fraction of items sum — stored header is decimal-shifted or truncated.
  // Items are the truth. (e.g. SO-003418: total=$78 but 32 items sum to $28K)
  const totalVsItems = itemsSum > 0 ? Math.abs(Number(storedTotal)) / itemsSum : 0;
  if (itemsSum > 1000 && totalVsItems < 0.25 && absDriftItems > 10000) {
    return { kind: 'CORRUPT_HEADER_TRUST_ITEMS', reason: `items=$${round2(itemsSum)} vs |stored total|=$${round2(Math.abs(storedTotal))} (${(totalVsItems*100).toFixed(1)}%). Stored header looks decimal-shifted/truncated — items are truth.` };
  }

  // Stored total materially larger than items sum — stored is likely the real total,
  // items were partially imported. (e.g. SO-001947: stored=$12,967 but 1 item=$750)
  if (storedTotal > itemsSum + 5000 && itemCount < Math.max(5, itemsSum / 2000)) {
    return { kind: 'PARTIAL_IMPORT_TRUST_STORED', reason: `stored total $${round2(storedTotal)} >> items sum $${round2(itemsSum)} with only ${itemCount} item(s) — items were partially re-imported.` };
  }

  // Stored-header self-reconciles AND items-side diverges: trust stored header.
  if (absDriftStored < 0.01 && absDriftItems > 0.01) {
    return { kind: 'PARTIAL_IMPORT_TRUST_STORED', reason: 'subtotal+tax+ship=total (header consistent). Items were partially imported — trust stored header.' };
  }

  // Items-side fully reconciles with stored-total (items+tax+ship = total), but stored
  // subtotal doesn't match items. Items are truth; stored subtotal is stale.
  if (absDriftItems < 0.01 && absDriftStored > 0.01) {
    return { kind: 'STALE_SUBTOTAL_TRUST_ITEMS', reason: 'items+tax+ship=total. Stored subtotal is stale — recompute subtotal from items.' };
  }

  // A small, round delta — probable discount at total level
  const subtotalDelta = Math.abs(itemsSum - Number(storedSubtotal || 0));
  if (subtotalDelta < 1.00 && absDriftStored > 0.01 && absDriftStored < 5000) {
    return { kind: 'MANUAL_ADJUSTMENT', reason: 'items ≈ subtotal, but total ≠ subtotal+tax+ship — probable discount/credit applied at total level.' };
  }

  // Neither side reconciles and numbers are wildly off — flag for human
  return { kind: 'DATA_CORRUPTION', reason: `neither side reconciles: driftFromItems=$${round2(absDriftItems)}, driftFromStored=$${round2(absDriftStored)} — needs manual review.` };
}

async function main() {
  console.log('── drift-deep-dive (READ-ONLY) ──\n');

  // ── 1. Orders with drift > $10K (items present) ──────────────────────
  // Definition of drift: |total - (items_sum + tax + ship)| > 0.01
  console.log('[1] Scanning Orders with drift > $10K (items present)...');
  const bigDrift = await sql`
    SELECT
      o.id, o."orderNumber", o."builderId",
      b."companyName" as "builderName",
      o.total, o.subtotal, o."taxAmount", o."shippingCost",
      o."inflowOrderId",
      o."createdAt", o."orderDate", o.status::text as status,
      COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0) as items_sum,
      (SELECT COUNT(*)::int FROM "OrderItem" oi WHERE oi."orderId" = o.id) as item_count
    FROM "Order" o
    LEFT JOIN "Builder" b ON b.id = o."builderId"
    WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id)
      AND ABS(o.total - (
        COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0)
          + COALESCE(o."taxAmount", 0) + COALESCE(o."shippingCost", 0)
      )) >= 10000
    ORDER BY ABS(o.total - (
        COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0)
          + COALESCE(o."taxAmount", 0) + COALESCE(o."shippingCost", 0)
      )) DESC`;

  const bigDriftClassified = [];
  for (const r of bigDrift) {
    const items_sum = Number(r.items_sum);
    const expected_total = items_sum + Number(r.taxAmount || 0) + Number(r.shippingCost || 0);
    const delta = Number(r.total) - expected_total;

    const sampleItems = await sql`
      SELECT id, description, quantity, "unitPrice", "lineTotal", "productId"
      FROM "OrderItem" WHERE "orderId" = ${r.id}
      ORDER BY "lineTotal" DESC LIMIT 5`;

    const cls = classifyWithItems({
      storedSubtotal: Number(r.subtotal),
      storedTax: Number(r.taxAmount || 0),
      storedShipping: Number(r.shippingCost || 0),
      storedTotal: Number(r.total),
      itemsSum: items_sum,
      itemCount: r.item_count,
    });

    bigDriftClassified.push({
      id: r.id,
      orderNumber: r.orderNumber,
      builder: r.builderName,
      total: round2(r.total),
      storedSubtotal: round2(r.subtotal),
      storedTax: round2(r.taxAmount || 0),
      storedShipping: round2(r.shippingCost || 0),
      itemsSum: round2(items_sum),
      expectedTotal: round2(expected_total),
      delta: round2(delta),
      itemCount: r.item_count,
      inflowOrderId: r.inflowOrderId,
      createdAt: r.createdAt,
      orderDate: r.orderDate,
      status: r.status,
      classification: cls.kind,
      reason: cls.reason,
      sampleItems: sampleItems.map(s => ({
        description: s.description,
        qty: s.quantity,
        unitPrice: round2(s.unitPrice),
        lineTotal: round2(s.lineTotal),
      })),
    });
  }
  console.log(`    Found ${bigDriftClassified.length} orders with drift >= $10K`);
  const bigDriftBuckets = bigDriftClassified.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] || 0) + 1;
    return acc;
  }, {});
  console.log(`    Classifications: ${JSON.stringify(bigDriftBuckets)}`);

  // ── 2. Orders with ZERO OrderItems (the 441 flagged by the integrity audit) ──
  // Definition per the audit: any Order with no OrderItem rows. Every one of these
  // has implicit "drift" because items_sum = 0 while total is usually > 0.
  console.log('\n[2] Scanning Orders with ZERO items...');
  const noItemDrift = await sql`
    SELECT
      o.id, o."orderNumber", o."builderId",
      b."companyName" as "builderName",
      o.total, o.subtotal, o."taxAmount", o."shippingCost",
      o."inflowOrderId", o."inflowCustomerId", o."isForecast",
      o."createdAt", o."orderDate", o.status::text as status
    FROM "Order" o
    LEFT JOIN "Builder" b ON b.id = o."builderId"
    WHERE NOT EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id)
    ORDER BY o.total DESC NULLS LAST`;

  const noItemClassified = noItemDrift.map(r => {
    const expected_total = Number(r.subtotal || 0) + Number(r.taxAmount || 0) + Number(r.shippingCost || 0);
    const storedDelta = Number(r.total) - expected_total;
    let classification, reason;
    if (r.inflowOrderId) {
      classification = 'INFLOW_LEGACY';
      reason = 'InFlow-synced order with no local line items; stored total is source of truth.';
    } else if (r.isForecast) {
      classification = 'FORECAST_PLACEHOLDER';
      reason = 'Forecast order (isForecast=true) — headers only by design.';
    } else if (Number(r.total || 0) === 0) {
      classification = 'EMPTY_ORDER';
      reason = 'No items, zero total — safe to leave or cancel.';
    } else if (Number(r.subtotal || 0) === 0 && Number(r.total || 0) !== 0) {
      classification = 'MIGRATION';
      reason = 'Subtotal=0 but total!=0 — legacy migration with header-only data.';
    } else {
      classification = 'MANUAL_ENTRY';
      reason = 'No InFlow link, no items — manually-entered header-level order.';
    }
    return {
      id: r.id,
      orderNumber: r.orderNumber,
      builder: r.builderName,
      total: round2(r.total),
      storedSubtotal: round2(r.subtotal || 0),
      storedTax: round2(r.taxAmount || 0),
      storedShipping: round2(r.shippingCost || 0),
      expectedFromStored: round2(expected_total),
      storedDelta: round2(storedDelta),
      inflowOrderId: r.inflowOrderId,
      inflowCustomerId: r.inflowCustomerId,
      isForecast: r.isForecast,
      createdAt: r.createdAt,
      orderDate: r.orderDate,
      status: r.status,
      classification,
      reason,
    };
  });

  console.log(`    Found ${noItemClassified.length} orders with drift + zero items`);
  const noItemBuckets = noItemClassified.reduce((acc, r) => {
    acc[r.classification] = (acc[r.classification] || 0) + 1;
    return acc;
  }, {});
  console.log(`    Classifications: ${JSON.stringify(noItemBuckets)}`);

  // ── 3. Orphaned OrderItem rows (productId points nowhere) ─────────────
  console.log('\n[3] Scanning OrderItem rows with orphaned productId...');
  // Note: schema enforces FK with onDelete:Restrict — but raw SQL merges could
  // have bypassed constraint triggers. Check anyway.
  const orphanItems = await sql`
    SELECT oi.id, oi."orderId", oi."productId", oi.description, oi.quantity, oi."lineTotal",
           o."orderNumber"
    FROM "OrderItem" oi
    LEFT JOIN "Product" p ON p.id = oi."productId"
    LEFT JOIN "Order" o ON o.id = oi."orderId"
    WHERE p.id IS NULL`;
  console.log(`    Found ${orphanItems.length} orphan OrderItems`);

  const orphanSample = orphanItems.slice(0, 20).map(o => ({
    id: o.id,
    orderId: o.orderId,
    orderNumber: o.orderNumber,
    productId: o.productId,
    description: o.description,
    lineTotal: round2(o.lineTotal),
  }));

  // ── 4. Also check for orphan OrderItem.orderId (order deleted) ────────
  const orphanOrderRefs = await sql`
    SELECT oi.id, oi."orderId", oi."productId", oi.description, oi."lineTotal"
    FROM "OrderItem" oi
    LEFT JOIN "Order" o ON o.id = oi."orderId"
    WHERE o.id IS NULL`;
  console.log(`    Found ${orphanOrderRefs.length} OrderItems whose parent Order is missing`);

  // ── Summary ──
  const out = {
    generatedAt: new Date().toISOString(),
    summary: {
      bigDriftCount: bigDriftClassified.length,
      bigDriftBuckets,
      noItemDriftCount: noItemClassified.length,
      noItemBuckets,
      orphanOrderItemProducts: orphanItems.length,
      orphanOrderItemOrders: orphanOrderRefs.length,
    },
    bigDrift: bigDriftClassified,
    noItemDrift: noItemClassified,
    orphanItemsSample: orphanSample,
    orphanItemsTotal: orphanItems.length,
    orphanParentlessItemsTotal: orphanOrderRefs.length,
  };

  const outPath = join(__dirname, 'drift-deep-dive.json');
  writeFileSync(outPath, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${outPath}`);
  console.log('\nSummary:');
  console.log(`  >$10K drift orders: ${out.summary.bigDriftCount}  ${JSON.stringify(bigDriftBuckets)}`);
  console.log(`  No-item drift orders: ${out.summary.noItemDriftCount}  ${JSON.stringify(noItemBuckets)}`);
  console.log(`  Orphan OrderItem.productId: ${out.summary.orphanOrderItemProducts}`);
  console.log(`  Orphan OrderItem.orderId:   ${out.summary.orphanOrderItemOrders}`);
}

main().catch(e => { console.error(e); process.exit(1); });
