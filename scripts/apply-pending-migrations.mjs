#!/usr/bin/env node
/**
 * scripts/apply-pending-migrations.mjs
 *
 * Applies the three pending SQL migrations that hydrate the
 * Activity/Task/Inspection portals:
 *
 *   1. prisma/migrations/pending_activity_task_source_key.sql
 *      - Activity.sourceKey  (String? @unique)
 *      - Task.sourceKey      (String? @unique)
 *
 *   2. prisma/migrations/pending_ai_invocation.sql
 *      - AIInvocation table + 3 indexes
 *
 *   3. prisma/migrations/pending_staff_preferences.sql
 *      - Staff.preferences (JSONB) + GIN index
 *
 * Each file is:
 *   - split into individual top-level statements
 *   - run inside a single Neon HTTP transaction (rolls back on failure)
 *   - idempotent (ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS / ...)
 *
 * After applying, post-checks query information_schema to confirm each column/
 * table is actually present. Exits 0 on success, 1 on any hard failure.
 *
 * Usage:
 *   node scripts/apply-pending-migrations.mjs
 *
 * No flags — SQL is idempotent, so re-running is safe (second run is a no-op).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// ── Load DATABASE_URL from .env ──────────────────────────────────────────
const envPath = join(rootDir, '.env');
const envContent = readFileSync(envPath, 'utf-8');
const dbUrl = envContent.match(/DATABASE_URL="([^"]+)"/)?.[1];

if (!dbUrl) {
  console.error('[migrate] ERROR: No DATABASE_URL found in .env');
  process.exit(1);
}

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

// ── Statement splitter (same pattern as apply-2026-04-22-migration.js) ──
// Strips -- line comments, honors $$ dollar-quoted blocks, splits on
// top-level semicolons.
function splitSql(text) {
  const stripped = text
    .split('\n')
    .map((l) => (l.match(/^\s*--/) ? '' : l))
    .join('\n');

  const out = [];
  let buf = '';
  let inDollar = false;
  for (let i = 0; i < stripped.length; i++) {
    const two = stripped.slice(i, i + 2);
    if (two === '$$') {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }
    const ch = stripped[i];
    if (ch === ';' && !inDollar) {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// ── Pending migrations + their post-apply verification checks ────────────
const migrations = [
  {
    name: 'pending_activity_task_source_key.sql',
    path: join(rootDir, 'prisma', 'migrations', 'pending_activity_task_source_key.sql'),
    verify: async () => {
      const checks = [];
      const [activityCol] = await sql.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Activity' AND column_name = 'sourceKey'`,
      );
      checks.push(['Activity.sourceKey column', !!activityCol]);
      const [taskCol] = await sql.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = 'Task' AND column_name = 'sourceKey'`,
      );
      checks.push(['Task.sourceKey column', !!taskCol]);
      const [activityIdx] = await sql.query(
        `SELECT 1 FROM pg_indexes
          WHERE tablename = 'Activity' AND indexname = 'Activity_sourceKey_key'`,
      );
      checks.push(['Activity_sourceKey_key unique index', !!activityIdx]);
      const [taskIdx] = await sql.query(
        `SELECT 1 FROM pg_indexes
          WHERE tablename = 'Task' AND indexname = 'Task_sourceKey_key'`,
      );
      checks.push(['Task_sourceKey_key unique index', !!taskIdx]);
      return checks;
    },
  },
  {
    name: 'pending_ai_invocation.sql',
    path: join(rootDir, 'prisma', 'migrations', 'pending_ai_invocation.sql'),
    verify: async () => {
      const checks = [];
      const [tbl] = await sql.query(
        `SELECT 1 FROM information_schema.tables
          WHERE table_name = 'AIInvocation'`,
      );
      checks.push(['AIInvocation table', !!tbl]);
      const idxRows = await sql.query(
        `SELECT indexname FROM pg_indexes
          WHERE tablename = 'AIInvocation'`,
      );
      const idxNames = new Set(idxRows.map((r) => r.indexname));
      checks.push(['AIInvocation_endpoint_idx', idxNames.has('AIInvocation_endpoint_idx')]);
      checks.push(['AIInvocation_staffId_idx', idxNames.has('AIInvocation_staffId_idx')]);
      checks.push(['AIInvocation_createdAt_idx', idxNames.has('AIInvocation_createdAt_idx')]);
      return checks;
    },
  },
  {
    name: 'pending_staff_preferences.sql',
    path: join(rootDir, 'prisma', 'migrations', 'pending_staff_preferences.sql'),
    verify: async () => {
      const checks = [];
      const [col] = await sql.query(
        `SELECT data_type FROM information_schema.columns
          WHERE table_name = 'Staff' AND column_name = 'preferences'`,
      );
      checks.push(['Staff.preferences column', !!col]);
      if (col) {
        checks.push([`  data_type = ${col.data_type}`, col.data_type === 'jsonb']);
      }
      const [idx] = await sql.query(
        `SELECT 1 FROM pg_indexes
          WHERE tablename = 'Staff' AND indexname = 'Staff_preferences_gin_idx'`,
      );
      checks.push(['Staff_preferences_gin_idx', !!idx]);
      return checks;
    },
  },
];

// ── Runner ───────────────────────────────────────────────────────────────
const results = [];

for (const m of migrations) {
  console.log(`\n[migrate] ── ${m.name}`);
  const text = readFileSync(m.path, 'utf-8');
  const stmts = splitSql(text);
  console.log(`[migrate]    ${stmts.length} statement(s)`);

  let status = 'applied';
  let errorMsg = null;

  try {
    // Build lazy NeonQueryPromise[] and hand off as single HTTP transaction.
    // Neon's HTTP driver wraps the array in BEGIN/COMMIT; any failure ROLLBACKs.
    const queries = stmts.map((s) => sql.query(s));
    await sql.transaction(queries);
    console.log(`[migrate]    transaction committed`);
  } catch (e) {
    status = 'failed';
    errorMsg = e?.message || String(e);
    console.error(`[migrate]    FAILED: ${errorMsg}`);
  }

  // Verify regardless — idempotent SQL means a "failed" rerun may still leave
  // the schema correct. The verify pass is the source of truth.
  let verifyChecks = [];
  try {
    verifyChecks = await m.verify();
  } catch (e) {
    console.error(`[migrate]    verify ERROR: ${e?.message || e}`);
  }

  const allPresent = verifyChecks.every(([, ok]) => ok);
  const summary = {
    migration: m.name,
    status: status === 'failed' ? 'failed' : allPresent ? 'applied' : 'partial',
    error: errorMsg,
    checks: verifyChecks.map(([label, ok]) => ({ label, ok })),
  };
  results.push(summary);

  for (const [label, ok] of verifyChecks) {
    console.log(`[migrate]    ${ok ? 'OK  ' : 'MISS'} ${label}`);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────
console.log('\n[migrate] ── summary');
console.log(JSON.stringify(results, null, 2));

const anyFailed = results.some((r) => r.status !== 'applied');
if (anyFailed) {
  console.error('[migrate] one or more migrations did not fully apply');
  process.exit(1);
}
console.log('[migrate] all three migrations verified present');
process.exit(0);
