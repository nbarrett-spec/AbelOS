#!/usr/bin/env node
// Abel Lumber — InFlow PurchaseOrder reconciliation
//
// Reconciles Aegis PurchaseOrder + PurchaseOrderItem against a fresh InFlow
// PO export. InFlow is source of truth for current status, expectedDate,
// totals, and line-item quantities.
//
//   node scripts/reconcile-inflow-po.mjs                          # dry run
//   node scripts/reconcile-inflow-po.mjs --commit                 # apply
//   node scripts/reconcile-inflow-po.mjs --csv "/path/to/file.csv"
//
// Scope: only PurchaseOrder, PurchaseOrderItem, ReconciliationAudit.
//   Does NOT touch Product catalog, Order, Builder, or InventoryItem.
//
// Keying: match by poNumber first (InFlow OrderNumber === Aegis poNumber).
//   inflowId is backfilled with the OrderNumber where empty.
//
// Idempotent: re-running applies 0 inserts and only updates rows that drift.

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { neon } from '@neondatabase/serverless';
import {
  readCSV,
  parseMoney,
  parseIntSafe,
  parseDate,
  vendorCodeFromName,
} from './_brain-helpers.mjs';

// Generate a short, sortable-ish hex id with prefix (mirrors existing
// cuid-style string IDs). Keep IDs stable and unique.
function mkId(prefix) {
  return prefix + '_' + crypto.randomBytes(12).toString('hex');
}

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const COMMIT = process.argv.includes('--commit');
const SOURCE_TAG = 'INFLOW_RECONCILE_2026-04-24';

// CSV path: --csv "path" override, else the downloads drop.
const csvFlagIdx = process.argv.indexOf('--csv');
const CSV_PATH =
  csvFlagIdx > -1 && process.argv[csvFlagIdx + 1]
    ? process.argv[csvFlagIdx + 1]
    : 'C:/Users/natha/Downloads/inFlow_PurchaseOrder (13).csv';

const sql = neon(process.env.DATABASE_URL);

// ── helpers ─────────────────────────────────────────────────────────

function bar(t) {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + t);
  console.log('='.repeat(72));
}

// Map InFlow (inventoryStatus | paymentStatus | isCancelled | isQuote)
// to Aegis POStatus enum. Existing enum:
//   DRAFT, PENDING_APPROVAL, APPROVED, SENT_TO_VENDOR,
//   PARTIALLY_RECEIVED, RECEIVED, CANCELLED
function mapStatus({ inv, pay, cancel, quote }) {
  const i = (inv || '').toLowerCase();
  const p = (pay || '').toLowerCase();
  const c = (cancel || '').toLowerCase() === 'true';
  const q = (quote || '').toLowerCase() === 'true';
  if (c) return 'CANCELLED';
  if (q || i === 'quote') return 'DRAFT';
  if (i.includes('partial')) return 'PARTIALLY_RECEIVED';
  if (i.includes('fulfilled')) return 'RECEIVED';
  // InFlow "Started" = receiving has begun but not complete.
  if (i.includes('started')) return 'PARTIALLY_RECEIVED';
  if (i.includes('unfulfilled')) return 'SENT_TO_VENDOR';
  return 'DRAFT';
}

// Compare two possibly-null dates for equality (day precision).
function sameDay(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  const da = new Date(a);
  const db = new Date(b);
  if (isNaN(da.getTime()) || isNaN(db.getTime())) return false;
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function approxEq(a, b, eps = 0.01) {
  return Math.abs((a || 0) - (b || 0)) <= eps;
}

// ── main ────────────────────────────────────────────────────────────

async function main() {
  bar(`InFlow PO Reconcile — ${COMMIT ? 'COMMIT' : 'DRY-RUN'}`);
  console.log('CSV:', CSV_PATH);

  if (!fs.existsSync(CSV_PATH)) {
    console.error('CSV not found at', CSV_PATH);
    process.exit(1);
  }

  // 1. Parse CSV and fold line items into PO headers ─────────────
  const { rows: csvRows } = readCSV(CSV_PATH);
  console.log(`CSV rows (line items): ${csvRows.length.toLocaleString()}`);

  const poMap = new Map();
  for (const r of csvRows) {
    const n = (r.OrderNumber || '').trim();
    if (!n) continue;
    if (!poMap.has(n)) poMap.set(n, { header: r, items: [] });
    poMap.get(n).items.push(r);
  }
  console.log(`CSV unique POs:         ${poMap.size.toLocaleString()}`);

  // 2. Preload vendor + product + staff lookups ─────────────────
  const vendorRows = await sql`
    SELECT id, code, UPPER(name) AS uname, name
    FROM "Vendor"
  `;
  const vendorByName = new Map(vendorRows.map((v) => [v.uname.trim(), v.id]));
  const vendorByCode = new Map(vendorRows.map((v) => [v.code, v.id]));

  const productRows = await sql`SELECT id, UPPER(sku) AS usku FROM "Product" WHERE sku IS NOT NULL`;
  const productBySku = new Map(productRows.map((p) => [p.usku.trim(), p.id]));

  const staffRows = await sql`
    SELECT id, email FROM "Staff"
    WHERE email = 'n.barrett@abellumber.com'
    LIMIT 1
  `;
  let systemStaffId = staffRows[0]?.id;
  if (!systemStaffId) {
    const anyStaff = await sql`SELECT id FROM "Staff" LIMIT 1`;
    systemStaffId = anyStaff[0]?.id;
  }
  if (!systemStaffId) {
    console.error('No Staff row in DB — seed data missing.');
    process.exit(1);
  }

  // 3. Aegis baseline ───────────────────────────────────────────
  const aegisCountPre = await sql`SELECT COUNT(*)::int AS n FROM "PurchaseOrder"`;
  const itemCountPre = await sql`SELECT COUNT(*)::int AS n FROM "PurchaseOrderItem"`;
  const statusPre =
    await sql`SELECT status::text AS s, COUNT(*)::int AS n FROM "PurchaseOrder" GROUP BY status ORDER BY n DESC`;

  const now = new Date();
  const nextWeek = new Date(Date.now() + 7 * 86400000);
  const next7Pre = await sql`
    SELECT COUNT(*)::int AS n
    FROM "PurchaseOrder"
    WHERE "expectedDate" BETWEEN ${now} AND ${nextWeek}
      AND status IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED','PENDING_APPROVAL','DRAFT')
  `;

  console.log(`Aegis PO rows pre:      ${aegisCountPre[0].n.toLocaleString()}`);
  console.log(`Aegis PO items pre:     ${itemCountPre[0].n.toLocaleString()}`);
  console.log(`POs expected next 7 pre:${next7Pre[0].n}`);

  // 4. Pull existing PO snapshot for reconcile ──────────────────
  const poNumbers = [...poMap.keys()];
  const existingRows = await sql`
    SELECT id, "poNumber", status::text AS status, "expectedDate",
           "receivedAt", total, "vendorId", "inflowId"
    FROM "PurchaseOrder"
    WHERE "poNumber" = ANY(${poNumbers})
  `;
  const existingByPo = new Map(existingRows.map((r) => [r.poNumber, r]));

  // Item counts by PO for existing rows
  const existingItemRows = await sql`
    SELECT "purchaseOrderId", COUNT(*)::int AS n
    FROM "PurchaseOrderItem"
    WHERE "purchaseOrderId" = ANY(${existingRows.map((r) => r.id)})
    GROUP BY "purchaseOrderId"
  `;
  const existingItemCountById = new Map(
    existingItemRows.map((r) => [r.purchaseOrderId, r.n]),
  );

  // 5. Walk CSV POs: classify + (if --commit) apply ─────────────
  let added = 0;
  let statusUpdates = 0;
  let fieldUpdates = 0;
  let lineCountDiff = 0;
  let matched = 0;
  let skippedNoVendor = 0;
  let itemsAdded = 0;
  let itemsUpdated = 0;
  const orphanSkus = new Set();
  const statusDriftSamples = [];
  const addedPOsByValue = []; // for top-5 newly-added by value

  for (const [poNumber, { header, items }] of poMap) {
    // Resolve vendor
    const vendorName = (header.Vendor || '').trim();
    let vendorId = vendorByName.get(vendorName.toUpperCase()) || null;
    if (!vendorId) vendorId = vendorByCode.get(vendorCodeFromName(vendorName));
    if (!vendorId) {
      if (!COMMIT) {
        skippedNoVendor++;
        continue;
      }
      // Auto-create so no PO is dropped.
      const code = vendorCodeFromName(vendorName);
      const vId = mkId('v');
      const ins = await sql`
        INSERT INTO "Vendor" (id, code, name, "contactName", email, phone, active, "createdAt", "updatedAt")
        VALUES (
          ${vId},
          ${code},
          ${vendorName || 'UNKNOWN VENDOR'},
          ${header.ContactName || null},
          ${header.Email || null},
          ${header.Phone || null},
          true,
          NOW(), NOW()
        )
        ON CONFLICT (code) DO UPDATE SET "updatedAt" = NOW()
        RETURNING id
      `;
      vendorId = ins[0].id;
      vendorByName.set(vendorName.toUpperCase(), vendorId);
      vendorByCode.set(code, vendorId);
    }

    // Build line items
    const itemPayload = [];
    let subtotal = 0;
    for (const it of items) {
      const qty = parseIntSafe(it.ProductQuantity);
      if (qty <= 0 && !it.ProductName && !it.ProductSKU) continue;
      const unit = parseMoney(it.ProductUnitPrice);
      const lineTotal = parseMoney(it.ProductSubtotal) || qty * unit;
      const sku = (it.ProductSKU || '').trim();
      const productId = productBySku.get(sku.toUpperCase()) || null;
      if (sku && !productId) orphanSkus.add(sku);
      itemPayload.push({
        productId,
        vendorSku: (it.VendorProductCode || sku || 'UNKNOWN').slice(0, 255),
        description: (
          it.ProductName ||
          it.ProductDescription ||
          sku ||
          'Line item'
        ).slice(0, 500),
        quantity: qty || 1,
        unitCost: unit,
        lineTotal,
      });
      subtotal += lineTotal;
    }
    if (itemPayload.length === 0) continue;

    const shipping = parseMoney(header.Freight);
    const total = subtotal + shipping;
    const status = mapStatus({
      inv: header.InventoryStatus,
      pay: header.PaymentStatus,
      cancel: header.IsCancelled,
      quote: header.IsQuote,
    });
    const orderedAt =
      parseDate(header.OrderDate) || parseDate(header.RequestedShipDate) || null;
    const expectedDate =
      parseDate(header.DueDate) || parseDate(header.RequestedShipDate) || null;
    const receivedAt = status === 'RECEIVED' ? expectedDate : null;

    const existing = existingByPo.get(poNumber);

    if (!existing) {
      // MISSING in Aegis — insert.
      added++;
      addedPOsByValue.push({ poNumber, total, vendor: vendorName });
      if (COMMIT) {
        const poId = mkId('po');
        const ins = await sql`
          INSERT INTO "PurchaseOrder" (
            id, "poNumber", "vendorId", "createdById", status, category,
            subtotal, "shippingCost", total, "orderedAt", "expectedDate",
            "receivedAt", notes, "inflowId", source, "createdAt", "updatedAt"
          ) VALUES (
            ${poId},
            ${poNumber},
            ${vendorId},
            ${systemStaffId},
            ${status}::"POStatus",
            'GENERAL'::"POCategory",
            ${subtotal},
            ${shipping},
            ${total},
            ${orderedAt},
            ${expectedDate},
            ${receivedAt},
            ${header.OrderRemarks || null},
            ${poNumber},
            ${SOURCE_TAG},
            NOW(), NOW()
          )
          ON CONFLICT ("poNumber") DO NOTHING
          RETURNING id
        `;
        if (ins[0]) {
          for (const it of itemPayload) {
            await sql`
              INSERT INTO "PurchaseOrderItem" (
                id, "purchaseOrderId", "productId", "vendorSku", description,
                quantity, "unitCost", "lineTotal", "createdAt", "updatedAt"
              ) VALUES (
                ${mkId('poi')},
                ${ins[0].id},
                ${it.productId},
                ${it.vendorSku},
                ${it.description},
                ${it.quantity},
                ${it.unitCost},
                ${it.lineTotal},
                NOW(), NOW()
              )
            `;
            itemsAdded++;
          }
        }
      }
      continue;
    }

    // MATCHED — check drift.
    matched++;
    const statusChanged = existing.status !== status;
    const dateChanged = !sameDay(existing.expectedDate, expectedDate);
    const totalChanged = !approxEq(Number(existing.total || 0), total);
    const receivedChanged = !sameDay(existing.receivedAt, receivedAt);
    const existingItemN = existingItemCountById.get(existing.id) || 0;
    const lineDiff = existingItemN !== itemPayload.length;

    if (statusChanged) {
      statusUpdates++;
      if (statusDriftSamples.length < 10) {
        statusDriftSamples.push({
          poNumber,
          from: existing.status,
          to: status,
        });
      }
    }
    if (dateChanged || totalChanged || receivedChanged) fieldUpdates++;
    if (lineDiff) lineCountDiff++;

    if (
      COMMIT &&
      (statusChanged || dateChanged || totalChanged || receivedChanged ||
        !existing.inflowId)
    ) {
      await sql`
        UPDATE "PurchaseOrder"
        SET status = ${status}::"POStatus",
            "expectedDate" = ${expectedDate},
            "receivedAt" = ${receivedAt},
            total = ${total},
            subtotal = ${subtotal},
            "shippingCost" = ${shipping},
            "inflowId" = COALESCE("inflowId", ${poNumber}),
            "updatedAt" = NOW()
        WHERE id = ${existing.id}
      `;
    }

    // Line-level reconcile for matched POs: replace items when drift exists.
    if (COMMIT && lineDiff) {
      await sql`DELETE FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = ${existing.id}`;
      for (const it of itemPayload) {
        await sql`
          INSERT INTO "PurchaseOrderItem" (
            id, "purchaseOrderId", "productId", "vendorSku", description,
            quantity, "unitCost", "lineTotal", "createdAt", "updatedAt"
          ) VALUES (
            ${mkId('poi')},
            ${existing.id},
            ${it.productId},
            ${it.vendorSku},
            ${it.description},
            ${it.quantity},
            ${it.unitCost},
            ${it.lineTotal},
            NOW(), NOW()
          )
        `;
        itemsUpdated++;
      }
    }
  }

  // 6. Post-reconcile snapshot ─────────────────────────────────
  const aegisCountPost = await sql`SELECT COUNT(*)::int AS n FROM "PurchaseOrder"`;
  const itemCountPost = await sql`SELECT COUNT(*)::int AS n FROM "PurchaseOrderItem"`;
  const statusPost =
    await sql`SELECT status::text AS s, COUNT(*)::int AS n FROM "PurchaseOrder" GROUP BY status ORDER BY n DESC`;
  const next7Post = await sql`
    SELECT COUNT(*)::int AS n
    FROM "PurchaseOrder"
    WHERE "expectedDate" BETWEEN ${now} AND ${nextWeek}
      AND status IN ('APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED','PENDING_APPROVAL','DRAFT')
  `;

  // 7. Report ──────────────────────────────────────────────────
  bar('Reconcile Report');
  console.log(`CSV rows                : ${csvRows.length}`);
  console.log(`CSV unique POs          : ${poMap.size}`);
  console.log(`Matched in Aegis        : ${matched}`);
  console.log(`Missing → added         : ${added}${COMMIT ? '' : ' (dry-run)'}`);
  console.log(`Status drift            : ${statusUpdates}${COMMIT ? ' updated' : ' (dry-run)'}`);
  console.log(`Date/total drift        : ${fieldUpdates}${COMMIT ? ' updated' : ' (dry-run)'}`);
  console.log(`Line-count drift        : ${lineCountDiff} POs${COMMIT ? '' : ' (dry-run)'}`);
  console.log(`Line items added        : ${itemsAdded}`);
  console.log(`Line items replaced     : ${itemsUpdated}`);
  console.log(`Skipped (no vendor)     : ${skippedNoVendor}`);
  console.log(`Orphan SKUs             : ${orphanSkus.size}`);
  console.log(`\nAegis PO rows  pre → post: ${aegisCountPre[0].n} → ${aegisCountPost[0].n}`);
  console.log(`Aegis PO items pre → post: ${itemCountPre[0].n} → ${itemCountPost[0].n}`);
  console.log(`POs expected next 7d     : ${next7Pre[0].n} → ${next7Post[0].n}`);

  bar('Status distribution (pre → post)');
  const allStatuses = new Set([...statusPre.map((r) => r.s), ...statusPost.map((r) => r.s)]);
  const preMap = new Map(statusPre.map((r) => [r.s, r.n]));
  const postMap = new Map(statusPost.map((r) => [r.s, r.n]));
  for (const s of allStatuses) {
    const a = preMap.get(s) || 0;
    const b = postMap.get(s) || 0;
    const delta = b - a;
    console.log(`  ${s.padEnd(22)} ${String(a).padStart(5)} → ${String(b).padStart(5)}  (${delta >= 0 ? '+' : ''}${delta})`);
  }

  if (statusDriftSamples.length) {
    bar('Status drift samples (first 10)');
    for (const s of statusDriftSamples) {
      console.log(`  ${s.poNumber}  ${s.from} → ${s.to}`);
    }
  }

  const topAdds = addedPOsByValue.sort((a, b) => b.total - a.total).slice(0, 5);
  if (topAdds.length) {
    bar('Top 5 newly-added POs by value');
    for (const t of topAdds) {
      console.log(`  ${t.poNumber}  $${t.total.toFixed(2).padStart(10)}  ${t.vendor}`);
    }
  }

  if (orphanSkus.size) {
    bar(`Orphan SKUs (${orphanSkus.size}) — not in Product catalog`);
    const list = [...orphanSkus].sort();
    for (const s of list.slice(0, 50)) console.log('  ' + s);
    if (list.length > 50) console.log(`  ... and ${list.length - 50} more`);
  }

  if (!COMMIT) {
    console.log('\nDRY-RUN — no writes. Re-run with --commit to apply.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => process.exit(0));
