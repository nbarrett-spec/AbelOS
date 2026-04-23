/**
 * scripts/etl-brookfield-folder.ts
 *
 * Second-pass Brookfield ETL — the FOLDER (everything A13's etl-brookfield.ts
 * did not already load from commit ed0380a).
 *
 * Decisions vs. A13:
 *   - A13 loaded Pricing Schedule Rev2, Plan Breakdown Rev2, and VE Proposal.
 *   - This script picks up the REV4 Plan Breakdown (dated 4/20, sent to Amanda
 *     Barham) which *supersedes* Rev2 base-package totals. UPDATE only; never
 *     create. sqFt stays as-is (Rev4 has no sqFt; Rev2's is still correct).
 *   - Account Audit, Chapter 2 Analysis, and Trade Partner Directory are
 *     strategy / reference docs → InboxItem summaries with sourceTag.
 *   - Rev3 Plan Breakdown is an intermediate draft superseded by Rev4 → skip.
 *   - "Abel Door and Trim Bids - Turnkey Pricing - Brookfield - 2024.xlsx"
 *     is a 2024 legacy baseline; plan sheets are empty and the lookup tabs
 *     (Western Slider / Barn Doors / Mantels) conflict with Rev2 pricing A13
 *     already authoritatively loaded. Skip, defer to future pipeline.
 *   - DOCX (Pricing Response) + PPTX (Chapter 2 Proposal) = deferred, logged
 *     but not parsed (no parser in deps, no tsx-safe option).
 *
 * Flags:
 *   (default)   dry-run
 *   --commit    actually write
 *   --only plans|audit|chapter2|directory
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'node:path';
import * as fs from 'node:fs';

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--commit');
const ONLY = (() => { const i = argv.indexOf('--only'); return i >= 0 ? argv[i + 1] : null; })();

const prisma = new PrismaClient();

const ABEL_ROOT = path.resolve(__dirname, '..', '..');
const BF_DIR = path.join(ABEL_ROOT, 'Brookfield');

const FILES = {
  plansRev4: path.join(BF_DIR, 'Brookfield_Plan_Breakdown_Rev4_April_2026.xlsx'),
  audit:    path.join(BF_DIR, 'Brookfield_Account_Audit_April_2026.xlsx'),
  chapter2: path.join(BF_DIR, 'Chapter 2', 'Chapter_2_Analysis_Workbook.xlsx'),
  directory: path.join(BF_DIR, 'Brookfield_Trade_Partner_Directory.xlsx'),
};

const DEFERRED_FILES = [
  'Brookfield_Plan_Breakdown_Rev3_April_2026.xlsx',       // superseded by Rev4
  'Brookfield_Pricing_Response_April_2026.docx',          // Word, no parser
  'Abel Door and Trim Bids - Turnkey Pricing - Brookfield - 2024.xlsx', // 2024 legacy, plan tabs empty
  'Chapter 2/Chapter_2_Brookfield_Proposal.pptx',         // PPTX
  'Chapter 2/Chapter_2_One_Pager.docx',                   // DOCX
];

function bar(t: string) { console.log('\n' + '='.repeat(60) + '\n  ' + t + '\n' + '='.repeat(60)); }
function money(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}
function readSheet(fp: string, name: string): any[][] {
  const wb = XLSX.readFile(fp, { cellDates: true });
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`Sheet missing: ${name} in ${path.basename(fp)}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as any[][];
}

async function findBrookfield(): Promise<{ id: string; companyName: string }> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "companyName" FROM "Builder" WHERE "companyName"='BROOKFIELD' LIMIT 1`);
  if (!rows.length) throw new Error('BROOKFIELD builder not found');
  return rows[0];
}
async function findTheGrove(builderId: string): Promise<{ id: string; name: string }> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM "Community" WHERE "builderId"=$1 AND name='The Grove' LIMIT 1`, builderId);
  if (!rows.length) throw new Error('The Grove community not found');
  return rows[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 1: Plan Breakdown Rev4  →  CommunityFloorPlan.basePackagePrice
// ─────────────────────────────────────────────────────────────────────────────
interface PlanRev4 { plan: string; baseTotal: number | null }
function parsePlansRev4(fp: string): PlanRev4[] {
  // Summary r03 header:
  //   Plan | Exterior Doors | Int Doors & Trim Material | Trim Labor 1 | Trim Labor 2 | Final Front | Base Total
  const m = readSheet(fp, 'Summary');
  const out: PlanRev4[] = [];
  for (let i = 4; i < m.length; i++) {
    const row = m[i] || [];
    const plan = (row[0] ?? '').toString().trim();
    if (!plan || plan.toUpperCase() === 'AVERAGE' || plan.toUpperCase().startsWith('TOTAL')) continue;
    if (!/^\d{4}$/.test(plan)) continue;
    const baseTotal = money(row[6]);
    if (baseTotal == null) continue;
    out.push({ plan, baseTotal });
  }
  return out;
}

async function stagePlansRev4() {
  bar('STAGE 1: Plan Breakdown Rev4  →  CommunityFloorPlan (UPDATE only)');
  if (!fs.existsSync(FILES.plansRev4)) { console.log('  FILE MISSING'); return; }
  const builder = await findBrookfield();
  const grove = await findTheGrove(builder.id);
  console.log(`  Builder=${builder.companyName}  Community=${grove.name}`);

  const rev4 = parsePlansRev4(FILES.plansRev4);
  console.log(`  Parsed Rev4 plans: ${rev4.length}`);

  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "planNumber", "basePackagePrice" FROM "CommunityFloorPlan" WHERE "communityId"=$1`, grove.id);
  const byPlan = new Map<string, any>();
  for (const e of existing) byPlan.set(String(e.planNumber).trim(), e);

  let toUpdate = 0, unchanged = 0, missing = 0;
  const diffs: string[] = [];
  for (const r of rev4) {
    const ex = byPlan.get(r.plan);
    if (!ex) { missing++; continue; }
    const prev = Number(ex.basePackagePrice ?? 0);
    const delta = Math.round((r.baseTotal! - prev) * 100) / 100;
    if (Math.abs(delta) < 0.005) { unchanged++; continue; }
    toUpdate++;
    diffs.push(`    Plan ${r.plan}:  $${prev.toFixed(2)}  ->  $${r.baseTotal!.toFixed(2)}   Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`);
  }
  console.log(`  UPDATE: ${toUpdate}   UNCHANGED: ${unchanged}   MISSING (would-be-create; SKIPPED): ${missing}`);
  if (diffs.length) { console.log('  Rev4 diff vs Rev2-loaded:'); diffs.forEach(d => console.log(d)); }

  if (DRY_RUN) { console.log('\n  [dry-run] no writes'); return; }
  let wrote = 0;
  for (const r of rev4) {
    const ex = byPlan.get(r.plan);
    if (!ex) continue; // UPDATE-only
    const prev = Number(ex.basePackagePrice ?? 0);
    if (Math.abs(r.baseTotal! - prev) < 0.005) continue;
    await prisma.$executeRawUnsafe(
      `UPDATE "CommunityFloorPlan" SET "basePackagePrice"=$1, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$2`,
      r.baseTotal, ex.id);
    wrote++;
  }
  console.log(`  wrote ${wrote} CommunityFloorPlan updates (Rev4 base totals)`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: InboxItem upsert by sourceTag
// ─────────────────────────────────────────────────────────────────────────────
async function upsertInboxItem(args: { tag: string; title: string; description: string; actionData: any; priority?: string; type?: string; source?: string }) {
  const { tag, title, description, actionData } = args;
  const priority = args.priority || 'MEDIUM';
  const type = args.type || 'DEAL_FOLLOWUP';
  const source = args.source || 'sales-brookfield';

  const dupes: any[] = await prisma.$queryRawUnsafe(
    `SELECT id FROM "InboxItem" WHERE "actionData"->>'sourceTag' = $1 LIMIT 1`, tag);
  console.log(`  InboxItem sourceTag=${tag}   existing=${dupes.length}`);
  console.log(`  Title: ${title}`);
  console.log(`  Description:`);
  console.log(description.split('\n').map(l => '    ' + l).join('\n'));

  if (DRY_RUN) { console.log('  [dry-run] no writes'); return; }

  const payload = JSON.stringify({ sourceTag: tag, ...actionData });
  if (dupes.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem" SET title=$1, description=$2, "actionData"=$3::jsonb, "updatedAt"=CURRENT_TIMESTAMP WHERE id=$4`,
      title, description, payload, dupes[0].id);
    console.log(`  updated InboxItem id=${dupes[0].id}`);
  } else {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "InboxItem" ("id","type","source","title","description","priority","status","actionData","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,'PENDING',$6::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP) RETURNING id`,
      type, source, title, description, priority, payload);
    console.log(`  created InboxItem id=${rows[0].id}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 2: Brookfield Account Audit  →  InboxItem
// ─────────────────────────────────────────────────────────────────────────────
async function stageAccountAudit() {
  bar('STAGE 2: Brookfield Account Audit  →  InboxItem');
  if (!fs.existsSync(FILES.audit)) { console.log('  FILE MISSING'); return; }

  const cat = readSheet(FILES.audit, 'Category Margins');
  // header r02; data r03..
  const catLines: string[] = [];
  for (let i = 3; i < cat.length; i++) {
    const r = cat[i] || [];
    const name = (r[0] ?? '').toString().trim();
    if (!name) continue;
    const rev = money(r[1]), gm = money(r[3]), gmPct = money(r[4]), target = money(r[5]), gap = money(r[6]);
    if (gmPct == null) continue;
    catLines.push(`    ${name.padEnd(18)}  rev $${(rev ?? 0).toFixed(0)}  GM $${(gm ?? 0).toFixed(0)} (${((gmPct || 0) * 100).toFixed(1)}%)  target ${((target || 0) * 100).toFixed(0)}%  gap $${(gap ?? 0).toFixed(0)}`);
  }

  const vend = readSheet(FILES.audit, 'Vendor Cost Basis');
  const vendLines: string[] = [];
  for (let i = 3; i < vend.length; i++) {
    const r = vend[i] || [];
    const v = (r[0] ?? '').toString().trim();
    const cost = money(r[1]);
    const pos = r[2];
    if (!v || cost == null || pos == null) continue; // skip trailing footnote rows
    vendLines.push(`    ${v.padEnd(26)}  $${cost.toFixed(2)}  (${pos} POs)`);
  }

  // Executive Summary "account overview" — scan for simple key/value pairs
  const exec = readSheet(FILES.audit, 'Executive Summary');
  const overviewPairs: string[] = [];
  for (let i = 5; i < Math.min(exec.length, 20); i++) {
    const r = exec[i] || [];
    for (const [lbl, val] of [[r[0], r[1]], [r[3], r[4]], [r[6], r[7]]]) {
      if (lbl && val != null && val !== '' && String(lbl).toLowerCase() !== 'metric') {
        overviewPairs.push(`    ${String(lbl)}: ${String(val)}`);
      }
    }
  }

  const description = [
    'INTERNAL account audit of Brookfield, prepared April 8 2026.',
    '',
    'Account overview:',
    ...overviewPairs.slice(0, 12),
    '',
    'Margin by category:',
    ...catLines,
    '',
    'Vendor cost basis on Brookfield jobs:',
    ...vendLines,
    '',
    'Source: Brookfield/Brookfield_Account_Audit_April_2026.xlsx',
    'Sheets: Executive Summary, Category Margins, Product Pricing Detail, Takeoff Pricing by Plan, Negotiation Strategy, Vendor Cost Basis.',
  ].join('\n');

  await upsertInboxItem({
    tag: 'BROOKFIELD_ACCOUNT_AUDIT_APR2026',
    title: 'Brookfield Account Audit — April 2026 (INTERNAL)',
    description,
    actionData: { confidential: true, sheetCount: 6 },
    priority: 'HIGH',
    type: 'DEAL_FOLLOWUP',
    source: 'sales-brookfield',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 3: Chapter 2 Analysis Workbook  →  InboxItem
// ─────────────────────────────────────────────────────────────────────────────
async function stageChapter2() {
  bar('STAGE 3: Chapter 2 Analysis  →  InboxItem');
  if (!fs.existsSync(FILES.chapter2)) { console.log('  FILE MISSING'); return; }

  // Upgrade Menu sheet: #, Upgrade Option, Retail Price, Typical Attach, BF GP/Yr, What the buyer sees
  const um = readSheet(FILES.chapter2, 'Upgrade Menu');
  const umLines: string[] = [];
  for (let i = 4; i < um.length; i++) {
    const r = um[i] || [];
    const code = (r[0] ?? '').toString().trim();
    const label = (r[1] ?? '').toString().trim();
    if (!code || !label) continue;
    const retail = money(r[2]); const attach = money(r[3]); const gpYr = money(r[4]);
    umLines.push(`    ${code}  ${label}  — retail $${(retail ?? 0).toFixed(2)}  attach ${((attach || 0) * 100).toFixed(0)}%  BF GP/yr $${(gpYr ?? 0).toFixed(0)}`);
  }

  // BF Pitch Numbers — what Amanda sees
  const pn = readSheet(FILES.chapter2, 'BF Pitch Numbers');
  const pnLines: string[] = [];
  for (let i = 4; i < pn.length; i++) {
    const r = pn[i] || [];
    const code = (r[0] ?? '').toString().trim();
    const lever = (r[1] ?? '').toString().trim();
    if (!code || !lever) continue;
    if (code === '#' || /^lever$/i.test(lever)) continue; // skip in-sheet sub-headers
    const per = money(r[2]); const yr = money(r[3]);
    if (per == null) continue;
    pnLines.push(`    ${code}  ${lever}  — $${per.toFixed(2)}/home${yr != null ? `  annual $${yr.toFixed(0)}` : ''}`);
  }

  const description = [
    'Chapter 2 — Brookfield three-lever margin strategy (internal analysis).',
    '',
    'Buyer-facing upgrade menu:',
    ...umLines,
    '',
    'Direct-savings pitch numbers (what Amanda sees):',
    ...pnLines,
    '',
    'Source: Brookfield/Chapter 2/Chapter_2_Analysis_Workbook.xlsx',
    'Sheets: Executive Summary, Lever Detail, BF Pitch Numbers, Implementation, Upgrade Menu.',
    'Related (deferred): Chapter_2_Brookfield_Proposal.pptx, Chapter_2_One_Pager.docx.',
  ].join('\n');

  await upsertInboxItem({
    tag: 'BROOKFIELD_CHAPTER2_APR2026',
    title: 'Brookfield — Chapter 2 Analysis (margin levers, April 2026)',
    description,
    actionData: { confidential: true, leverBuckets: ['Buyer Upgrade Menu', 'Direct Savings', 'Vendor Strategy'] },
    priority: 'HIGH',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// STAGE 4: Trade Partner Directory  →  InboxItem (stats only — no bulk contact load)
// ─────────────────────────────────────────────────────────────────────────────
async function stageDirectory() {
  bar('STAGE 4: Trade Partner Directory  →  InboxItem (stats only)');
  if (!fs.existsSync(FILES.directory)) { console.log('  FILE MISSING'); return; }

  const contacts = readSheet(FILES.directory, 'Contacts');
  const companies = readSheet(FILES.directory, 'Companies');
  const contactRows = contacts.length - 1; // minus header
  const companyRows = companies.length - 1;

  // Pull just the Brookfield internal contacts
  const bfContacts: string[] = [];
  for (let i = 1; i < contacts.length; i++) {
    const r = contacts[i] || [];
    const name = (r[0] ?? '').toString().trim();
    const email = (r[1] ?? '').toString().trim();
    const company = (r[2] ?? '').toString().trim();
    const domain = (r[3] ?? '').toString().trim();
    const role = (r[4] ?? '').toString().trim();
    if (!name) continue;
    if (/brookfield/i.test(company) || /brookfieldrp\.com/i.test(domain)) {
      bfContacts.push(`    ${name} <${email}>  [${role}]`);
    }
  }

  const description = [
    'Brookfield Trade Partner Directory — full extract of every counterparty email seen on BF jobs.',
    '',
    `Totals:  ${contactRows} contacts across ${companyRows} companies.`,
    '',
    `Brookfield-internal contacts (${bfContacts.length}):`,
    ...bfContacts,
    '',
    'NOTE: full contact list is multi-builder and not scoped to BROOKFIELD only — not auto-loaded into Contact table. Use source file for lookup.',
    'Source: Brookfield/Brookfield_Trade_Partner_Directory.xlsx',
  ].join('\n');

  await upsertInboxItem({
    tag: 'BROOKFIELD_TRADE_DIRECTORY',
    title: 'Brookfield Trade Partner Directory — contacts index',
    description,
    actionData: { totalContacts: contactRows, totalCompanies: companyRows, bfInternalContacts: bfContacts.length },
    priority: 'LOW',
    type: 'DEAL_FOLLOWUP',
    source: 'sales-brookfield',
  });
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(DRY_RUN ? '\n[DRY-RUN MODE]  (use --commit to write)' : '\n[COMMIT MODE]');
  console.log(`Source dir: ${BF_DIR}`);

  bar('DEFERRED FILES (listed, not parsed)');
  for (const f of DEFERRED_FILES) console.log('  -', f);

  if (!ONLY || ONLY === 'plans')     await stagePlansRev4();
  if (!ONLY || ONLY === 'audit')     await stageAccountAudit();
  if (!ONLY || ONLY === 'chapter2')  await stageChapter2();
  if (!ONLY || ONLY === 'directory') await stageDirectory();

  bar('DONE');
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
