// Import Hyphen Brookfield "clean" export into HyphenOrder + HyphenPayment tables.
// Source: "Downlods/Hyphen_Brookfield_Clean.xlsx" (sheet: "Data")
// Idempotent: uses hyphId (Line Ref) as upsert key on HyphenOrder and
// (orderNumber + checkNumber) dedupe for HyphenPayment.
//
// Parses "Check Info" column which has formats like:
//   "ET001218 12/5/2025 $995.98"
//   "33012345 11/1/2025 $1,200.00"
//
// Usage: node scripts/import-hyphen-brookfield.mjs
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { readXlsxSheet, parseMoney, parseDateSafe, normalizeBuilderName, bar, fileExistsOrDie, ABEL_FOLDER } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();

async function ensureTables() {
  // Minimal DDL — idempotent via IF NOT EXISTS. Mirrors the shapes used by
  // /api/ops/import-hyphen/route.ts. Safe to run repeatedly.
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenOrder" (
      "id"               TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "hyphId"           TEXT UNIQUE,
      "refOrderId"       TEXT,
      "jobId"            TEXT,
      "builderOrderNum"  TEXT,
      "supplierOrderNum" TEXT,
      "account"          TEXT,
      "builderName"      TEXT,
      "subdivision"      TEXT,
      "phase"            TEXT,
      "groupName"        TEXT,
      "lotBlockPlan"     TEXT,
      "address"          TEXT,
      "task"             TEXT,
      "total"            DOUBLE PRECISION DEFAULT 0,
      "requestedStart"   TIMESTAMPTZ,
      "requestedEnd"     TIMESTAMPTZ,
      "actualStart"      TIMESTAMPTZ,
      "actualEnd"        TIMESTAMPTZ,
      "orderStatus"      TEXT,
      "builderStatus"    TEXT,
      "rawDates"         TEXT,
      "rawStatus"        TEXT,
      "createdAt"        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"        TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenPayment" (
      "id"              TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "builderAccount"  TEXT,
      "builderName"     TEXT,
      "orderNumber"     TEXT,
      "address"         TEXT,
      "subdivision"     TEXT,
      "lotBlockPlan"    TEXT,
      "supplierOrderNum" TEXT,
      "taskDescription" TEXT,
      "soNumber"        TEXT,
      "invoiceNumber"   TEXT,
      "checkNumber"     TEXT,
      "paymentDate"     TIMESTAMPTZ,
      "amount"          DOUBLE PRECISION DEFAULT 0,
      "paymentType"     TEXT,
      "createdAt"       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"       TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_hyphen_order_hyphId" ON "HyphenOrder" ("hyphId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_hyphen_order_builder" ON "HyphenOrder" ("builderName")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_hyphen_order_so" ON "HyphenOrder" ("refOrderId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_hyphen_payment_check" ON "HyphenPayment" ("checkNumber")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_hyphen_payment_builder" ON "HyphenPayment" ("builderName")`);
  // Defensive dedupe index for payments — unique combination of
  // (orderNumber, checkNumber, amount) prevents duplicate inserts on re-run.
  // Try the unique form first; if pre-existing data violates it (e.g. rows
  // from the legacy /api/ops/import-hyphen API route had empty orderNumbers
  // and identical (checkNumber, amount) pairs), fall back to a non-unique
  // index. The script's INSERT path tolerates both.
  try {
    await prisma.$executeRawUnsafe(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_hyphen_payment_dedupe"
      ON "HyphenPayment" ("orderNumber", "checkNumber", "amount")
      WHERE "orderNumber" IS NOT NULL AND "orderNumber" <> ''
    `);
  } catch (e) {
    console.warn(`   note: dedupe unique index skipped (${e.message?.slice(0,80)})`);
    try {
      await prisma.$executeRawUnsafe(`
        CREATE INDEX IF NOT EXISTS "idx_hyphen_payment_dedupe"
        ON "HyphenPayment" ("orderNumber", "checkNumber", "amount")
      `);
    } catch {}
  }
}

// "ET001218 12/5/2025 $995.98" → { checkNumber, paymentDate, amount }
function parseCheckInfo(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || /^no\s*check/i.test(s)) return null;
  const m = s.match(/^(\S+)\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+\$?([\d,]+(?:\.\d+)?)/);
  if (!m) return null;
  return {
    checkNumber: m[1],
    paymentDate: parseDateSafe(m[2]),
    amount: parseMoney(m[3]),
  };
}

async function main() {
  bar('HYPHEN BROOKFIELD — CLEAN IMPORT');
  const filePath = path.join(ABEL_FOLDER, 'Downlods', 'Hyphen_Brookfield_Clean.xlsx');
  fileExistsOrDie(filePath, 'Hyphen_Brookfield_Clean.xlsx');

  console.log('→ ensuring tables/indexes exist...');
  await ensureTables();

  console.log(`→ reading ${filePath}`);
  const { rows } = readXlsxSheet(filePath, 'Data', 0);
  console.log(`   ${rows.length} data rows`);

  let orderInserts = 0, orderUpdates = 0, orderSkipped = 0;
  let paymentInserts = 0, paymentSkipped = 0;

  for (const r of rows) {
    const hyphId = (r['Line Ref'] || '').toString().trim();
    if (!hyphId) { orderSkipped++; continue; }

    const account = (r['Account'] || '').toString().trim();
    const builderName = normalizeBuilderName(account) || 'Brookfield Residential';
    const refOrderId = (r['Sales Order'] || '').toString().trim();
    const builderOrderNum = (r['Builder Ref'] || '').toString().trim();
    const supplierOrderNum = (r['Supplier Ref'] || '').toString().trim();
    const subdivision = (r['Subdivision'] || '').toString().trim();
    const lotBlockPlan = (r['Lot / Block'] || '').toString().trim();
    const address = [(r['Address'] || ''), (r['City/State'] || '')].filter(Boolean).join(', ').trim();
    const task = (r['Task'] || '').toString().trim();
    const total = parseMoney(r['Total'] || r['Amount Excl Tax']);
    const orderStatus = (r['Order Status'] || '').toString().trim();
    const builderStatus = (r['Builder Status'] || '').toString().trim();
    const completionDate = parseDateSafe(r['Completion Date']);

    try {
      const result = await prisma.$executeRawUnsafe(
        `INSERT INTO "HyphenOrder" (
           "id", "hyphId", "refOrderId", "builderOrderNum", "supplierOrderNum",
           "account", "builderName", "subdivision", "lotBlockPlan", "address",
           "task", "total", "actualEnd", "orderStatus", "builderStatus",
           "createdAt", "updatedAt"
         ) VALUES (
           gen_random_uuid()::text, $1, $2, $3, $4,
           $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14,
           CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         )
         ON CONFLICT ("hyphId") DO UPDATE SET
           "refOrderId" = EXCLUDED."refOrderId",
           "builderOrderNum" = EXCLUDED."builderOrderNum",
           "supplierOrderNum" = EXCLUDED."supplierOrderNum",
           "subdivision" = EXCLUDED."subdivision",
           "lotBlockPlan" = EXCLUDED."lotBlockPlan",
           "address" = EXCLUDED."address",
           "task" = EXCLUDED."task",
           "total" = EXCLUDED."total",
           "actualEnd" = EXCLUDED."actualEnd",
           "orderStatus" = EXCLUDED."orderStatus",
           "builderStatus" = EXCLUDED."builderStatus",
           "updatedAt" = CURRENT_TIMESTAMP`,
        hyphId, refOrderId || null, builderOrderNum || null, supplierOrderNum || null,
        account || null, builderName, subdivision || null, lotBlockPlan || null, address || null,
        task || null, total, completionDate, orderStatus || null, builderStatus || null,
      );
      // $executeRawUnsafe returns affected rowcount. With ON CONFLICT DO UPDATE
      // postgres returns 1 on insert and 1 on update — indistinguishable. Count as upserts.
      orderInserts++;
    } catch (e) {
      orderSkipped++;
      if (orderSkipped < 5) console.warn(`   order skip: ${e.message?.slice(0, 120)}`);
    }

    // Parse Check Info → HyphenPayment row
    // No ON CONFLICT — instead do a manual existence check on the natural
    // dedupe key (orderNumber, checkNumber, amount). This is robust whether
    // or not the unique index exists, and silently coexists with the legacy
    // 321 rows from the API route.
    const checkInfo = parseCheckInfo(r['Check Info']);
    if (checkInfo && checkInfo.amount > 0) {
      try {
        const existing = await prisma.$queryRawUnsafe(
          `SELECT "id" FROM "HyphenPayment"
            WHERE COALESCE("orderNumber",'') = COALESCE($1,'')
              AND "checkNumber" = $2
              AND "amount" = $3
            LIMIT 1`,
          refOrderId || null, checkInfo.checkNumber, checkInfo.amount,
        );
        if (existing && existing.length) {
          await prisma.$executeRawUnsafe(
            `UPDATE "HyphenPayment" SET
               "paymentDate" = $2,
               "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = $1`,
            existing[0].id, checkInfo.paymentDate,
          );
        } else {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "HyphenPayment" (
               "id", "builderAccount", "builderName", "orderNumber", "address",
               "subdivision", "lotBlockPlan", "supplierOrderNum", "taskDescription",
               "soNumber", "checkNumber", "paymentDate", "amount", "paymentType",
               "createdAt", "updatedAt"
             ) VALUES (
               gen_random_uuid()::text, $1, $2, $3, $4,
               $5, $6, $7, $8,
               $9, $10, $11, $12, $13,
               CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
             )`,
            account || null, builderName, refOrderId || null, address || null,
            subdivision || null, lotBlockPlan || null, supplierOrderNum || null, task || null,
            refOrderId || null, checkInfo.checkNumber, checkInfo.paymentDate, checkInfo.amount,
            /^ET/i.test(checkInfo.checkNumber) ? 'EFT' : 'CHECK',
          );
        }
        paymentInserts++;
      } catch (e) {
        if (paymentSkipped < 3) console.warn(`   pay skip: ${e.message?.slice(0,120)}`);
        paymentSkipped++;
      }
    } else {
      paymentSkipped++;
    }
  }

  console.log(`\n✅ HYPHEN BROOKFIELD IMPORT COMPLETE`);
  console.log(`   HyphenOrder upserts:   ${orderInserts}`);
  console.log(`   HyphenOrder skipped:   ${orderSkipped}`);
  console.log(`   HyphenPayment upserts: ${paymentInserts}`);
  console.log(`   HyphenPayment skipped: ${paymentSkipped}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
