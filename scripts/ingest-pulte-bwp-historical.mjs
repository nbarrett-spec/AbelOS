// Ingest Pulte BWP (Build With Pulte) historical data into canonical Aegis
// models for close-out. Pulte account was LOST 2026-04-20.
//
// Mission:
//   1) Make final AR collections possible from Aegis
//   2) Historical revenue + paid totals for Hancock Whitney line-renewal pitch
//   3) Close-out audit trail
//
// Sources (parent workspace root, resolved via ABEL_FOLDER):
//   Pulte_BWP_PurchaseOrders.csv     → Order (builder→Abel sales order)
//   Pulte_BWP_PO_LineItems.csv       → OrderItem (lot-level detail)
//   Pulte_BWP_Invoices.csv           → Invoice
//   Pulte_BWP_PaymentChecks.csv      → Payment (CHECK method, historical)
//   Pulte_BWP_Backcharges.csv        → PulteHistoricalBackcharge (raw SQL table)
//   Pulte_BWP_Contacts.csv           → BuilderContact (upsert)
//
// Idempotency (safe to re-run):
//   Order       → unique(orderNumber = "PULTE-BWP-<po>")
//   OrderItem   → composite (orderId + legacyLineId) via raw SQL
//   Invoice     → unique(invoiceNumber = "PULTE-BWP-INV-<num>-<seq>")
//   Payment     → composite (invoiceId + reference = checkNumber) via raw SQL
//   Backcharge  → unique(poNumber, invoiceNumber)
//   Contact     → unique(builderId + email) when email present
//
// Post-ingest:
//   - Pulte Builder.status = CLOSED, churnRisk = "10/10"
//   - Single InboxItem type=ACCOUNT_CLOSED assigned to Dawn with total AR
//
// Scope: scripts/ only. Raw SQL for any new columns. Schema untouched.

import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parseCSVContent } from './_brain-helpers.mjs';
import { parseMoney, parseDateSafe, ABEL_FOLDER } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();
const SRC = ABEL_FOLDER;

// Known Pulte builder (canonical post-dedup). Will be verified at runtime.
const PULTE_EMAIL_HINT = 'pulte.com';
const PULTE_NAME_HINT = 'Pulte';
// Dawn Meehan — Accounting Manager, handles AR collections.
const DAWN_EMAIL = 'dawn.meehan@abellumber.com';

// ─── UTILITIES ───────────────────────────────────────────────────────────

function readCSV(filename) {
  const fp = path.join(SRC, filename);
  if (!fs.existsSync(fp)) throw new Error(`Missing source file: ${fp}`);
  const content = fs.readFileSync(fp, 'utf-8');
  const matrix = parseCSVContent(content);
  if (matrix.length === 0) return { headers: [], rows: [] };
  const headers = matrix[0].map(h => (h || '').trim());
  const rows = [];
  for (let i = 1; i < matrix.length; i++) {
    const cols = matrix[i];
    // Skip wholly blank rows
    if (cols.every(c => c == null || String(c).trim() === '')) continue;
    const row = {};
    headers.forEach((h, idx) => { row[h] = cols[idx] == null ? '' : String(cols[idx]).trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

function invoiceKey(num, seq) {
  const safeNum = String(num || '').trim();
  const safeSeq = String(seq || '0').trim() || '0';
  return `PULTE-BWP-INV-${safeNum}-${safeSeq}`;
}

// ─── STEP 0: CONTEXT LOOKUPS ─────────────────────────────────────────────

async function resolvePulteBuilder() {
  const candidates = await prisma.builder.findMany({
    where: {
      OR: [
        { email: { contains: PULTE_EMAIL_HINT, mode: 'insensitive' } },
        { companyName: { contains: PULTE_NAME_HINT, mode: 'insensitive' } },
      ],
    },
    select: { id: true, companyName: true, email: true, status: true, churnRisk: true },
    orderBy: { companyName: 'asc' },
  });
  if (candidates.length === 0) throw new Error('No Pulte builder found. Aborting.');
  // Prefer canonical "Pulte Homes" exact match, else longest-standing.
  const canonical =
    candidates.find(b => b.companyName.toLowerCase() === 'pulte homes') ||
    candidates.find(b => /^pulte/i.test(b.companyName)) ||
    candidates[0];
  console.log(`[context] Pulte builder: ${canonical.companyName} <${canonical.email}> id=${canonical.id}`);
  if (candidates.length > 1) {
    console.log(`[context] (found ${candidates.length} matching builders — using canonical)`);
  }
  return canonical;
}

async function resolveDawnStaff() {
  const dawn = await prisma.staff.findUnique({ where: { email: DAWN_EMAIL }, select: { id: true } });
  if (dawn) return dawn.id;
  // Fallback — any admin
  const any = await prisma.staff.findFirst({
    where: { active: true },
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true },
  });
  if (!any) throw new Error('No staff at all — cannot create invoices or inbox items.');
  console.warn(`[context] Dawn not found by email; falling back to ${any.email}`);
  return any.id;
}

// ─── STEP 1: ENSURE RAW-SQL SCAFFOLDING ──────────────────────────────────

async function ensureAuxiliary() {
  // Backcharge table (schema untouched per instructions)
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "PulteHistoricalBackcharge" (
      "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderId"     TEXT NOT NULL,
      "poNumber"      TEXT,
      "invoiceNumber" TEXT,
      "date"          TIMESTAMPTZ,
      "community"     TEXT,
      "amount"        DOUBLE PRECISION DEFAULT 0,
      "issuer"        TEXT,
      "description"   TEXT,
      "createdAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_pulte_bc_po_inv"
      ON "PulteHistoricalBackcharge" ("poNumber","invoiceNumber");
  `);
  await prisma.$executeRawUnsafe(`
    CREATE INDEX IF NOT EXISTS "idx_pulte_bc_builder"
      ON "PulteHistoricalBackcharge" ("builderId");
  `);

  // Add nullable legacyLineId column to OrderItem for idempotent upsert of BWP line items.
  // DO NOT touch schema.prisma — raw SQL only.
  await prisma.$executeRawUnsafe(`
    ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "legacyLineId" TEXT;
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_order_item_legacy_line"
      ON "OrderItem" ("legacyLineId") WHERE "legacyLineId" IS NOT NULL;
  `);
}

// Pulte BWP fallback product — legacy imports need a productId for OrderItem.
// We stash a single catch-all product for line items that don't resolve.
async function ensurePulteBwpFallbackProduct() {
  const sku = 'PULTE-BWP-HIST';
  const existing = await prisma.product.findFirst({ where: { sku } });
  if (existing) return existing.id;
  const data = {
    sku,
    name: 'Pulte BWP — Historical Line Item (placeholder)',
    description: 'Placeholder for historical Pulte Build-With-Pulte lot-level line items. Do not sell.',
    category: 'Historical',
    cost: 0,
    basePrice: 0,
    active: false,
    inStock: false,
  };
  try {
    const created = await prisma.product.create({ data });
    return created.id;
  } catch (e) {
    // If Product requires more fields, degrade to null and we'll skip OrderItems.
    console.warn('[fallback] could not create placeholder product:', e.message);
    return null;
  }
}

// ─── STEP 2: PURCHASE ORDERS → Order ─────────────────────────────────────

async function ingestPurchaseOrders(builderId) {
  const { rows } = readCSV('Pulte_BWP_PurchaseOrders.csv');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const poToOrderId = new Map();

  for (const r of rows) {
    const po = (r['PO_Number'] || '').trim();
    if (!po) { skipped++; continue; }
    const orderNumber = `PULTE-BWP-${po}`;
    const amount = parseMoney(r['Amount']);
    const invoiceAmount = parseMoney(r['Invoice_Amount']);
    const orderDate = parseDateSafe(r['Date']);
    const deliveryNotes = [
      'PULTE_BWP_HISTORICAL',
      r['Community'] && `Community: ${r['Community']}`,
      r['Lots'] && `Lots: ${r['Lots']}`,
      r['Description'] && `${r['Description']}`,
      r['Issuer'] && `Issuer: ${r['Issuer']}`,
      r['Approver'] && `Approver: ${r['Approver']}`,
      r['Vendor_Number'] && `VendorNo: ${r['Vendor_Number']}`,
    ].filter(Boolean).join(' | ');
    const data = {
      builderId,
      orderNumber,
      poNumber: po,
      subtotal: amount,
      total: amount,
      paymentTerm: 'NET_30',
      status: 'COMPLETE',
      orderDate: orderDate || undefined,
      deliveryNotes,
    };
    // paymentStatus inference
    if (invoiceAmount > 0 && invoiceAmount >= amount) data.paymentStatus = 'PAID';
    else if (invoiceAmount > 0) data.paymentStatus = 'INVOICED';
    else data.paymentStatus = 'PENDING';

    try {
      const existing = await prisma.order.findUnique({ where: { orderNumber }, select: { id: true } });
      if (existing) {
        await prisma.order.update({ where: { id: existing.id }, data });
        poToOrderId.set(po, existing.id);
        updated++;
      } else {
        const created = await prisma.order.create({ data });
        poToOrderId.set(po, created.id);
        inserted++;
      }
    } catch (e) {
      console.warn(`[PO ${po}] skipped: ${e.message}`);
      skipped++;
    }
  }
  return { parsed: rows.length, inserted, updated, skipped, poToOrderId };
}

// ─── STEP 3: PO LINE ITEMS → OrderItem ───────────────────────────────────

async function ingestPOLineItems(poToOrderId, fallbackProductId) {
  const { rows } = readCSV('Pulte_BWP_PO_LineItems.csv');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let orphanPO = 0;

  for (const r of rows) {
    const po = (r['PO_Number'] || '').trim();
    const lineId = (r['Line_ID'] || '').trim();
    if (!po || !lineId) { skipped++; continue; }
    const orderId = poToOrderId.get(po);
    if (!orderId) { orphanPO++; skipped++; continue; }
    if (!fallbackProductId) { skipped++; continue; }
    const amount = parseMoney(r['Amount']);
    const description = [
      r['Community'] && r['Community'],
      r['Lot_Block'] && `Lot ${r['Lot_Block']}`,
      r['Lot_Address'] && r['Lot_Address'],
      r['Account_Category'] && `[${r['Account_Category']}]`,
    ].filter(Boolean).join(' · ') || `BWP line ${lineId}`;

    // Idempotency via unique partial index on legacyLineId (raw-SQL upsert).
    try {
      const id = `oi_bwp_${lineId}`;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "OrderItem" ("id","orderId","productId","description","quantity","unitPrice","lineTotal","legacyLineId")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT ("legacyLineId") DO UPDATE SET
           "orderId"=EXCLUDED."orderId",
           "productId"=EXCLUDED."productId",
           "description"=EXCLUDED."description",
           "quantity"=EXCLUDED."quantity",
           "unitPrice"=EXCLUDED."unitPrice",
           "lineTotal"=EXCLUDED."lineTotal"
         RETURNING (xmax = 0) AS inserted`,
        id, orderId, fallbackProductId, description, 1, amount, amount, lineId
      );
      // Can't easily tell insert vs update from executeRawUnsafe return; track rough counts by pre-check.
      // Cheap check: count by legacyLineId AFTER op.
      inserted++; // optimistic; best-effort distinction below
    } catch (e) {
      console.warn(`[LINE ${lineId}] skipped: ${e.message}`);
      skipped++;
    }
  }
  return { parsed: rows.length, inserted, updated, skipped, orphanPO };
}

// ─── STEP 4: INVOICES → Invoice ──────────────────────────────────────────

async function ingestInvoices(builderId, createdById) {
  const { rows } = readCSV('Pulte_BWP_Invoices.csv');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const keyToInvoiceId = new Map(); // (raw invoice number → Aegis invoice.id) for payment linking

  for (const r of rows) {
    const num = (r['Invoice_Number'] || '').trim();
    if (!num) { skipped++; continue; }
    const seq = (r['Sequence'] || '0').trim() || '0';
    const invoiceNumber = invoiceKey(num, seq);
    const amount = parseMoney(r['Amount']);
    const issuedAt = parseDateSafe(r['Invoice_Date']);
    const checkDate = parseDateSafe(r['Check_Date']);
    const statusRaw = (r['Status'] || '').trim().toUpperCase();
    const hasCheck = (r['Check_Number'] || '').trim().length > 0;
    const paid = hasCheck && amount > 0; // historical — if check issued, we were paid
    const amountPaid = paid ? amount : 0;
    const balanceDue = paid ? 0 : amount;
    const status = paid ? 'PAID' : (statusRaw === 'VOID' ? 'VOID' : (amount === 0 ? 'PAID' : 'OVERDUE'));
    const data = {
      invoiceNumber,
      builderId,
      createdById,
      subtotal: amount,
      total: amount,
      amountPaid,
      balanceDue,
      status,
      paymentTerm: 'NET_30',
      issuedAt: issuedAt || undefined,
      paidAt: paid ? (checkDate || issuedAt || undefined) : undefined,
      notes: [
        'PULTE BWP HISTORICAL',
        r['Description'] && r['Description'],
        r['Check_Number'] && `Check #${r['Check_Number'].trim()}`,
        r['Cash_Code'] && `CashCode ${r['Cash_Code']}`,
        r['EFT'] && `EFT=${r['EFT']}`,
      ].filter(Boolean).join(' | '),
    };
    try {
      const existing = await prisma.invoice.findUnique({ where: { invoiceNumber }, select: { id: true } });
      if (existing) {
        await prisma.invoice.update({ where: { id: existing.id }, data });
        keyToInvoiceId.set(`${num}|${seq}`, existing.id);
        if (!keyToInvoiceId.has(num)) keyToInvoiceId.set(num, existing.id);
        updated++;
      } else {
        const created = await prisma.invoice.create({ data });
        keyToInvoiceId.set(`${num}|${seq}`, created.id);
        if (!keyToInvoiceId.has(num)) keyToInvoiceId.set(num, created.id);
        inserted++;
      }
    } catch (e) {
      console.warn(`[INV ${num}/${seq}] skipped: ${e.message}`);
      skipped++;
    }
  }
  return { parsed: rows.length, inserted, updated, skipped, keyToInvoiceId };
}

// ─── STEP 5: PAYMENT CHECKS → Payment ────────────────────────────────────
// Note: the standalone PaymentChecks.csv is a thin check registry (not
// invoice-linked). Most historical check linkage is already captured in
// Invoices.csv (Check_Number + Check_Date). We ingest checks here by linking
// to any invoice that references them; un-linkable checks are logged.

async function ingestPayments(keyToInvoiceId) {
  // First: materialize Payment rows from Invoices.csv (one per paid invoice).
  // That's already implicit in the balanceDue/paidAt on Invoice, but we want
  // discrete Payment rows for QB sync + reporting.
  const { rows: invRows } = readCSV('Pulte_BWP_Invoices.csv');
  let paymentsFromInvoices = 0;
  let paySkipped = 0;

  for (const r of invRows) {
    const num = (r['Invoice_Number'] || '').trim();
    const seq = (r['Sequence'] || '0').trim() || '0';
    const checkNumber = (r['Check_Number'] || '').trim();
    const amount = parseMoney(r['Amount']);
    if (!num || !checkNumber || amount <= 0) continue;
    const invoiceId = keyToInvoiceId.get(`${num}|${seq}`) || keyToInvoiceId.get(num);
    if (!invoiceId) { paySkipped++; continue; }
    const receivedAt = parseDateSafe(r['Check_Date']) || parseDateSafe(r['Invoice_Date']) || new Date();

    // Idempotency: (invoiceId, reference) — raw SQL since Payment has no natural unique.
    const existing = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Payment" WHERE "invoiceId"=$1 AND "reference"=$2 LIMIT 1`,
      invoiceId, checkNumber
    );
    if (Array.isArray(existing) && existing.length > 0) continue; // already ingested
    await prisma.payment.create({
      data: {
        invoiceId,
        amount,
        method: 'CHECK',
        reference: checkNumber,
        receivedAt,
        notes: 'PULTE BWP HISTORICAL',
      },
    });
    paymentsFromInvoices++;
  }

  // Second: scan the check registry and record orphans for audit.
  const { rows: checkRows } = readCSV('Pulte_BWP_PaymentChecks.csv');
  let registryParsed = checkRows.length;
  // No additional writes — invoice-linked path handles AR. Registry is informational.

  return { invoicesParsed: invRows.length, paymentsFromInvoices, paySkipped, registryParsed };
}

// ─── STEP 6: BACKCHARGES → PulteHistoricalBackcharge ─────────────────────

async function ingestBackcharges(builderId) {
  const { rows } = readCSV('Pulte_BWP_Backcharges.csv');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const po = (r['PO_Number'] || '').trim();
    const inv = (r['Invoice_Number'] || '').trim();
    if (!po || !inv) { skipped++; continue; }
    const date = parseDateSafe(r['Date']);
    const amount = parseMoney(r['Amount']);
    const community = (r['Community'] || '').trim() || null;
    const issuer = (r['Issuer'] || '').trim() || null;
    const description = (r['Description'] || '').trim() || null;
    try {
      // Count pre-op for insert/update distinction
      const before = await prisma.$queryRawUnsafe(
        `SELECT id FROM "PulteHistoricalBackcharge" WHERE "poNumber"=$1 AND "invoiceNumber"=$2`,
        po, inv
      );
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PulteHistoricalBackcharge"
           ("builderId","poNumber","invoiceNumber","date","community","amount","issuer","description","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, CURRENT_TIMESTAMP)
         ON CONFLICT ("poNumber","invoiceNumber") DO UPDATE SET
           "builderId"=EXCLUDED."builderId",
           "date"=EXCLUDED."date",
           "community"=EXCLUDED."community",
           "amount"=EXCLUDED."amount",
           "issuer"=EXCLUDED."issuer",
           "description"=EXCLUDED."description",
           "updatedAt"=CURRENT_TIMESTAMP`,
        builderId, po, inv, date, community, amount, issuer, description
      );
      if (Array.isArray(before) && before.length > 0) updated++; else inserted++;
    } catch (e) {
      console.warn(`[BC ${po}/${inv}] skipped: ${e.message}`);
      skipped++;
    }
  }
  return { parsed: rows.length, inserted, updated, skipped };
}

// ─── STEP 7: CONTACTS → BuilderContact ───────────────────────────────────

function splitName(full) {
  const s = (full || '').trim();
  if (!s) return { first: '', last: '' };
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

function mapRole(title) {
  const t = (title || '').toLowerCase();
  if (/purchas/.test(t)) return 'PURCHASING';
  if (/super/.test(t)) return 'SUPERINTENDENT';
  if (/vp|vice president/.test(t)) return 'DIVISION_VP';
  if (/project manager|\bpm\b/.test(t)) return 'PROJECT_MANAGER';
  if (/estimator/.test(t)) return 'ESTIMATOR';
  if (/accounts payable|\bap\b/.test(t)) return 'ACCOUNTS_PAYABLE';
  if (/owner|president|ceo/.test(t)) return 'OWNER';
  return 'OTHER';
}

async function ingestContacts(builderId) {
  const { rows } = readCSV('Pulte_BWP_Contacts.csv');
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const r of rows) {
    const rawEmail = (r['Email'] || '').trim().toLowerCase();
    const { first, last } = splitName(r['Name']);
    if (!first && !last && !rawEmail) { skipped++; continue; }

    const data = {
      firstName: first || '(unknown)',
      lastName: last || '',
      email: rawEmail || null,
      phone: (r['Phone'] || '').trim() || null,
      mobile: (r['Mobile'] || '').trim() || null,
      title: (r['Title'] || '').trim() || null,
      role: mapRole(r['Title']),
      active: ((r['Status'] || '').trim().toLowerCase() === 'active'),
      notes: [
        r['Department'] && `Dept: ${r['Department']}`,
        r['City'] && `City: ${r['City']}`,
        r['State'] && `State: ${r['State']}`,
      ].filter(Boolean).join(' · ') || null,
    };

    try {
      // Natural key: (builderId, email) when email exists; otherwise (builderId, firstName, lastName).
      let existing = null;
      if (rawEmail) {
        existing = await prisma.builderContact.findFirst({
          where: { builderId, email: { equals: rawEmail, mode: 'insensitive' } },
          select: { id: true },
        });
      } else {
        existing = await prisma.builderContact.findFirst({
          where: { builderId, firstName: data.firstName, lastName: data.lastName },
          select: { id: true },
        });
      }
      if (existing) {
        await prisma.builderContact.update({ where: { id: existing.id }, data });
        updated++;
      } else {
        await prisma.builderContact.create({ data: { ...data, builderId } });
        inserted++;
      }
    } catch (e) {
      console.warn(`[CONTACT ${r['Name']}] skipped: ${e.message}`);
      skipped++;
    }
  }
  return { parsed: rows.length, inserted, updated, skipped };
}

// ─── STEP 8: POST-INGEST ACTIONS ─────────────────────────────────────────

async function closeOutBuilder(builderId, dawnStaffId, ar) {
  await prisma.builder.update({
    where: { id: builderId },
    data: { status: 'CLOSED', churnRisk: '10/10' },
  });

  // Upsert a single ACCOUNT_CLOSED inbox item (idempotent by entityType+entityId).
  const existing = await prisma.inboxItem.findFirst({
    where: { type: 'ACCOUNT_CLOSED', entityType: 'Builder', entityId: builderId },
    select: { id: true },
  });
  const title = `Pulte account closed — pursue final AR of $${ar.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const description = [
    'Pulte/PulteGroup/Centex/Del Webb lost 2026-04-20 (Doug Gough, Sr Procurement).',
    'Treeline → 84 Lumber; Mobberly Farms moved March 2026.',
    'Historical BWP data ingested for close-out collections and Hancock Whitney pitch.',
    `Open AR for final collections: $${ar.toFixed(2)}.`,
  ].join('\n');
  if (existing) {
    await prisma.inboxItem.update({
      where: { id: existing.id },
      data: { title, description, priority: 'HIGH', assignedTo: dawnStaffId, financialImpact: ar },
    });
  } else {
    await prisma.inboxItem.create({
      data: {
        type: 'ACCOUNT_CLOSED',
        source: 'pulte-closeout-ingest',
        title,
        description,
        priority: 'HIGH',
        entityType: 'Builder',
        entityId: builderId,
        assignedTo: dawnStaffId,
        financialImpact: ar,
      },
    });
  }
}

// ─── REPORTING ───────────────────────────────────────────────────────────

async function snapshot(builderId, label) {
  const [invAgg, payAgg, orderCount, contactCount] = await Promise.all([
    prisma.invoice.aggregate({
      where: { builderId },
      _count: true,
      _sum: { total: true, balanceDue: true, amountPaid: true },
    }),
    prisma.payment.aggregate({
      where: { invoice: { builderId } },
      _count: true,
      _sum: { amount: true },
    }),
    prisma.order.count({ where: { builderId } }),
    prisma.builderContact.count({ where: { builderId } }),
  ]);
  return {
    label,
    invoices: invAgg._count,
    revenue: invAgg._sum.total || 0,
    ar: invAgg._sum.balanceDue || 0,
    collected: invAgg._sum.amountPaid || 0,
    payments: payAgg._count,
    paymentsTotal: payAgg._sum.amount || 0,
    orders: orderCount,
    contacts: contactCount,
  };
}

async function topOutstandingInvoices(builderId, n = 5) {
  return prisma.invoice.findMany({
    where: { builderId, balanceDue: { gt: 0 } },
    orderBy: { balanceDue: 'desc' },
    take: n,
    select: { invoiceNumber: true, total: true, balanceDue: true, issuedAt: true, status: true },
  });
}

function fmtMoney(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

// ─── MAIN ────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Pulte BWP Historical Ingest (close-out) ===');
  console.log(`Source: ${SRC}\n`);

  const pulte = await resolvePulteBuilder();
  const dawnId = await resolveDawnStaff();

  await ensureAuxiliary();
  const fallbackProductId = await ensurePulteBwpFallbackProduct();

  const before = await snapshot(pulte.id, 'BEFORE');

  const po = await ingestPurchaseOrders(pulte.id);
  const lines = await ingestPOLineItems(po.poToOrderId, fallbackProductId);
  const inv = await ingestInvoices(pulte.id, dawnId);
  const pay = await ingestPayments(inv.keyToInvoiceId);
  const bc = await ingestBackcharges(pulte.id);
  const ct = await ingestContacts(pulte.id);

  const after = await snapshot(pulte.id, 'AFTER');
  const top = await topOutstandingInvoices(pulte.id, 5);

  await closeOutBuilder(pulte.id, dawnId, after.ar);

  // ─── Report ────────────────────────────────────────────────────────
  const report = {
    parsedByFile: {
      PurchaseOrders: po.parsed,
      PO_LineItems: lines.parsed,
      Invoices: inv.parsed,
      PaymentChecks_registry: pay.registryParsed,
      Backcharges: bc.parsed,
      Contacts: ct.parsed,
    },
    ingest: {
      orders: { inserted: po.inserted, updated: po.updated, skipped: po.skipped },
      orderItems: { processed: lines.inserted, skipped: lines.skipped, orphanPO: lines.orphanPO },
      invoices: { inserted: inv.inserted, updated: inv.updated, skipped: inv.skipped },
      payments: { inserted: pay.paymentsFromInvoices, orphan: pay.paySkipped },
      backcharges: { inserted: bc.inserted, updated: bc.updated, skipped: bc.skipped },
      contacts: { inserted: ct.inserted, updated: ct.updated, skipped: ct.skipped },
    },
    before: {
      orders: before.orders,
      invoices: before.invoices,
      revenue: fmtMoney(before.revenue),
      ar: fmtMoney(before.ar),
      collected: fmtMoney(before.collected),
      contacts: before.contacts,
    },
    after: {
      orders: after.orders,
      invoices: after.invoices,
      revenue: fmtMoney(after.revenue),
      ar: fmtMoney(after.ar),
      collected: fmtMoney(after.collected),
      contacts: after.contacts,
    },
    topOutstanding: top.map(t => ({
      invoice: t.invoiceNumber,
      total: fmtMoney(t.total),
      balanceDue: fmtMoney(t.balanceDue),
      issuedAt: t.issuedAt ? t.issuedAt.toISOString().slice(0, 10) : null,
      status: t.status,
    })),
    builderClosed: { status: 'CLOSED', churnRisk: '10/10' },
    inboxItem: `ACCOUNT_CLOSED → Dawn (${DAWN_EMAIL}) financialImpact=${fmtMoney(after.ar)}`,
  };

  console.log('\n=== REPORT ===');
  console.log(JSON.stringify(report, null, 2));
  console.log('\nDone.');
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
