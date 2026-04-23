/**
 * scripts/etl-floorplans.ts
 *
 * Populate CommunityFloorPlan across the 4 target builders:
 *   - Brookfield     (folder: Brookfield/)             -> already populated by etl-brookfield.ts; re-enrich sqFt/stories/blueprintUrl where empty
 *   - Bloomfield Homes (folder: Bloomfield Homes/Plans/) -> backfill planNumber + blueprintUrl + sqFt for existing rows, add missing
 *   - Shaddock Homes  (folder: Downlods/Downloads/SHADDOCK PLAN 5410.pdf) -> create community + 1 plan
 *   - Toll Brothers   (folder: Toll Brothers/)         -> extract CHAMBORD / VIANDEN from xlsx, attach to Creek Meadows
 *
 * Matches Community by fuzzy name against Builder.
 * Idempotent via @@unique([communityId, name]) on CommunityFloorPlan.
 *
 * Flags:
 *   (default)  dry-run  — print diff + counts, no writes
 *   --apply              actually write
 *   --only brookfield|bloomfield|shaddock|toll   run one stage only
 *
 * Usage:
 *   npx tsx scripts/etl-floorplans.ts                    (dry-run all)
 *   npx tsx scripts/etl-floorplans.ts --apply
 *   npx tsx scripts/etl-floorplans.ts --only bloomfield --apply
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as XLSX from 'xlsx';

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--apply');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? argv[i + 1] : null;
})();

const prisma = new PrismaClient();
const ABEL_ROOT = path.resolve(__dirname, '..', '..');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function bar(title: string) {
  console.log('\n' + '='.repeat(70));
  console.log('  ' + title);
  console.log('='.repeat(70));
}

function normName(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, ' ');
}

async function findBuilder(opts: { contains?: string[]; exact?: string }): Promise<{ id: string; companyName: string } | null> {
  if (opts.exact) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName" FROM "Builder" WHERE "companyName" = $1 LIMIT 1`, opts.exact,
    );
    if (rows.length) return rows[0];
  }
  if (opts.contains && opts.contains.length) {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "companyName" FROM "Builder"
        WHERE ${opts.contains.map((_, i) => `LOWER("companyName") LIKE $${i + 1}`).join(' OR ')}
        ORDER BY LENGTH("companyName") ASC, "createdAt" ASC LIMIT 1`,
      ...opts.contains.map(c => `%${c.toLowerCase()}%`),
    );
    if (rows.length) return rows[0];
  }
  return null;
}

async function findOrCreateCommunity(
  builderId: string,
  communityName: string,
  city?: string,
): Promise<{ id: string; name: string; created: boolean }> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM "Community"
      WHERE "builderId" = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    builderId, communityName,
  );
  if (rows.length) return { id: rows[0].id, name: rows[0].name, created: false };
  if (DRY_RUN) return { id: '(would-create)', name: communityName, created: true };
  const ins: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO "Community" ("id","builderId","name","city","status","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, 'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     RETURNING id, name`,
    builderId, communityName, city ?? null,
  );
  return { id: ins[0].id, name: ins[0].name, created: true };
}

// CommunityFloorPlan upsert
type FpRow = {
  communityId: string;
  name: string;
  planNumber?: string | null;
  sqFootage?: number | null;
  stories?: number | null;
  blueprintUrl?: string | null;
};

async function upsertFloorPlan(r: FpRow): Promise<'created' | 'updated' | 'unchanged'> {
  if (r.communityId === '(would-create)') return 'created';
  // Read existing
  const ex: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "planNumber", "sqFootage", stories, "blueprintUrl"
       FROM "CommunityFloorPlan"
      WHERE "communityId" = $1 AND name = $2 LIMIT 1`,
    r.communityId, r.name,
  );
  if (!ex.length) {
    if (DRY_RUN) return 'created';
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CommunityFloorPlan"
        ("id","communityId","name","planNumber","sqFootage","stories","blueprintUrl","active","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      r.communityId, r.name, r.planNumber ?? null, r.sqFootage ?? null, r.stories ?? null, r.blueprintUrl ?? null,
    );
    return 'created';
  }
  // Only fill fields that are empty or changed
  const cur = ex[0];
  const updates: string[] = [];
  const vals: any[] = [];
  const push = (col: string, newVal: any, curVal: any) => {
    // Only overwrite null/empty current values, or if new is non-null and different
    if (newVal == null || newVal === '') return;
    if (curVal == null || String(curVal).trim() === '') {
      updates.push(`"${col}" = $${updates.length + 1}`); vals.push(newVal);
      return;
    }
    // For blueprintUrl prefer to update if changed to a non-null file that exists
    if (col === 'blueprintUrl' && newVal !== curVal) {
      updates.push(`"${col}" = $${updates.length + 1}`); vals.push(newVal);
      return;
    }
  };
  push('planNumber', r.planNumber, cur.planNumber);
  push('sqFootage', r.sqFootage, cur.sqFootage);
  push('stories', r.stories, cur.stories);
  push('blueprintUrl', r.blueprintUrl, cur.blueprintUrl);
  if (!updates.length) return 'unchanged';
  if (DRY_RUN) return 'updated';
  vals.push(cur.id);
  await prisma.$executeRawUnsafe(
    `UPDATE "CommunityFloorPlan" SET ${updates.join(', ')}, "updatedAt" = CURRENT_TIMESTAMP
      WHERE id = $${vals.length}`,
    ...vals,
  );
  return 'updated';
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: BROOKFIELD — ensure sqFt already present (nothing new to do usually)
// ─────────────────────────────────────────────────────────────────────────────

async function stageBrookfield() {
  bar('STAGE 1: BROOKFIELD — Plan Breakdown Rev4 (enrich sqFt)');
  const BROOKFIELD_DIR = path.join(ABEL_ROOT, 'Brookfield');
  const fp = path.join(BROOKFIELD_DIR, 'Brookfield_Plan_Breakdown_Rev4_April_2026.xlsx');
  if (!fs.existsSync(fp)) { console.log('  FILE MISSING:', fp); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }

  // Builder: "BROOKFIELD" (upper) is the canonical one with existing data
  const builder = await findBuilder({ exact: 'BROOKFIELD' })
    ?? await findBuilder({ contains: ['brookfield'] });
  if (!builder) { console.log('  builder not found'); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }
  console.log(`  Builder: ${builder.companyName}  id=${builder.id}`);

  // Community: "The Grove"
  const comm = await findOrCreateCommunity(builder.id, 'The Grove');
  console.log(`  Community: ${comm.name}  id=${comm.id}${comm.created ? '  (CREATED)' : ''}`);

  // Parse plan tabs -> sqFt from header, planNumber = sheet name
  const wb = XLSX.readFile(fp, { cellDates: true });
  const planSheets = wb.SheetNames.filter(sn => /^\d/.test(sn));
  const plans: { planNumber: string; sqFt: number | null }[] = [];
  for (const sn of planSheets) {
    const ws = wb.Sheets[sn];
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as any[][];
    const subtitle = (m[1] && m[1][0]) ? String(m[1][0]) : '';
    const match = subtitle.match(/([\d,]+)\s*Sq\s*Ft/i);
    const sqFt = match ? parseInt(match[1].replace(/,/g, ''), 10) : null;
    plans.push({ planNumber: sn, sqFt });
  }
  console.log(`  Parsed ${plans.length} plan tabs from Rev4`);

  let created = 0, updated = 0, unchanged = 0;
  for (const p of plans) {
    const res = await upsertFloorPlan({
      communityId: comm.id,
      name: `Plan ${p.planNumber}`,
      planNumber: p.planNumber,
      sqFootage: p.sqFt,
    });
    if (res === 'created') created++;
    else if (res === 'updated') updated++;
    else unchanged++;
  }
  console.log(`  CREATE: ${created}   UPDATE: ${updated}   UNCHANGED: ${unchanged}   (total ${plans.length})`);
  return { created, updated, unchanged, scanned: plans.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: BLOOMFIELD — scan Plans/ for PDF sets
// ─────────────────────────────────────────────────────────────────────────────

interface BloomfieldPlan {
  folder: string;             // "BELLFLOWER"
  name: string;               // "Bellflower"
  planNumber: string | null;  // "3540R" or "3504R"
  blueprintUrl: string | null; // absolute path to first PDF set
  stories: number | null;     // inferred from folder contents (1 or 2)
  variants: string[];         // all PDFs found
}

function parseBloomfieldPlanFolder(folder: string): BloomfieldPlan {
  const folderName = path.basename(folder);
  const display = folderName.replace(/_/g, ' ')
    .toLowerCase()
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
  // Scan files
  const files = fs.readdirSync(folder, { withFileTypes: true })
    .filter(d => d.isFile() && /\.pdf$/i.test(d.name))
    .map(d => d.name)
    .sort();
  // Try to extract planNumber from first file: "3540R - Bellflower I (set)5.23.23.pdf"
  let planNumber: string | null = null;
  let storiesHint: number | null = null;
  for (const f of files) {
    const m = f.match(/^([A-Z0-9]+R?)\s*-/i);
    if (m && !planNumber) planNumber = m[1].toUpperCase();
    // Hint for stories: filename contains "two story" / "single story" / "1 story" / "2-story"
    if (/two\s*story|2[-\s]story/i.test(f)) storiesHint = 2;
    else if (/single\s*story|1[-\s]story|one\s*story/i.test(f)) storiesHint = storiesHint ?? 1;
  }
  const blueprintUrl = files.length ? path.join(folder, files[0]) : null;
  return {
    folder: folderName,
    name: display,
    planNumber,
    blueprintUrl,
    stories: storiesHint,
    variants: files,
  };
}

async function stageBloomfield() {
  bar('STAGE 2: BLOOMFIELD — scan Plans/ folder for PDF sets');
  const BLOOM_DIR = path.join(ABEL_ROOT, 'Bloomfield Homes', 'Plans');
  if (!fs.existsSync(BLOOM_DIR)) { console.log('  DIR MISSING:', BLOOM_DIR); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }

  const builder = await findBuilder({ contains: ['bloomfield'] });
  if (!builder) { console.log('  builder not found'); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }
  console.log(`  Builder: ${builder.companyName}  id=${builder.id}`);

  // Community
  const comm = await findOrCreateCommunity(builder.id, 'Bloomfield Homes DFW');
  console.log(`  Community: ${comm.name}  id=${comm.id}${comm.created ? '  (CREATED)' : ''}`);

  // Enumerate plan folders (skip "Nate Plans" which is duplicate content)
  const planFolders = fs.readdirSync(BLOOM_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== 'Nate Plans')
    .map(d => path.join(BLOOM_DIR, d.name));

  const parsed: BloomfieldPlan[] = planFolders.map(parseBloomfieldPlanFolder)
    .filter(p => p.variants.length > 0);
  console.log(`  Parsed ${parsed.length} plan folders with PDF content (of ${planFolders.length} total)`);

  // Existing plans — to handle alt spellings like "Gardinia" vs "Gardenia"
  const existing: any[] = comm.id === '(would-create)' ? [] : await prisma.$queryRawUnsafe(
    `SELECT id, name, "planNumber", "sqFootage", stories, "blueprintUrl"
       FROM "CommunityFloorPlan" WHERE "communityId" = $1`,
    comm.id,
  );
  const existingByNorm = new Map<string, any>();
  for (const e of existing) existingByNorm.set(normName(e.name), e);
  console.log(`  Existing floor plans on community: ${existing.length}`);

  let created = 0, updated = 0, unchanged = 0;
  const folderAliases: Record<string, string> = {
    'gardenia': 'Gardinia', // DB has "Gardinia" typo
  };

  for (const p of parsed) {
    // Prefer existing row's name to avoid duplicate
    const alias = folderAliases[normName(p.name)];
    const nameKey = alias ? normName(alias) : normName(p.name);
    const existingRow = existingByNorm.get(nameKey);
    const rowName = existingRow ? existingRow.name : p.name;
    const res = await upsertFloorPlan({
      communityId: comm.id,
      name: rowName,
      planNumber: p.planNumber,
      stories: p.stories,
      blueprintUrl: p.blueprintUrl,
    });
    if (res === 'created') created++;
    else if (res === 'updated') updated++;
    else unchanged++;
    if (res !== 'unchanged') {
      console.log(`    ${res.padEnd(9)} ${rowName.padEnd(20)} pn=${p.planNumber ?? '-'} stories=${p.stories ?? '-'} url=${p.blueprintUrl ? 'Y' : 'N'}`);
    }
  }
  console.log(`  CREATE: ${created}   UPDATE: ${updated}   UNCHANGED: ${unchanged}   (scanned ${parsed.length})`);
  return { created, updated, unchanged, scanned: parsed.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: SHADDOCK — single plan 5410 from Downloads
// ─────────────────────────────────────────────────────────────────────────────

async function stageShaddock() {
  bar('STAGE 3: SHADDOCK HOMES — 1 plan from Downloads');
  const pdfPath = path.join(ABEL_ROOT, 'Downlods', 'Downloads', 'SHADDOCK PLAN 5410.pdf');
  if (!fs.existsSync(pdfPath)) { console.log('  FILE MISSING:', pdfPath); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }

  const builder = await findBuilder({ contains: ['shaddock'] });
  if (!builder) { console.log('  builder not found'); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }
  console.log(`  Builder: ${builder.companyName}  id=${builder.id}`);

  // Shaddock has no communities yet. Create "Shaddock DFW" as umbrella.
  const comm = await findOrCreateCommunity(builder.id, 'Shaddock DFW');
  console.log(`  Community: ${comm.name}  id=${comm.id}${comm.created ? '  (CREATED)' : ''}`);

  const res = await upsertFloorPlan({
    communityId: comm.id,
    name: 'Plan 5410',
    planNumber: '5410',
    blueprintUrl: pdfPath,
  });
  const created = res === 'created' ? 1 : 0;
  const updated = res === 'updated' ? 1 : 0;
  const unchanged = res === 'unchanged' ? 1 : 0;
  console.log(`  ${res.toUpperCase()}   Plan 5410   url=${pdfPath}`);
  return { created, updated, unchanged, scanned: 1 };
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE: TOLL BROTHERS — CHAMBORD + VIANDEN from 1.5.26 PRICING CHANGE WORKSHEET
// ─────────────────────────────────────────────────────────────────────────────

async function stageToll() {
  bar('STAGE 4: TOLL BROTHERS — CHAMBORD + VIANDEN');
  const fp = path.join(ABEL_ROOT, 'Toll Brothers', '1.5.26 PRICING CHANGE WORKSHEET.xlsx');
  if (!fs.existsSync(fp)) { console.log('  FILE MISSING:', fp); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }

  // Pick the "Toll Brothers" builder that has existing communities
  const b: any[] = await prisma.$queryRawUnsafe(
    `SELECT b.id, b."companyName",
       (SELECT COUNT(*) FROM "Community" c WHERE c."builderId" = b.id) AS comm_count
     FROM "Builder" b
     WHERE LOWER(b."companyName") LIKE '%toll%'
     ORDER BY comm_count DESC, b."createdAt" ASC LIMIT 1`,
  );
  if (!b.length) { console.log('  builder not found'); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }
  const builder = b[0];
  console.log(`  Builder: ${builder.companyName}  id=${builder.id}  communities=${builder.comm_count}`);

  // Attach plans to the first/primary community (Creek Meadows) since the xlsx doesn't specify community
  const comms: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM "Community" WHERE "builderId" = $1 ORDER BY name LIMIT 10`, builder.id,
  );
  if (!comms.length) { console.log('  no community for builder'); return { created: 0, updated: 0, unchanged: 0, scanned: 0 }; }
  const primary = comms.find(c => /creek/i.test(c.name)) ?? comms[0];
  console.log(`  Community: ${primary.name}  id=${primary.id}`);

  // Plans: just the sheet names that represent plans (exclude PIVOT)
  const wb = XLSX.readFile(fp, { cellDates: true });
  const planSheets = wb.SheetNames.filter(sn => sn !== 'PIVOT');
  console.log(`  Parsed plan sheets: ${planSheets.join(', ')}`);

  let created = 0, updated = 0, unchanged = 0;
  for (const planKey of planSheets) {
    const display = planKey.charAt(0) + planKey.slice(1).toLowerCase(); // "Chambord"
    const res = await upsertFloorPlan({
      communityId: primary.id,
      name: display,
      planNumber: null, // no plan number in source data
      blueprintUrl: fp,
    });
    if (res === 'created') created++;
    else if (res === 'updated') updated++;
    else unchanged++;
    console.log(`    ${res.padEnd(9)} ${display}`);
  }
  console.log(`  CREATE: ${created}   UPDATE: ${updated}   UNCHANGED: ${unchanged}   (scanned ${planSheets.length})`);
  return { created, updated, unchanged, scanned: planSheets.length };
}

// ─────────────────────────────────────────────────────────────────────────────
// COVERAGE REPORT
// ─────────────────────────────────────────────────────────────────────────────

async function coverageReport() {
  bar('COVERAGE REPORT — CommunityFloorPlan per builder/community');
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT b."companyName", c.name AS community, c.id AS community_id,
       COUNT(fp.id) AS plans,
       COUNT(fp.id) FILTER (WHERE fp."planNumber" IS NOT NULL) AS with_plan_number,
       COUNT(fp.id) FILTER (WHERE fp."sqFootage" IS NOT NULL) AS with_sqft,
       COUNT(fp.id) FILTER (WHERE fp."blueprintUrl" IS NOT NULL) AS with_blueprint,
       COUNT(fp.id) FILTER (WHERE fp.stories IS NOT NULL) AS with_stories
     FROM "Builder" b
     JOIN "Community" c ON c."builderId" = b.id
     LEFT JOIN "CommunityFloorPlan" fp ON fp."communityId" = c.id
     WHERE LOWER(b."companyName") LIKE ANY(ARRAY['%brookfield%','%bloomfield%','%shaddock%','%toll%'])
     GROUP BY b."companyName", c.name, c.id
     ORDER BY b."companyName", c.name`,
  );
  console.log(`  ${'Builder'.padEnd(22)} | ${'Community'.padEnd(22)} | plans | pn  | sqft| url | stories`);
  console.log(`  ${'-'.repeat(22)} | ${'-'.repeat(22)} | ----- | --- | ----| --- | -------`);
  for (const r of rows) {
    console.log(
      `  ${String(r.companyName).padEnd(22)} | ${String(r.community).padEnd(22)} |` +
      ` ${String(r.plans).padStart(5)} |` +
      ` ${String(r.with_plan_number).padStart(3)} |` +
      ` ${String(r.with_sqft).padStart(4)}|` +
      ` ${String(r.with_blueprint).padStart(3)} |` +
      ` ${String(r.with_stories).padStart(7)}`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(DRY_RUN ? '\n[DRY-RUN MODE]  (use --apply to write)' : '\n[APPLY MODE]');

  const results: Record<string, any> = {};
  if (!ONLY || ONLY === 'brookfield') results.brookfield = await stageBrookfield();
  if (!ONLY || ONLY === 'bloomfield') results.bloomfield = await stageBloomfield();
  if (!ONLY || ONLY === 'shaddock')   results.shaddock   = await stageShaddock();
  if (!ONLY || ONLY === 'toll')       results.toll       = await stageToll();

  bar('TOTALS');
  let totalCreated = 0, totalUpdated = 0, totalUnchanged = 0, totalScanned = 0;
  for (const [k, v] of Object.entries(results)) {
    const s = v as { created: number; updated: number; unchanged: number; scanned: number };
    console.log(`  ${k.padEnd(12)}  scanned=${s.scanned}  created=${s.created}  updated=${s.updated}  unchanged=${s.unchanged}`);
    totalCreated += s.created; totalUpdated += s.updated; totalUnchanged += s.unchanged; totalScanned += s.scanned;
  }
  console.log(`  ${'TOTAL'.padEnd(12)}  scanned=${totalScanned}  created=${totalCreated}  updated=${totalUpdated}  unchanged=${totalUnchanged}`);

  await coverageReport();

  if (DRY_RUN) {
    console.log('\n[dry-run] no writes performed. Re-run with --apply to commit.');
  }
}

main()
  .catch((e) => { console.error('FATAL:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
