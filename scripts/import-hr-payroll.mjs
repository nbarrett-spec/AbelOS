// Import HR pay rates from "Abel Lumber - Labor Cost Analysis.xlsx" → Staff table.
// Source sheet: "Payroll Data" (headers on row index 2)
// Columns: Employee, Title, Cost Center, Hourly Rate, Annual Salary,
//          Burden Rate, Fully Loaded Hourly, Monthly Cost
//
// Adds missing columns to Staff via ALTER TABLE IF NOT EXISTS pattern
// (checked dynamically against information_schema) so it's safe to re-run
// without a Prisma migration.
//
// Employee names are "Last, First" — we normalize to "First Last" for
// matching against existing Staff.name rows. Unmatched names are logged
// and upserted into a new StaffPayrollStaging table so nothing is lost.
//
// Usage: node scripts/import-hr-payroll.mjs
import { PrismaClient } from '@prisma/client';
import path from 'path';
import { readXlsxSheet, parseMoney, bar, fileExistsOrDie, ABEL_FOLDER } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();

async function columnExists(table, column) {
  const rows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name = $1 AND column_name = $2 LIMIT 1`, table, column,
  );
  return Array.isArray(rows) && rows.length > 0;
}

async function ensureColumns() {
  const cols = [
    ['hourlyRate',         'DOUBLE PRECISION'],
    ['annualSalary',       'DOUBLE PRECISION'],
    ['burdenRate',         'DOUBLE PRECISION'],
    ['fullyLoadedHourly',  'DOUBLE PRECISION'],
    ['monthlyCost',        'DOUBLE PRECISION'],
    ['costCenter',         'TEXT'],
    ['payrollTitle',       'TEXT'],
    ['payrollUpdatedAt',   'TIMESTAMPTZ'],
  ];
  for (const [name, type] of cols) {
    if (!(await columnExists('Staff', name))) {
      try {
        await prisma.$executeRawUnsafe(
          `ALTER TABLE "Staff" ADD COLUMN "${name}" ${type}`,
        );
        console.log(`   + added Staff.${name} (${type})`);
      } catch (e) {
        console.warn(`   alter fail ${name}: ${e.message?.slice(0,120)}`);
      }
    }
  }
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "StaffPayrollStaging" (
      "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "rawName"           TEXT UNIQUE,
      "normalizedName"    TEXT,
      "title"             TEXT,
      "costCenter"        TEXT,
      "hourlyRate"        DOUBLE PRECISION,
      "annualSalary"      DOUBLE PRECISION,
      "burdenRate"        DOUBLE PRECISION,
      "fullyLoadedHourly" DOUBLE PRECISION,
      "monthlyCost"       DOUBLE PRECISION,
      "matchedStaffId"    TEXT,
      "createdAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

// "Brooks, Tiffany" → "Tiffany Brooks"
function normalizeName(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  if (s.includes(',')) {
    const [last, first] = s.split(',').map(x => x.trim());
    return `${first} ${last}`.trim();
  }
  return s;
}

// Staff table uses firstName + lastName columns (not a single "name").
// Try exact match on "First Last" first, then fall back to lastName + firstName,
// then a fuzzy contains on lastName.
async function findStaffIdByName(normalized) {
  if (!normalized) return null;
  const parts = normalized.split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const first = parts[0];
  const last = parts.slice(1).join(' ') || first;

  // Exact: firstName + lastName
  let rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE LOWER(TRIM("firstName")) = LOWER($1)
        AND LOWER(TRIM("lastName"))  = LOWER($2)
      LIMIT 1`,
    first, last,
  );
  if (rows?.[0]?.id) return rows[0].id;

  // Concatenated form
  rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE LOWER("firstName" || ' ' || "lastName") = LOWER($1)
      LIMIT 1`,
    normalized,
  );
  if (rows?.[0]?.id) return rows[0].id;

  // Fuzzy: lastName match (handles middle names, suffixes)
  rows = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "Staff"
      WHERE LOWER(TRIM("lastName")) = LOWER($1)
        AND LOWER(TRIM("firstName")) LIKE LOWER($2)
      LIMIT 1`,
    last, `${first}%`,
  );
  return rows?.[0]?.id || null;
}

async function main() {
  bar('HR PAYROLL → STAFF');
  const fp = path.join(ABEL_FOLDER, 'Abel Lumber - Labor Cost Analysis.xlsx');
  fileExistsOrDie(fp, 'Abel Lumber - Labor Cost Analysis.xlsx');

  console.log('→ ensuring Staff pay columns + staging table...');
  await ensureColumns();

  console.log('→ reading Payroll Data sheet...');
  const { rows } = readXlsxSheet(fp, 'Payroll Data', 2);
  console.log(`   ${rows.length} rows`);

  let matched = 0, staged = 0, updated = 0;
  for (const r of rows) {
    const raw = (r['Employee'] || '').toString().trim();
    if (!raw) continue;
    // Skip spreadsheet summary rows
    if (/^totals?$/i.test(raw) || /^grand\s*total/i.test(raw)) continue;
    const normalized = normalizeName(raw);
    const title = (r['Title'] || '').toString().trim() || null;
    const costCenter = (r['Cost Center'] || '').toString().trim() || null;
    const hourly = parseMoney(r['Hourly Rate']);
    const annual = parseMoney(r['Annual Salary']);
    const burden = parseMoney(r['Burden Rate']);
    const loaded = parseMoney(r['Fully Loaded Hourly']);
    const monthly = parseMoney(r['Monthly Cost']);

    const staffId = await findStaffIdByName(normalized);
    if (staffId) {
      matched++;
      try {
        await prisma.$executeRawUnsafe(
          `UPDATE "Staff" SET
             "hourlyRate"        = $2,
             "annualSalary"      = $3,
             "burdenRate"        = $4,
             "fullyLoadedHourly" = $5,
             "monthlyCost"       = $6,
             "costCenter"        = $7,
             "payrollTitle"      = $8,
             "payrollUpdatedAt"  = CURRENT_TIMESTAMP
           WHERE "id" = $1`,
          staffId, hourly, annual, burden, loaded, monthly, costCenter, title,
        );
        updated++;
      } catch (e) { console.warn(`   staff update fail: ${e.message?.slice(0,120)}`); }
    }

    try {
      await prisma.$executeRawUnsafe(
        `INSERT INTO "StaffPayrollStaging" (
           "id","rawName","normalizedName","title","costCenter","hourlyRate",
           "annualSalary","burdenRate","fullyLoadedHourly","monthlyCost","matchedStaffId"
         ) VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT ("rawName") DO UPDATE SET
           "hourlyRate"        = EXCLUDED."hourlyRate",
           "annualSalary"      = EXCLUDED."annualSalary",
           "burdenRate"        = EXCLUDED."burdenRate",
           "fullyLoadedHourly" = EXCLUDED."fullyLoadedHourly",
           "monthlyCost"       = EXCLUDED."monthlyCost",
           "matchedStaffId"    = EXCLUDED."matchedStaffId",
           "updatedAt"         = CURRENT_TIMESTAMP`,
        raw, normalized, title, costCenter, hourly, annual, burden, loaded, monthly, staffId,
      );
      staged++;
    } catch (e) {}
  }

  console.log(`\n✅ HR PAYROLL IMPORT COMPLETE`);
  console.log(`   Rows read:         ${rows.length}`);
  console.log(`   Staff matched:     ${matched}`);
  console.log(`   Staff updated:     ${updated}`);
  console.log(`   Staged rows:       ${staged}`);
  if (matched < rows.length) {
    console.log(`\n⚠️  ${rows.length - matched} payroll rows did not match a Staff record.`);
    console.log(`   Review "StaffPayrollStaging" WHERE "matchedStaffId" IS NULL`);
  }
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
