#!/usr/bin/env node
/**
 * Dead Model Report — read-only scan of every Prisma model.
 *
 * For each model in prisma/schema.prisma:
 *   • derive the Postgres table name (respect @@map("name") if present,
 *     otherwise use the model name verbatim — Prisma keeps PascalCase)
 *   • SELECT COUNT(*) FROM "<table>"
 *   • if the model has a createdAt column, also collect MIN/MAX(createdAt)
 *   • classify as ZERO | TABLE MISSING | STALE (>6mo since last write) | ACTIVE
 *
 * Output: stdout table + docs/DEAD-MODEL-REPORT.md
 *
 * Read-only: zero mutations, no DDL, no migrations. Safe to run anytime.
 *
 * Usage:  node scripts/dead-model-report.mjs
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ─── env: DATABASE_URL ─────────────────────────────────────────────────────
const envPath = join(ROOT, '.env');
let dbUrl;
try {
  const envContent = readFileSync(envPath, 'utf-8');
  dbUrl =
    envContent.match(/DATABASE_URL="([^"]+)"/)?.[1] ||
    envContent.match(/DATABASE_URL=([^\r\n]+)/)?.[1];
} catch (err) {
  console.error(`[dead-model-report] Cannot read ${envPath}: ${err.message}`);
  process.exit(1);
}
if (!dbUrl) {
  console.error('[dead-model-report] DATABASE_URL not found in .env');
  process.exit(1);
}

// ─── parse schema.prisma ───────────────────────────────────────────────────
const schemaPath = join(ROOT, 'prisma', 'schema.prisma');
let schemaText;
try {
  schemaText = readFileSync(schemaPath, 'utf-8');
} catch (err) {
  console.error(`[dead-model-report] Cannot read ${schemaPath}: ${err.message}`);
  process.exit(1);
}

/**
 * Extract { modelName, tableName, hasCreatedAt } for every model block.
 * Strategy: walk lines, track when we're inside `model X {` ... matching `}`
 * at column 0, and capture @@map + createdAt presence.
 */
function parseModels(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let cur = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!cur) {
      const m = line.match(/^model\s+(\w+)\s*\{/);
      if (m) {
        cur = { modelName: m[1], tableName: null, hasCreatedAt: false };
      }
    } else {
      // closing brace at column 0 ends the model
      if (/^\}\s*$/.test(line)) {
        cur.tableName = cur.tableName || cur.modelName;
        out.push(cur);
        cur = null;
        continue;
      }
      const map = line.match(/@@map\(\s*"([^"]+)"\s*\)/);
      if (map) cur.tableName = map[1];
      // field line — first token is the field name
      const fld = line.match(/^\s+(\w+)\s+\S/);
      if (fld && fld[1] === 'createdAt') cur.hasCreatedAt = true;
    }
  }
  return out;
}

const models = parseModels(schemaText);
if (models.length === 0) {
  console.error('[dead-model-report] No models parsed from schema.prisma');
  process.exit(1);
}
console.log(`[dead-model-report] Parsed ${models.length} models from schema.prisma`);

// ─── connect ───────────────────────────────────────────────────────────────
let sql;
try {
  const { neon } = await import('@neondatabase/serverless');
  sql = neon(dbUrl);
  // liveness probe
  await sql.query('SELECT 1 AS ok');
} catch (err) {
  console.error(`[dead-model-report] DB connection failed: ${err.message}`);
  process.exit(1);
}

// ─── one-shot: fetch all public tables + their columns so we don't hammer
//                information_schema per-model ───────────────────────────────
const colRows = await sql.query(`
  SELECT table_name, column_name
    FROM information_schema.columns
   WHERE table_schema = 'public'
`);
const tableCols = new Map(); // table_name -> Set<column>
for (const r of colRows) {
  if (!tableCols.has(r.table_name)) tableCols.set(r.table_name, new Set());
  tableCols.get(r.table_name).add(r.column_name);
}

// ─── scan each model ───────────────────────────────────────────────────────
const SIX_MONTHS_MS = 183 * 24 * 60 * 60 * 1000;
const now = Date.now();

const results = [];
let done = 0;
for (const m of models) {
  done++;
  const cols = tableCols.get(m.tableName);
  let status, rowCount = null, minCreated = null, maxCreated = null, error = null;

  if (!cols) {
    status = 'TABLE MISSING';
  } else {
    const hasCreatedAtColumn = cols.has('createdAt');
    try {
      if (m.hasCreatedAt && hasCreatedAtColumn) {
        const r = await sql.query(
          `SELECT COUNT(*)::bigint AS n,
                  MIN("createdAt") AS mn,
                  MAX("createdAt") AS mx
             FROM "${m.tableName}"`
        );
        rowCount = Number(r[0].n);
        minCreated = r[0].mn;
        maxCreated = r[0].mx;
      } else {
        const r = await sql.query(
          `SELECT COUNT(*)::bigint AS n FROM "${m.tableName}"`
        );
        rowCount = Number(r[0].n);
      }

      if (rowCount === 0) {
        status = 'ZERO';
      } else if (maxCreated && now - new Date(maxCreated).getTime() > SIX_MONTHS_MS) {
        status = 'STALE';
      } else if (!maxCreated && rowCount > 0 && m.hasCreatedAt && hasCreatedAtColumn) {
        // rows exist but all createdAt null — treat as stale
        status = 'STALE';
      } else {
        status = 'ACTIVE';
      }
    } catch (err) {
      // still catch relation-does-not-exist type race conditions
      error = err.message || String(err);
      if (/does not exist/i.test(error)) {
        status = 'TABLE MISSING';
      } else {
        status = 'ERROR';
      }
    }
  }

  results.push({
    modelName: m.modelName,
    tableName: m.tableName,
    hasCreatedAt: m.hasCreatedAt,
    rowCount,
    maxCreated: maxCreated ? new Date(maxCreated).toISOString() : null,
    minCreated: minCreated ? new Date(minCreated).toISOString() : null,
    status,
    error,
  });

  if (done % 25 === 0) process.stdout.write(`  …scanned ${done}/${models.length}\n`);
}

// ─── classify / summarize ──────────────────────────────────────────────────
const counts = { ZERO: 0, 'TABLE MISSING': 0, STALE: 0, ACTIVE: 0, ERROR: 0 };
for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

// suggestion text per row
function suggest(r) {
  switch (r.status) {
    case 'ZERO':
      return 'Zero rows since launch — candidate for archival';
    case 'STALE':
      return `Last write ${r.maxCreated?.slice(0, 10) || 'n/a'} — review; may be archivable`;
    case 'TABLE MISSING':
      return 'Table not in DB — schema drift; drop model or restore table';
    case 'ACTIVE':
      return 'Active — keep';
    case 'ERROR':
      return `Query failed: ${r.error}`;
    default:
      return '';
  }
}

// ─── archival candidates (ZERO + STALE) ────────────────────────────────────
const archivalCandidates = results
  .filter((r) => r.status === 'ZERO' || r.status === 'STALE')
  .sort((a, b) => {
    // ZERO first, then oldest STALE
    if (a.status !== b.status) return a.status === 'ZERO' ? -1 : 1;
    const ax = a.maxCreated || '';
    const bx = b.maxCreated || '';
    return ax.localeCompare(bx);
  });

// ─── stdout report ─────────────────────────────────────────────────────────
const today = new Date().toISOString().slice(0, 10);
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

console.log('\n═══════════════════════════════════════════════════════════════════');
console.log(` Dead Model Report — ${today}`);
console.log('═══════════════════════════════════════════════════════════════════');
console.log(` Total models scanned : ${results.length}`);
console.log(` ZERO rows           : ${counts['ZERO']}`);
console.log(` TABLE MISSING       : ${counts['TABLE MISSING']}`);
console.log(` STALE (>6 mo)       : ${counts['STALE']}`);
console.log(` ACTIVE              : ${counts['ACTIVE']}`);
if (counts['ERROR']) console.log(` ERROR               : ${counts['ERROR']}`);
console.log('───────────────────────────────────────────────────────────────────');

console.log('\nTop archival candidates (up to 25):');
for (const r of archivalCandidates.slice(0, 25)) {
  console.log(
    `  ${pad(r.status, 14)} ${pad(r.modelName, 32)} rows=${pad(r.rowCount ?? '—', 8)} last=${r.maxCreated?.slice(0, 10) || '—'}`
  );
}

// ─── write markdown ────────────────────────────────────────────────────────
const docsDir = join(ROOT, 'docs');
if (!existsSync(docsDir)) mkdirSync(docsDir, { recursive: true });
const outPath = join(docsDir, 'DEAD-MODEL-REPORT.md');

const fmtDate = (iso) => (iso ? iso.slice(0, 10) : '—');

let md = '';
md += `# Dead Model Report — ${today}\n`;
md += `Generated by \`scripts/dead-model-report.mjs\` (read-only).\n\n`;
md += `> **Nothing was dropped.** This is a review-only report to inform the post-launch archival decision.\n\n`;

md += `## Summary\n\n`;
md += `- Total models in schema: **${results.length}**\n`;
md += `- ZERO rows: **${counts['ZERO']}**\n`;
md += `- TABLE MISSING: **${counts['TABLE MISSING']}**\n`;
md += `- STALE (no write in 6+ mo): **${counts['STALE']}**\n`;
md += `- ACTIVE: **${counts['ACTIVE']}**\n`;
if (counts['ERROR']) md += `- ERROR: **${counts['ERROR']}**\n`;
md += `\n`;

md += `## Recommended for post-launch archival\n\n`;
md += `ZERO-row and STALE models, ordered ZERO first then oldest STALE last-write.\n\n`;
md += `| Model | Table | Rows | Last write | Status | Suggestion |\n`;
md += `|-------|-------|-----:|------------|--------|------------|\n`;
for (const r of archivalCandidates) {
  md += `| \`${r.modelName}\` | \`${r.tableName}\` | ${r.rowCount ?? '—'} | ${fmtDate(r.maxCreated)} | ${r.status} | ${suggest(r)} |\n`;
}
md += `\n`;

md += `## All models\n\n`;
md += `Sorted by status (ZERO → TABLE MISSING → STALE → ERROR → ACTIVE), then model name.\n\n`;
md += `| Model | Table | Rows | First write | Last write | Status |\n`;
md += `|-------|-------|-----:|-------------|------------|--------|\n`;
const sortKey = (s) =>
  ({ ZERO: 0, 'TABLE MISSING': 1, STALE: 2, ERROR: 3, ACTIVE: 4 })[s] ?? 9;
const sorted = [...results].sort((a, b) => {
  const k = sortKey(a.status) - sortKey(b.status);
  if (k !== 0) return k;
  return a.modelName.localeCompare(b.modelName);
});
for (const r of sorted) {
  md += `| \`${r.modelName}\` | \`${r.tableName}\` | ${r.rowCount ?? '—'} | ${fmtDate(r.minCreated)} | ${fmtDate(r.maxCreated)} | ${r.status} |\n`;
}
md += `\n`;

md += `---\n`;
md += `_Script: \`scripts/dead-model-report.mjs\` · Read-only · No DB mutations._\n`;

writeFileSync(outPath, md, 'utf-8');
console.log(`\n[dead-model-report] Wrote ${outPath}`);
console.log('[dead-model-report] Done.');
