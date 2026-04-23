/**
 * scripts/etl-brookfield.ts
 *
 * Multi-file ETL for Brookfield Rev2 April 2026:
 *   1) Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx  → BuilderPricing
 *      (diff against existing then upsert — Rev2 is authoritative)
 *   2) Brookfield_Plan_Breakdown_Rev2_April_2026.xlsx    → CommunityFloorPlan
 *      (11 plans attached to existing Community "The Grove")
 *   3) Brookfield_Value_Engineering_Proposal_April_2026.xlsx → InboxItem
 *      (single summary item, source tag BROOKFIELD_VE_APR2026)
 *
 * Flags:
 *   (default)  dry-run — diff + counts, no writes
 *   --commit            actually write
 *   --only pricing|plans|ve   run one stage
 */

import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as XLSX from 'xlsx';
import * as path from 'node:path';
import * as fs from 'node:fs';

const argv = process.argv.slice(2);
const DRY_RUN = !argv.includes('--commit');
const ONLY = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? argv[i + 1] : null;
})();

const prisma = new PrismaClient();

const ABEL_ROOT = path.resolve(__dirname, '..', '..');
const BROOKFIELD_DIR = path.join(ABEL_ROOT, 'Brookfield');
const FILES = {
  pricing: path.join(BROOKFIELD_DIR, 'Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx'),
  plans:   path.join(BROOKFIELD_DIR, 'Brookfield_Plan_Breakdown_Rev2_April_2026.xlsx'),
  ve:      path.join(BROOKFIELD_DIR, 'Brookfield_Value_Engineering_Proposal_April_2026.xlsx'),
};

function bar(title: string) {
  console.log('\n' + '='.repeat(60));
  console.log('  ' + title);
  console.log('='.repeat(60));
}
function parseMoney(v: unknown): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = parseFloat(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function readSheetRaw(fp: string, sheet: string): any[][] {
  const wb = XLSX.readFile(fp, { cellDates: true });
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`Sheet not found: ${sheet}`);
  return XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as any[][];
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. PRICING SCHEDULE → BuilderPricing
// ─────────────────────────────────────────────────────────────────────────────

interface PriceRow { sku: string; product: string; category: string; unit: string; price: number }

function parsePricingSchedule(fp: string): PriceRow[] {
  const matrix = readSheetRaw(fp, 'Pricing Schedule');
  // Header on r03: [SKU, Product, Category, Unit, Price, Change, Direction]
  const out: PriceRow[] = [];
  let section: string | null = null;
  for (let i = 4; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const sku = (row[0] ?? '').toString().trim();
    const product = (row[1] ?? '').toString().trim();
    const category = (row[2] ?? '').toString().trim();
    const unit = (row[3] ?? '').toString().trim();
    const price = parseMoney(row[4]);
    // Section header: sku filled, no product/price
    if (sku && !product && price == null) { section = sku; continue; }
    if (!sku || !product || price == null) continue;
    // Skip footer rows like "14 items", "Correction..." (non-BC SKUs)
    if (!/^BC\d+/i.test(sku)) continue;
    out.push({
      sku: sku.toUpperCase(),
      product,
      category: category || section || '',
      unit: unit || 'ea',
      price,
    });
  }
  return out;
}

async function findBrookfieldBuilder(): Promise<{ id: string; companyName: string }> {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "companyName" FROM "Builder"
      WHERE "companyName" = 'BROOKFIELD'
         OR LOWER("companyName") LIKE 'brookfield residential%'
      ORDER BY (CASE WHEN "companyName" = 'BROOKFIELD' THEN 0 ELSE 1 END)
      LIMIT 1`,
  );
  if (!rows.length) throw new Error('Brookfield builder not found');
  return rows[0];
}

async function stagePricing() {
  bar('STAGE 1: PRICING SCHEDULE Rev2 → BuilderPricing');
  if (!fs.existsSync(FILES.pricing)) { console.log('  FILE MISSING, skipping'); return; }

  const builder = await findBrookfieldBuilder();
  console.log(`  Builder: ${builder.companyName}  id=${builder.id}`);

  const priced = parsePricingSchedule(FILES.pricing);
  console.log(`  Parsed rows: ${priced.length}`);

  // Existing BuilderPricing for Brookfield keyed by SKU
  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT bp."productId", p."sku", bp."customPrice"
       FROM "BuilderPricing" bp
       JOIN "Product" p ON p.id = bp."productId"
      WHERE bp."builderId" = $1`, builder.id,
  );
  const existingBySku = new Map<string, { productId: string; customPrice: number }>();
  for (const r of existing) existingBySku.set(r.sku.toUpperCase(), { productId: r.productId, customPrice: Number(r.customPrice) });
  console.log(`  Existing BuilderPricing rows for Brookfield: ${existing.length}`);

  // Product catalog lookup by SKU (one-shot)
  const skus = priced.map(p => p.sku);
  const prodRows: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, sku FROM "Product" WHERE sku = ANY($1::text[])`, skus,
  );
  const prodBySku = new Map<string, string>();
  for (const p of prodRows) prodBySku.set(String(p.sku).toUpperCase(), p.id);
  console.log(`  Products matched in catalog: ${prodBySku.size}/${priced.length}`);

  const diffs: { sku: string; from: number | null; to: number; delta: number }[] = [];
  const missingProduct: string[] = [];
  let unchanged = 0, created = 0;
  for (const row of priced) {
    const productId = prodBySku.get(row.sku);
    if (!productId) { missingProduct.push(row.sku); continue; }
    const ex = existingBySku.get(row.sku);
    if (!ex) {
      created++;
      diffs.push({ sku: row.sku, from: null, to: row.price, delta: row.price });
      continue;
    }
    const diff = Math.round((row.price - ex.customPrice) * 100) / 100;
    if (Math.abs(diff) < 0.005) { unchanged++; continue; }
    diffs.push({ sku: row.sku, from: ex.customPrice, to: row.price, delta: diff });
  }

  console.log('\n  DIFF SUMMARY vs existing Brookfield BuilderPricing:');
  console.log(`    will CREATE new rows:   ${created}`);
  console.log(`    will UPDATE (changed):  ${diffs.length - created}`);
  console.log(`    UNCHANGED (skip):       ${unchanged}`);
  console.log(`    Missing product in catalog (SKU not in Aegis Product): ${missingProduct.length}`);
  if (missingProduct.length) {
    console.log('    First 10 missing SKUs:', missingProduct.slice(0, 10));
  }
  console.log('\n  Top 15 changes (|delta| desc):');
  const sorted = [...diffs].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  for (const d of sorted.slice(0, 15)) {
    console.log(`    ${d.sku.padEnd(10)}  ${String(d.from ?? 'NEW').padStart(8)}  ->  ${String(d.to).padStart(8)}   Δ ${d.delta >= 0 ? '+' : ''}${d.delta}`);
  }

  if (DRY_RUN) { console.log('\n  [dry-run] no writes'); return; }

  let wrote = 0;
  for (const row of priced) {
    const productId = prodBySku.get(row.sku);
    if (!productId) continue;
    const ex = existingBySku.get(row.sku);
    if (ex && Math.abs(ex.customPrice - row.price) < 0.005) continue;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderPricing" ("id","builderId","productId","customPrice","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("builderId","productId") DO UPDATE SET
         "customPrice" = EXCLUDED."customPrice",
         "updatedAt"   = CURRENT_TIMESTAMP`,
      builder.id, productId, row.price,
    );
    wrote++;
  }
  console.log(`  wrote ${wrote} BuilderPricing rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. PLAN BREAKDOWN → CommunityFloorPlan
// ─────────────────────────────────────────────────────────────────────────────

interface PlanSummary { plan: string; sqFt: number | null; baseTotal: number | null }

function parsePlanBreakdownSummary(fp: string): PlanSummary[] {
  // Prefer the Pricing Schedule's "Plan Summary" (has sqFt column) — but caller
  // here walks the Plan Breakdown file. So: Plan Breakdown's Summary gives only
  // Plan + base total. Square footage lives in each plan tab's r01 string.
  const matrix = readSheetRaw(fp, 'Summary');
  const plans: PlanSummary[] = [];
  // Headers on r03: [Plan, Ext..., Ext Install, Int..., Trim..., Labor, Base Total]
  for (let i = 4; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const plan = (row[0] ?? '').toString().trim();
    if (!plan || plan.toUpperCase() === 'AVERAGE') continue;
    const baseTotal = typeof row[6] === 'number' ? row[6] : parseMoney(row[6]);
    plans.push({ plan, sqFt: null, baseTotal });
  }
  // Fill sq footage by reading each plan's sheet header row r01
  const wb = XLSX.readFile(fp, { cellDates: true });
  for (const p of plans) {
    const ws = wb.Sheets[p.plan];
    if (!ws) continue;
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true }) as any[][];
    const subtitle = (m[1] && m[1][0]) ? String(m[1][0]) : '';
    const match = subtitle.match(/([\d,]+)\s*Sq\s*Ft/i);
    if (match) p.sqFt = parseInt(match[1].replace(/,/g, ''), 10);
  }
  return plans;
}

async function findOrCreateBrookfieldCommunity(builderId: string): Promise<{ id: string; name: string; created: boolean }> {
  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, name FROM "Community" WHERE "builderId" = $1 ORDER BY "createdAt" LIMIT 5`, builderId,
  );
  if (existing.length) return { id: existing[0].id, name: existing[0].name, created: false };
  if (DRY_RUN) return { id: '(would-create)', name: 'Brookfield DFW', created: true };
  const rows: any[] = await prisma.$queryRawUnsafe(
    `INSERT INTO "Community" ("id","builderId","name","status","createdAt","updatedAt")
     VALUES (gen_random_uuid()::text,$1,'Brookfield DFW','ACTIVE',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
     RETURNING id, name`, builderId,
  );
  return { id: rows[0].id, name: rows[0].name, created: true };
}

async function stagePlans() {
  bar('STAGE 2: PLAN BREAKDOWN Rev2 → CommunityFloorPlan');
  if (!fs.existsSync(FILES.plans)) { console.log('  FILE MISSING, skipping'); return; }

  const builder = await findBrookfieldBuilder();
  console.log(`  Builder: ${builder.companyName}`);
  const community = await findOrCreateBrookfieldCommunity(builder.id);
  console.log(`  Community: ${community.name}  id=${community.id}${community.created ? '  (CREATED)' : ''}`);

  const plans = parsePlanBreakdownSummary(FILES.plans);
  console.log(`  Parsed plans: ${plans.length}`);
  for (const p of plans) {
    console.log(`    ${p.plan}  sqFt=${p.sqFt ?? '?'}  baseTotal=$${p.baseTotal?.toFixed(2) ?? '?'}`);
  }

  // Existing floor plans on this community
  const existing: any[] = community.id === '(would-create)' ? [] : await prisma.$queryRawUnsafe(
    `SELECT id, name, "planNumber", "sqFootage", "basePackagePrice"
       FROM "CommunityFloorPlan" WHERE "communityId" = $1`, community.id,
  );
  const existingByPlan = new Map<string, any>();
  for (const e of existing) existingByPlan.set(String(e.planNumber || e.name).trim(), e);
  console.log(`  Existing floor plans on community: ${existing.length}`);

  let toCreate = 0, toUpdate = 0, unchanged = 0;
  for (const p of plans) {
    const ex = existingByPlan.get(p.plan);
    if (!ex) { toCreate++; continue; }
    const changed = (ex.sqFootage !== p.sqFt) || (Math.abs(Number(ex.basePackagePrice ?? 0) - Number(p.baseTotal ?? 0)) > 0.005);
    if (changed) toUpdate++; else unchanged++;
  }
  console.log(`  CREATE: ${toCreate}   UPDATE: ${toUpdate}   UNCHANGED: ${unchanged}`);

  if (DRY_RUN) { console.log('\n  [dry-run] no writes'); return; }

  let wrote = 0;
  for (const p of plans) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "CommunityFloorPlan"
         ("id","communityId","name","planNumber","sqFootage","basePackagePrice","active","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT ("communityId","name") DO UPDATE SET
         "planNumber"       = EXCLUDED."planNumber",
         "sqFootage"        = EXCLUDED."sqFootage",
         "basePackagePrice" = EXCLUDED."basePackagePrice",
         "updatedAt"        = CURRENT_TIMESTAMP`,
      community.id, `Plan ${p.plan}`, p.plan, p.sqFt, p.baseTotal,
    );
    wrote++;
  }
  console.log(`  wrote ${wrote} CommunityFloorPlan rows`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. VALUE ENGINEERING → InboxItem (one summary item)
// ─────────────────────────────────────────────────────────────────────────────

async function stageValueEngineering() {
  bar('STAGE 3: VALUE ENGINEERING → InboxItem');
  if (!fs.existsSync(FILES.ve)) { console.log('  FILE MISSING, skipping'); return; }

  // Pull the headline numbers out of Executive Summary
  const exec = readSheetRaw(FILES.ve, 'Executive Summary');
  // r05-08: the ask / impact;  r11-14: the answer
  const gab = (r: number, c: number) => (exec[r] && exec[r][c] != null ? String(exec[r][c]) : null);
  const summary = {
    ask: gab(5, 1),
    impact4pct: gab(6, 1),
    impact5pct: gab(7, 1),
    marginImpact: gab(8, 1),
    valueDelivered: gab(11, 1),
    abelMarginImprovement: gab(12, 1),
    annualRecovery: gab(13, 1),
    netResult: gab(14, 1),
  };

  const description = [
    `Brookfield asked for ${summary.ask}; that would cost Abel ${summary.impact4pct} / ${summary.impact5pct}.`,
    `VE counter-proposal: ${summary.valueDelivered}; Abel margin gain ${summary.abelMarginImprovement} (${summary.annualRecovery}/yr).`,
    `Margin impact of blanket discount: ${summary.marginImpact}.`,
    `Net: ${summary.netResult}`,
    '',
    'Sheets: Executive Summary, Door Style Analysis, Hardware & Specialty, Supplier Strategy, Implementation Roadmap, Brookfield Comparison.',
    'Source file: Brookfield/Brookfield_Value_Engineering_Proposal_April_2026.xlsx',
  ].join('\n');

  const title = 'Brookfield Value Engineering Proposal — April 2026';
  const SOURCE_TAG = 'BROOKFIELD_VE_APR2026';

  console.log(`  Title: ${title}`);
  console.log(`  Description:\n    ${description.replace(/\n/g, '\n    ')}`);

  // Check for existing item with this source tag (stored in actionData.sourceTag)
  const dupes: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, title FROM "InboxItem"
      WHERE "actionData"->>'sourceTag' = $1 LIMIT 5`, SOURCE_TAG,
  );
  console.log(`  Existing items with sourceTag=${SOURCE_TAG}: ${dupes.length}`);

  if (DRY_RUN) { console.log('\n  [dry-run] no writes'); return; }

  if (dupes.length) {
    await prisma.$executeRawUnsafe(
      `UPDATE "InboxItem"
          SET title = $1, description = $2, "updatedAt" = CURRENT_TIMESTAMP,
              "actionData" = $3::jsonb
        WHERE id = $4`,
      title, description,
      JSON.stringify({ sourceTag: SOURCE_TAG, summary }),
      dupes[0].id,
    );
    console.log(`  updated existing InboxItem id=${dupes[0].id}`);
  } else {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `INSERT INTO "InboxItem" ("id","type","source","title","description","priority","status","actionData","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text,'DEAL_FOLLOWUP','sales-brookfield',$1,$2,'HIGH','PENDING',$3::jsonb,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
       RETURNING id`,
      title, description, JSON.stringify({ sourceTag: SOURCE_TAG, summary }),
    );
    console.log(`  created InboxItem id=${rows[0].id}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log(DRY_RUN ? '\n[DRY-RUN MODE]  (use --commit to write)' : '\n[COMMIT MODE]');
  console.log(`Source dir: ${BROOKFIELD_DIR}`);

  if (!ONLY || ONLY === 'pricing') await stagePricing();
  if (!ONLY || ONLY === 'plans')   await stagePlans();
  if (!ONLY || ONLY === 've')      await stageValueEngineering();

  bar('DONE');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
