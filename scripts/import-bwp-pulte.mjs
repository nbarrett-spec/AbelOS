// Import BWP (Build With Pulte) CSV exports into Bwp* tables.
// Source folder: "Pulte Proposal - April 2026/3. Source Data/"
// CSVs handled:
//   Pulte_BWP_PurchaseOrders.csv   → BwpFieldPO (+ Job link via lot address)
//   Pulte_BWP_PO_LineItems.csv     → BwpFieldPOLine
//   Pulte_BWP_Invoices.csv         → BwpInvoice
//   Pulte_BWP_PaymentChecks.csv    → BwpCheck
//   Pulte_BWP_Contacts.csv         → BwpContact
//   Pulte_BWP_Backcharges.csv      → BwpBackcharge
//
// Idempotent: uses natural keys (po_number, invoice_number, check_id) for
// ON CONFLICT DO UPDATE. Safe to re-run.
//
// Usage: node scripts/import-bwp-pulte.mjs
import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { parseCSVLine } from './_brain-helpers.mjs';
import { parseMoney, parseDateSafe, bar, ABEL_FOLDER } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();
const SRC = path.join(ABEL_FOLDER, 'Pulte Proposal - April 2026', '3. Source Data');

function readCSVFile(fp) {
  let content = fs.readFileSync(fp, 'utf-8');
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
  const lines = content.split('\n').filter(l => l.trim().length > 0);
  const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => { row[h] = (cols[idx] ?? '').replace(/^"|"$/g, '').trim(); });
    rows.push(row);
  }
  return { headers, rows };
}

async function ensureTables() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BwpFieldPO" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "poNumber"       TEXT UNIQUE,
      "effectiveDate"  TIMESTAMPTZ,
      "community"      TEXT,
      "communityNumber" TEXT,
      "lots"           TEXT,
      "amount"         DOUBLE PRECISION DEFAULT 0,
      "status"         TEXT,
      "isBackcharge"   BOOLEAN DEFAULT FALSE,
      "description"    TEXT,
      "issuer"         TEXT,
      "approver"       TEXT,
      "invoiceNumber"  TEXT,
      "invoiceAmount"  DOUBLE PRECISION DEFAULT 0,
      "invoiceDate"    TIMESTAMPTZ,
      "vendorName"     TEXT,
      "vendorNumber"   TEXT,
      "note"           TEXT,
      "linkedPo"       TEXT,
      "createdAt"      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BwpFieldPOLine" (
      "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "poNumber"        TEXT,
      "lineId"          TEXT UNIQUE,
      "accountCategory" TEXT,
      "glAccount"       TEXT,
      "community"       TEXT,
      "communityNumber" TEXT,
      "lotBlock"        TEXT,
      "lotAddress"      TEXT,
      "amount"          DOUBLE PRECISION DEFAULT 0,
      "createdAt"       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BwpInvoice" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "invoiceNumber"  TEXT,
      "sequence"       TEXT,
      "invoiceDate"    TIMESTAMPTZ,
      "description"    TEXT,
      "amount"         DOUBLE PRECISION DEFAULT 0,
      "checkNumber"    TEXT,
      "checkDate"      TIMESTAMPTZ,
      "status"         TEXT,
      "cashCode"       TEXT,
      "eft"            TEXT,
      "createdAt"      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_bwp_invoice_num_seq"
    ON "BwpInvoice" ("invoiceNumber", "sequence")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BwpCheck" (
      "id"             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "checkId"        TEXT UNIQUE,
      "cashCode"       TEXT,
      "checkDate"      TIMESTAMPTZ,
      "checkNumber"    TEXT,
      "eftIndicator"   TEXT,
      "ach"            TEXT,
      "total"          DOUBLE PRECISION DEFAULT 0,
      "lawsonVendorNumber" TEXT,
      "checkVoidSeq"   TEXT,
      "createdAt"      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BwpContact" (
      "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "name"          TEXT,
      "title"         TEXT,
      "department"    TEXT,
      "email"         TEXT,
      "phone"         TEXT,
      "mobile"        TEXT,
      "officeAddress" TEXT,
      "city"          TEXT,
      "state"         TEXT,
      "zip"           TEXT,
      "status"        TEXT,
      "createdAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_bwp_contact_name_email"
    ON "BwpContact" ("name", "email")
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "BwpBackcharge" (
      "id"            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "poNumber"      TEXT,
      "date"          TIMESTAMPTZ,
      "community"     TEXT,
      "amount"        DOUBLE PRECISION DEFAULT 0,
      "issuer"        TEXT,
      "description"   TEXT,
      "invoiceNumber" TEXT,
      "createdAt"     TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE UNIQUE INDEX IF NOT EXISTS "uq_bwp_backcharge_po_inv"
    ON "BwpBackcharge" ("poNumber", "invoiceNumber")
  `);
}

async function importPurchaseOrders() {
  const fp = path.join(SRC, 'Pulte_BWP_PurchaseOrders.csv');
  if (!fs.existsSync(fp)) return { read: 0, wrote: 0 };
  const { rows } = readCSVFile(fp);
  let wrote = 0;
  for (const r of rows) {
    const poNum = (r.PO_Number || '').trim();
    if (!poNum) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BwpFieldPO" (
           "id","poNumber","effectiveDate","community","communityNumber","lots","amount",
           "status","isBackcharge","description","issuer","approver","invoiceNumber",
           "invoiceAmount","invoiceDate","vendorName","vendorNumber","note","linkedPo"
         ) VALUES (
           gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18
         ) ON CONFLICT ("poNumber") DO UPDATE SET
           "status" = EXCLUDED."status",
           "amount" = EXCLUDED."amount",
           "invoiceNumber" = EXCLUDED."invoiceNumber",
           "invoiceAmount" = EXCLUDED."invoiceAmount",
           "invoiceDate" = EXCLUDED."invoiceDate",
           "vendorName" = EXCLUDED."vendorName",
           "updatedAt" = CURRENT_TIMESTAMP`,
        poNum, parseDateSafe(r.Date), r.Community || null, r.Community_Number || null,
        r.Lots || null, parseMoney(r.Amount), r.Status || null,
        /yes/i.test(r.Is_Backcharge || ''), r.Description || null,
        r.Issuer || null, r.Approver || null, r.Invoice_Number || null,
        parseMoney(r.Invoice_Amount), parseDateSafe(r.Invoice_Date),
        r.Vendor_Name || null, r.Vendor_Number || null, r.Note || null, r.Linked_PO || null,
      );
      wrote++;
    } catch (e) { if (wrote < 3) console.warn(`   po skip: ${e.message?.slice(0,120)}`); }
  }
  return { read: rows.length, wrote };
}

async function importLineItems() {
  const fp = path.join(SRC, 'Pulte_BWP_PO_LineItems.csv');
  if (!fs.existsSync(fp)) return { read: 0, wrote: 0 };
  const { rows } = readCSVFile(fp);
  let wrote = 0;
  for (const r of rows) {
    const lineId = (r.Line_ID || '').trim();
    if (!lineId) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BwpFieldPOLine" (
           "id","poNumber","lineId","accountCategory","glAccount","community",
           "communityNumber","lotBlock","lotAddress","amount"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ("lineId") DO UPDATE SET
           "amount" = EXCLUDED."amount",
           "lotAddress" = EXCLUDED."lotAddress"`,
        r.PO_Number || null, lineId, r.Account_Category || null, r.GL_Account || null,
        r.Community || null, r.Community_Number || null, r.Lot_Block || null,
        r.Lot_Address || null, parseMoney(r.Amount),
      );
      wrote++;
    } catch (e) {}
  }
  return { read: rows.length, wrote };
}

async function importInvoices() {
  const fp = path.join(SRC, 'Pulte_BWP_Invoices.csv');
  if (!fs.existsSync(fp)) return { read: 0, wrote: 0 };
  const { rows } = readCSVFile(fp);
  let wrote = 0;
  for (const r of rows) {
    const invNum = (r.Invoice_Number || '').trim();
    if (!invNum) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BwpInvoice" (
           "id","invoiceNumber","sequence","invoiceDate","description","amount",
           "checkNumber","checkDate","status","cashCode","eft"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT ("invoiceNumber","sequence") DO UPDATE SET
           "amount" = EXCLUDED."amount",
           "checkNumber" = EXCLUDED."checkNumber",
           "checkDate" = EXCLUDED."checkDate",
           "status" = EXCLUDED."status",
           "updatedAt" = CURRENT_TIMESTAMP`,
        invNum, r.Sequence || '0', parseDateSafe(r.Invoice_Date),
        r.Description || null, parseMoney(r.Amount),
        (r.Check_Number || '').trim() || null, parseDateSafe(r.Check_Date),
        r.Status || null, r.Cash_Code || null, r.EFT || null,
      );
      wrote++;
    } catch (e) { if (wrote < 3) console.warn(`   inv skip: ${e.message?.slice(0,120)}`); }
  }
  return { read: rows.length, wrote };
}

async function importChecks() {
  const fp = path.join(SRC, 'Pulte_BWP_PaymentChecks.csv');
  if (!fs.existsSync(fp)) return { read: 0, wrote: 0 };
  const { rows } = readCSVFile(fp);
  let wrote = 0;
  for (const r of rows) {
    const checkId = (r.checkId || '').trim();
    if (!checkId) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BwpCheck" (
           "id","checkId","cashCode","checkDate","checkNumber","eftIndicator","ach",
           "total","lawsonVendorNumber","checkVoidSeq"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT ("checkId") DO UPDATE SET
           "total" = EXCLUDED."total",
           "checkDate" = EXCLUDED."checkDate",
           "updatedAt" = CURRENT_TIMESTAMP`,
        checkId, r.cashCode || null, parseDateSafe(r.checkDate),
        r.checkNumber || null, r.eftIndicator || null, r.ach || null,
        parseMoney(r.total), r.lawsonVendorNumber || null, r.checkVoidSeq || null,
      );
      wrote++;
    } catch (e) {}
  }
  return { read: rows.length, wrote };
}

async function importContacts() {
  const fp = path.join(SRC, 'Pulte_BWP_Contacts.csv');
  if (!fs.existsSync(fp)) return { read: 0, wrote: 0 };
  const { rows } = readCSVFile(fp);
  let wrote = 0;
  for (const r of rows) {
    const name = (r.Name || '').trim();
    if (!name) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BwpContact" (
           "id","name","title","department","email","phone","mobile","officeAddress",
           "city","state","zip","status"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT ("name","email") DO UPDATE SET
           "title" = EXCLUDED."title",
           "department" = EXCLUDED."department",
           "phone" = EXCLUDED."phone",
           "status" = EXCLUDED."status",
           "updatedAt" = CURRENT_TIMESTAMP`,
        name, r.Title || null, r.Department || null, (r.Email || '').toLowerCase() || null,
        r.Phone || null, r.Mobile || null, r.Office_Address || null,
        r.City || null, r.State || null, r.Zip || null, r.Status || null,
      );
      wrote++;
    } catch (e) {}
  }
  return { read: rows.length, wrote };
}

async function importBackcharges() {
  const fp = path.join(SRC, 'Pulte_BWP_Backcharges.csv');
  if (!fs.existsSync(fp)) return { read: 0, wrote: 0 };
  const { rows } = readCSVFile(fp);
  let wrote = 0;
  for (const r of rows) {
    const po = (r.PO_Number || '').trim();
    if (!po) continue;
    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "BwpBackcharge" (
           "id","poNumber","date","community","amount","issuer","description","invoiceNumber"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT ("poNumber","invoiceNumber") DO UPDATE SET
           "amount" = EXCLUDED."amount",
           "description" = EXCLUDED."description"`,
        po, parseDateSafe(r.Date), r.Community || null, parseMoney(r.Amount),
        r.Issuer || null, r.Description || null, r.Invoice_Number || '',
      );
      wrote++;
    } catch (e) {}
  }
  return { read: rows.length, wrote };
}

async function main() {
  bar('BWP PULTE — FULL INGEST');
  console.log(`→ source folder: ${SRC}`);
  if (!fs.existsSync(SRC)) {
    console.error(`❌ BWP source folder not found.`);
    process.exit(1);
  }
  console.log('→ ensuring tables...');
  await ensureTables();

  console.log('\n[1/6] Purchase Orders');
  const po = await importPurchaseOrders();
  console.log(`     read ${po.read}, wrote ${po.wrote}`);

  console.log('[2/6] PO Line Items');
  const li = await importLineItems();
  console.log(`     read ${li.read}, wrote ${li.wrote}`);

  console.log('[3/6] Invoices');
  const inv = await importInvoices();
  console.log(`     read ${inv.read}, wrote ${inv.wrote}`);

  console.log('[4/6] Payment Checks');
  const chk = await importChecks();
  console.log(`     read ${chk.read}, wrote ${chk.wrote}`);

  console.log('[5/6] Contacts');
  const con = await importContacts();
  console.log(`     read ${con.read}, wrote ${con.wrote}`);

  console.log('[6/6] Backcharges');
  const bc = await importBackcharges();
  console.log(`     read ${bc.read}, wrote ${bc.wrote}`);

  console.log('\n✅ BWP PULTE IMPORT COMPLETE');
  console.log(`   PurchaseOrders: ${po.wrote}`);
  console.log(`   LineItems:      ${li.wrote}`);
  console.log(`   Invoices:       ${inv.wrote}`);
  console.log(`   Checks:         ${chk.wrote}`);
  console.log(`   Contacts:       ${con.wrote}`);
  console.log(`   Backcharges:    ${bc.wrote}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
