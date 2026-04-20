#!/usr/bin/env node
/**
 * Run all InFlow SQL batch imports against production Neon DB.
 *
 * Usage: node scripts/run-sql-batches.mjs
 *
 * Reads 65 SQL batch files from scripts/sql_batches/mb_*.sql
 * Each batch inserts 50 orders with ON CONFLICT upsert.
 * Total: 3,230 orders from InFlow (May 2024 - March 2026).
 *
 * Requires: npm install @neondatabase/serverless dotenv
 * Uses DATABASE_URL from .env
 */

import { readFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Load .env
const envPath = join(rootDir, '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];

if (!dbUrl) {
  console.error('❌ No DATABASE_URL found in .env');
  process.exit(1);
}

// Dynamic import after we know the env
const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

const batchDir = join(__dirname, 'sql_batches');
const files = readdirSync(batchDir)
  .filter(f => f.startsWith('mb_') && f.endsWith('.sql'))
  .sort((a, b) => {
    const na = parseInt(a.replace('mb_', '').replace('.sql', ''));
    const nb = parseInt(b.replace('mb_', '').replace('.sql', ''));
    return na - nb;
  });

console.log(`📦 Found ${files.length} batch files`);
console.log(`🔗 Connecting to Neon...`);

let totalInserted = 0;
let errors = [];

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const filePath = join(batchDir, file);
  const sqlContent = readFileSync(filePath, 'utf-8');

  try {
    await sql.query(sqlContent);
    totalInserted += 50; // approx per batch
    if ((i + 1) % 5 === 0 || i === files.length - 1) {
      console.log(`  ✅ Batch ${i + 1}/${files.length} done (~${totalInserted} orders)`);
    }
  } catch (err) {
    console.error(`  ❌ Batch ${i + 1} (${file}) FAILED: ${err.message}`);
    errors.push({ file, error: err.message });
  }
}

console.log(`\n📊 Import complete!`);
console.log(`   Batches run: ${files.length - errors.length}/${files.length}`);
console.log(`   Approx orders upserted: ~${totalInserted}`);
if (errors.length > 0) {
  console.log(`   ⚠️  Errors: ${errors.length}`);
  errors.forEach(e => console.log(`      ${e.file}: ${e.error}`));
}

// Verify
console.log(`\n🔍 Verifying...`);
const result = await sql`SELECT COUNT(*) as total, COALESCE(SUM(total) FILTER (WHERE status::text != 'CANCELLED'), 0)::numeric(12,2) as revenue FROM "Order"`;
console.log(`   Total orders: ${result[0].total}`);
console.log(`   Active revenue: $${Number(result[0].revenue).toLocaleString()}`);
