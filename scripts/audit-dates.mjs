#!/usr/bin/env node
/**
 * Diagnose date issues on Order and PurchaseOrder.
 * Readonly — prints distribution, outliers, and suspected wrong dates.
 */
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

console.log('\n═══ ORDER date audit ═══\n');

const totals = await sql.query(`
  SELECT COUNT(*)::int AS total,
    MIN("createdAt")::text AS min_created,
    MAX("createdAt")::text AS max_created,
    COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE)::int AS created_today,
    COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '1 day')::int AS created_24h,
    COUNT(*) FILTER (WHERE "deliveryDate" IS NULL)::int AS missing_delivery,
    COUNT(*) FILTER (WHERE "createdAt" > COALESCE("deliveryDate", "createdAt"))::int AS delivery_before_create
  FROM "Order"
`);
console.log('Orders total:     ', totals[0].total);
console.log('createdAt range:  ', totals[0].min_created?.substring(0,10), '→', totals[0].max_created?.substring(0,10));
console.log('Created today:    ', totals[0].created_today, '(suspicious if > ~10)');
console.log('Created last 24h: ', totals[0].created_24h);
console.log('Missing delivery: ', totals[0].missing_delivery);
console.log('deliveryDate < createdAt: ', totals[0].delivery_before_create);

console.log('\n--- Orders per month (by createdAt) ---');
const monthly = await sql.query(`
  SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS mo,
         COUNT(*)::int AS n,
         ROUND(SUM(total)::numeric, 0) AS revenue
  FROM "Order"
  WHERE status::text != 'CANCELLED'
  GROUP BY 1 ORDER BY 1
`);
for (const r of monthly) console.log(`  ${r.mo}  n=${String(r.n).padStart(4)}  rev=$${Number(r.revenue).toLocaleString()}`);

console.log('\n═══ PURCHASE ORDER date audit ═══\n');

const poExists = await sql.query(`SELECT to_regclass('"PurchaseOrder"') AS t`);
if (!poExists[0].t) {
  console.log('PurchaseOrder table not present.');
} else {
  const poTotals = await sql.query(`
    SELECT COUNT(*)::int AS total,
      MIN("createdAt")::text AS min_created,
      MAX("createdAt")::text AS max_created,
      COUNT(*) FILTER (WHERE "createdAt"::date = CURRENT_DATE)::int AS created_today,
      COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '1 day')::int AS created_24h
    FROM "PurchaseOrder"
  `);
  console.log('POs total:        ', poTotals[0].total);
  if (poTotals[0].total > 0) {
    console.log('createdAt range:  ', poTotals[0].min_created?.substring(0,10), '→', poTotals[0].max_created?.substring(0,10));
    console.log('Created today:    ', poTotals[0].created_today);
    console.log('Created last 24h: ', poTotals[0].created_24h);

    const poMonthly = await sql.query(`
      SELECT TO_CHAR(DATE_TRUNC('month', "createdAt"), 'YYYY-MM') AS mo, COUNT(*)::int AS n
      FROM "PurchaseOrder" GROUP BY 1 ORDER BY 1
    `);
    console.log('\n--- POs per month ---');
    for (const r of poMonthly) console.log(`  ${r.mo}  n=${r.n}`);
  }
}

console.log('\n═══ Sort sanity checks ═══\n');
const topRecent = await sql.query(`
  SELECT "orderNumber", "createdAt"::text AS created, status::text, ROUND(total::numeric,2) AS total
  FROM "Order" ORDER BY "createdAt" DESC LIMIT 5
`);
console.log('Top 5 newest Orders:');
for (const r of topRecent) console.log(`  ${r.created?.substring(0,19)}  ${r.orderNumber.padEnd(30)} ${r.status.padEnd(10)} $${r.total}`);

const topOld = await sql.query(`
  SELECT "orderNumber", "createdAt"::text AS created, status::text
  FROM "Order" ORDER BY "createdAt" ASC LIMIT 5
`);
console.log('\nOldest 5 Orders:');
for (const r of topOld) console.log(`  ${r.created?.substring(0,19)}  ${r.orderNumber.padEnd(30)} ${r.status}`);
