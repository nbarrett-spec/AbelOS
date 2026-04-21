#!/usr/bin/env node
/**
 * Reconcile Abel OS open AR against the Bolt Master AR Report.
 * Source of truth: C:/Users/natha/OneDrive/Abel Lumber/Abel_Master_AR_Report_2026-04-10.xlsx
 */
import { readFileSync } from 'fs';
import XLSX from 'xlsx';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const XLSX_PATH = 'C:/Users/natha/OneDrive/Abel Lumber/Abel_Master_AR_Report_2026-04-10.xlsx';
console.log(`\n── Reading ${XLSX_PATH.split('/').pop()} ──\n`);

const wb = XLSX.readFile(XLSX_PATH);
console.log(`Sheets: ${wb.SheetNames.join(', ')}`);

for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
  console.log(`\n[${sheetName}] ${rows.length} rows`);
  if (rows.length) console.log(`  Headers: ${JSON.stringify(rows[0]).slice(0, 300)}`);
  if (rows.length > 1) console.log(`  First data row: ${JSON.stringify(rows[1]).slice(0, 300)}`);
}

// Pick the main sheet (first or biggest)
const main = wb.SheetNames[0];
const data = XLSX.utils.sheet_to_json(wb.Sheets[main], { defval: '' });
console.log(`\n── Parsed ${data.length} rows from "${main}" ──\n`);
if (data[0]) console.log('Keys:', Object.keys(data[0]).join(' | '));

// Try to find balance/amount columns and customer column heuristically
const sample = data[0] || {};
const keys = Object.keys(sample);
const balKey = keys.find(k => /balance|outstanding|open|amount due|total/i.test(k)) || keys.find(k => /amount/i.test(k));
const custKey = keys.find(k => /customer|builder|company|client/i.test(k));
console.log(`\nDetected: customer="${custKey}", balance="${balKey}"`);

if (!balKey || !custKey) {
  console.log('\n⚠️  Could not auto-detect columns. Dumping first 3 rows for manual inspection:');
  data.slice(0,3).forEach((r,i) => console.log(`  [${i}]`, JSON.stringify(r).slice(0,500)));
  process.exit(0);
}

// Roll up by customer
const boltAR = {};
let total = 0;
for (const r of data) {
  const cust = String(r[custKey] || '').trim();
  const bal = parseFloat(String(r[balKey] || '0').replace(/[^0-9.-]/g,'')) || 0;
  if (!cust) continue;
  boltAR[cust] = (boltAR[cust] || 0) + bal;
  total += bal;
}

console.log(`\n📊 Bolt Master AR Report total open balance: $${total.toLocaleString(undefined,{maximumFractionDigits:2})}`);
console.log(`   Customer count: ${Object.keys(boltAR).length}`);

console.log('\nTop 15 by balance (Bolt):');
const top = Object.entries(boltAR).sort((a,b)=>b[1]-a[1]).slice(0,15);
for (const [c,v] of top) console.log(`  ${c.padEnd(40)} $${Number(v).toLocaleString(undefined,{maximumFractionDigits:2})}`);

// DB side: Order.balanceDue (or total - amountPaid) for non-cancelled, non-paid
const dbAR = await sql.query(`
  SELECT b."companyName",
    ROUND(SUM(
      CASE WHEN o."paymentStatus"::text = 'PAID' THEN 0
           ELSE o.total - COALESCE((
             SELECT SUM(p.amount) FROM "Payment" p WHERE p."orderId" = o.id
           ), 0)
      END
    )::numeric, 2) AS open_ar
  FROM "Order" o JOIN "Builder" b ON b.id = o."builderId"
  WHERE o.status::text != 'CANCELLED'
  GROUP BY b."companyName"
  HAVING SUM(
    CASE WHEN o."paymentStatus"::text = 'PAID' THEN 0
         ELSE o.total - COALESCE((
           SELECT SUM(p.amount) FROM "Payment" p WHERE p."orderId" = o.id
         ), 0)
    END
  ) > 0.01
  ORDER BY open_ar DESC LIMIT 30
`);

const dbTotal = await sql.query(`
  SELECT ROUND(SUM(
    CASE WHEN o."paymentStatus"::text = 'PAID' THEN 0
         ELSE o.total - COALESCE((SELECT SUM(p.amount) FROM "Payment" p WHERE p."orderId" = o.id), 0)
    END
  )::numeric, 2) AS total
  FROM "Order" o WHERE o.status::text != 'CANCELLED'
`);

console.log(`\n📊 Abel OS DB open AR: $${Number(dbTotal[0].total).toLocaleString()}`);
console.log('\nTop 15 by balance (DB):');
for (const r of dbAR.slice(0,15)) console.log(`  ${(r.companyName||'').padEnd(40)} $${Number(r.open_ar).toLocaleString()}`);

const gap = total - Number(dbTotal[0].total);
console.log(`\n⚠️  GAP (Bolt – DB): $${Math.round(gap).toLocaleString()}`);
console.log(`    ${((Math.abs(gap)/total)*100).toFixed(1)}% difference`);
