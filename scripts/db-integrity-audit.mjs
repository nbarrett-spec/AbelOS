/**
 * db-integrity-audit.mjs — EXHAUSTIVE data integrity audit, READ-ONLY.
 *
 * Runs a battery of checks against the live Neon DB and emits findings
 * as JSON (stdout + scripts/db-integrity-audit-findings.json) and as a
 * markdown report (DATA_INTEGRITY_REPORT.md at repo root).
 *
 * Finding shape:
 *   { severity: 'P0'|'P1'|'P2', category, table, count, sample, description, impact, fix_sql }
 *
 * Ground rules:
 *   - NO mutations. No DDL. No writes. Only SELECT queries.
 *   - Uses raw SQL via @neondatabase/serverless (no Prisma client).
 *   - Uses the live schema column names (probed prior to writing the script).
 *
 * Usage:
 *   node scripts/db-integrity-audit.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

// ── Parse DATABASE_URL from .env ────────────────────────────────────
const envPath = path.join(repoRoot, '.env');
const envText = readFileSync(envPath, 'utf8');
const dbLine = envText.split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL'));
if (!dbLine) {
  console.error('DATABASE_URL not found in .env');
  process.exit(1);
}
const DATABASE_URL = dbLine.replace(/^DATABASE_URL\s*=\s*/, '').replace(/^"|"$/g, '').trim();
const sql = neon(DATABASE_URL);

// ── Finding collector ───────────────────────────────────────────────
const findings = [];
let rowsScanned = 0;

function addFinding(f) {
  findings.push({
    severity: f.severity,
    category: f.category,
    table: f.table || null,
    count: Number(f.count ?? 0),
    sample: f.sample ?? [],
    description: f.description,
    impact: f.impact || '',
    fix_sql: f.fix_sql || null,
  });
}

async function count(q) {
  const rows = await sql.query(q);
  const n = Number(rows[0]?.n ?? rows[0]?.count ?? 0);
  rowsScanned += n;
  return n;
}

async function first(q, limit = 5) {
  const rows = await sql.query(q);
  return rows.slice(0, limit).map((r) => r.id);
}

/**
 * Run a "finding" query the right way: one SELECT id ... LIMIT 5 for
 * samples, one COUNT(*) for the total. The caller passes a predicate
 * SQL ("FROM ... WHERE ..." with no leading SELECT) and the helper
 * builds both variants.
 *
 * Example:
 *   sampleAndCount(`FROM "Order" WHERE "status" = 'DELIVERED'`)
 */
async function sampleAndCount(tail, idExpr = `"id"`) {
  const sampleRows = await sql.query(`SELECT ${idExpr} AS id ${tail} LIMIT 5`);
  const [cnt] = await sql.query(`SELECT count(*)::int AS n ${tail}`);
  const n = Number(cnt?.n ?? 0);
  rowsScanned += n;
  return { count: n, sample: sampleRows.map((r) => r.id) };
}

// Helpful guard: quote identifier (all our tables are PascalCase, need double-quotes)
const q = (id) => `"${id.replace(/"/g, '""')}"`;

// ── Check list ──────────────────────────────────────────────────────

/**
 * A. Orphaned FK rows
 *   child.targetCol -> parent.id
 *
 * For each pair run:
 *   SELECT count(*), array_agg(id limit 5)
 *   FROM child LEFT JOIN parent ON child.fk = parent.id
 *   WHERE child.fk IS NOT NULL AND parent.id IS NULL
 */
const orphanChecks = [
  // Order
  { child: 'Order', childCol: 'builderId', parent: 'Builder', sev: 'P0', impact: 'Orders with no builder — AR reports, builder dashboard, collections all broken.' },
  { child: 'Order', childCol: 'quoteId', parent: 'Quote', sev: 'P1', impact: 'Order linked to a deleted quote; quote source trace broken.', nullable: true },
  { child: 'Order', childCol: 'driverId', parent: 'Staff', sev: 'P2', impact: 'Driver assignment stale; delivery assignment filters misfire.', nullable: true },
  // OrderItem
  { child: 'OrderItem', childCol: 'orderId', parent: 'Order', sev: 'P0', impact: 'Line items belonging to no Order — subtotal rollups undercount.' },
  { child: 'OrderItem', childCol: 'productId', parent: 'Product', sev: 'P0', impact: 'Line items referencing deleted products — pricing/margin calc broken.' },
  // Invoice
  { child: 'Invoice', childCol: 'builderId', parent: 'Builder', sev: 'P0', impact: 'Invoices with no builder — AR aging & collections broken.' },
  { child: 'Invoice', childCol: 'orderId', parent: 'Order', sev: 'P1', impact: 'Invoice points to non-existent order — order->invoice reports break.', nullable: true },
  { child: 'Invoice', childCol: 'jobId', parent: 'Job', sev: 'P1', impact: 'Invoice linked to missing job — job profitability reports fail.', nullable: true },
  { child: 'Invoice', childCol: 'createdById', parent: 'Staff', sev: 'P1', impact: 'Invoice creator staff record missing — audit log integrity fails.' },
  // InvoiceItem
  { child: 'InvoiceItem', childCol: 'invoiceId', parent: 'Invoice', sev: 'P0', impact: 'Line items with no invoice — double-counted or lost revenue.' },
  { child: 'InvoiceItem', childCol: 'productId', parent: 'Product', sev: 'P2', impact: 'Line references deleted product — category rollup misclassifies.', nullable: true },
  // Payment
  { child: 'Payment', childCol: 'invoiceId', parent: 'Invoice', sev: 'P0', impact: 'Payments with no invoice — cash can’t be applied, AR overstated.' },
  { child: 'Payment', childCol: 'builderId', parent: 'Builder', sev: 'P2', impact: 'Builder on payment missing — attribution fuzzy but invoice chain still works.', nullable: true },
  { child: 'Payment', childCol: 'processedById', parent: 'Staff', sev: 'P2', impact: 'Payment processor staff missing — audit trail incomplete.', nullable: true },
  // PurchaseOrder
  { child: 'PurchaseOrder', childCol: 'vendorId', parent: 'Vendor', sev: 'P0', impact: 'POs without a vendor — AP, receiving, spend reporting broken.' },
  { child: 'PurchaseOrder', childCol: 'createdById', parent: 'Staff', sev: 'P1', impact: 'PO creator staff missing — audit log integrity.' },
  { child: 'PurchaseOrder', childCol: 'approvedById', parent: 'Staff', sev: 'P2', impact: 'Approver missing — approval audit integrity gap.', nullable: true },
  // PurchaseOrderItem
  { child: 'PurchaseOrderItem', childCol: 'purchaseOrderId', parent: 'PurchaseOrder', sev: 'P0', impact: 'PO lines without a PO — inventory-on-order counts wrong.' },
  { child: 'PurchaseOrderItem', childCol: 'productId', parent: 'Product', sev: 'P1', impact: 'PO line references missing product — inventory receiving miscategorizes.', nullable: true },
  { child: 'PurchaseOrderItem', childCol: 'jobId', parent: 'Job', sev: 'P2', impact: 'Job-tagged PO line where job is gone — job costing integrity gap.', nullable: true },
  // Job
  { child: 'Job', childCol: 'orderId', parent: 'Order', sev: 'P1', impact: 'Job linked to non-existent order — order fulfilment dashboard breaks.', nullable: true },
  { child: 'Job', childCol: 'assignedPMId', parent: 'Staff', sev: 'P2', impact: 'PM assignment stale — workload balancing wrong.', nullable: true },
  { child: 'Job', childCol: 'communityId', parent: 'Community', sev: 'P2', impact: 'Community missing — production builder grouping wrong.', nullable: true },
  { child: 'Job', childCol: 'divisionId', parent: 'Division', sev: 'P2', impact: 'Division dropped — location rollups may undercount.', nullable: true },
  // Delivery
  { child: 'Delivery', childCol: 'jobId', parent: 'Job', sev: 'P0', impact: 'Deliveries unlinked from Jobs — delivery board and job lifecycle both break.' },
  { child: 'Delivery', childCol: 'crewId', parent: 'Crew', sev: 'P2', impact: 'Crew deleted but delivery still references — crew roster reports error.', nullable: true },
  // Installation
  { child: 'Installation', childCol: 'jobId', parent: 'Job', sev: 'P1', impact: 'Install record unlinked from job — completion tracking breaks.' },
  { child: 'Installation', childCol: 'crewId', parent: 'Crew', sev: 'P2', impact: 'Crew gone; install attribution stale.', nullable: true },
  // MaterialPick
  { child: 'MaterialPick', childCol: 'jobId', parent: 'Job', sev: 'P1', impact: 'Pick list without a job — warehouse staging confusion.' },
  // DecisionNote
  { child: 'DecisionNote', childCol: 'jobId', parent: 'Job', sev: 'P2', impact: 'Decision note orphaned; comms log integrity.' },
  // QualityCheck
  { child: 'QualityCheck', childCol: 'jobId', parent: 'Job', sev: 'P2', impact: 'QC event orphan.' },
  // Community
  { child: 'Community', childCol: 'builderId', parent: 'Builder', sev: 'P1', impact: 'Community assigned to missing builder — production builder tree broken.' },
  // Project
  { child: 'Project', childCol: 'builderId', parent: 'Builder', sev: 'P1', impact: 'Project with no builder — builder portal shows phantom projects.' },
  // Quote
  { child: 'Quote', childCol: 'projectId', parent: 'Project', sev: 'P1', impact: 'Quote with no project — estimating pipeline broken.' },
  { child: 'Quote', childCol: 'takeoffId', parent: 'Takeoff', sev: 'P1', impact: 'Quote with no takeoff — source material missing.' },
  // QuoteItem
  { child: 'QuoteItem', childCol: 'quoteId', parent: 'Quote', sev: 'P0', impact: 'Quote line items with no quote — subtotal calcs undercount.' },
  { child: 'QuoteItem', childCol: 'productId', parent: 'Product', sev: 'P2', impact: 'Quote line referencing missing product.', nullable: true },
  // BuilderContact
  { child: 'BuilderContact', childCol: 'builderId', parent: 'Builder', sev: 'P1', impact: 'Contact record orphaned from builder — CRM data loss.' },
  // BuilderPricing
  { child: 'BuilderPricing', childCol: 'builderId', parent: 'Builder', sev: 'P1', impact: 'Custom pricing orphan.' },
  { child: 'BuilderPricing', childCol: 'productId', parent: 'Product', sev: 'P1', impact: 'Custom pricing for deleted product.' },
  // VendorProduct
  { child: 'VendorProduct', childCol: 'vendorId', parent: 'Vendor', sev: 'P1', impact: 'Vendor catalog entry orphan.' },
  // InventoryItem (productId unique; should never orphan)
  { child: 'InventoryItem', childCol: 'productId', parent: 'Product', sev: 'P0', impact: 'Inventory record points to deleted product — stock visibility wrong.' },
  // PunchItem
  { child: 'PunchItem', childCol: 'installationId', parent: 'Installation', sev: 'P1', impact: 'Punch item without install.' },
  { child: 'PunchItem', childCol: 'jobId', parent: 'Job', sev: 'P1', impact: 'Punch item without job.' },
  // StockTransferItem
  { child: 'StockTransferItem', childCol: 'transferId', parent: 'StockTransfer', sev: 'P1', impact: 'Stock transfer line orphan.' },
  // CollectionAction
  { child: 'CollectionAction', childCol: 'invoiceId', parent: 'Invoice', sev: 'P1', impact: 'Collection record refers to missing invoice — AR collection workflow breaks.', nullable: true },
];

async function checkOrphans() {
  for (const c of orphanChecks) {
    try {
      const rows = await sql.query(
        `SELECT c.id FROM ${q(c.child)} c LEFT JOIN ${q(c.parent)} p ON c.${q(c.childCol)} = p."id" ` +
          `WHERE c.${q(c.childCol)} IS NOT NULL AND p."id" IS NULL LIMIT 5`
      );
      const cnt = await count(
        `SELECT count(*)::int AS n FROM ${q(c.child)} c LEFT JOIN ${q(c.parent)} p ON c.${q(c.childCol)} = p."id" ` +
          `WHERE c.${q(c.childCol)} IS NOT NULL AND p."id" IS NULL`
      );
      if (cnt > 0) {
        // Build fix SQL only if parent is nullable — else it's a manual investigation
        let fix = null;
        if (c.nullable) {
          fix = `-- Null out orphaned ${c.child}.${c.childCol} references (${cnt} rows)\n` +
            `UPDATE ${q(c.child)} SET ${q(c.childCol)} = NULL\n` +
            `WHERE ${q(c.childCol)} IS NOT NULL AND ${q(c.childCol)} NOT IN (SELECT "id" FROM ${q(c.parent)});`;
        } else {
          fix = `-- Required FK — MANUAL TRIAGE. Review and either recreate the parent ${c.parent} record(s), or delete the orphaned ${c.child} rows:\n` +
            `-- SELECT * FROM ${q(c.child)} WHERE ${q(c.childCol)} NOT IN (SELECT "id" FROM ${q(c.parent)}) LIMIT 50;\n` +
            `-- Potential delete (use only after verifying the rows are truly abandoned):\n` +
            `-- DELETE FROM ${q(c.child)} WHERE ${q(c.childCol)} IS NOT NULL AND ${q(c.childCol)} NOT IN (SELECT "id" FROM ${q(c.parent)});`;
        }
        addFinding({
          severity: c.sev,
          category: 'A. Orphaned FK',
          table: c.child,
          count: cnt,
          sample: rows.map((r) => r.id),
          description: `${c.child}.${c.childCol} -> ${c.parent}.id: ${cnt} orphan rows`,
          impact: c.impact,
          fix_sql: fix,
        });
      }
    } catch (err) {
      addFinding({
        severity: 'P1',
        category: 'A. Orphaned FK',
        table: c.child,
        count: 0,
        sample: [],
        description: `Failed to check ${c.child}.${c.childCol} -> ${c.parent}.id: ${err?.message || String(err)}`,
        impact: 'Check skipped (likely schema drift).',
      });
    }
  }
}

/**
 * B. Derived-field drift
 */
async function checkDrift() {
  // Order.subtotal vs SUM(OrderItem.lineTotal)
  try {
    const sampleRows = await sql.query(`
      SELECT o."id"
      FROM "Order" o
      LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
      GROUP BY o."id", o."subtotal"
      HAVING ABS(o."subtotal" - COALESCE(SUM(oi."lineTotal"),0)) > 0.01
      LIMIT 5
    `);
    const cntRows = await sql.query(`
      SELECT COUNT(*)::int AS n FROM (
        SELECT o."id"
        FROM "Order" o LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id"
        GROUP BY o."id", o."subtotal"
        HAVING ABS(o."subtotal" - COALESCE(SUM(oi."lineTotal"),0)) > 0.01
      ) t
    `);
    const driftCount = Number(cntRows[0]?.n ?? 0);
    rowsScanned += driftCount;
    if (driftCount > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'Order',
        count: driftCount,
        sample: sampleRows.map((r) => r.id),
        description: `Order.subtotal disagrees with SUM(OrderItem.lineTotal) by >$0.01 on ${driftCount} rows.`,
        impact: 'Sales reports and AR aging may show wrong totals; syncs to QuickBooks/InFlow may replay stale values.',
        fix_sql: `-- Recompute Order.subtotal from OrderItem.lineTotal sums\n` +
          `UPDATE "Order" o\n` +
          `SET "subtotal" = sub.derived,\n` +
          `    "total" = sub.derived + COALESCE(o."taxAmount",0) + COALESCE(o."shippingCost",0),\n` +
          `    "updatedAt" = now()\n` +
          `FROM (\n` +
          `  SELECT "orderId" AS id, COALESCE(SUM("lineTotal"),0) AS derived\n` +
          `  FROM "OrderItem" GROUP BY "orderId"\n` +
          `) sub\n` +
          `WHERE o."id" = sub.id AND ABS(o."subtotal" - sub.derived) > 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'Order', count: 0, sample: [], description: `Order.subtotal check failed: ${err.message}`, impact: '' });
  }

  // Order.total vs subtotal + taxAmount + shippingCost
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Order" WHERE ABS("total" - ("subtotal" + COALESCE("taxAmount",0) + COALESCE("shippingCost",0))) > 0.01`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'Order',
        count: n,
        sample,
        description: `Order.total disagrees with subtotal + tax + shipping on ${n} rows.`,
        impact: 'Invoice generation may bill wrong totals; revenue recognition off.',
        fix_sql: `UPDATE "Order"\n` +
          `SET "total" = "subtotal" + COALESCE("taxAmount",0) + COALESCE("shippingCost",0),\n` +
          `    "updatedAt" = now()\n` +
          `WHERE ABS("total" - ("subtotal" + COALESCE("taxAmount",0) + COALESCE("shippingCost",0))) > 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'Order', count: 0, sample: [], description: `Order.total check failed: ${err.message}`, impact: '' });
  }

  // Invoice.total vs Order.total (when linked)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Invoice" i JOIN "Order" o ON o."id" = i."orderId" WHERE ABS(i."total" - o."total") > 0.01`,
      `i."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P2',
        category: 'B. Derived-field drift',
        table: 'Invoice',
        count: n,
        sample,
        description: `Invoice.total differs from linked Order.total by >$0.01 on ${n} rows.`,
        impact: 'Acceptable if invoice was partially invoiced or adjusted, but should be reviewed.',
        fix_sql: `-- Manual review. Invoice may intentionally differ (change orders, partial invoicing). Spot-check:\n` +
          `-- SELECT i."id", i."total" AS inv, o."total" AS ord FROM "Invoice" i JOIN "Order" o ON o."id" = i."orderId" WHERE ABS(i."total" - o."total") > 0.01 LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'B. Derived-field drift', table: 'Invoice', count: 0, sample: [], description: `Invoice<->Order total check failed: ${err.message}`, impact: '' });
  }

  // Invoice.balanceDue vs total - amountPaid
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Invoice" WHERE ABS(COALESCE("balanceDue",0) - ("total" - COALESCE("amountPaid",0))) > 0.01`
    );
    if (n > 0) {
      addFinding({
        severity: 'P0',
        category: 'B. Derived-field drift',
        table: 'Invoice',
        count: n,
        sample,
        description: `Invoice.balanceDue != total - amountPaid on ${n} rows.`,
        impact: 'AR outstanding balance is wrong. Collections and credit hold logic may work on stale balances.',
        fix_sql: `UPDATE "Invoice"\n` +
          `SET "balanceDue" = "total" - COALESCE("amountPaid",0),\n` +
          `    "updatedAt" = now()\n` +
          `WHERE ABS(COALESCE("balanceDue",0) - ("total" - COALESCE("amountPaid",0))) > 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'B. Derived-field drift', table: 'Invoice', count: 0, sample: [], description: `Invoice balanceDue check failed: ${err.message}`, impact: '' });
  }

  // Invoice.amountPaid vs SUM(Payment.amount)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Invoice" i LEFT JOIN (SELECT "invoiceId", SUM("amount")::float AS paid FROM "Payment" GROUP BY "invoiceId") p ON p."invoiceId" = i."id" WHERE ABS(COALESCE(i."amountPaid",0) - COALESCE(p.paid,0)) > 0.01`,
      `i."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P0',
        category: 'B. Derived-field drift',
        table: 'Invoice',
        count: n,
        sample,
        description: `Invoice.amountPaid disagrees with SUM(Payment.amount) on ${n} rows.`,
        impact: 'Cash applied is misreported. Over/underpayment reports wrong. Collection tickets may chase paid invoices (or miss unpaid ones).',
        fix_sql: `UPDATE "Invoice" i\n` +
          `SET "amountPaid" = COALESCE(p.paid,0),\n` +
          `    "balanceDue" = i."total" - COALESCE(p.paid,0),\n` +
          `    "updatedAt" = now()\n` +
          `FROM (\n` +
          `  SELECT "invoiceId", SUM("amount")::float AS paid FROM "Payment" GROUP BY "invoiceId"\n` +
          `) p\n` +
          `WHERE p."invoiceId" = i."id" AND ABS(COALESCE(i."amountPaid",0) - COALESCE(p.paid,0)) > 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'B. Derived-field drift', table: 'Invoice', count: 0, sample: [], description: `Invoice amountPaid check failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrder.subtotal vs SUM(PurchaseOrderItem.lineTotal)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "PurchaseOrder" p LEFT JOIN (SELECT "purchaseOrderId" AS id, COALESCE(SUM("lineTotal"),0) AS derived FROM "PurchaseOrderItem" GROUP BY "purchaseOrderId") sub ON sub.id = p."id" WHERE ABS(COALESCE(p."subtotal",0) - COALESCE(sub.derived,0)) > 0.01`,
      `p."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'PurchaseOrder',
        count: n,
        sample,
        description: `PurchaseOrder.subtotal disagrees with SUM(PurchaseOrderItem.lineTotal) on ${n} rows.`,
        impact: 'Vendor spend and AP accruals may be wrong; purchasing dashboards miscategorize.',
        fix_sql: `UPDATE "PurchaseOrder" p\n` +
          `SET "subtotal" = COALESCE(sub.derived,0),\n` +
          `    "total" = COALESCE(sub.derived,0) + COALESCE(p."shippingCost",0),\n` +
          `    "updatedAt" = now()\n` +
          `FROM (\n` +
          `  SELECT "purchaseOrderId" AS id, COALESCE(SUM("lineTotal"),0) AS derived\n` +
          `  FROM "PurchaseOrderItem" GROUP BY "purchaseOrderId"\n` +
          `) sub\n` +
          `WHERE sub.id = p."id" AND ABS(COALESCE(p."subtotal",0) - COALESCE(sub.derived,0)) > 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'PurchaseOrder', count: 0, sample: [], description: `PurchaseOrder subtotal check failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrder.total vs subtotal + shippingCost
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "PurchaseOrder" WHERE ABS("total" - (COALESCE("subtotal",0) + COALESCE("shippingCost",0))) > 0.01`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'PurchaseOrder',
        count: n,
        sample,
        description: `PurchaseOrder.total disagrees with subtotal + shippingCost on ${n} rows.`,
        impact: 'AP / cash flow forecast miscalculated.',
        fix_sql: `UPDATE "PurchaseOrder"\n` +
          `SET "total" = COALESCE("subtotal",0) + COALESCE("shippingCost",0), "updatedAt" = now()\n` +
          `WHERE ABS("total" - (COALESCE("subtotal",0) + COALESCE("shippingCost",0))) > 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'PurchaseOrder', count: 0, sample: [], description: `PurchaseOrder total check failed: ${err.message}`, impact: '' });
  }

  // Builder.accountBalance vs SUM(open Invoices.balanceDue)  [ISSUED/SENT/PARTIALLY_PAID/OVERDUE]
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Builder" b LEFT JOIN (SELECT "builderId", SUM(COALESCE("balanceDue",0))::float AS open FROM "Invoice" WHERE "status" IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE') GROUP BY "builderId") v ON v."builderId" = b."id" WHERE ABS(COALESCE(b."accountBalance",0) - COALESCE(v.open,0)) > 0.01`,
      `b."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'Builder',
        count: n,
        sample,
        description: `Builder.accountBalance disagrees with SUM(open Invoice.balanceDue) on ${n} rows.`,
        impact: 'Credit hold decisions and builder dashboard "amount due" widgets are wrong.',
        fix_sql: `UPDATE "Builder" b\n` +
          `SET "accountBalance" = COALESCE(v.open,0), "updatedAt" = now()\n` +
          `FROM (\n` +
          `  SELECT "builderId", SUM(COALESCE("balanceDue",0))::float AS open\n` +
          `  FROM "Invoice" WHERE "status" IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')\n` +
          `  GROUP BY "builderId"\n` +
          `) v\n` +
          `WHERE v."builderId" = b."id" AND ABS(COALESCE(b."accountBalance",0) - COALESCE(v.open,0)) > 0.01;\n` +
          `-- Also zero out builders with no open invoices:\n` +
          `UPDATE "Builder" SET "accountBalance" = 0, "updatedAt" = now()\n` +
          `WHERE COALESCE("accountBalance",0) <> 0 AND "id" NOT IN (\n` +
          `  SELECT DISTINCT "builderId" FROM "Invoice" WHERE "status" IN ('ISSUED','SENT','PARTIALLY_PAID','OVERDUE')\n` +
          `);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'Builder', count: 0, sample: [], description: `Builder.accountBalance check failed: ${err.message}`, impact: '' });
  }

  // InventoryItem.onHand < 0
  try {
    const { count: n, sample } = await sampleAndCount(`FROM "InventoryItem" WHERE "onHand" < 0`);
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'InventoryItem',
        count: n,
        sample,
        description: `${n} InventoryItem rows have onHand < 0 (physically impossible).`,
        impact: 'Usually caused by shipments/picks applied without receipts. Will misstate available-to-promise and reorder suggestions.',
        fix_sql: `-- Flag for physical recount. If you trust onHand=0 floor, reset:\n` +
          `UPDATE "InventoryItem" SET "onHand" = 0, "available" = GREATEST("onHand" - COALESCE("committed",0), 0), "updatedAt" = now()\n` +
          `WHERE "onHand" < 0;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'InventoryItem', count: 0, sample: [], description: `InventoryItem negative onHand check failed: ${err.message}`, impact: '' });
  }

  // InventoryItem.onOrder vs SUM of open PO lines (status in DRAFT..PARTIALLY_RECEIVED) (quantity - receivedQty)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "InventoryItem" i LEFT JOIN (SELECT poi."productId", SUM(GREATEST(COALESCE(poi."quantity",0) - COALESCE(poi."receivedQty",0), 0))::int AS open_qty FROM "PurchaseOrderItem" poi JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId" WHERE po."status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED') AND poi."productId" IS NOT NULL GROUP BY poi."productId") v ON v."productId" = i."productId" WHERE COALESCE(i."onOrder",0) <> COALESCE(v.open_qty,0)`,
      `i."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'InventoryItem',
        count: n,
        sample,
        description: `InventoryItem.onOrder disagrees with open PO line quantities on ${n} SKUs.`,
        impact: 'Reorder suggestions & auto-purchase recommendations will be wrong.',
        fix_sql: `UPDATE "InventoryItem" i\n` +
          `SET "onOrder" = COALESCE(v.open_qty,0), "updatedAt" = now()\n` +
          `FROM (\n` +
          `  SELECT poi."productId", SUM(GREATEST(COALESCE(poi."quantity",0) - COALESCE(poi."receivedQty",0), 0))::int AS open_qty\n` +
          `  FROM "PurchaseOrderItem" poi JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"\n` +
          `  WHERE po."status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED') AND poi."productId" IS NOT NULL\n` +
          `  GROUP BY poi."productId"\n` +
          `) v\n` +
          `WHERE v."productId" = i."productId" AND COALESCE(i."onOrder",0) <> COALESCE(v.open_qty,0);\n` +
          `-- Also zero out SKUs with no open PO lines:\n` +
          `UPDATE "InventoryItem" SET "onOrder" = 0, "updatedAt" = now()\n` +
          `WHERE COALESCE("onOrder",0) <> 0 AND "productId" NOT IN (\n` +
          `  SELECT DISTINCT poi."productId" FROM "PurchaseOrderItem" poi\n` +
          `  JOIN "PurchaseOrder" po ON po."id" = poi."purchaseOrderId"\n` +
          `  WHERE po."status" IN ('DRAFT','PENDING_APPROVAL','APPROVED','SENT_TO_VENDOR','PARTIALLY_RECEIVED') AND poi."productId" IS NOT NULL\n` +
          `);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'InventoryItem', count: 0, sample: [], description: `InventoryItem.onOrder check failed: ${err.message}`, impact: '' });
  }

  // InventoryItem.onOrder < 0 (spotted in prior audit)
  try {
    const { count: n, sample } = await sampleAndCount(`FROM "InventoryItem" WHERE "onOrder" < 0`);
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'B. Derived-field drift',
        table: 'InventoryItem',
        count: n,
        sample,
        description: `${n} InventoryItem rows have onOrder < 0 (physically impossible).`,
        impact: 'Prior negatives mean receipts posted without matching PO lines or double-decrement on receipt.',
        fix_sql: `UPDATE "InventoryItem" SET "onOrder" = 0, "updatedAt" = now() WHERE "onOrder" < 0;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'B. Derived-field drift', table: 'InventoryItem', count: 0, sample: [], description: `InventoryItem negative onOrder check failed: ${err.message}`, impact: '' });
  }

  // InventoryItem.available vs onHand - committed
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "InventoryItem" WHERE COALESCE("available",0) <> COALESCE("onHand",0) - COALESCE("committed",0)`
    );
    if (n > 0) {
      addFinding({
        severity: 'P2',
        category: 'B. Derived-field drift',
        table: 'InventoryItem',
        count: n,
        sample,
        description: `InventoryItem.available != onHand - committed on ${n} rows.`,
        impact: 'Warehouse "available to promise" is wrong.',
        fix_sql: `UPDATE "InventoryItem" SET "available" = COALESCE("onHand",0) - COALESCE("committed",0), "updatedAt" = now()\n` +
          `WHERE COALESCE("available",0) <> COALESCE("onHand",0) - COALESCE("committed",0);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'B. Derived-field drift', table: 'InventoryItem', count: 0, sample: [], description: `InventoryItem.available check failed: ${err.message}`, impact: '' });
  }
}

/**
 * C. Timestamp ordering
 */
async function checkTimestamps() {
  // Order.deliveryDate < orderDate (when both set)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Order" WHERE "deliveryDate" IS NOT NULL AND "orderDate" IS NOT NULL AND "deliveryDate"::date < "orderDate"::date`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'C. Timestamp ordering',
        table: 'Order',
        count: n,
        sample,
        description: `Order.deliveryDate is before Order.orderDate on ${n} rows.`,
        impact: 'Impossible ordering. Likely a bad import or a swapped-field mapping. Forecasts, aging and lead-time reports will be wrong.',
        fix_sql: `-- Spot-check the rows and decide whether to flip, clear, or investigate:\n` +
          `-- SELECT "id","orderDate","deliveryDate" FROM "Order" WHERE "deliveryDate" IS NOT NULL AND "orderDate" IS NOT NULL AND "deliveryDate"::date < "orderDate"::date LIMIT 50;\n` +
          `-- Safest conservative fix: clear the bad deliveryDate so downstream jobs recompute.\n` +
          `UPDATE "Order" SET "deliveryDate" = NULL, "updatedAt" = now()\n` +
          `WHERE "deliveryDate" IS NOT NULL AND "orderDate" IS NOT NULL AND "deliveryDate"::date < "orderDate"::date;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'C. Timestamp ordering', table: 'Order', count: 0, sample: [], description: `Order deliveryDate<orderDate check failed: ${err.message}`, impact: '' });
  }

  // Invoice.paidAt < issuedAt
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Invoice" WHERE "paidAt" IS NOT NULL AND "issuedAt" IS NOT NULL AND "paidAt" < "issuedAt"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'C. Timestamp ordering',
        table: 'Invoice',
        count: n,
        sample,
        description: `Invoice.paidAt is before Invoice.issuedAt on ${n} rows.`,
        impact: 'DSO, collections SLA reporting broken.',
        fix_sql: `-- Clear paidAt so it gets rewritten at the next payment event:\n` +
          `UPDATE "Invoice" SET "paidAt" = NULL, "updatedAt" = now()\n` +
          `WHERE "paidAt" IS NOT NULL AND "issuedAt" IS NOT NULL AND "paidAt" < "issuedAt";`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'C. Timestamp ordering', table: 'Invoice', count: 0, sample: [], description: `Invoice paidAt<issuedAt check failed: ${err.message}`, impact: '' });
  }

  // Payment.receivedAt < Invoice.issuedAt (linked)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Payment" p JOIN "Invoice" i ON i."id" = p."invoiceId" WHERE p."receivedAt" IS NOT NULL AND i."issuedAt" IS NOT NULL AND p."receivedAt" < i."issuedAt"`,
      `p."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P2',
        category: 'C. Timestamp ordering',
        table: 'Payment',
        count: n,
        sample,
        description: `Payment.receivedAt is before linked Invoice.issuedAt on ${n} rows.`,
        impact: 'Either a prepayment recorded before invoice existed, or a data-entry error. Affects cash-aging reports.',
        fix_sql: `-- Investigate; could be prepayment. No universal fix. Sample:\n` +
          `-- SELECT p."id", p."receivedAt", i."issuedAt" FROM "Payment" p JOIN "Invoice" i ON i."id"=p."invoiceId" WHERE p."receivedAt" < i."issuedAt" LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'C. Timestamp ordering', table: 'Payment', count: 0, sample: [], description: `Payment receivedAt<issuedAt check failed: ${err.message}`, impact: '' });
  }

  // Delivery.completedAt < Delivery.createdAt
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Delivery" WHERE "completedAt" IS NOT NULL AND "createdAt" IS NOT NULL AND "completedAt" < "createdAt"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P2',
        category: 'C. Timestamp ordering',
        table: 'Delivery',
        count: n,
        sample,
        description: `Delivery.completedAt is before Delivery.createdAt on ${n} rows.`,
        impact: 'Broken delivery timeline. OTD metric skewed.',
        fix_sql: `-- Clear completedAt and let next delivery event rewrite:\n` +
          `UPDATE "Delivery" SET "completedAt" = NULL, "updatedAt" = now()\n` +
          `WHERE "completedAt" IS NOT NULL AND "createdAt" IS NOT NULL AND "completedAt" < "createdAt";`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'C. Timestamp ordering', table: 'Delivery', count: 0, sample: [], description: `Delivery completedAt check failed: ${err.message}`, impact: '' });
  }

  // Job.actualDate < Order.createdAt (if linked)
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "Job" j JOIN "Order" o ON o."id" = j."orderId" WHERE j."actualDate" IS NOT NULL AND j."actualDate" < o."createdAt"`,
      `j."id"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P2',
        category: 'C. Timestamp ordering',
        table: 'Job',
        count: n,
        sample,
        description: `Job.actualDate earlier than the linked Order.createdAt on ${n} rows.`,
        impact: 'Impossible — job done before order created. Likely stale/imported date.',
        fix_sql: `-- Investigate each row; may be a legacy import artifact. No auto-fix.\n` +
          `-- SELECT j."id", j."actualDate", o."createdAt" FROM "Job" j JOIN "Order" o ON o."id"=j."orderId" WHERE j."actualDate" < o."createdAt" LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'C. Timestamp ordering', table: 'Job', count: 0, sample: [], description: `Job.actualDate check failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrder.orderedAt > receivedAt
  try {
    const { count: n, sample } = await sampleAndCount(
      `FROM "PurchaseOrder" WHERE "orderedAt" IS NOT NULL AND "receivedAt" IS NOT NULL AND "orderedAt" > "receivedAt"`
    );
    if (n > 0) {
      addFinding({
        severity: 'P1',
        category: 'C. Timestamp ordering',
        table: 'PurchaseOrder',
        count: n,
        sample,
        description: `PurchaseOrder.orderedAt after receivedAt on ${n} rows.`,
        impact: 'Impossible — received before ordered. Skews vendor lead-time metrics.',
        fix_sql: `-- No universal fix. Inspect and decide to clear one of the fields:\n` +
          `-- SELECT "id","orderedAt","receivedAt" FROM "PurchaseOrder" WHERE "orderedAt" > "receivedAt" LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'C. Timestamp ordering', table: 'PurchaseOrder', count: 0, sample: [], description: `PurchaseOrder ordering check failed: ${err.message}`, impact: '' });
  }
}

/**
 * D. Duplicates
 */
async function checkDuplicates() {
  // Builder by trimmed lowercased companyName
  try {
    const rows = await sql.query(`
      SELECT LOWER(TRIM("companyName")) AS key, COUNT(*)::int AS n, ARRAY_AGG("id" ORDER BY "createdAt") AS ids
      FROM "Builder" WHERE "companyName" IS NOT NULL AND TRIM("companyName") <> ''
      GROUP BY 1 HAVING COUNT(*) > 1
      ORDER BY n DESC LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const total = rows.reduce((s, r) => s + r.n, 0);
      addFinding({
        severity: 'P1',
        category: 'D. Duplicates',
        table: 'Builder',
        count: total,
        sample: rows.slice(0, 5).flatMap((r) => r.ids.slice(0, 2)),
        description: `${rows.length} distinct companyName (case-insensitive, trimmed) with duplicates — ${total} rows total.`,
        impact: 'Orders/invoices split across builder copies; AR/margin reports undercount per builder; credit hold logic bypassed if wrong shell is referenced.',
        fix_sql: `-- Manual dedup — pick the keeper with most activity, reassign FKs, then soft-delete orphans. Sample inspection:\n` +
          `-- SELECT LOWER(TRIM("companyName")) key, array_agg("id" ORDER BY "createdAt") ids FROM "Builder" GROUP BY 1 HAVING COUNT(*)>1 ORDER BY COUNT(*) DESC LIMIT 50;\n` +
          `-- Use scripts/dedup-builders.mjs (existing) as starting point.`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'D. Duplicates', table: 'Builder', count: 0, sample: [], description: `Builder dup check failed: ${err.message}`, impact: '' });
  }

  // Vendor by trimmed lowercased name
  try {
    const rows = await sql.query(`
      SELECT LOWER(TRIM("name")) AS key, COUNT(*)::int AS n, ARRAY_AGG("id" ORDER BY "createdAt") AS ids
      FROM "Vendor" WHERE "name" IS NOT NULL AND TRIM("name") <> ''
      GROUP BY 1 HAVING COUNT(*) > 1
      ORDER BY n DESC LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const total = rows.reduce((s, r) => s + r.n, 0);
      addFinding({
        severity: 'P1',
        category: 'D. Duplicates',
        table: 'Vendor',
        count: total,
        sample: rows.slice(0, 5).flatMap((r) => r.ids.slice(0, 2)),
        description: `${rows.length} distinct vendor names (case-insensitive) with duplicates — ${total} rows total.`,
        impact: 'PO spend and vendor performance split across copies.',
        fix_sql: `-- Use scripts/dedup-vendors.mjs as a template. Manual: pick keeper, reassign PO.vendorId and VendorProduct.vendorId.`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'D. Duplicates', table: 'Vendor', count: 0, sample: [], description: `Vendor dup check failed: ${err.message}`, impact: '' });
  }

  // Staff by email (unique constraint — should be impossible)
  try {
    const rows = await sql.query(`
      SELECT LOWER(TRIM("email")) AS key, COUNT(*)::int AS n
      FROM "Staff" WHERE "email" IS NOT NULL AND TRIM("email") <> ''
      GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'Staff',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.key),
        description: `${rows.length} duplicate Staff.email (should be unique).`,
        impact: 'Login collisions; auth flow ambiguous.',
        fix_sql: `-- Urgent manual fix. Inspect:\n-- SELECT "id","email","firstName","lastName" FROM "Staff" WHERE LOWER(TRIM("email")) IN (SELECT LOWER(TRIM("email")) FROM "Staff" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'Staff', count: 0, sample: [], description: `Staff email dup check failed: ${err.message}`, impact: '' });
  }

  // Product by sku
  try {
    const rows = await sql.query(`
      SELECT "sku", COUNT(*)::int AS n FROM "Product" WHERE "sku" IS NOT NULL AND TRIM("sku") <> ''
      GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'Product',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.sku),
        description: `${rows.length} duplicate Product.sku (should be unique).`,
        impact: 'Inventory and pricing calculations ambiguous; unique-constraint violated.',
        fix_sql: `-- Urgent. Inspect: SELECT "id","sku","name" FROM "Product" WHERE "sku" IN (SELECT "sku" FROM "Product" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'Product', count: 0, sample: [], description: `Product sku dup check failed: ${err.message}`, impact: '' });
  }

  // Order by orderNumber
  try {
    const rows = await sql.query(`
      SELECT "orderNumber", COUNT(*)::int AS n FROM "Order"
      WHERE "orderNumber" IS NOT NULL AND TRIM("orderNumber") <> ''
      GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'Order',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.orderNumber),
        description: `${rows.length} duplicate Order.orderNumber (should be unique).`,
        impact: 'Order lookups ambiguous, invoice->order joins may pick wrong row.',
        fix_sql: `-- Urgent. SELECT "id","orderNumber","createdAt" FROM "Order" WHERE "orderNumber" IN (SELECT "orderNumber" FROM "Order" GROUP BY 1 HAVING COUNT(*)>1) ORDER BY "orderNumber","createdAt";`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'Order', count: 0, sample: [], description: `Order number dup check failed: ${err.message}`, impact: '' });
  }

  // Invoice by invoiceNumber
  try {
    const rows = await sql.query(`
      SELECT "invoiceNumber", COUNT(*)::int AS n FROM "Invoice"
      WHERE "invoiceNumber" IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'Invoice',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.invoiceNumber),
        description: `${rows.length} duplicate Invoice.invoiceNumber (should be unique).`,
        impact: 'Double-count AR, ambiguous payment application.',
        fix_sql: `-- SELECT "id","invoiceNumber","total","status","createdAt" FROM "Invoice" WHERE "invoiceNumber" IN (SELECT "invoiceNumber" FROM "Invoice" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'Invoice', count: 0, sample: [], description: `Invoice number dup check failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrder by poNumber
  try {
    const rows = await sql.query(`
      SELECT "poNumber", COUNT(*)::int AS n FROM "PurchaseOrder"
      WHERE "poNumber" IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'PurchaseOrder',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.poNumber),
        description: `${rows.length} duplicate PurchaseOrder.poNumber (should be unique).`,
        impact: 'Receiving and AP ambiguous.',
        fix_sql: `-- SELECT "id","poNumber","vendorId","createdAt" FROM "PurchaseOrder" WHERE "poNumber" IN (SELECT "poNumber" FROM "PurchaseOrder" GROUP BY 1 HAVING COUNT(*)>1) ORDER BY "poNumber","createdAt";`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'PurchaseOrder', count: 0, sample: [], description: `PO number dup check failed: ${err.message}`, impact: '' });
  }

  // Job.jobNumber
  try {
    const rows = await sql.query(`
      SELECT "jobNumber", COUNT(*)::int AS n FROM "Job"
      WHERE "jobNumber" IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'Job',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.jobNumber),
        description: `${rows.length} duplicate Job.jobNumber (should be unique).`,
        impact: 'Job routing/deliveries go to the wrong record.',
        fix_sql: `-- Manual. SELECT "id","jobNumber","builderName","createdAt" FROM "Job" WHERE "jobNumber" IN (SELECT "jobNumber" FROM "Job" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'Job', count: 0, sample: [], description: `Job number dup check failed: ${err.message}`, impact: '' });
  }

  // Builder by email (unique)
  try {
    const rows = await sql.query(`
      SELECT LOWER(TRIM("email")) AS key, COUNT(*)::int AS n
      FROM "Builder" WHERE "email" IS NOT NULL AND TRIM("email") <> ''
      GROUP BY 1 HAVING COUNT(*) > 1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'Builder',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.key),
        description: `${rows.length} duplicate Builder.email (should be unique).`,
        impact: 'Builder login collisions.',
        fix_sql: `-- SELECT "id","email","companyName" FROM "Builder" WHERE LOWER(TRIM("email")) IN (SELECT LOWER(TRIM("email")) FROM "Builder" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'Builder', count: 0, sample: [], description: `Builder email dup check failed: ${err.message}`, impact: '' });
  }

  // InventoryItem.productId (unique)
  try {
    const rows = await sql.query(`
      SELECT "productId", COUNT(*)::int AS n FROM "InventoryItem"
      WHERE "productId" IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P0',
        category: 'D. Duplicates',
        table: 'InventoryItem',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.productId),
        description: `${rows.length} duplicate InventoryItem.productId (should be unique).`,
        impact: 'Inventory count per SKU ambiguous.',
        fix_sql: `-- SELECT "id","productId","onHand","location" FROM "InventoryItem" WHERE "productId" IN (SELECT "productId" FROM "InventoryItem" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'D. Duplicates', table: 'InventoryItem', count: 0, sample: [], description: `InventoryItem.productId dup check failed: ${err.message}`, impact: '' });
  }

  // Vendor.code (unique)
  try {
    const rows = await sql.query(`
      SELECT "code", COUNT(*)::int AS n FROM "Vendor"
      WHERE "code" IS NOT NULL AND TRIM("code") <> '' GROUP BY 1 HAVING COUNT(*)>1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P1',
        category: 'D. Duplicates',
        table: 'Vendor',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.code),
        description: `${rows.length} duplicate Vendor.code (should be unique).`,
        impact: 'Vendor-by-code lookups ambiguous.',
        fix_sql: `-- SELECT "id","code","name" FROM "Vendor" WHERE "code" IN (SELECT "code" FROM "Vendor" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'D. Duplicates', table: 'Vendor', count: 0, sample: [], description: `Vendor code dup check failed: ${err.message}`, impact: '' });
  }

  // Delivery.deliveryNumber unique
  try {
    const rows = await sql.query(`
      SELECT "deliveryNumber", COUNT(*)::int AS n FROM "Delivery"
      WHERE "deliveryNumber" IS NOT NULL GROUP BY 1 HAVING COUNT(*)>1 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P1',
        category: 'D. Duplicates',
        table: 'Delivery',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.deliveryNumber),
        description: `${rows.length} duplicate Delivery.deliveryNumber (should be unique).`,
        impact: 'Route tracking ambiguous.',
        fix_sql: `-- SELECT "id","deliveryNumber","jobId","createdAt" FROM "Delivery" WHERE "deliveryNumber" IN (SELECT "deliveryNumber" FROM "Delivery" GROUP BY 1 HAVING COUNT(*)>1);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'D. Duplicates', table: 'Delivery', count: 0, sample: [], description: `Delivery number dup check failed: ${err.message}`, impact: '' });
  }
}

/**
 * E. Required fields NULL
 */
async function checkNulls() {
  const nullChecks = [
    { t: 'Order', col: 'builderId', sev: 'P0', note: 'builder required' },
    { t: 'Order', col: 'orderNumber', sev: 'P0', note: 'unique identifier required' },
    { t: 'Order', col: 'status', sev: 'P0', note: 'enum required (default RECEIVED)' },
    { t: 'Order', col: 'paymentTerm', sev: 'P1', note: 'payment term required' },
    { t: 'Invoice', col: 'builderId', sev: 'P0', note: 'builder required' },
    { t: 'Invoice', col: 'invoiceNumber', sev: 'P0', note: 'unique identifier required' },
    { t: 'Invoice', col: 'total', sev: 'P0', note: 'total required' },
    { t: 'Invoice', col: 'status', sev: 'P0', note: 'status required' },
    { t: 'Invoice', col: 'createdById', sev: 'P1', note: 'creator required' },
    { t: 'PurchaseOrder', col: 'vendorId', sev: 'P0', note: 'vendor required' },
    { t: 'PurchaseOrder', col: 'poNumber', sev: 'P0', note: 'unique identifier required' },
    { t: 'PurchaseOrder', col: 'createdById', sev: 'P1', note: 'creator required' },
    { t: 'Job', col: 'jobNumber', sev: 'P0', note: 'unique identifier required' },
    { t: 'Job', col: 'builderName', sev: 'P1', note: 'required for display' },
    { t: 'Job', col: 'status', sev: 'P0', note: 'enum required' },
    { t: 'Job', col: 'scopeType', sev: 'P1', note: 'scope required' },
    { t: 'Delivery', col: 'jobId', sev: 'P0', note: 'FK required' },
    { t: 'Delivery', col: 'status', sev: 'P0', note: 'status required' },
    { t: 'Delivery', col: 'address', sev: 'P1', note: 'address required for delivery' },
    { t: 'Builder', col: 'companyName', sev: 'P0', note: 'name required' },
    { t: 'Builder', col: 'email', sev: 'P0', note: 'unique email required' },
    { t: 'Staff', col: 'email', sev: 'P0', note: 'login email required' },
    { t: 'Staff', col: 'role', sev: 'P0', note: 'role required' },
    { t: 'Staff', col: 'active', sev: 'P1', note: 'active flag required' },
    { t: 'Product', col: 'sku', sev: 'P0', note: 'sku required' },
    { t: 'Product', col: 'name', sev: 'P0', note: 'name required' },
    { t: 'Product', col: 'cost', sev: 'P1', note: 'cost required for margin calc' },
    { t: 'Product', col: 'basePrice', sev: 'P1', note: 'base price required for pricing' },
  ];

  for (const c of nullChecks) {
    try {
      const rows = await sql.query(`SELECT "id" FROM ${q(c.t)} WHERE ${q(c.col)} IS NULL LIMIT 5`);
      const cnt = await count(`SELECT count(*)::int AS n FROM ${q(c.t)} WHERE ${q(c.col)} IS NULL`);
      if (cnt > 0) {
        addFinding({
          severity: c.sev,
          category: 'E. Required fields NULL',
          table: c.t,
          count: cnt,
          sample: rows.map((r) => r.id),
          description: `${c.t}.${c.col} IS NULL on ${cnt} rows — ${c.note}.`,
          impact: `Callers expect ${c.col} non-null; queries that don't guard will throw or drop rows.`,
          fix_sql: `-- Investigate sources; backfill or default. Sample inspection:\n-- SELECT * FROM ${q(c.t)} WHERE ${q(c.col)} IS NULL LIMIT 50;`,
        });
      }
    } catch (err) {
      addFinding({ severity: c.sev, category: 'E. Required fields NULL', table: c.t, count: 0, sample: [], description: `${c.t}.${c.col} NULL check failed: ${err.message}`, impact: '' });
    }
  }

  // Extra: Invoice.issuedAt IS NULL where status <> 'DRAFT'
  try {
    const rows = await sql.query(`SELECT "id" FROM "Invoice" WHERE "issuedAt" IS NULL AND "status" <> 'DRAFT' LIMIT 5`);
    const cnt = await count(`SELECT count(*)::int AS n FROM "Invoice" WHERE "issuedAt" IS NULL AND "status" <> 'DRAFT'`);
    if (cnt > 0) {
      addFinding({
        severity: 'P1',
        category: 'E. Required fields NULL',
        table: 'Invoice',
        count: cnt,
        sample: rows.map((r) => r.id),
        description: `Invoice.issuedAt is NULL on ${cnt} rows where status != DRAFT — issued invoices must have issue date.`,
        impact: 'DSO and aging calculations miscount these invoices.',
        fix_sql: `-- Backfill from createdAt as a best-guess:\n` +
          `UPDATE "Invoice" SET "issuedAt" = "createdAt", "updatedAt" = now()\n` +
          `WHERE "issuedAt" IS NULL AND "status" <> 'DRAFT';`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'E. Required fields NULL', table: 'Invoice', count: 0, sample: [], description: `Invoice.issuedAt check failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrder.orderedAt NULL where status not DRAFT/PENDING_APPROVAL
  try {
    const rows = await sql.query(`SELECT "id" FROM "PurchaseOrder" WHERE "orderedAt" IS NULL AND "status" NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED') LIMIT 5`);
    const cnt = await count(`SELECT count(*)::int AS n FROM "PurchaseOrder" WHERE "orderedAt" IS NULL AND "status" NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED')`);
    if (cnt > 0) {
      addFinding({
        severity: 'P1',
        category: 'E. Required fields NULL',
        table: 'PurchaseOrder',
        count: cnt,
        sample: rows.map((r) => r.id),
        description: `PurchaseOrder.orderedAt is NULL on ${cnt} rows where status is past approval — should be set when PO goes to vendor.`,
        impact: 'Vendor lead-time metrics miscalculated.',
        fix_sql: `-- Backfill from createdAt when orderedAt is NULL on non-draft POs:\n` +
          `UPDATE "PurchaseOrder" SET "orderedAt" = "createdAt", "updatedAt" = now()\n` +
          `WHERE "orderedAt" IS NULL AND "status" NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED');`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'E. Required fields NULL', table: 'PurchaseOrder', count: 0, sample: [], description: `PO orderedAt check failed: ${err.message}`, impact: '' });
  }
}

/**
 * F. Enum / type value drift — verify freeform text columns holding enum-like values don't have bad tokens
 */
async function checkEnumDrift() {
  // InventoryItem.status (text, expected IN_STOCK / LOW_STOCK / OUT_OF_STOCK / ON_ORDER / DISCONTINUED)
  try {
    const rows = await sql.query(`
      SELECT DISTINCT "status" FROM "InventoryItem"
      WHERE "status" IS NOT NULL AND "status" NOT IN ('IN_STOCK','LOW_STOCK','OUT_OF_STOCK','ON_ORDER','DISCONTINUED')
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'F. Enum / type value drift',
        table: 'InventoryItem',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.status),
        description: `InventoryItem.status has ${rows.length} unexpected value(s): ${rows.map((r) => r.status).slice(0, 5).join(', ')}`,
        impact: 'UI status filters/badges may not render these rows.',
        fix_sql: `-- Spot-check; may add new values to allowed list, or normalize:\n-- SELECT DISTINCT "status", COUNT(*) FROM "InventoryItem" GROUP BY 1 ORDER BY 2 DESC;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'F. Enum / type value drift', table: 'InventoryItem', count: 0, sample: [], description: `InventoryItem.status drift check failed: ${err.message}`, impact: '' });
  }

  // InboxItem.priority
  try {
    const rows = await sql.query(`
      SELECT DISTINCT "priority" FROM "InboxItem"
      WHERE "priority" IS NOT NULL AND "priority" NOT IN ('CRITICAL','HIGH','MEDIUM','LOW')
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'F. Enum / type value drift',
        table: 'InboxItem',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.priority),
        description: `InboxItem.priority has unexpected values: ${rows.map((r) => r.priority).slice(0, 5).join(', ')}`,
        impact: 'Inbox sorting/filtering miscategorizes.',
        fix_sql: `-- Normalize: UPDATE "InboxItem" SET "priority" = 'MEDIUM' WHERE "priority" NOT IN ('CRITICAL','HIGH','MEDIUM','LOW');`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'F. Enum / type value drift', table: 'InboxItem', count: 0, sample: [], description: `InboxItem.priority drift check failed: ${err.message}`, impact: '' });
  }

  // InboxItem.status
  try {
    const rows = await sql.query(`
      SELECT DISTINCT "status" FROM "InboxItem"
      WHERE "status" IS NOT NULL AND "status" NOT IN ('PENDING','APPROVED','REJECTED','SNOOZED','EXPIRED','COMPLETED')
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'F. Enum / type value drift',
        table: 'InboxItem',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.status),
        description: `InboxItem.status has unexpected values: ${rows.map((r) => r.status).slice(0, 5).join(', ')}`,
        impact: 'Inbox state machine broken for these rows.',
        fix_sql: `-- Spot-check: SELECT DISTINCT "status" FROM "InboxItem";`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'F. Enum / type value drift', table: 'InboxItem', count: 0, sample: [], description: `InboxItem.status drift check failed: ${err.message}`, impact: '' });
  }

  // StockTransfer.status
  try {
    const rows = await sql.query(`
      SELECT DISTINCT "status" FROM "StockTransfer"
      WHERE "status" IS NOT NULL AND "status" NOT IN ('PENDING','IN_TRANSIT','COMPLETED','CANCELLED')
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'F. Enum / type value drift',
        table: 'StockTransfer',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.status),
        description: `StockTransfer.status has unexpected values: ${rows.map((r) => r.status).slice(0, 5).join(', ')}`,
        impact: 'Transfer board filtering off.',
        fix_sql: `-- Spot-check.`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'F. Enum / type value drift', table: 'StockTransfer', count: 0, sample: [], description: `StockTransfer.status drift check failed: ${err.message}`, impact: '' });
  }

  // Payment.status (text)
  try {
    const rows = await sql.query(`
      SELECT DISTINCT "status" FROM "Payment"
      WHERE "status" IS NOT NULL AND "status" NOT IN ('PENDING','POSTED','CLEARED','BOUNCED','REFUNDED','VOID')
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'F. Enum / type value drift',
        table: 'Payment',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.status),
        description: `Payment.status has unexpected values: ${rows.map((r) => r.status).slice(0, 5).join(', ')}`,
        impact: 'Payment reconciliation UI may hide these rows.',
        fix_sql: `-- Spot-check.`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'F. Enum / type value drift', table: 'Payment', count: 0, sample: [], description: `Payment.status drift check failed: ${err.message}`, impact: '' });
  }
}

/**
 * G. Cross-table consistency
 */
async function checkCrossTable() {
  // Order with 0 line items
  try {
    const { count: cnt, sample } = await sampleAndCount(
      `FROM "Order" o LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id" WHERE oi."id" IS NULL`,
      `o."id"`
    );
    if (cnt > 0) {
      addFinding({
        severity: 'P2',
        category: 'G. Cross-table consistency',
        table: 'Order',
        count: cnt,
        sample,
        description: `${cnt} Orders have zero OrderItems.`,
        impact: 'Could be forecast/placeholder orders, or broken imports. Review.',
        fix_sql: `-- Investigate. For forecast/placeholder orders this may be legitimate.\n-- SELECT "id","orderNumber","status","total","isForecast","createdAt" FROM "Order" WHERE "id" IN (SELECT o."id" FROM "Order" o LEFT JOIN "OrderItem" oi ON oi."orderId" = o."id" WHERE oi."id" IS NULL) LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'G. Cross-table consistency', table: 'Order', count: 0, sample: [], description: `Empty Order check failed: ${err.message}`, impact: '' });
  }

  // Invoice with 0 line items but total > 0
  try {
    const rows = await sql.query(`
      SELECT i."id"
      FROM "Invoice" i LEFT JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
      WHERE ii."id" IS NULL AND COALESCE(i."total",0) > 0 LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const cnt = await count(`
        SELECT count(*)::int AS n FROM "Invoice" i
        LEFT JOIN "InvoiceItem" ii ON ii."invoiceId" = i."id"
        WHERE ii."id" IS NULL AND COALESCE(i."total",0) > 0
      `);
      addFinding({
        severity: 'P1',
        category: 'G. Cross-table consistency',
        table: 'Invoice',
        count: cnt,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${cnt} Invoices with total > 0 but zero InvoiceItems.`,
        impact: 'Revenue recognized without line detail. Can\'t explain what\'s being billed.',
        fix_sql: `-- Investigate. SELECT "id","invoiceNumber","orderId","total","status" FROM "Invoice" WHERE "total" > 0 AND "id" NOT IN (SELECT DISTINCT "invoiceId" FROM "InvoiceItem") LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'G. Cross-table consistency', table: 'Invoice', count: 0, sample: [], description: `Empty Invoice check failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrder with 0 line items
  try {
    const rows = await sql.query(`
      SELECT po."id"
      FROM "PurchaseOrder" po LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      WHERE poi."id" IS NULL LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const cnt = await count(`
        SELECT count(*)::int AS n FROM "PurchaseOrder" po
        LEFT JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
        WHERE poi."id" IS NULL
      `);
      addFinding({
        severity: 'P2',
        category: 'G. Cross-table consistency',
        table: 'PurchaseOrder',
        count: cnt,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${cnt} PurchaseOrders with zero PurchaseOrderItems.`,
        impact: 'Empty PO shells; may be legacy seed or canceled drafts.',
        fix_sql: `-- SELECT "id","poNumber","vendorId","status","source","createdAt" FROM "PurchaseOrder" WHERE "id" NOT IN (SELECT DISTINCT "purchaseOrderId" FROM "PurchaseOrderItem") LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'G. Cross-table consistency', table: 'PurchaseOrder', count: 0, sample: [], description: `Empty PO check failed: ${err.message}`, impact: '' });
  }
}

/**
 * H. Temporal coverage
 */
async function checkTemporalCoverage() {
  // Order.orderDate NULL
  try {
    const cnt = await count(`SELECT count(*)::int AS n FROM "Order" WHERE "orderDate" IS NULL`);
    const total = await count(`SELECT count(*)::int AS n FROM "Order"`);
    if (cnt > 0) {
      addFinding({
        severity: cnt > total * 0.5 ? 'P1' : 'P2',
        category: 'H. Temporal coverage',
        table: 'Order',
        count: cnt,
        sample: [],
        description: `${cnt}/${total} Orders have orderDate IS NULL.`,
        impact: 'Forecast rollups, sales-by-month and aging all fall back to createdAt — inaccurate once backdated.',
        fix_sql: `-- Backfill orderDate from createdAt for any row missing it:\n` +
          `UPDATE "Order" SET "orderDate" = "createdAt" WHERE "orderDate" IS NULL;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'H. Temporal coverage', table: 'Order', count: 0, sample: [], description: `Order.orderDate coverage check failed: ${err.message}`, impact: '' });
  }

  // PO.orderedAt NULL rate
  try {
    const cnt = await count(`SELECT count(*)::int AS n FROM "PurchaseOrder" WHERE "orderedAt" IS NULL`);
    const total = await count(`SELECT count(*)::int AS n FROM "PurchaseOrder"`);
    if (cnt > 0) {
      addFinding({
        severity: 'P2',
        category: 'H. Temporal coverage',
        table: 'PurchaseOrder',
        count: cnt,
        sample: [],
        description: `${cnt}/${total} PurchaseOrders have orderedAt IS NULL.`,
        impact: 'AP aging & lead-time reporting miscount.',
        fix_sql: `-- For non-draft POs, backfill from createdAt (see check E):\n-- UPDATE "PurchaseOrder" SET "orderedAt" = "createdAt" WHERE "orderedAt" IS NULL AND "status" NOT IN ('DRAFT','PENDING_APPROVAL','CANCELLED');`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'H. Temporal coverage', table: 'PurchaseOrder', count: 0, sample: [], description: `PO.orderedAt coverage check failed: ${err.message}`, impact: '' });
  }

  // Delivery.completedAt NULL where status=COMPLETE
  try {
    const cnt = await count(`SELECT count(*)::int AS n FROM "Delivery" WHERE "status" = 'COMPLETE' AND "completedAt" IS NULL`);
    if (cnt > 0) {
      addFinding({
        severity: 'P1',
        category: 'H. Temporal coverage',
        table: 'Delivery',
        count: cnt,
        sample: [],
        description: `${cnt} Deliveries with status=COMPLETE but completedAt IS NULL.`,
        impact: 'OTD metric and delivery throughput mis-measured.',
        fix_sql: `-- Backfill from arrivedAt or updatedAt:\n` +
          `UPDATE "Delivery" SET "completedAt" = COALESCE("arrivedAt","updatedAt"), "updatedAt" = now()\n` +
          `WHERE "status" = 'COMPLETE' AND "completedAt" IS NULL;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'H. Temporal coverage', table: 'Delivery', count: 0, sample: [], description: `Delivery completedAt coverage check failed: ${err.message}`, impact: '' });
  }

  // Order.orderDate distribution by year
  try {
    const rows = await sql.query(`
      SELECT EXTRACT(YEAR FROM "orderDate")::int AS yr, COUNT(*)::int AS n
      FROM "Order" WHERE "orderDate" IS NOT NULL GROUP BY 1 ORDER BY 1
    `);
    if (rows.length > 0) {
      const dist = rows.map((r) => `${r.yr}:${r.n}`).join(', ');
      addFinding({
        severity: 'P2',
        category: 'H. Temporal coverage',
        table: 'Order',
        count: rows.length,
        sample: [dist],
        description: `Order.orderDate year distribution: ${dist}`,
        impact: 'Informational — verify there are no surprise gaps or outlier years.',
        fix_sql: null,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'H. Temporal coverage', table: 'Order', count: 0, sample: [], description: `Order year distribution failed: ${err.message}`, impact: '' });
  }
}

/**
 * I. Status coherence
 */
async function checkStatusCoherence() {
  // Order in DELIVERED state without Invoice
  try {
    const rows = await sql.query(`
      SELECT o."id"
      FROM "Order" o LEFT JOIN "Invoice" i ON i."orderId" = o."id"
      WHERE o."status" = 'DELIVERED' AND i."id" IS NULL LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const cnt = await count(`
        SELECT count(*)::int AS n FROM "Order" o LEFT JOIN "Invoice" i ON i."orderId" = o."id"
        WHERE o."status" = 'DELIVERED' AND i."id" IS NULL
      `);
      addFinding({
        severity: 'P1',
        category: 'I. Status coherence',
        table: 'Order',
        count: cnt,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${cnt} Orders in DELIVERED state without a linked Invoice.`,
        impact: 'Revenue delivered but not billed — unbilled revenue / missed AR.',
        fix_sql: `-- Investigate. Possibly needs invoice auto-gen. Sample list:\n-- SELECT "id","orderNumber","builderId","total" FROM "Order" WHERE "status" = 'DELIVERED' AND "id" NOT IN (SELECT "orderId" FROM "Invoice" WHERE "orderId" IS NOT NULL) LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'I. Status coherence', table: 'Order', count: 0, sample: [], description: `DELIVERED order invoice check failed: ${err.message}`, impact: '' });
  }

  // Order in DELIVERED state without Delivery record (via Job->Delivery)
  try {
    const rows = await sql.query(`
      SELECT o."id"
      FROM "Order" o
      LEFT JOIN "Job" j ON j."orderId" = o."id"
      LEFT JOIN "Delivery" d ON d."jobId" = j."id"
      WHERE o."status" = 'DELIVERED'
      GROUP BY o."id"
      HAVING COUNT(d."id") = 0
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'I. Status coherence',
        table: 'Order',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length}+ Orders in DELIVERED state with no Delivery record via any linked Job.`,
        impact: 'Fulfilment audit trail is thin — we know it delivered but can\'t show when/where.',
        fix_sql: `-- Spot-check. Not always a bug — some legacy orders predate Delivery tracking.`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'I. Status coherence', table: 'Order', count: 0, sample: [], description: `DELIVERED order Delivery check failed: ${err.message}`, impact: '' });
  }

  // Invoices in PAID state where amountPaid < total - 0.01
  try {
    const rows = await sql.query(`
      SELECT "id" FROM "Invoice"
      WHERE "status" = 'PAID' AND COALESCE("amountPaid",0) < COALESCE("total",0) - 0.01
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const cnt = await count(`SELECT count(*)::int AS n FROM "Invoice" WHERE "status" = 'PAID' AND COALESCE("amountPaid",0) < COALESCE("total",0) - 0.01`);
      addFinding({
        severity: 'P0',
        category: 'I. Status coherence',
        table: 'Invoice',
        count: cnt,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${cnt} Invoices marked PAID but amountPaid < total.`,
        impact: 'Marking invoice paid while underpaid hides AR. Collections will miss these balances.',
        fix_sql: `-- Recompute status based on payments:\n` +
          `UPDATE "Invoice"\n` +
          `SET "status" = CASE\n` +
          `    WHEN COALESCE("amountPaid",0) >= COALESCE("total",0) - 0.01 THEN 'PAID'\n` +
          `    WHEN COALESCE("amountPaid",0) > 0 THEN 'PARTIALLY_PAID'\n` +
          `    ELSE 'ISSUED'\n` +
          `  END,\n` +
          `    "balanceDue" = COALESCE("total",0) - COALESCE("amountPaid",0),\n` +
          `    "updatedAt" = now()\n` +
          `WHERE "status" = 'PAID' AND COALESCE("amountPaid",0) < COALESCE("total",0) - 0.01;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P0', category: 'I. Status coherence', table: 'Invoice', count: 0, sample: [], description: `PAID invoice balance check failed: ${err.message}`, impact: '' });
  }

  // Invoices in DRAFT with Payments attached
  try {
    const rows = await sql.query(`
      SELECT DISTINCT i."id"
      FROM "Invoice" i JOIN "Payment" p ON p."invoiceId" = i."id"
      WHERE i."status" = 'DRAFT' LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P1',
        category: 'I. Status coherence',
        table: 'Invoice',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length} DRAFT invoices have Payments attached (impossible in normal flow).`,
        impact: 'Payment applied to unfinalized invoice. Likely revenue reported in wrong period.',
        fix_sql: `-- Move these invoices to ISSUED or PAID based on payments:\n` +
          `UPDATE "Invoice" i\n` +
          `SET "status" = CASE WHEN COALESCE(i."amountPaid",0) >= COALESCE(i."total",0) - 0.01 THEN 'PAID' ELSE 'ISSUED' END,\n` +
          `    "issuedAt" = COALESCE(i."issuedAt", i."createdAt"),\n` +
          `    "updatedAt" = now()\n` +
          `WHERE i."status" = 'DRAFT' AND i."id" IN (SELECT DISTINCT "invoiceId" FROM "Payment");`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'I. Status coherence', table: 'Invoice', count: 0, sample: [], description: `DRAFT Invoice Payments check failed: ${err.message}`, impact: '' });
  }

  // POs in RECEIVED status with POItem.receivedQty < quantity
  try {
    const rows = await sql.query(`
      SELECT DISTINCT po."id"
      FROM "PurchaseOrder" po JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"
      WHERE po."status" = 'RECEIVED' AND COALESCE(poi."receivedQty",0) < COALESCE(poi."quantity",0)
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P1',
        category: 'I. Status coherence',
        table: 'PurchaseOrder',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length} POs marked RECEIVED but at least one line is under-received.`,
        impact: 'Inventory-on-order will be wrong; receipt shouldn\'t have closed the PO.',
        fix_sql: `-- Move back to PARTIALLY_RECEIVED; receiving flow will close when lines settle:\n` +
          `UPDATE "PurchaseOrder" SET "status" = 'PARTIALLY_RECEIVED', "updatedAt" = now()\n` +
          `WHERE "status" = 'RECEIVED' AND "id" IN (\n` +
          `  SELECT DISTINCT po."id" FROM "PurchaseOrder" po JOIN "PurchaseOrderItem" poi ON poi."purchaseOrderId" = po."id"\n` +
          `  WHERE po."status" = 'RECEIVED' AND COALESCE(poi."receivedQty",0) < COALESCE(poi."quantity",0)\n` +
          `);`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'I. Status coherence', table: 'PurchaseOrder', count: 0, sample: [], description: `RECEIVED PO line check failed: ${err.message}`, impact: '' });
  }

  // Jobs in COMPLETE state without Delivery
  try {
    const rows = await sql.query(`
      SELECT j."id"
      FROM "Job" j LEFT JOIN "Delivery" d ON d."jobId" = j."id"
      WHERE j."status" IN ('COMPLETE','INVOICED','CLOSED') AND d."id" IS NULL
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      const cnt = await count(`
        SELECT count(*)::int AS n FROM "Job" j LEFT JOIN "Delivery" d ON d."jobId" = j."id"
        WHERE j."status" IN ('COMPLETE','INVOICED','CLOSED') AND d."id" IS NULL
      `);
      addFinding({
        severity: 'P2',
        category: 'I. Status coherence',
        table: 'Job',
        count: cnt,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${cnt} Jobs in COMPLETE/INVOICED/CLOSED state without a Delivery record.`,
        impact: 'Completion tracked without fulfilment evidence. Legacy jobs may predate Delivery entity.',
        fix_sql: `-- Spot-check: SELECT "id","jobNumber","builderName","status","createdAt" FROM "Job" WHERE "status" IN ('COMPLETE','INVOICED','CLOSED') AND "id" NOT IN (SELECT DISTINCT "jobId" FROM "Delivery") LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'I. Status coherence', table: 'Job', count: 0, sample: [], description: `Completed Job Delivery check failed: ${err.message}`, impact: '' });
  }

  // Orders with paymentStatus=PAID but no Invoice marked PAID
  try {
    const rows = await sql.query(`
      SELECT o."id" FROM "Order" o
      WHERE o."paymentStatus" = 'PAID'
        AND NOT EXISTS (SELECT 1 FROM "Invoice" i WHERE i."orderId" = o."id" AND i."status" = 'PAID')
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P1',
        category: 'I. Status coherence',
        table: 'Order',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length}+ Orders with paymentStatus=PAID but no linked PAID Invoice.`,
        impact: 'Order marks itself as paid with no accounting evidence. Accounts may appear current that aren\'t.',
        fix_sql: `-- Spot-check: SELECT "id","orderNumber","paymentStatus","total" FROM "Order" WHERE "paymentStatus" = 'PAID' LIMIT 50;`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P1', category: 'I. Status coherence', table: 'Order', count: 0, sample: [], description: `Order paid without invoice check failed: ${err.message}`, impact: '' });
  }
}

/**
 * J. Table row counts baseline
 */
async function checkRowCounts() {
  const tables = [
    'Builder', 'Community', 'BuilderContact', 'Product', 'BomEntry', 'BuilderPricing',
    'Project', 'Quote', 'QuoteItem', 'Order', 'OrderItem', 'Staff', 'Job', 'Delivery',
    'Installation', 'PunchItem', 'Invoice', 'InvoiceItem', 'Payment', 'PurchaseOrder',
    'PurchaseOrderItem', 'Vendor', 'VendorProduct', 'InventoryItem', 'StockTransfer',
    'StockTransferItem', 'CollectionAction', 'CollectionRule', 'DataQualityRule',
    'DataQualityIssue', 'InboxItem', 'AIInvocation', 'AuditLog', 'CronRun',
    'WebhookEvent', 'FinancialSnapshot', 'Deal', 'DealActivity',
    'OutreachSequence', 'OutreachEnrollment',
  ];

  const counts = {};
  for (const t of tables) {
    try {
      const rows = await sql.query(`SELECT count(*)::int AS n FROM ${q(t)}`);
      counts[t] = Number(rows[0]?.n ?? 0);
    } catch (err) {
      counts[t] = -1; // missing
    }
  }

  // Flag empty tables that should have data
  const expectedPopulated = ['Builder', 'Staff', 'Product', 'Order', 'OrderItem', 'Invoice', 'Vendor', 'PurchaseOrder', 'InventoryItem'];
  const emptyImportant = expectedPopulated.filter((t) => counts[t] === 0);
  if (emptyImportant.length > 0) {
    addFinding({
      severity: 'P0',
      category: 'J. Table row counts',
      table: emptyImportant.join(','),
      count: emptyImportant.length,
      sample: emptyImportant,
      description: `Core tables unexpectedly empty: ${emptyImportant.join(', ')}.`,
      impact: 'The app won\'t work without these.',
      fix_sql: null,
    });
  }

  // Informational dump of all counts
  addFinding({
    severity: 'P2',
    category: 'J. Table row counts',
    table: null,
    count: tables.length,
    sample: Object.entries(counts).map(([t, n]) => `${t}=${n}`),
    description: `Baseline counts (${tables.length} tables): ${Object.entries(counts).map(([t, n]) => `${t}=${n}`).join(', ')}`,
    impact: 'Informational.',
    fix_sql: null,
  });
}

/**
 * K. Dead test data
 */
async function checkTestData() {
  // Builders with obvious test markers
  try {
    const rows = await sql.query(`
      SELECT "id","companyName"
      FROM "Builder"
      WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%'
         OR "companyName" ILIKE '%audit test%' OR "companyName" ILIKE '%test builder%'
         OR "companyName" ILIKE 'e2e %' OR "email" LIKE 'audit-%@%' OR "email" LIKE 'test-%@%'
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'K. Dead test data',
        table: 'Builder',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length} Builder rows look like test/E2E leftovers: ${rows.slice(0, 5).map((r) => r.companyName).join(' | ')}`,
        impact: 'Pollutes reporting and AR lists.',
        fix_sql: `-- Manual cleanup (CASCADE off so reassign/delete dependents first):\n-- SELECT "id","companyName","email" FROM "Builder" WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%' OR "companyName" ILIKE '%audit test%' OR "companyName" ILIKE '%test builder%';\n-- Once clean: DELETE FROM "Builder" WHERE <above> AND "id" NOT IN (SELECT "builderId" FROM "Order") AND "id" NOT IN (SELECT "builderId" FROM "Invoice");`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'K. Dead test data', table: 'Builder', count: 0, sample: [], description: `Test Builder scan failed: ${err.message}`, impact: '' });
  }

  // Orders with test-like orderNumber
  try {
    const rows = await sql.query(`
      SELECT "id","orderNumber"
      FROM "Order"
      WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%'
         OR "orderNumber" ILIKE 'TEST-%' OR "orderNumber" ILIKE 'AUDIT-%'
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'K. Dead test data',
        table: 'Order',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length} Order rows look like E2E leftovers (sample orderNumbers: ${rows.slice(0, 5).map((r) => r.orderNumber).join(', ')})`,
        impact: 'Inflates sales totals.',
        fix_sql: `-- Inspect and delete after confirming no FK dependents.`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'K. Dead test data', table: 'Order', count: 0, sample: [], description: `Test Order scan failed: ${err.message}`, impact: '' });
  }

  // Invoices
  try {
    const rows = await sql.query(`
      SELECT "id","invoiceNumber"
      FROM "Invoice"
      WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%'
         OR "invoiceNumber" ILIKE 'TEST-%' OR "invoiceNumber" ILIKE 'AUDIT-%'
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'K. Dead test data',
        table: 'Invoice',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length} Invoice rows look like E2E leftovers.`,
        impact: 'Inflates AR.',
        fix_sql: `-- SELECT "id","invoiceNumber","total","status" FROM "Invoice" WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%' OR "invoiceNumber" ILIKE 'TEST-%' OR "invoiceNumber" ILIKE 'AUDIT-%';`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'K. Dead test data', table: 'Invoice', count: 0, sample: [], description: `Test Invoice scan failed: ${err.message}`, impact: '' });
  }

  // PurchaseOrders
  try {
    const rows = await sql.query(`
      SELECT "id","poNumber"
      FROM "PurchaseOrder"
      WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%'
         OR "poNumber" ILIKE 'TEST-%' OR "poNumber" ILIKE 'AUDIT-%'
      LIMIT 200
    `);
    rowsScanned += rows.length;
    if (rows.length > 0) {
      addFinding({
        severity: 'P2',
        category: 'K. Dead test data',
        table: 'PurchaseOrder',
        count: rows.length,
        sample: rows.slice(0, 5).map((r) => r.id),
        description: `${rows.length} PurchaseOrder rows look like E2E leftovers.`,
        impact: 'Inflates spend.',
        fix_sql: `-- SELECT "id","poNumber","total","status" FROM "PurchaseOrder" WHERE "id" LIKE 'test-%' OR "id" LIKE 'audit-%' OR "poNumber" ILIKE 'TEST-%' OR "poNumber" ILIKE 'AUDIT-%';`,
      });
    }
  } catch (err) {
    addFinding({ severity: 'P2', category: 'K. Dead test data', table: 'PurchaseOrder', count: 0, sample: [], description: `Test PO scan failed: ${err.message}`, impact: '' });
  }
}

// ── Run ─────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  console.log(`\nAbel OS — DB Integrity Audit (READ-ONLY)\n${new Date().toISOString()}\n`);

  await checkOrphans();
  await checkDrift();
  await checkTimestamps();
  await checkDuplicates();
  await checkNulls();
  await checkEnumDrift();
  await checkCrossTable();
  await checkTemporalCoverage();
  await checkStatusCoherence();
  await checkRowCounts();
  await checkTestData();

  const ms = Date.now() - started;

  // Sort findings: severity, then category
  const sevOrder = { P0: 0, P1: 1, P2: 2 };
  findings.sort((a, b) => (sevOrder[a.severity] - sevOrder[b.severity]) || a.category.localeCompare(b.category));

  const p0 = findings.filter((f) => f.severity === 'P0').length;
  const p1 = findings.filter((f) => f.severity === 'P1').length;
  const p2 = findings.filter((f) => f.severity === 'P2').length;

  // Write JSON
  const jsonPath = path.join(__dirname, 'db-integrity-audit-findings.json');
  writeFileSync(jsonPath, JSON.stringify({
    generatedAt: new Date().toISOString(),
    durationMs: ms,
    rowsScanned,
    summary: { P0: p0, P1: p1, P2: p2, total: findings.length },
    findings,
  }, null, 2));

  // Write Markdown
  const md = buildMarkdown({ ms, p0, p1, p2 });
  writeFileSync(path.join(repoRoot, 'DATA_INTEGRITY_REPORT.md'), md);

  // One-line summary
  console.log(`P0: ${p0} · P1: ${p1} · P2: ${p2} · Total rows scanned: ${rowsScanned} · Duration: ${(ms / 1000).toFixed(1)}s`);
  console.log(`Report written to DATA_INTEGRITY_REPORT.md`);
  console.log(`JSON at scripts/db-integrity-audit-findings.json`);
}

function escapeMd(s) {
  if (s == null) return '';
  return String(s).replace(/\|/g, '\\|');
}

function buildMarkdown({ ms, p0, p1, p2 }) {
  const lines = [];
  lines.push(`# Abel OS — Data Integrity Audit`);
  lines.push('');
  lines.push(`**Generated:** ${new Date().toISOString()}`);
  lines.push(`**Script:** \`scripts/db-integrity-audit.mjs\` (READ-ONLY)`);
  lines.push(`**Duration:** ${(ms / 1000).toFixed(1)}s  \`\`  **Rows scanned:** ${rowsScanned.toLocaleString()}`);
  lines.push('');
  lines.push(`## Summary`);
  lines.push('');
  lines.push(`| Severity | Count |`);
  lines.push(`|---|---|`);
  lines.push(`| P0 (breaking) | ${p0} |`);
  lines.push(`| P1 (data accuracy) | ${p1} |`);
  lines.push(`| P2 (informational / minor) | ${p2} |`);
  lines.push(`| **Total findings** | **${findings.length}** |`);
  lines.push('');

  const sev = ['P0', 'P1', 'P2'];
  for (const s of sev) {
    const group = findings.filter((f) => f.severity === s);
    if (group.length === 0) continue;
    const label = s === 'P0' ? 'P0 — Breaking: data is actively wrong or required fields missing'
      : s === 'P1' ? 'P1 — Data accuracy: fix within days'
      : 'P2 — Informational / minor';
    lines.push(`## ${label}`);
    lines.push('');
    // Group by category within severity
    const byCategory = {};
    for (const f of group) {
      (byCategory[f.category] = byCategory[f.category] || []).push(f);
    }
    for (const cat of Object.keys(byCategory).sort()) {
      lines.push(`### ${cat}`);
      lines.push('');
      for (const f of byCategory[cat]) {
        lines.push(`#### ${escapeMd(f.table || 'multi')} — ${escapeMd(f.description)}`);
        lines.push('');
        lines.push(`- **Count:** ${f.count}`);
        if (f.sample?.length) {
          lines.push(`- **Sample:** \`${f.sample.slice(0, 5).map((x) => String(x)).join('`, `')}\``);
        }
        if (f.impact) {
          lines.push(`- **Impact:** ${f.impact}`);
        }
        if (f.fix_sql) {
          lines.push('');
          lines.push('```sql');
          lines.push(f.fix_sql);
          lines.push('```');
        }
        lines.push('');
      }
    }
  }

  lines.push(`---`);
  lines.push(``);
  lines.push(`**One-line summary:** P0: ${p0} · P1: ${p1} · P2: ${p2} · Total rows scanned: ${rowsScanned} · Duration: ${(ms / 1000).toFixed(1)}s`);
  lines.push('');

  return lines.join('\n');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
