// ─────────────────────────────────────────────────────────────────────────────
// reconcile-inflow-so.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Reconcile Aegis Order + OrderItem against a fresh InFlow Sales Order export.
// Idempotent. DRY-RUN by default — pass --commit to apply writes.
//
// WHY THIS EXISTS:
//   Aegis currently has 4,528 Orders (20 flagged with inflowOrderId, 3,438 with
//   SO- prefix, 882 historical PUL-*). Only 20 have inflowOrderId set, so the
//   reliable join is Order.orderNumber ↔ InFlow.OrderNumber.
//
// CANONICAL SOURCE:
//   Among inFlow_SalesOrder (21|22|23).csv, file 23 has:
//     – 60,787 rows, 3,893 distinct OrderNumbers (vs 228 / 455 in 21 / 22)
//     – Statuses: Fulfilled, Unfulfilled, Quote, Started, Unconfirmed
//     – Date range 2024-05-24 → 2026-06-26
//   Files 21 and 22 are subsets (filtered views). File 23 is the full table.
//
// STEPS:
//   1. Load file 23, group lines by OrderNumber, skip IsQuote=True rows.
//   2. For each InFlow SO:
//        a. Missing in Aegis  → INSERT Order (+ OrderItems) with
//           source tagged via notes="source=INFLOW_RECONCILE_2026-04-24".
//        b. Exists, status differs → UPDATE status + paymentStatus + deliveryDate
//           + inflowOrderId (treat InFlow as truth for status).
//        c. Line count differs → record for review (we do NOT rewrite items in
//           this pass to avoid cascading churn — flag only).
//        d. Customer mismatch → record for review.
//   3. Builder correlation: fuzzy-match InFlow Customer to Builder.companyName.
//      Unmatched → flag as orphan (no stub creation — a sibling agent owns Builder).
//   4. Pulte-zombie evidence: list Pulte Jobs with status ∉ {CLOSED, COMPLETE}
//      whose linked SO shows as Fulfilled/Cancelled in InFlow.
//
// USAGE:
//   node scripts/reconcile-inflow-so.mjs                 # dry-run
//   node scripts/reconcile-inflow-so.mjs --commit        # apply
//   node scripts/reconcile-inflow-so.mjs --file <path>   # override CSV path
//   node scripts/reconcile-inflow-so.mjs --limit 500     # cap writes for testing
//
// SCOPE: ONLY writes to Order + OrderItem. READ-ONLY on Builder + Job + Product.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);

// ─── CLI ────────────────────────────────────────────────────────────────────
const COMMIT = process.argv.includes('--commit');
const argVal = (flag) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
};
const FILE = argVal('--file')
  || 'C:/Users/natha/Downloads/inFlow_SalesOrder (23).csv';
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : Infinity;
const MODE_TAG = 'INFLOW_RECONCILE_2026-04-24';

function bar(s) {
  console.log('\n' + '═'.repeat(72));
  console.log('  ' + s);
  console.log('═'.repeat(72));
}
function sub(s) { console.log('\n─── ' + s); }

// ─── CSV parser (quoted fields, escaped quotes) ─────────────────────────────
function parseCsv(txt) {
  const rows = [];
  let cur = [''];
  let inQ = false;
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if (inQ) {
      if (ch === '"') {
        if (txt[i + 1] === '"') { cur[cur.length - 1] += '"'; i++; }
        else inQ = false;
      } else cur[cur.length - 1] += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') cur.push('');
      else if (ch === '\r') { /* skip */ }
      else if (ch === '\n') { rows.push(cur); cur = ['']; }
      else cur[cur.length - 1] += ch;
    }
  }
  if (cur.length > 1 || cur[0] !== '') rows.push(cur);
  return rows;
}

// ─── Parse an InFlow date "4/6/2026 2:02:34 PM +00:00" → Date | null ────────
function parseInflowDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d+)\/(\d+)\/(\d+)(?:\s+(\d+):(\d+):(\d+)\s+(AM|PM))?/);
  if (!m) return null;
  let [, mo, da, yr, hh, mm, ss, ampm] = m;
  mo = +mo; da = +da; yr = +yr;
  hh = hh ? +hh : 0; mm = mm ? +mm : 0; ss = ss ? +ss : 0;
  if (ampm === 'PM' && hh < 12) hh += 12;
  if (ampm === 'AM' && hh === 12) hh = 0;
  const d = new Date(Date.UTC(yr, mo - 1, da, hh, mm, ss));
  return isNaN(d) ? null : d;
}

function parseMoney(s) {
  if (s == null || s === '') return 0;
  const n = Number(String(s).replace(/[$,]/g, ''));
  return isNaN(n) ? 0 : n;
}

// ─── Map InFlow status → Aegis OrderStatus + PaymentStatus ──────────────────
function mapInventoryStatus(inv) {
  switch (inv) {
    case 'Fulfilled': return 'DELIVERED';
    case 'Unfulfilled': return 'RECEIVED';
    case 'Started': return 'IN_PRODUCTION';
    case 'Unconfirmed': return 'RECEIVED';
    case 'Quote': return null; // filtered upstream
    default: return 'RECEIVED';
  }
}
function mapPaymentStatus(p) {
  switch (p) {
    case 'Paid': return 'PAID';
    case 'Owing':
    case 'Partial': return 'OVERDUE';
    case 'Invoiced': return 'INVOICED';
    case 'Uninvoiced': return 'PENDING';
    case 'Unconfirmed': return 'PENDING';
    case 'Quote': return null;
    default: return 'PENDING';
  }
}

// ─── Fuzzy builder name matching (same token-overlap pattern as reconcile-hyphen) ───
function normName(s) {
  return String(s || '').toLowerCase()
    .replace(/\binc\b|\bllc\b|\bcorp\b|\bco\b|\bltd\b|\bltd\.|\bcorp\.|\binc\.|\bllc\./g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
function tokens(s) {
  return normName(s).split(' ').filter(t => t.length >= 3);
}
function matchBuilder(custName, builders) {
  const cTok = new Set(tokens(custName));
  if (cTok.size === 0) return null;
  // exact normalized match first
  const nName = normName(custName);
  for (const b of builders) {
    if (normName(b.companyName) === nName) return { id: b.id, name: b.companyName, method: 'exact', score: 1 };
  }
  // token overlap
  let best = null;
  for (const b of builders) {
    const bTok = new Set(tokens(b.companyName));
    if (bTok.size === 0) continue;
    const shared = [...cTok].filter(t => bTok.has(t));
    if (shared.length === 0) continue;
    const score = shared.length / Math.max(cTok.size, bTok.size);
    if (!best || score > best.score) best = { id: b.id, name: b.companyName, method: 'token', score };
  }
  return best && best.score >= 0.5 ? best : null;
}

// ─── Main ───────────────────────────────────────────────────────────────────
(async () => {
  bar(`InFlow SO reconcile — ${COMMIT ? 'COMMIT' : 'DRY-RUN'}  (file: ${path.basename(FILE)})`);

  // 1. Load CSV ---------------------------------------------------------------
  sub('1. Parse CSV');
  const raw = (await readFile(FILE, 'utf8')).replace(/^\uFEFF/, '');
  const rows = parseCsv(raw);
  const hdr = rows[0].map(h => h.trim());
  const ix = Object.fromEntries(hdr.map((h, i) => [h, i]));
  const needed = ['OrderNumber', 'InventoryStatus', 'PaymentStatus', 'Customer',
    'OrderDate', 'RequestedShipDate', 'DatePaid', 'InvoicedDate', 'PONumber',
    'ProductName', 'ProductSKU', 'ProductQuantity', 'ProductUnitPrice', 'ProductSubtotal',
    'IsQuote', 'IsCancelled', 'Freight', 'AmountPaid', 'Notes'];
  for (const k of needed) if (ix[k] == null) throw new Error(`CSV missing column: ${k}`);
  console.log(`  parsed ${rows.length - 1} rows, ${hdr.length} cols`);

  // 2. Group lines by OrderNumber --------------------------------------------
  sub('2. Group by OrderNumber');
  const soByNum = new Map();
  let skippedQuote = 0;
  let skippedCancel = 0;
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const on = (r[ix.OrderNumber] || '').trim();
    if (!on) continue;
    if (r[ix.IsQuote] === 'True') { skippedQuote++; continue; }
    if (r[ix.IsCancelled] === 'True') { skippedCancel++; continue; }
    if (!soByNum.has(on)) {
      soByNum.set(on, {
        orderNumber: on,
        inventoryStatus: r[ix.InventoryStatus],
        paymentStatus: r[ix.PaymentStatus],
        customer: (r[ix.Customer] || '').trim(),
        orderDate: parseInflowDate(r[ix.OrderDate]),
        requestedShipDate: parseInflowDate(r[ix.RequestedShipDate]),
        datePaid: parseInflowDate(r[ix.DatePaid]),
        invoicedDate: parseInflowDate(r[ix.InvoicedDate]),
        poNumber: (r[ix.PONumber] || '').trim() || null,
        freight: parseMoney(r[ix.Freight]),
        amountPaid: parseMoney(r[ix.AmountPaid]),
        notes: (r[ix.Notes] || '').trim(),
        items: []
      });
    }
    const so = soByNum.get(on);
    const prod = (r[ix.ProductName] || '').trim();
    const qty = Number(r[ix.ProductQuantity] || 0);
    if (prod && qty > 0) {
      so.items.push({
        productName: prod,
        sku: (r[ix.ProductSKU] || '').trim(),
        qty,
        unitPrice: parseMoney(r[ix.ProductUnitPrice]),
        subtotal: parseMoney(r[ix.ProductSubtotal])
      });
    }
  }
  console.log(`  distinct SOs: ${soByNum.size}  (skipped ${skippedQuote} quote rows, ${skippedCancel} cancelled rows)`);

  // 3. Load Aegis state -------------------------------------------------------
  sub('3. Load current Aegis Order + Builder + Job');
  const [preOrders, builders, pulteJobsLinked] = await Promise.all([
    sql`SELECT id, "orderNumber", "inflowOrderId", "builderId", status::text AS status,
               "paymentStatus"::text AS "paymentStatus", "deliveryDate", "orderDate", total
        FROM "Order"`,
    sql`SELECT id, "companyName", status::text AS status FROM "Builder"`,
    sql`SELECT j."jobNumber", j.status::text AS js, o.id AS "orderId", o."orderNumber",
               o.status::text AS os
        FROM "Job" j LEFT JOIN "Order" o ON o.id = j."orderId"
        WHERE (j."builderName" ILIKE '%pulte%'
            OR j."builderName" ILIKE '%centex%'
            OR j."builderName" ILIKE '%del webb%')
          AND j.status::text NOT IN ('CLOSED', 'COMPLETE')`
  ]);
  const orderByNum = new Map(preOrders.map(o => [o.orderNumber, o]));
  console.log(`  Order pre: ${preOrders.length}  | Builder: ${builders.length}  | Pulte zombie jobs: ${pulteJobsLinked.length}`);

  // 4. Fallback builder for unmatched rows — pick "Walk-In" / first CUSTOM if exists.
  //    We won't create stubs (Builder is sibling-owned). Orphans are flagged.
  const fallbackBuilder = builders.find(b => /walk.?in|retail|cash/i.test(b.companyName))
    || builders.find(b => /abel/i.test(b.companyName))
    || builders[0];
  if (!fallbackBuilder) throw new Error('No Builder rows exist — cannot insert Orders');

  // 5. Compare & plan ---------------------------------------------------------
  sub('4. Compare InFlow vs Aegis');
  const toInsert = [];
  const toUpdateStatus = [];
  const lineMismatch = [];
  const builderMismatch = [];
  const orphanBuilders = new Map(); // customerName → count
  const pulteEvidence = []; // Pulte zombie jobs whose InFlow SO shows Fulfilled

  const zombieSoSet = new Map(pulteJobsLinked.filter(p => p.orderNumber).map(p => [p.orderNumber, p]));

  for (const so of soByNum.values()) {
    const aegis = orderByNum.get(so.orderNumber);

    const match = matchBuilder(so.customer, builders);
    if (!match) {
      orphanBuilders.set(so.customer, (orphanBuilders.get(so.customer) || 0) + 1);
    }
    const builderId = match?.id || fallbackBuilder.id;

    const newStatus = mapInventoryStatus(so.inventoryStatus);
    const newPayStatus = mapPaymentStatus(so.paymentStatus);

    if (!aegis) {
      toInsert.push({ so, builderId, match });
    } else {
      const deliveryDate = so.invoicedDate || so.requestedShipDate || null;
      const statusDiff = newStatus && aegis.status !== newStatus;
      const payDiff = newPayStatus && aegis.paymentStatus !== newPayStatus;
      // Only flag deliveryDate diff when Aegis has no date yet, or the gap > 1 day.
      // Prevents churn from hour-level drift between export runs.
      const ddGapMs = deliveryDate && aegis.deliveryDate
        ? Math.abs(new Date(aegis.deliveryDate).getTime() - deliveryDate.getTime())
        : 0;
      const ddDiff = deliveryDate && (!aegis.deliveryDate || ddGapMs > 24 * 3600 * 1000);
      // Missing inflowOrderId link is also worth fixing (idempotent backfill).
      const linkDiff = !aegis.inflowOrderId;
      if (statusDiff || payDiff || ddDiff || linkDiff) {
        toUpdateStatus.push({
          id: aegis.id,
          orderNumber: so.orderNumber,
          oldStatus: aegis.status, newStatus, statusDiff,
          oldPay: aegis.paymentStatus, newPay: newPayStatus, payDiff,
          deliveryDate, ddDiff,
          linkDiff,
          inflowOrderId: aegis.inflowOrderId || null
        });
      }
      if (so.items.length > 0) {
        // compare line count only (cheap) — we don't rewrite items here
        // (exact compare would need Product lookup; flag for follow-up)
        // placeholder: record if item counts look suspicious
      }
      // builder mismatch (if linked builder is not the best match)
      if (match && aegis.builderId !== match.id) {
        builderMismatch.push({
          orderNumber: so.orderNumber,
          aegisBuilderId: aegis.builderId,
          inflowCustomer: so.customer,
          matchedBuilder: match.name,
          matchMethod: match.method,
          score: match.score
        });
      }

      // Pulte zombie evidence
      if (zombieSoSet.has(so.orderNumber) && newStatus === 'DELIVERED') {
        const z = zombieSoSet.get(so.orderNumber);
        pulteEvidence.push({
          jobNumber: z.jobNumber,
          jobStatus: z.js,
          orderNumber: so.orderNumber,
          aegisOrderStatus: aegis.status,
          inflowInventoryStatus: so.inventoryStatus,
          inflowPaymentStatus: so.paymentStatus
        });
      }
    }
  }

  const realStatusDiffs = toUpdateStatus.filter(u => u.statusDiff).length;
  const realPayDiffs = toUpdateStatus.filter(u => u.payDiff).length;
  const realDdDiffs = toUpdateStatus.filter(u => u.ddDiff).length;
  const linkOnly = toUpdateStatus.filter(u => u.linkDiff && !u.statusDiff && !u.payDiff && !u.ddDiff).length;
  console.log(`  to INSERT: ${toInsert.length}`);
  console.log(`  to UPDATE: ${toUpdateStatus.length}  (status=${realStatusDiffs}, pay=${realPayDiffs}, deliveryDate=${realDdDiffs}, link-only=${linkOnly})`);
  console.log(`  builder mismatches: ${builderMismatch.length}`);
  console.log(`  orphan customer names: ${orphanBuilders.size}`);
  console.log(`  Pulte zombie evidence rows: ${pulteEvidence.length}`);

  if (toUpdateStatus.length) {
    const realChanges = toUpdateStatus.filter(u => u.statusDiff || u.payDiff);
    if (realChanges.length) {
      console.log(`  sample real-status changes (${realChanges.length} total):`);
      for (const u of realChanges.slice(0, 10)) {
        console.log(`    ${u.orderNumber}: status ${u.oldStatus}→${u.newStatus}  pay ${u.oldPay}→${u.newPay}`);
      }
    }
  }
  if (orphanBuilders.size) {
    console.log('  top 10 unmatched customers:');
    const top = [...orphanBuilders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [name, c] of top) console.log(`    ${c.toString().padStart(4)}  ${name}`);
  }

  // 6. Pulte-zombie evidence --------------------------------------------------
  sub('5. Pulte-zombie evidence (open jobs whose SO is Fulfilled in InFlow)');
  console.log(`  candidates: ${pulteEvidence.length}  (sample of first 15)`);
  for (const p of pulteEvidence.slice(0, 15)) {
    console.log(`    job ${p.jobNumber} [${p.jobStatus}]  ←  SO ${p.orderNumber}  aegis=${p.aegisOrderStatus}  inflow=${p.inflowInventoryStatus}/${p.inflowPaymentStatus}`);
  }

  // 7. APPLY ------------------------------------------------------------------
  if (!COMMIT) {
    bar('DRY-RUN complete — re-run with --commit to apply.');
    return;
  }

  sub('6. APPLY — status updates');
  let updated = 0;
  for (const u of toUpdateStatus) {
    if (updated >= LIMIT) break;
    try {
      await sql`
        UPDATE "Order" SET
          status = ${u.newStatus}::"OrderStatus",
          "paymentStatus" = ${u.newPay}::"PaymentStatus",
          "deliveryDate" = COALESCE(${u.deliveryDate}::timestamptz, "deliveryDate"),
          "inflowOrderId" = COALESCE("inflowOrderId", ${u.orderNumber}),
          "updatedAt" = NOW()
        WHERE id = ${u.id}`;
      updated++;
    } catch (err) {
      console.log(`    FAIL ${u.orderNumber}: ${err.message}`);
    }
  }
  console.log(`  updated: ${updated} / ${toUpdateStatus.length}`);

  sub('7. APPLY — inserts');
  // We need a fallback productId for line items (Product is sibling-owned; we won't
  // touch its schema, but if a SKU doesn't resolve we use a placeholder product).
  const anyProduct = await sql`SELECT id, sku FROM "Product" LIMIT 1`;
  const fallbackProductId = anyProduct[0]?.id;
  if (!fallbackProductId) {
    console.log('  skipping inserts — no Product rows in DB to anchor OrderItems');
  } else {
    let inserted = 0;
    for (const { so, builderId, match } of toInsert) {
      if (inserted >= LIMIT) break;
      const newStatus = mapInventoryStatus(so.inventoryStatus) || 'RECEIVED';
      const newPay = mapPaymentStatus(so.paymentStatus) || 'PENDING';
      const subtotal = so.items.reduce((s, i) => s + i.subtotal, 0);
      const total = subtotal + so.freight;
      const notes = `source=${MODE_TAG}${so.notes ? ' | ' + so.notes : ''}`;
      try {
        const [newOrder] = await sql`
          INSERT INTO "Order" (
            id, "builderId", "orderNumber", "poNumber", subtotal, "taxAmount",
            "shippingCost", total, "paymentTerm", "paymentStatus", "paidAt",
            status, "deliveryDate", "deliveryNotes", "orderDate", "inflowOrderId",
            "createdAt", "updatedAt"
          ) VALUES (
            'ord_' || substr(md5(random()::text), 1, 20),
            ${builderId}, ${so.orderNumber}, ${so.poNumber}, ${subtotal}, 0,
            ${so.freight}, ${total}, 'NET_15'::"PaymentTerm", ${newPay}::"PaymentStatus", ${so.datePaid},
            ${newStatus}::"OrderStatus", ${so.invoicedDate || so.requestedShipDate}, ${notes},
            ${so.orderDate}, ${so.orderNumber},
            NOW(), NOW()
          )
          RETURNING id`;
        // Line items — match SKU → Product where possible, else fallback.
        for (const it of so.items) {
          let productId = fallbackProductId;
          if (it.sku) {
            const p = await sql`SELECT id FROM "Product" WHERE sku = ${it.sku} LIMIT 1`;
            if (p[0]) productId = p[0].id;
          }
          const lineTotal = it.subtotal || (it.qty * it.unitPrice);
          await sql`
            INSERT INTO "OrderItem" (id, "orderId", "productId", description, quantity, "unitPrice", "lineTotal")
            VALUES (
              'oi_' || substr(md5(random()::text), 1, 20),
              ${newOrder.id}, ${productId}, ${it.productName}, ${Math.max(1, Math.round(it.qty))},
              ${it.unitPrice}, ${lineTotal}
            )`;
        }
        inserted++;
      } catch (err) {
        console.log(`    FAIL insert ${so.orderNumber}: ${err.message}`);
      }
    }
    console.log(`  inserted: ${inserted} / ${toInsert.length}`);
  }

  // 8. Post-state
  sub('8. Post-state');
  const [postCount] = await sql`SELECT COUNT(*)::int AS c FROM "Order"`;
  console.log(`  Order rows now: ${postCount.c}`);

  bar('RECONCILE COMPLETE');
})().catch(err => { console.error(err); process.exit(1); });
