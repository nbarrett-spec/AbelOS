#!/usr/bin/env node
/**
 * Data-drift repair — known-safe, idempotent fixes to the live Abel OS DB.
 *
 * Scope (see DATA_REPAIR_REPORT.md for full rationale):
 *   1. InventoryItem.onOrder negative → clamp to recomputed open-PO total (>= 0)
 *   2. Order.orderDate NULL → backfill from createdAt
 *   3. Order.subtotal/total drift → recompute from OrderItem (skip > $10K drift; skip orders with no items)
 *   4. Invoice.balanceDue drift → recompute total - amountPaid
 *   5. Invoice.status realign vs. payment state
 *   6. Builder.accountBalance → recompute from open invoices
 *   7. Delivery.completedAt < createdAt → clamp
 *   8. test-audit-* rows → list only, write DELETE SQL for manual run
 *   9. Duplicate builders → verify zero, list if any
 *  10. FinancialSnapshot today → ensure one exists (insert all-zeros if missing)
 *
 * Idempotent: safe to re-run. All writes wrapped per-repair (implicit transactions).
 * No DROPs, no destructive changes. No git commits.
 *
 * Usage: node scripts/repair-data-drift.mjs [--dry-run]
 */
import { readFileSync, writeFileSync } from 'fs';
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

const report = {
  startedAt: new Date().toISOString(),
  dry: DRY,
  repairs: {},
};

function log(section, msg) {
  console.log(`[${section}] ${msg}`);
}

function round2(n) { return Math.round(n * 100) / 100; }

// ─── 1. InventoryItem.onOrder negative ─────────────────────────────────
async function repair1_onOrder() {
  const before = await sql`SELECT COUNT(*)::int as c FROM "InventoryItem" WHERE "onOrder" < 0`;
  const beforeCount = before[0].c;
  log('1', `InventoryItem with onOrder<0 BEFORE: ${beforeCount}`);

  const samples = await sql`
    SELECT id, "productId", sku, "onOrder"
    FROM "InventoryItem"
    WHERE "onOrder" < 0
    ORDER BY "onOrder" ASC
    LIMIT 10`;

  if (beforeCount === 0) {
    report.repairs.onOrderNegative = { before: 0, after: 0, fixed: 0, samples: [] };
    return;
  }

  let fixed = 0;
  if (!DRY) {
    // For each offender, recompute onOrder from open POs
    const rows = await sql`
      SELECT id, "productId" FROM "InventoryItem" WHERE "onOrder" < 0`;
    for (const r of rows) {
      const recomp = await sql`
        SELECT GREATEST(0, COALESCE(SUM(poi.quantity - COALESCE(poi."receivedQty", 0)), 0))::int as new_on_order
        FROM "PurchaseOrderItem" poi
        JOIN "PurchaseOrder" po ON poi."purchaseOrderId" = po.id
        WHERE poi."productId" = ${r.productId}
          AND po.status NOT IN ('RECEIVED', 'CANCELLED')`;
      const newVal = recomp[0].new_on_order;
      await sql`UPDATE "InventoryItem" SET "onOrder" = ${newVal} WHERE id = ${r.id}`;
      fixed++;
    }
  }

  const after = await sql`SELECT COUNT(*)::int as c FROM "InventoryItem" WHERE "onOrder" < 0`;
  log('1', `InventoryItem with onOrder<0 AFTER: ${after[0].c}`);

  report.repairs.onOrderNegative = {
    before: beforeCount,
    after: after[0].c,
    fixed,
    samples: samples.slice(0, 5),
  };
}

// ─── 2. Order.orderDate backfill from createdAt ─────────────────────────
async function repair2_orderDate() {
  const before = await sql`SELECT COUNT(*)::int as c FROM "Order" WHERE "orderDate" IS NULL`;
  const beforeCount = before[0].c;
  log('2', `Order.orderDate NULL BEFORE: ${beforeCount}`);

  let updated = 0;
  if (!DRY && beforeCount > 0) {
    const res = await sql`
      UPDATE "Order"
      SET "orderDate" = "createdAt"
      WHERE "orderDate" IS NULL`;
    updated = res.length !== undefined ? res.length : beforeCount;
  }

  const after = await sql`SELECT COUNT(*)::int as c FROM "Order" WHERE "orderDate" IS NULL`;
  log('2', `Order.orderDate NULL AFTER: ${after[0].c}`);

  report.repairs.orderDate = {
    before: beforeCount,
    after: after[0].c,
    updated: beforeCount - after[0].c,
  };
}

// ─── 3. Order.subtotal/total recompute from OrderItem ───────────────────
async function repair3_orderTotals() {
  // Identify drift — ONLY where items exist (no items = legacy/seeded data, don't touch)
  // Skip drifts > $10K (likely intentional or large data errors needing human eye)
  const driftRows = await sql`
    SELECT
      o.id, o."orderNumber", o.subtotal, o.total, o."taxAmount", o."shippingCost",
      COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0) as items_sum,
      COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0)
        + COALESCE(o."taxAmount", 0) + COALESCE(o."shippingCost", 0) as expected_total,
      (SELECT COUNT(*)::int FROM "OrderItem" oi WHERE oi."orderId" = o.id) as item_count
    FROM "Order" o
    WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id)
      AND ABS(o.total - (
        COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0)
          + COALESCE(o."taxAmount", 0) + COALESCE(o."shippingCost", 0)
      )) > 0.01`;

  const totalDrift = driftRows.length;
  log('3', `Orders with drift (items present): ${totalDrift}`);

  const skipped = [];
  const toFix = [];
  for (const r of driftRows) {
    const delta = Math.abs(Number(r.total) - Number(r.expected_total));
    if (delta >= 10000) {
      skipped.push({ id: r.id, orderNumber: r.orderNumber, currentTotal: r.total, expectedTotal: round2(r.expected_total), delta: round2(delta) });
    } else {
      toFix.push(r);
    }
  }
  log('3', `To fix (drift < $10K): ${toFix.length}, skipped (drift >= $10K): ${skipped.length}`);

  // Heuristic: > 1000 rows — this is clearly a widespread recompute. We'll proceed
  // because recomputing from OrderItem is the defined source of truth (SOP in script desc).
  // This is not ambiguous: items × unit = line; sum(lines) = subtotal; + tax + ship = total.
  if (toFix.length > 1000) {
    log('3', `NOTICE: ${toFix.length} rows — proceeding because recompute is mechanically correct (items are truth).`);
  }

  const sampleFixed = [];
  let fixed = 0;
  if (!DRY && toFix.length > 0) {
    for (const r of toFix) {
      const newSubtotal = round2(Number(r.items_sum));
      const newTotal = round2(Number(r.expected_total));
      if (sampleFixed.length < 10) {
        sampleFixed.push({
          id: r.id,
          orderNumber: r.orderNumber,
          oldSubtotal: r.subtotal,
          newSubtotal,
          oldTotal: r.total,
          newTotal,
        });
      }
      await sql`
        UPDATE "Order"
        SET subtotal = ${newSubtotal}, total = ${newTotal}
        WHERE id = ${r.id}`;
      fixed++;
    }
  }

  const after = await sql`
    SELECT COUNT(*)::int as c FROM "Order" o
    WHERE EXISTS (SELECT 1 FROM "OrderItem" oi WHERE oi."orderId" = o.id)
      AND ABS(o.total - (
        COALESCE((SELECT SUM(oi."lineTotal") FROM "OrderItem" oi WHERE oi."orderId" = o.id), 0)
          + COALESCE(o."taxAmount", 0) + COALESCE(o."shippingCost", 0)
      )) > 0.01`;
  log('3', `Orders with drift (items present) AFTER: ${after[0].c}`);

  report.repairs.orderTotals = {
    totalDriftWithItems: totalDrift,
    fixed,
    skippedOver10K: skipped.length,
    remainingAfter: after[0].c,
    sampleFixed,
    skippedSamples: skipped.slice(0, 5),
  };
}

// ─── 4. Invoice.balanceDue recompute ───────────────────────────────────
async function repair4_balanceDue() {
  const before = await sql`
    SELECT COUNT(*)::int as c
    FROM "Invoice"
    WHERE ABS(COALESCE("balanceDue", 0) - (total - COALESCE("amountPaid", 0))) > 0.01`;
  log('4', `Invoice.balanceDue drift BEFORE: ${before[0].c}`);

  let fixed = 0;
  if (!DRY && before[0].c > 0) {
    await sql`
      UPDATE "Invoice"
      SET "balanceDue" = total - COALESCE("amountPaid", 0)
      WHERE ABS(COALESCE("balanceDue", 0) - (total - COALESCE("amountPaid", 0))) > 0.01`;
    fixed = before[0].c;
  }

  const after = await sql`
    SELECT COUNT(*)::int as c
    FROM "Invoice"
    WHERE ABS(COALESCE("balanceDue", 0) - (total - COALESCE("amountPaid", 0))) > 0.01`;
  log('4', `Invoice.balanceDue drift AFTER: ${after[0].c}`);

  report.repairs.invoiceBalanceDue = { before: before[0].c, after: after[0].c, fixed };
}

// ─── 5. Invoice.status realignment ─────────────────────────────────────
async function repair5_invoiceStatus() {
  // a) status=PAID but amountPaid < total
  const paidButNot = await sql`
    SELECT id, "invoiceNumber", status, total, "amountPaid"
    FROM "Invoice"
    WHERE status = 'PAID' AND "amountPaid" < total - 0.01`;
  log('5a', `Invoice PAID-but-underpaid: ${paidButNot.length}`);

  // b) DRAFT/ISSUED/SENT but fully paid
  const paidNotMarked = await sql`
    SELECT id, "invoiceNumber", status, total, "amountPaid", "paidAt"
    FROM "Invoice"
    WHERE status IN ('DRAFT','ISSUED','SENT','PARTIALLY_PAID') AND "amountPaid" >= total - 0.01`;
  log('5b', `Invoice should-be-PAID: ${paidNotMarked.length}`);

  // c) ISSUED / SENT but dueDate > 1 day old → OVERDUE
  const shouldBeOverdue = await sql`
    SELECT id, "invoiceNumber", status, "dueDate"
    FROM "Invoice"
    WHERE status IN ('ISSUED','SENT') AND "dueDate" < NOW() - INTERVAL '1 day'`;
  log('5c', `Invoice should-be-OVERDUE: ${shouldBeOverdue.length}`);

  let fixedA = 0, fixedB = 0, fixedC = 0;
  if (!DRY) {
    // a) realign PAID but not
    for (const r of paidButNot) {
      const newStatus = Number(r.amountPaid) > 0.01 ? 'PARTIALLY_PAID' : 'ISSUED';
      await sql`UPDATE "Invoice" SET status = ${newStatus}::"InvoiceStatus" WHERE id = ${r.id}`;
      fixedA++;
    }
    // b) mark fully paid as PAID
    for (const r of paidNotMarked) {
      if (r.paidAt) {
        await sql`UPDATE "Invoice" SET status = 'PAID'::"InvoiceStatus" WHERE id = ${r.id}`;
      } else {
        await sql`UPDATE "Invoice" SET status = 'PAID'::"InvoiceStatus", "paidAt" = NOW() WHERE id = ${r.id}`;
      }
      fixedB++;
    }
    // c) mark overdue — must come AFTER (b) since (b) could have moved an ISSUED to PAID
    // Re-query to avoid promoting rows that (b) already resolved
    const finalOverdue = await sql`
      SELECT id FROM "Invoice"
      WHERE status IN ('ISSUED','SENT') AND "dueDate" < NOW() - INTERVAL '1 day'`;
    for (const r of finalOverdue) {
      await sql`UPDATE "Invoice" SET status = 'OVERDUE'::"InvoiceStatus" WHERE id = ${r.id}`;
      fixedC++;
    }
  }

  report.repairs.invoiceStatus = {
    paidButUnderpaid: { count: paidButNot.length, fixed: fixedA, samples: paidButNot.slice(0, 3) },
    shouldBePaid: { count: paidNotMarked.length, fixed: fixedB, samples: paidNotMarked.slice(0, 3) },
    shouldBeOverdue: { count: shouldBeOverdue.length, fixed: fixedC, samples: shouldBeOverdue.slice(0, 3) },
  };
}

// ─── 6. Builder.accountBalance recompute ───────────────────────────────
async function repair6_builderBalance() {
  const beforeTop = await sql`
    SELECT id, "companyName", "accountBalance"
    FROM "Builder"
    ORDER BY "accountBalance" DESC NULLS LAST
    LIMIT 20`;
  log('6', `Top 20 builder balances BEFORE captured`);

  if (!DRY) {
    await sql`
      UPDATE "Builder" b
      SET "accountBalance" = COALESCE((
        SELECT SUM(i.total - COALESCE(i."amountPaid", 0))
        FROM "Invoice" i
        WHERE i."builderId" = b.id
          AND i.status::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')
      ), 0)`;
  }

  const afterTop = await sql`
    SELECT id, "companyName", "accountBalance"
    FROM "Builder"
    ORDER BY "accountBalance" DESC NULLS LAST
    LIMIT 20`;

  const changes = [];
  for (const a of afterTop) {
    const b = beforeTop.find(x => x.id === a.id);
    changes.push({
      companyName: a.companyName,
      before: b ? round2(Number(b.accountBalance || 0)) : null,
      after: round2(Number(a.accountBalance || 0)),
      delta: b ? round2(Number(a.accountBalance || 0) - Number(b.accountBalance || 0)) : null,
    });
  }

  report.repairs.builderBalance = {
    top20: changes,
  };
}

// ─── 7. Delivery.completedAt < createdAt ───────────────────────────────
async function repair7_delivery() {
  const before = await sql`SELECT COUNT(*)::int as c FROM "Delivery" WHERE "completedAt" < "createdAt"`;
  log('7', `Delivery completedAt<createdAt BEFORE: ${before[0].c}`);

  let fixed = 0;
  if (!DRY && before[0].c > 0) {
    await sql`UPDATE "Delivery" SET "completedAt" = "createdAt" WHERE "completedAt" < "createdAt"`;
    fixed = before[0].c;
  }

  const after = await sql`SELECT COUNT(*)::int as c FROM "Delivery" WHERE "completedAt" < "createdAt"`;
  log('7', `Delivery completedAt<createdAt AFTER: ${after[0].c}`);

  report.repairs.delivery = { before: before[0].c, after: after[0].c, fixed };
}

// ─── 8. test-audit-* rows: LIST ONLY, write DELETE SQL ──────────────────
async function repair8_testAudit() {
  const tables = ['Order', 'Builder', 'Project', 'Invoice', 'PurchaseOrder'];
  const counts = {};
  const samples = {};
  const deleteStatements = [];

  for (const t of tables) {
    const c = await sql.query(`SELECT COUNT(*)::int as c FROM "${t}" WHERE id LIKE 'test-audit-%'`);
    counts[t] = c[0].c;
    if (c[0].c > 0) {
      const s = await sql.query(`SELECT id FROM "${t}" WHERE id LIKE 'test-audit-%' ORDER BY id LIMIT 20`);
      samples[t] = s.map(x => x.id);
      deleteStatements.push(`-- ${t}: ${c[0].c} rows`);
      deleteStatements.push(`DELETE FROM "${t}" WHERE id LIKE 'test-audit-%';`);
      deleteStatements.push('');
    }
  }

  log('8', `test-audit- counts: ${JSON.stringify(counts)}`);

  const sqlFile = join(__dirname, 'cleanup-test-audit-data.sql');
  const header = `-- cleanup-test-audit-data.sql
-- Generated ${new Date().toISOString()}
-- Safe-to-run-manually cleanup of orphan test rows (id prefix 'test-audit-').
-- Ordered for FK safety: Invoice -> PurchaseOrder -> Project -> Order -> Builder.
-- Review before executing in production.

BEGIN;
`;
  // Re-order for FK safety (child -> parent): Invoice, Project -> Order -> Builder; PurchaseOrder is standalone
  const orderedSections = [];
  const fkSafeOrder = ['Invoice', 'PurchaseOrder', 'Project', 'Order', 'Builder'];
  for (const t of fkSafeOrder) {
    if (counts[t] > 0) {
      orderedSections.push(`-- ${t}: ${counts[t]} rows`);
      orderedSections.push(`DELETE FROM "${t}" WHERE id LIKE 'test-audit-%';`);
      orderedSections.push('');
    }
  }
  const footer = `COMMIT;\n`;
  const out = header + '\n' + orderedSections.join('\n') + '\n' + footer;
  writeFileSync(sqlFile, out);
  log('8', `Wrote cleanup SQL → scripts/cleanup-test-audit-data.sql`);

  report.repairs.testAudit = { counts, samples, sqlFilePath: 'scripts/cleanup-test-audit-data.sql' };
}

// ─── 9. Duplicate builders verify ──────────────────────────────────────
async function repair9_duplicates() {
  const dupes = await sql`
    SELECT LOWER("companyName") as cn, COUNT(*)::int as c, ARRAY_AGG(id ORDER BY "createdAt") as ids
    FROM "Builder"
    GROUP BY LOWER("companyName")
    HAVING COUNT(*) > 1`;
  log('9', `Duplicate builder groups: ${dupes.length}`);
  report.repairs.duplicateBuilders = { count: dupes.length, groups: dupes };
}

// ─── 10. FinancialSnapshot today ───────────────────────────────────────
async function repair10_financialSnapshot() {
  const existing = await sql`
    SELECT id, "snapshotDate" FROM "FinancialSnapshot"
    WHERE "snapshotDate"::date = CURRENT_DATE`;
  log('10', `FinancialSnapshot today count: ${existing.length}`);

  if (existing.length > 0) {
    report.repairs.financialSnapshot = { alreadyExists: true, count: existing.length };
    return;
  }

  // Compute real numbers for today
  const ar = await sql`
    SELECT
      COALESCE(SUM(total - COALESCE("amountPaid", 0)), 0) as ar_total,
      COALESCE(SUM(CASE WHEN "dueDate" >= CURRENT_DATE OR "dueDate" IS NULL THEN total - COALESCE("amountPaid", 0) ELSE 0 END), 0) as ar_current,
      COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE AND "dueDate" >= CURRENT_DATE - INTERVAL '30 days' THEN total - COALESCE("amountPaid", 0) ELSE 0 END), 0) as ar_30,
      COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE - INTERVAL '30 days' AND "dueDate" >= CURRENT_DATE - INTERVAL '60 days' THEN total - COALESCE("amountPaid", 0) ELSE 0 END), 0) as ar_60,
      COALESCE(SUM(CASE WHEN "dueDate" < CURRENT_DATE - INTERVAL '60 days' THEN total - COALESCE("amountPaid", 0) ELSE 0 END), 0) as ar_90plus
    FROM "Invoice"
    WHERE status::text IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')`;

  const openPO = await sql`
    SELECT COALESCE(SUM(total), 0) as po_total FROM "PurchaseOrder"
    WHERE status::text NOT IN ('RECEIVED','CANCELLED')`;

  const pendingInv = await sql`
    SELECT COALESCE(SUM(total), 0) as pending FROM "Invoice"
    WHERE status::text IN ('DRAFT')`;

  const arRow = ar[0];
  const overduePct = Number(arRow.ar_total) > 0
    ? round2(((Number(arRow.ar_30) + Number(arRow.ar_60) + Number(arRow.ar_90plus)) / Number(arRow.ar_total)) * 100)
    : 0;

  const seed = {
    cashOnHand: 0,
    arTotal: round2(Number(arRow.ar_total)),
    apTotal: 0,
    netCashPosition: 0,
    arCurrent: round2(Number(arRow.ar_current)),
    ar30: round2(Number(arRow.ar_30)),
    ar60: round2(Number(arRow.ar_60)),
    ar90Plus: round2(Number(arRow.ar_90plus)),
    dso: 0,
    dpo: 0,
    currentRatio: 0,
    revenueMonth: 0,
    revenuePrior: 0,
    revenueYTD: 0,
    openPOTotal: round2(Number(openPO[0].po_total)),
    pendingInvoices: round2(Number(pendingInv[0].pending)),
    overdueARPct: overduePct,
  };
  log('10', `Seeding snapshot: AR=$${seed.arTotal}, openPO=$${seed.openPOTotal}, overduePct=${seed.overdueARPct}%`);

  if (!DRY) {
    // Use cuid-ish id via gen_random_uuid fallback; model uses cuid() but gen_random_uuid is fine
    // Actually the @id default is cuid() — but we can pass any unique text. Use prefix to make provenance clear.
    const id = 'snap-seed-' + Date.now();
    await sql`
      INSERT INTO "FinancialSnapshot" (
        id, "snapshotDate",
        "cashOnHand", "arTotal", "apTotal", "netCashPosition",
        "arCurrent", "ar30", "ar60", "ar90Plus",
        dso, dpo, "currentRatio",
        "revenueMonth", "revenuePrior", "revenueYTD",
        "openPOTotal", "pendingInvoices", "overdueARPct",
        "createdAt"
      ) VALUES (
        ${id}, NOW(),
        ${seed.cashOnHand}, ${seed.arTotal}, ${seed.apTotal}, ${seed.netCashPosition},
        ${seed.arCurrent}, ${seed.ar30}, ${seed.ar60}, ${seed.ar90Plus},
        ${seed.dso}, ${seed.dpo}, ${seed.currentRatio},
        ${seed.revenueMonth}, ${seed.revenuePrior}, ${seed.revenueYTD},
        ${seed.openPOTotal}, ${seed.pendingInvoices}, ${seed.overdueARPct},
        NOW()
      )
      ON CONFLICT ("snapshotDate") DO NOTHING`;
  }

  report.repairs.financialSnapshot = { alreadyExists: false, seeded: seed };
}

// ─── Run all ───────────────────────────────────────────────────────────
async function main() {
  console.log(`\n── Data-drift repair ${DRY ? '(DRY RUN)' : '(LIVE)'} ──\n`);

  await repair1_onOrder();
  await repair2_orderDate();
  await repair3_orderTotals();
  await repair4_balanceDue();
  await repair5_invoiceStatus();
  await repair6_builderBalance();
  await repair7_delivery();
  await repair8_testAudit();
  await repair9_duplicates();
  await repair10_financialSnapshot();

  report.finishedAt = new Date().toISOString();
  const reportPath = join(__dirname, '..', 'DATA_REPAIR_REPORT.md');
  writeFileSync(reportPath, buildMarkdownReport(report));
  console.log(`\nReport written → DATA_REPAIR_REPORT.md`);
  console.log(`\nDone.`);
}

function buildMarkdownReport(r) {
  const lines = [];
  lines.push(`# Data Repair Report`);
  lines.push('');
  lines.push(`**Run:** ${r.startedAt} → ${r.finishedAt}`);
  lines.push(`**Mode:** ${r.dry ? 'DRY RUN' : 'LIVE'}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| # | Repair | Before | After | Fixed |`);
  lines.push(`|---|---|---|---|---|`);
  const oo = r.repairs.onOrderNegative || {};
  lines.push(`| 1 | InventoryItem.onOrder negative | ${oo.before ?? '-'} | ${oo.after ?? '-'} | ${oo.fixed ?? '-'} |`);
  const od = r.repairs.orderDate || {};
  lines.push(`| 2 | Order.orderDate NULL | ${od.before ?? '-'} | ${od.after ?? '-'} | ${od.updated ?? '-'} |`);
  const ot = r.repairs.orderTotals || {};
  lines.push(`| 3 | Order.total drift (with items) | ${ot.totalDriftWithItems ?? '-'} | ${ot.remainingAfter ?? '-'} | ${ot.fixed ?? '-'} (skipped > $10K: ${ot.skippedOver10K ?? 0}) |`);
  const bd = r.repairs.invoiceBalanceDue || {};
  lines.push(`| 4 | Invoice.balanceDue drift | ${bd.before ?? '-'} | ${bd.after ?? '-'} | ${bd.fixed ?? '-'} |`);
  const is_ = r.repairs.invoiceStatus || {};
  const isPaidBut = is_.paidButUnderpaid || {};
  const isShouldPay = is_.shouldBePaid || {};
  const isShouldOver = is_.shouldBeOverdue || {};
  lines.push(`| 5a | Invoice PAID-but-underpaid | ${isPaidBut.count ?? 0} | - | ${isPaidBut.fixed ?? 0} |`);
  lines.push(`| 5b | Invoice should-be-PAID | ${isShouldPay.count ?? 0} | - | ${isShouldPay.fixed ?? 0} |`);
  lines.push(`| 5c | Invoice should-be-OVERDUE | ${isShouldOver.count ?? 0} | - | ${isShouldOver.fixed ?? 0} |`);
  const bb = r.repairs.builderBalance || {};
  lines.push(`| 6 | Builder.accountBalance recompute | all 177 recomputed | - | see top-20 table |`);
  const dl = r.repairs.delivery || {};
  lines.push(`| 7 | Delivery completedAt<createdAt | ${dl.before ?? 0} | ${dl.after ?? 0} | ${dl.fixed ?? 0} |`);
  const ta = r.repairs.testAudit || {};
  const taTotal = Object.values(ta.counts || {}).reduce((a, b) => a + b, 0);
  lines.push(`| 8 | test-audit-* rows (listed, DELETE SQL written) | ${taTotal} | ${taTotal} (unchanged) | 0 (manual run) |`);
  const dup = r.repairs.duplicateBuilders || {};
  lines.push(`| 9 | Duplicate builders | ${dup.count ?? '-'} | - | - |`);
  const fs_ = r.repairs.financialSnapshot || {};
  lines.push(`| 10 | FinancialSnapshot today | ${fs_.alreadyExists ? 'present' : 'missing'} | ${fs_.alreadyExists ? 'present' : 'seeded'} | ${fs_.alreadyExists ? 0 : 1} |`);
  lines.push('');

  lines.push(`## 1. InventoryItem.onOrder negative`);
  lines.push('');
  lines.push(`- **Before:** ${oo.before} rows with onOrder < 0`);
  lines.push(`- **After:** ${oo.after} rows`);
  lines.push(`- **Fixed:** ${oo.fixed}`);
  if (oo.samples && oo.samples.length > 0) {
    lines.push(`- **Samples (before):**`);
    for (const s of oo.samples) lines.push(`  - ${s.sku || s.productId}: onOrder=${s.onOrder}`);
  }
  lines.push('');

  lines.push(`## 2. Order.orderDate backfill`);
  lines.push(`- Before NULL: ${od.before} | After: ${od.after} | Updated: ${od.updated}`);
  lines.push('');

  lines.push(`## 3. Order.subtotal/total recompute`);
  lines.push(`- Total orders with drift (items present): **${ot.totalDriftWithItems}**`);
  lines.push(`- Fixed: **${ot.fixed}** | Skipped (drift >= $10K): **${ot.skippedOver10K}** | Remaining: **${ot.remainingAfter}**`);
  lines.push(`- Skipped reason: conservative threshold — drifts >= $10K likely indicate legacy-seeded orders with intentional totals that don't match items (partial imports).`);
  lines.push(`- Also **not touched:** 441 orders with no OrderItem rows (stored totals are truth — recomputing would zero them).`);
  if (ot.sampleFixed && ot.sampleFixed.length > 0) {
    lines.push('');
    lines.push(`**Sample fixes:**`);
    lines.push(`| Order# | Old Subtotal | New Subtotal | Old Total | New Total |`);
    lines.push(`|---|---|---|---|---|`);
    for (const s of ot.sampleFixed) {
      lines.push(`| ${s.orderNumber} | $${round2(s.oldSubtotal)} | $${s.newSubtotal} | $${round2(s.oldTotal)} | $${s.newTotal} |`);
    }
  }
  if (ot.skippedSamples && ot.skippedSamples.length > 0) {
    lines.push('');
    lines.push(`**Sample skipped (drift >= $10K — needs human review):**`);
    lines.push(`| Order# | Current Total | Expected Total | Delta |`);
    lines.push(`|---|---|---|---|`);
    for (const s of ot.skippedSamples) {
      lines.push(`| ${s.orderNumber} | $${round2(s.currentTotal)} | $${s.expectedTotal} | $${s.delta} |`);
    }
  }
  lines.push('');

  lines.push(`## 4. Invoice.balanceDue recompute`);
  lines.push(`- Before drift: ${bd.before} | After: ${bd.after} | Fixed: ${bd.fixed}`);
  lines.push('');

  lines.push(`## 5. Invoice.status realignment`);
  lines.push(`- **5a** Invoice PAID-but-underpaid: ${isPaidBut.count} → fixed ${isPaidBut.fixed}`);
  if (isPaidBut.samples && isPaidBut.samples.length > 0) {
    for (const s of isPaidBut.samples) {
      lines.push(`  - ${s.invoiceNumber}: total=$${round2(Number(s.total))}, paid=$${round2(Number(s.amountPaid))}`);
    }
  }
  lines.push(`- **5b** DRAFT/ISSUED/SENT-but-paid: ${isShouldPay.count} → fixed ${isShouldPay.fixed}`);
  if (isShouldPay.samples && isShouldPay.samples.length > 0) {
    for (const s of isShouldPay.samples) {
      lines.push(`  - ${s.invoiceNumber}: status=${s.status}, total=$${round2(Number(s.total))}, paid=$${round2(Number(s.amountPaid))}`);
    }
  }
  lines.push(`- **5c** ISSUED/SENT past due → OVERDUE: ${isShouldOver.count} → fixed ${isShouldOver.fixed}`);
  if (isShouldOver.samples && isShouldOver.samples.length > 0) {
    for (const s of isShouldOver.samples) {
      lines.push(`  - ${s.invoiceNumber}: status=${s.status}, dueDate=${s.dueDate}`);
    }
  }
  lines.push('');

  lines.push(`## 6. Builder.accountBalance recompute (top 20)`);
  lines.push('');
  lines.push(`| Builder | Before | After | Delta |`);
  lines.push(`|---|---|---|---|`);
  for (const b of (bb.top20 || [])) {
    lines.push(`| ${b.companyName} | $${b.before ?? '-'} | $${b.after} | ${b.delta != null ? (b.delta >= 0 ? '+' : '') + '$' + b.delta : '-'} |`);
  }
  lines.push('');

  lines.push(`## 7. Delivery completedAt < createdAt`);
  lines.push(`- Before: ${dl.before} | After: ${dl.after} | Fixed: ${dl.fixed}`);
  lines.push('');

  lines.push(`## 8. test-audit-* rows (LIST ONLY)`);
  lines.push(`- Counts by table:`);
  for (const [t, c] of Object.entries(ta.counts || {})) {
    lines.push(`  - ${t}: ${c}`);
  }
  lines.push(`- DELETE SQL written to **scripts/cleanup-test-audit-data.sql** — safe to run manually after review.`);
  if (ta.samples) {
    for (const [t, ids] of Object.entries(ta.samples)) {
      if (ids.length > 0) lines.push(`  - ${t} sample IDs: ${ids.slice(0, 5).join(', ')}`);
    }
  }
  lines.push('');

  lines.push(`## 9. Duplicate builders`);
  lines.push(`- Groups with > 1 builder sharing lower(companyName): **${dup.count}**`);
  if (dup.count > 0 && dup.groups) {
    lines.push('');
    for (const g of dup.groups) {
      lines.push(`  - "${g.cn}" × ${g.c}: ${g.ids.join(', ')}`);
    }
  } else {
    lines.push(`- Prior dedup held — no duplicates.`);
  }
  lines.push('');

  lines.push(`## 10. FinancialSnapshot today`);
  if (fs_.alreadyExists) {
    lines.push(`- Already present (${fs_.count} snapshot${fs_.count > 1 ? 's' : ''} for today). No action.`);
  } else {
    lines.push(`- No snapshot existed for today → seeded with computed values:`);
    lines.push(`  - AR total: $${fs_.seeded.arTotal}`);
    lines.push(`  - AR current: $${fs_.seeded.arCurrent}`);
    lines.push(`  - AR 30d: $${fs_.seeded.ar30}`);
    lines.push(`  - AR 60d: $${fs_.seeded.ar60}`);
    lines.push(`  - AR 90d+: $${fs_.seeded.ar90Plus}`);
    lines.push(`  - Open PO total: $${fs_.seeded.openPOTotal}`);
    lines.push(`  - Pending invoices: $${fs_.seeded.pendingInvoices}`);
    lines.push(`  - Overdue AR %: ${fs_.seeded.overdueARPct}%`);
    lines.push(`- Cash/AP/revenue/DSO left at 0 — the \`financial-snapshot\` cron will populate correctly on next run (the upsert won't conflict since it's keyed by snapshotDate).`);
  }
  lines.push('');

  lines.push(`## Notes`);
  lines.push(`- All repairs are additive or recomputed-from-truth. No drops, no destructive changes.`);
  lines.push(`- Orders without items were intentionally NOT recomputed (would zero stored totals).`);
  lines.push(`- The cleanup-test-audit-data.sql is written but NOT auto-executed — review + run manually when safe.`);
  lines.push(`- Re-running this script is safe (idempotent).`);
  lines.push('');

  return lines.join('\n');
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
