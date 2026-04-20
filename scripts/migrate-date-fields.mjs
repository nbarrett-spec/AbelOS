#!/usr/bin/env node
/**
 * Phase 1 — Schema migration for proper date handling on Order and PurchaseOrder.
 *
 * Adds:
 *   Order.orderDate       (TIMESTAMPTZ, nullable) — business order date from InFlow
 *   Order.isForecast      (BOOLEAN, default false) — true if orderDate > today
 *   PurchaseOrder.source  (TEXT, nullable) — 'INFLOW' | 'LEGACY_SEED' | null
 *
 * Backfills orderDate from existing createdAt (safe default). Subsequent reimport
 * overwrites with real InFlow OrderDate.
 *
 * Idempotent — safe to re-run.
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

console.log('\n── Phase 1: schema migration ──\n');

const steps = [
  {
    name: 'Order.orderDate',
    sql: `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "orderDate" TIMESTAMPTZ`,
  },
  {
    name: 'Order.isForecast',
    sql: `ALTER TABLE "Order" ADD COLUMN IF NOT EXISTS "isForecast" BOOLEAN NOT NULL DEFAULT false`,
  },
  {
    name: 'PurchaseOrder.source',
    sql: `ALTER TABLE "PurchaseOrder" ADD COLUMN IF NOT EXISTS "source" TEXT`,
  },
  {
    name: 'Index Order(orderDate)',
    sql: `CREATE INDEX IF NOT EXISTS "Order_orderDate_idx" ON "Order" ("orderDate")`,
  },
  {
    name: 'Index Order(isForecast)',
    sql: `CREATE INDEX IF NOT EXISTS "Order_isForecast_idx" ON "Order" ("isForecast")`,
  },
  {
    name: 'Index PurchaseOrder(source)',
    sql: `CREATE INDEX IF NOT EXISTS "PurchaseOrder_source_idx" ON "PurchaseOrder" ("source")`,
  },
];

for (const step of steps) {
  try {
    await sql.query(step.sql);
    console.log(`  ✅  ${step.name}`);
  } catch (e) {
    console.error(`  ❌  ${step.name}: ${e.message}`);
    process.exit(1);
  }
}

// Backfill orderDate from createdAt for any rows where it's null.
console.log('\n── Backfill Order.orderDate from createdAt (where null) ──\n');
const backfill = await sql.query(
  `UPDATE "Order" SET "orderDate" = "createdAt" WHERE "orderDate" IS NULL`
);
console.log(`  Backfilled rows (Order.orderDate): returned obj:`, backfill);

// Set isForecast true where orderDate > today
console.log('\n── Mark forecast orders (orderDate > today) ──\n');
const markForecast = await sql.query(
  `UPDATE "Order" SET "isForecast" = true WHERE "orderDate" > NOW()`
);
console.log(`  Forecast rows:`, markForecast);

// Tag existing POs as LEGACY_SEED so we know they pre-date real InFlow data
console.log('\n── Tag all current POs as LEGACY_SEED (will flip to INFLOW during reimport) ──\n');
const tagSeed = await sql.query(
  `UPDATE "PurchaseOrder" SET "source" = 'LEGACY_SEED' WHERE "source" IS NULL`
);
console.log(`  Tagged rows:`, tagSeed);

console.log('\n✅ Phase 1 complete.\n');
