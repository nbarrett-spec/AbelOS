#!/usr/bin/env node
/**
 * Query live DB for Quote + Contract columns.
 * Read-only.
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

for (const table of ['Quote', 'Contract']) {
  console.log(`\n=== ${table} ===`);
  const rows = await sql`
    SELECT column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name=${table}
    ORDER BY ordinal_position
  `;
  for (const r of rows) {
    console.log(`  ${r.column_name.padEnd(30)} ${r.data_type.padEnd(30)} udt=${(r.udt_name||'').padEnd(20)} null=${r.is_nullable}  default=${r.column_default||''}`);
  }
}
