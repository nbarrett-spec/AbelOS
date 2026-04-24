// Ingest Standard Operating Procedures from the SOP/ folder into the Sop table.
//
// Source folder (parent workspace, ../SOP/):
//   *.docx, *.pdf, *.md — anything role-tagged by filename or body keywords.
//
// Writes:
//   Sop — one row per source file, role-tagged for portal surfacing.
//
// Idempotent on id (hash of filePath). Default is dry-run; pass --commit to apply.
//
//   node scripts/ingest-sop-folder.mjs            # dry run
//   node scripts/ingest-sop-folder.mjs --commit   # apply

import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';
import { unzipSync, strFromU8 } from 'fflate';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');
const SOP_DIR = path.join(ABEL_FOLDER, 'SOP');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const COMMIT = process.argv.includes('--commit');
const sql = neon(process.env.DATABASE_URL);

function bar(t) {
  console.log('\n' + '='.repeat(64));
  console.log('  ' + t);
  console.log('='.repeat(64));
}

// ── Role-routing heuristic ─────────────────────────────────────────
// Filename + first-chunk-of-body scan.
const ALL_ROLES = [
  'ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP',
  'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER',
  'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER',
];

// Tokens only from filename (high-signal). Body used for tie-breaking.
function assignRoles(filename, body) {
  const name = filename.toLowerCase();
  const firstChunk = (body || '').slice(0, 1500).toLowerCase();
  const roles = new Set();

  // Delivery / driver work
  if (/\b(driver|delivery|shipment|loader)\b/.test(name)) {
    roles.add('DRIVER');
    roles.add('WAREHOUSE_LEAD');
  }
  // Manufacturing / warehouse line
  if (/\b(manufactur\w*|hanging line|door hanging|production)\b/.test(name)) {
    roles.add('WAREHOUSE_LEAD');
    roles.add('WAREHOUSE_TECH');
  }
  // Warehouse-only pickers
  if (/\b(warehouse|pick|receive|receiving|inventory)\b/.test(name)) {
    roles.add('WAREHOUSE_LEAD');
    roles.add('WAREHOUSE_TECH');
  }
  // Installers
  if (/\b(installer|install crew|field install)\b/.test(name)) {
    roles.add('INSTALLER');
    roles.add('WAREHOUSE_LEAD');
  }
  // PM-specific
  if (/\b(project manager|\bpm\b|builder)\b/.test(name)) {
    roles.add('PROJECT_MANAGER');
    roles.add('MANAGER');
  }
  // Accounting / billing
  if (/\b(accounting|invoice|payment|collections|billing)\b/.test(name)) {
    roles.add('ACCOUNTING');
    roles.add('MANAGER');
  }
  // QC
  if (/\b(qc|quality control|inspection)\b/.test(name)) {
    roles.add('QC_INSPECTOR');
    roles.add('MANAGER');
  }
  // Sales
  if (/\b(sales|quote|estimate|proposal|takeoff)\b/.test(name)) {
    roles.add('SALES_REP');
    roles.add('MANAGER');
  }

  // If nothing matched on filename, fall back to body scan for a single hint.
  if (roles.size === 0) {
    if (/\bdriver|delivery crew|loading the truck\b/.test(firstChunk)) {
      roles.add('DRIVER');
      roles.add('WAREHOUSE_LEAD');
    } else if (/\bproject manager|builder portal\b/.test(firstChunk)) {
      roles.add('PROJECT_MANAGER');
      roles.add('MANAGER');
    } else {
      // Truly generic — make visible to every role (e.g. company handbook-style)
      return [...ALL_ROLES];
    }
  }
  return [...roles].sort();
}

function guessDepartment(roles, filename) {
  const f = filename.toLowerCase();
  if (f.includes('delivery') || f.includes('driver') || f.includes('shipment')) return 'DELIVERY';
  if (f.includes('manufactur') || f.includes('hanging')) return 'MANUFACTURING';
  if (f.includes('pm') || f.includes('project manager')) return 'OPERATIONS';
  if (f.includes('warehouse') || f.includes('loader')) return 'WAREHOUSE';
  if (f.includes('install')) return 'INSTALLATION';
  if (f.includes('account') || f.includes('invoice')) return 'ACCOUNTING';
  if (f.includes('sales') || f.includes('quote')) return 'SALES';
  return null;
}

// ── Extractors ─────────────────────────────────────────────────────
function extractMd(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

// DOCX = ZIP. word/document.xml holds the content. Strip XML tags.
function extractDocx(filePath) {
  const buf = fs.readFileSync(filePath);
  const zip = unzipSync(new Uint8Array(buf), {
    filter: (f) => f.name === 'word/document.xml',
  });
  const xmlBytes = zip['word/document.xml'];
  if (!xmlBytes) return '';
  const xml = strFromU8(xmlBytes);
  // Replace paragraph/break tags with newlines before stripping.
  const withBreaks = xml
    .replace(/<w:p[ >][^]*?<\/w:p>/g, (p) => p + '\n')
    .replace(/<w:br\s*\/?>/g, '\n')
    .replace(/<w:tab\s*\/?>/g, '\t');
  // Strip all XML tags.
  const text = withBreaks
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+\n/g, '\n\n')
    .trim();
  return text;
}

async function extractPdf(filePath) {
  try {
    // Use pdf-parse (already installed). Limit to first 2 pages via max.
    const pdfParse = (await import('pdf-parse')).default;
    const buf = fs.readFileSync(filePath);
    const result = await pdfParse(buf, { max: 2 });
    return (result.text || '').trim();
  } catch (err) {
    console.warn(`  ! PDF extract failed for ${path.basename(filePath)}: ${err.message}`);
    return '';
  }
}

function titleFromFilename(filename) {
  return filename
    .replace(/\.(docx|pdf|md)$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function stableId(relPath) {
  return 'sop_' + crypto.createHash('sha1').update(relPath).digest('hex').slice(0, 16);
}

// ── Schema ─────────────────────────────────────────────────────────
async function ensureSchema() {
  await sql`
    CREATE TABLE IF NOT EXISTS "Sop" (
      "id" TEXT PRIMARY KEY,
      "title" TEXT NOT NULL,
      "roles" TEXT[] NOT NULL,
      "department" TEXT,
      "filePath" TEXT,
      "fileType" TEXT,
      "summary" TEXT,
      "bodyExcerpt" TEXT,
      "lastUpdatedAt" TIMESTAMPTZ,
      "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "Sop_roles_idx" ON "Sop" USING gin("roles")`;
  await sql`CREATE INDEX IF NOT EXISTS "Sop_department_idx" ON "Sop"("department")`;
}

// ── Walk folder recursively ────────────────────────────────────────
function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, acc);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (['.docx', '.pdf', '.md'].includes(ext)) {
        acc.push(full);
      }
    }
  }
  return acc;
}

// ── Main ───────────────────────────────────────────────────────────
async function main() {
  bar(`Ingest SOP folder → Sop table ${COMMIT ? '(COMMIT)' : '(dry-run)'}`);
  console.log(`  Source: ${SOP_DIR}`);

  if (!fs.existsSync(SOP_DIR)) {
    console.error(`  ! SOP folder not found: ${SOP_DIR}`);
    process.exit(1);
  }

  if (COMMIT) await ensureSchema();

  const files = walk(SOP_DIR);
  console.log(`  Found ${files.length} candidate file(s)`);

  let parsed = 0;
  let inserted = 0;
  let skipped = 0;
  const roleCounts = {};

  for (const filePath of files) {
    const rel = path.relative(ABEL_FOLDER, filePath).replace(/\\/g, '/');
    const filename = path.basename(filePath);
    const ext = path.extname(filename).toLowerCase();

    let body = '';
    try {
      if (ext === '.md') body = extractMd(filePath);
      else if (ext === '.docx') body = extractDocx(filePath);
      else if (ext === '.pdf') body = await extractPdf(filePath);
    } catch (err) {
      console.warn(`  ! Parse failed [${filename}]: ${err.message}`);
      skipped++;
      continue;
    }

    if (!body || body.length < 10) {
      console.warn(`  ! Empty body [${filename}] — keeping stub`);
    }
    parsed++;

    const title = titleFromFilename(filename);
    const roles = assignRoles(filename, body);
    const department = guessDepartment(roles, filename);
    const summary = body.slice(0, 500);
    const bodyExcerpt = body.slice(0, 2000);
    const id = stableId(rel);
    const fileType = ext.replace('.', '').toUpperCase();
    const stat = fs.statSync(filePath);
    const lastUpdatedAt = stat.mtime;

    for (const r of roles) roleCounts[r] = (roleCounts[r] || 0) + 1;

    console.log(
      `  • ${filename}\n      roles=[${roles.join(', ')}] dept=${department || '-'} size=${body.length}ch`
    );

    if (COMMIT) {
      await sql`
        INSERT INTO "Sop" ("id", "title", "roles", "department", "filePath", "fileType", "summary", "bodyExcerpt", "lastUpdatedAt")
        VALUES (${id}, ${title}, ${roles}, ${department}, ${rel}, ${fileType}, ${summary}, ${bodyExcerpt}, ${lastUpdatedAt})
        ON CONFLICT ("id") DO UPDATE SET
          "title" = EXCLUDED."title",
          "roles" = EXCLUDED."roles",
          "department" = EXCLUDED."department",
          "filePath" = EXCLUDED."filePath",
          "fileType" = EXCLUDED."fileType",
          "summary" = EXCLUDED."summary",
          "bodyExcerpt" = EXCLUDED."bodyExcerpt",
          "lastUpdatedAt" = EXCLUDED."lastUpdatedAt"
      `;
      inserted++;
    }
  }

  bar('Report');
  console.log(`  Files parsed:  ${parsed}`);
  console.log(`  Inserted/upd:  ${inserted}`);
  console.log(`  Skipped:       ${skipped}`);
  console.log(`  By role:`);
  const roleEntries = Object.entries(roleCounts).sort((a, b) => b[1] - a[1]);
  for (const [r, n] of roleEntries) {
    console.log(`    ${r.padEnd(18)} ${n}`);
  }
  if (!COMMIT) console.log(`\n  (dry-run — rerun with --commit to write)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
