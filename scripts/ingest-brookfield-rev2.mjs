// Ingest Brookfield Rev2 plan breakdown + pricing schedule + VE proposal.
//
// Source files (parent workspace, ../):
//   Brookfield/Brookfield_Plan_Breakdown_Rev2_April_2026.xlsx
//   Brookfield/Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx
//   Brookfield/Brookfield_Value_Engineering_Proposal_April_2026.xlsx
//
// Writes:
//   CommunityFloorPlan            — 11 plans under Brookfield Homes → The Grove
//   BrookfieldPlanBom             — per-plan BoM rows (name/qty/unit_price/section)
//   BuilderPricing                — ~227 rows tagged revisionTag='Rev2-April-2026'
//   BrookfieldVeAlternative       — VE swap pairs (current → proposed)
//
// Idempotent. Default is dry-run; pass --commit to apply.
//
//   node scripts/ingest-brookfield-rev2.mjs                # dry run
//   node scripts/ingest-brookfield-rev2.mjs --commit       # apply

import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const COMMIT = process.argv.includes('--commit');
const REVISION_TAG = 'Rev2-April-2026';
const EFFECTIVE_DATE = '2026-04-15';

const sql = neon(process.env.DATABASE_URL);

function bar(t) {
  console.log('\n' + '='.repeat(64));
  console.log('  ' + t);
  console.log('='.repeat(64));
}

function parseMoney(v) {
  if (v == null || v === '') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

async function ensureSchema() {
  // Add revisionTag + effectiveDate columns to BuilderPricing if missing.
  await sql`ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "revisionTag" TEXT`;
  await sql`ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "effectiveDate" DATE`;

  // Plan BoM table — distinct from Product-to-Product BomEntry because plan
  // sheets list item descriptions (e.g. "3080 RH DUNNAGE"), not formal SKUs.
  await sql`
    CREATE TABLE IF NOT EXISTS "BrookfieldPlanBom" (
      "id"            TEXT PRIMARY KEY,
      "planId"        TEXT NOT NULL,
      "section"       TEXT,
      "lineOrder"     INTEGER NOT NULL,
      "itemName"      TEXT NOT NULL,
      "quantity"      NUMERIC NOT NULL,
      "unit"          TEXT,
      "unitPrice"     NUMERIC,
      "extended"      NUMERIC,
      "wall"          TEXT,
      "location"      TEXT,
      "revisionTag"   TEXT NOT NULL,
      "productId"     TEXT,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_bfpbom_plan" ON "BrookfieldPlanBom"("planId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_bfpbom_rev"  ON "BrookfieldPlanBom"("revisionTag")`;

  // VE alternatives — lightweight substitution log.
  // Use a deterministic id (MD5 of identifying fields) so ON CONFLICT works
  // even when nullable columns are NULL.
  await sql`
    CREATE TABLE IF NOT EXISTS "BrookfieldVeAlternative" (
      "id"              TEXT PRIMARY KEY,
      "category"        TEXT NOT NULL,
      "currentItem"     TEXT NOT NULL,
      "proposedItem"    TEXT NOT NULL,
      "currentCost"     NUMERIC,
      "proposedCost"    NUMERIC,
      "currentPrice"    NUMERIC,
      "proposedPrice"   NUMERIC,
      "bfSavings"       NUMERIC,
      "abelGain"        NUMERIC,
      "doorSize"        TEXT,
      "handing"         TEXT,
      "notes"           TEXT,
      "revisionTag"     TEXT NOT NULL,
      "createdAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
}

async function getBrookfield() {
  const r = await sql`
    SELECT "id", "companyName" FROM "Builder"
    WHERE LOWER("companyName") LIKE '%brookfield%' LIMIT 1
  `;
  if (!r[0]) throw new Error('Brookfield builder not found');
  return r[0];
}

async function getOrCreateCommunity(builderId) {
  let r = await sql`
    SELECT "id", "name" FROM "Community"
    WHERE "builderId" = ${builderId} AND LOWER("name") = 'the grove' LIMIT 1
  `;
  if (r[0]) return r[0];
  // Fallback to any community
  r = await sql`
    SELECT "id", "name" FROM "Community" WHERE "builderId" = ${builderId} LIMIT 1
  `;
  if (r[0]) return r[0];
  if (!COMMIT) return { id: '(DRY-RUN:new-community)', name: 'The Grove' };
  const ins = await sql`
    INSERT INTO "Community" ("id","builderId","name","status","createdAt","updatedAt")
    VALUES (gen_random_uuid()::text, ${builderId}, 'The Grove', 'ACTIVE',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING "id","name"
  `;
  return ins[0];
}

// ─────────────────────────────────────────────────────────────────────────
// PLAN BREAKDOWN
// ─────────────────────────────────────────────────────────────────────────

function isPlanSheet(name) {
  return /^\d{4}$/.test(name); // 4500, 4515, …
}

function parseSqFt(metaRow1) {
  const s = String(metaRow1 || '');
  const m = s.match(/([\d,]+)\s*Sq\s*Ft/i);
  if (!m) return null;
  const n = parseInt(m[1].replace(/,/g, ''), 10);
  return Number.isFinite(n) ? n : null;
}

function isSectionHeader(cell) {
  if (!cell) return false;
  const s = String(cell).trim();
  return /^(EXTERIOR DOORS|INTERIOR DOORS|INTERIOR TRIM|TRIM LABOR|UPGRADE|OPTION|PLAN SUMMARY)/i.test(s);
}

function isHeaderRow(row) {
  const a = String(row[0] || '').toLowerCase();
  return a === 'item' || a === 'description' || a === 'billing code';
}

function isTotalsRow(row) {
  const a = String(row[0] || '').toLowerCase();
  if (!a) return false;
  return /\b(subtotal|total|tax\s*\(|less:|net adder|billing codes)/i.test(a)
      || /^(ext|int)\s/i.test(a) && /(subtotal|total)/i.test(a);
}

function parsePlanSheet(sheet, planCode) {
  const m = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const meta = String(m[1]?.[0] || '');
  const sqFt = parseSqFt(meta);
  const lines = [];
  let section = null;
  let order = 0;
  for (let i = 0; i < m.length; i++) {
    const row = m[i] || [];
    const a = row[0];
    if (a && !row[1] && !row[2] && !row[3] && !row[4] && !row[5]) {
      if (isSectionHeader(a)) { section = String(a).trim(); continue; }
      continue;
    }
    if (isHeaderRow(row)) continue;
    if (isTotalsRow(row)) continue;
    // Skip summary at the bottom.
    if (section && /^PLAN SUMMARY/i.test(section)) continue;

    const itemName = String(a || '').trim();
    if (!itemName) continue;

    // TRIM LABOR rows look different (Sq Ft, Rate). Skip — already captured in summary.
    if (section && /^TRIM LABOR/i.test(section)) continue;

    const qty = row[1];
    const wallOrUom = row[2];
    const loc = row[3];
    const unitPrice = row[4];
    const extended = row[5];

    // Reject rows that don't look like BoM lines.
    if (qty == null || qty === '') continue;
    const qtyNum = Number(qty);
    if (!Number.isFinite(qtyNum)) continue;
    if (unitPrice == null || unitPrice === '') continue;

    order += 1;
    lines.push({
      section,
      lineOrder: order,
      itemName,
      quantity: qtyNum,
      unit: typeof wallOrUom === 'string' && /^(EA|PAIR|LF|SF)$/i.test(wallOrUom)
            ? wallOrUom.toUpperCase() : null,
      wall: typeof wallOrUom === 'string' && /"$|''$|inch/i.test(wallOrUom)
            ? wallOrUom : null,
      location: loc ? String(loc).trim() : null,
      unitPrice: parseMoney(unitPrice),
      extended: extended != null && extended !== '' ? parseMoney(extended) : null,
    });
  }
  return { planCode, sqFt, lines };
}

async function upsertFloorPlan({ communityId, planCode, sqFt, interiorCount, exteriorCount, baseTotal }) {
  if (!COMMIT) return { id: `(DRY:${planCode})`, created: false };
  // Match by (communityId, planNumber) so we merge onto the pre-existing
  // "Plan 4500" / "Plan 4515" rows rather than creating "4500" duplicates.
  const existing = await sql`
    SELECT "id", "name" FROM "CommunityFloorPlan"
    WHERE "communityId" = ${communityId} AND "planNumber" = ${planCode}
    ORDER BY CASE WHEN "name" LIKE 'Plan %' THEN 0 ELSE 1 END
    LIMIT 1
  `;
  if (existing[0]) {
    await sql`
      UPDATE "CommunityFloorPlan" SET
        "planNumber"        = ${planCode},
        "sqFootage"         = ${sqFt},
        "interiorDoorCount" = ${interiorCount},
        "exteriorDoorCount" = ${exteriorCount},
        "basePackagePrice"  = ${baseTotal},
        "updatedAt"         = CURRENT_TIMESTAMP
      WHERE "id" = ${existing[0].id}
    `;
    return { id: existing[0].id, created: false };
  }
  const ins = await sql`
    INSERT INTO "CommunityFloorPlan"
      ("id","communityId","name","planNumber","sqFootage","interiorDoorCount",
       "exteriorDoorCount","basePackagePrice","active","createdAt","updatedAt")
    VALUES (gen_random_uuid()::text, ${communityId}, ${'Plan ' + planCode}, ${planCode},
            ${sqFt}, ${interiorCount}, ${exteriorCount}, ${baseTotal}, TRUE,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING "id"
  `;
  return { id: ins[0].id, created: true };
}

async function writePlanBom(planId, lines) {
  if (!COMMIT) return lines.length;
  // Delete existing rows for this plan + revision (idempotent).
  await sql`
    DELETE FROM "BrookfieldPlanBom"
    WHERE "planId" = ${planId} AND "revisionTag" = ${REVISION_TAG}
  `;
  // Insert line-by-line. 11 plans * ~80 lines = ~880 inserts; acceptable.
  let n = 0;
  for (const ln of lines) {
    await sql`
      INSERT INTO "BrookfieldPlanBom"
        ("id","planId","section","lineOrder","itemName","quantity","unit","unitPrice",
         "extended","wall","location","revisionTag","createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${planId}, ${ln.section}, ${ln.lineOrder},
         ${ln.itemName}, ${ln.quantity}, ${ln.unit}, ${ln.unitPrice},
         ${ln.extended}, ${ln.wall}, ${ln.location}, ${REVISION_TAG},
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    n++;
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────
// PRICING SCHEDULE
// ─────────────────────────────────────────────────────────────────────────

async function getOrCreateProduct(sku, name, category, unit) {
  if (!sku) return null;
  const existing = await sql`SELECT "id" FROM "Product" WHERE "sku" = ${sku} LIMIT 1`;
  if (existing[0]) return existing[0].id;
  if (!COMMIT) return `(DRY:${sku})`;
  try {
    const ins = await sql`
      INSERT INTO "Product"
        ("id","sku","name","category","cost","basePrice","createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${sku}, ${name || sku}, ${category || 'Unclassified'},
         0, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("sku") DO UPDATE SET "name" = EXCLUDED."name"
      RETURNING "id"
    `;
    return ins[0].id;
  } catch (e) {
    console.warn(`   product create fail (${sku}): ${String(e.message).slice(0, 140)}`);
    return null;
  }
}

async function upsertBuilderPricing(builderId, productId, price) {
  if (!COMMIT) return 'dry';
  try {
    await sql`
      INSERT INTO "BuilderPricing"
        ("id","builderId","productId","customPrice","revisionTag","effectiveDate",
         "createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${builderId}, ${productId}, ${price},
         ${REVISION_TAG}, ${EFFECTIVE_DATE}::date,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT ("builderId","productId") DO UPDATE SET
        "customPrice"   = EXCLUDED."customPrice",
        "revisionTag"   = EXCLUDED."revisionTag",
        "effectiveDate" = EXCLUDED."effectiveDate",
        "updatedAt"     = CURRENT_TIMESTAMP
    `;
    return 'ok';
  } catch (e) {
    return 'fail: ' + String(e.message).slice(0, 140);
  }
}

async function ingestPricingSchedule(builderId) {
  const fp = path.join(ABEL_FOLDER, 'Brookfield', 'Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx');
  if (!fs.existsSync(fp)) throw new Error('Pricing schedule file missing: ' + fp);
  const wb = XLSX.readFile(fp);
  const ws = wb.Sheets['Pricing Schedule'];
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  let section = null;
  let wrote = 0, skipped = 0, productsTouched = 0;
  const unmatched = [];
  for (let i = 4; i < m.length; i++) {
    const row = m[i] || [];
    const sku = (row[0] || '').toString().trim();
    const product = (row[1] || '').toString().trim();
    const category = (row[2] || '').toString().trim();
    const unit = (row[3] || '').toString().trim();
    const price = parseMoney(row[4]);
    if (sku && !product && !unit && !price) { section = sku; continue; }
    if (!sku || !product) { skipped++; continue; }
    const productId = await getOrCreateProduct(sku, product, category || section || null, unit || 'ea');
    if (!productId) { skipped++; unmatched.push(sku); continue; }
    productsTouched++;
    const r = await upsertBuilderPricing(builderId, productId, price);
    if (r === 'ok' || r === 'dry') wrote++; else { skipped++; if (unmatched.length < 10) unmatched.push(sku + ' ' + r); }
  }
  return { wrote, skipped, productsTouched, unmatched };
}

// ─────────────────────────────────────────────────────────────────────────
// VALUE ENGINEERING
// ─────────────────────────────────────────────────────────────────────────

function veId(row) {
  const key = [REVISION_TAG, row.category, row.currentItem, row.proposedItem,
               row.doorSize || '', row.handing || ''].join('|');
  return 'bfve_' + crypto.createHash('md5').update(key).digest('hex').slice(0, 24);
}

async function upsertVe(row) {
  if (!COMMIT) return;
  const id = veId(row);
  await sql`
    INSERT INTO "BrookfieldVeAlternative"
      ("id","category","currentItem","proposedItem","currentCost","proposedCost",
       "currentPrice","proposedPrice","bfSavings","abelGain","doorSize","handing",
       "notes","revisionTag","createdAt","updatedAt")
    VALUES
      (${id}, ${row.category}, ${row.currentItem}, ${row.proposedItem},
       ${row.currentCost}, ${row.proposedCost}, ${row.currentPrice}, ${row.proposedPrice},
       ${row.bfSavings}, ${row.abelGain}, ${row.doorSize}, ${row.handing},
       ${row.notes}, ${REVISION_TAG},
       CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    ON CONFLICT ("id") DO UPDATE SET
      "currentCost"   = EXCLUDED."currentCost",
      "proposedCost"  = EXCLUDED."proposedCost",
      "currentPrice"  = EXCLUDED."currentPrice",
      "proposedPrice" = EXCLUDED."proposedPrice",
      "bfSavings"     = EXCLUDED."bfSavings",
      "abelGain"      = EXCLUDED."abelGain",
      "notes"         = EXCLUDED."notes",
      "updatedAt"     = CURRENT_TIMESTAMP
  `;
}

async function ingestVeProposal() {
  const fp = path.join(ABEL_FOLDER, 'Brookfield', 'Brookfield_Value_Engineering_Proposal_April_2026.xlsx');
  if (!fs.existsSync(fp)) throw new Error('VE proposal file missing: ' + fp);
  const wb = XLSX.readFile(fp);
  let wrote = 0;

  // Door Style Analysis: 2-Panel → 1-Panel per size/hand.
  const dsa = XLSX.utils.sheet_to_json(wb.Sheets['Door Style Analysis'], { header: 1, defval: null });
  for (const row of dsa) {
    const [size, hand, curCost, altCost, savings] = row || [];
    if (!size || !hand || typeof curCost !== 'number' || typeof altCost !== 'number') continue;
    await upsertVe({
      category:      'Door Style (2-Panel → 1-Panel)',
      currentItem:   `${size} 2-Panel Molded Shaker`,
      proposedItem:  `${size} 1-Panel Molded Shaker`,
      currentCost:   curCost,
      proposedCost:  altCost,
      currentPrice:  null,
      proposedPrice: null,
      bfSavings:     typeof row[5] === 'number' ? row[5] : null,
      abelGain:      typeof row[6] === 'number' ? row[6] : null,
      doorSize:      String(size),
      handing:       String(hand),
      notes:         'COGS savings split 60% BF / 40% Abel',
    });
    wrote++;
  }

  // Hardware & Specialty: Brass → Black hinges, Alder → MDF barn door, etc.
  const hw = XLSX.utils.sheet_to_json(wb.Sheets['Hardware & Specialty'], { header: 1, defval: null });
  let hwSection = null;
  for (const row of hw) {
    const a = row?.[0];
    if (!a) { continue; }
    const s = String(a).trim();
    // Section titles span a single cell.
    if (!row[1] && !row[2] && !row[3]) {
      if (/[A-Z]{2,}/.test(s) && /SWAP|SUBSTITUTION|HARDWARE|BARN|SHELV|ROD|ATTIC|FINISH/i.test(s)) {
        hwSection = s; continue;
      }
      continue;
    }
    if (s === 'Item' || s === 'Metric') continue;
    // Rows with numeric current & proposed cost.
    const curCost = typeof row[1] === 'number' ? row[1] : null;
    const curPrice = typeof row[2] === 'number' ? row[2] : null;
    const propCost = typeof row[4] === 'number' ? row[4] : null;
    const propPrice = typeof row[5] === 'number' ? row[5] : null;
    const bfSav = typeof row[7] === 'number' ? row[7] : null;
    const abelGain = typeof row[8] === 'number' ? row[8] : null;
    if (curCost == null && propCost == null && curPrice == null) continue;
    await upsertVe({
      category:      hwSection || 'Hardware & Specialty',
      currentItem:   s,
      proposedItem:  s + ' (proposed alternative)',
      currentCost:   curCost,
      proposedCost:  propCost,
      currentPrice:  curPrice,
      proposedPrice: propPrice,
      bfSavings:     bfSav,
      abelGain:      abelGain,
      doorSize:      null,
      handing:       null,
      notes:         'See VE proposal Apr 2026',
    });
    wrote++;
  }
  return { wrote };
}

// ─────────────────────────────────────────────────────────────────────────
// PLAN SUMMARY (for basePackagePrice + door counts)
// ─────────────────────────────────────────────────────────────────────────

function loadPlanSummary() {
  const fp = path.join(ABEL_FOLDER, 'Brookfield', 'Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx');
  const wb = XLSX.readFile(fp);
  const m = XLSX.utils.sheet_to_json(wb.Sheets['Plan Summary'], { header: 1, defval: null });
  const out = {};
  for (let i = 4; i < m.length; i++) {
    const [plan, sqFt, ext, intDoors, intTrim, trimLabor, baseTotal] = m[i] || [];
    if (!plan || /^AVERAGE$/i.test(String(plan))) continue;
    if (typeof baseTotal !== 'number') continue;
    out[String(plan).trim()] = { sqFt, ext, intDoors, intTrim, trimLabor, baseTotal };
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  bar(`INGEST BROOKFIELD REV2 ${COMMIT ? '[COMMIT]' : '[DRY-RUN]'}`);
  console.log(`Revision tag:   ${REVISION_TAG}`);
  console.log(`Effective date: ${EFFECTIVE_DATE}`);

  await ensureSchema();

  const builder = await getBrookfield();
  console.log(`\nBuilder: ${builder.companyName} (${builder.id})`);

  const community = await getOrCreateCommunity(builder.id);
  console.log(`Community: ${community.name} (${community.id})`);

  // Pre-count for reporting
  const preBp = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builder.id}
  `;
  const prePlans = await sql`
    SELECT COUNT(*)::int AS n FROM "CommunityFloorPlan" WHERE "communityId" = ${community.id}
  `;

  // 1. Plan breakdowns
  bar('Plan Breakdown Rev2 → CommunityFloorPlan + BrookfieldPlanBom');
  const fpPlan = path.join(ABEL_FOLDER, 'Brookfield', 'Brookfield_Plan_Breakdown_Rev2_April_2026.xlsx');
  const wbPlan = XLSX.readFile(fpPlan);
  const planSummary = loadPlanSummary();
  let plansSeeded = 0, plansCreated = 0, bomRows = 0;
  const sampleBom = [];
  for (const sheetName of wbPlan.SheetNames) {
    if (!isPlanSheet(sheetName)) continue;
    const parsed = parsePlanSheet(wbPlan.Sheets[sheetName], sheetName);
    const summary = planSummary[sheetName] || {};
    const intCount = parsed.lines.filter(l =>
      l.section && /^INTERIOR DOORS — Base/i.test(l.section)).reduce((s, l) => s + Math.abs(l.quantity), 0);
    const extCount = parsed.lines.filter(l =>
      l.section && /^EXTERIOR DOORS — Material/i.test(l.section)
      && /dunnage|fg /i.test(l.itemName)).reduce((s, l) => s + Math.abs(l.quantity), 0);

    const { id: planId, created } = await upsertFloorPlan({
      communityId:    community.id,
      planCode:       sheetName,
      sqFt:           parsed.sqFt || summary.sqFt || null,
      interiorCount:  Math.round(intCount) || null,
      exteriorCount:  Math.round(extCount) || null,
      baseTotal:      summary.baseTotal || null,
    });
    plansSeeded++;
    if (created) plansCreated++;
    const n = await writePlanBom(planId, parsed.lines);
    bomRows += n;

    if (sampleBom.length < 3) {
      sampleBom.push({
        plan: sheetName,
        sqFt: parsed.sqFt,
        baseTotal: summary.baseTotal,
        lines: parsed.lines.length,
        first5: parsed.lines.slice(0, 5).map(l =>
          `${l.itemName} x${l.quantity} @ $${l.unitPrice} [${l.section}]`),
      });
    }
    console.log(`   plan ${sheetName}: ${parsed.lines.length} BoM lines · ${parsed.sqFt || '?'} sqft · base $${summary.baseTotal ?? '?'}`);
  }

  // 2. Pricing schedule
  bar('Pricing Schedule Rev2 → BuilderPricing');
  const pricing = await ingestPricingSchedule(builder.id);
  console.log(`   products touched:  ${pricing.productsTouched}`);
  console.log(`   pricing upserts:   ${pricing.wrote}`);
  console.log(`   skipped/unmatched: ${pricing.skipped}`);
  if (pricing.unmatched.length) {
    console.log(`   unmatched SKUs (first 10): ${pricing.unmatched.slice(0, 10).join(', ')}`);
  }

  // 3. VE Proposal
  bar('Value Engineering Proposal → BrookfieldVeAlternative');
  const ve = await ingestVeProposal();
  console.log(`   VE alternatives upserted: ${ve.wrote}`);

  // Post-count
  const postBp = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builder.id}
  `;
  const postPlans = await sql`
    SELECT COUNT(*)::int AS n FROM "CommunityFloorPlan" WHERE "communityId" = ${community.id}
  `;

  bar('SUMMARY');
  console.log(`Plans seeded:                  ${plansSeeded} (new: ${plansCreated})`);
  console.log(`BoM rows written:              ${bomRows}`);
  console.log(`Pricing rows upserted:         ${pricing.wrote}`);
  console.log(`VE alternatives:               ${ve.wrote}`);
  console.log(`Skipped unmatched SKUs:        ${pricing.skipped}`);
  console.log('');
  console.log(`BuilderPricing (Brookfield):   ${preBp[0].n}  →  ${postBp[0].n}`);
  console.log(`CommunityFloorPlan (Grove):    ${prePlans[0].n}  →  ${postPlans[0].n}`);
  console.log('');
  console.log('Sample plans (first 3 with first 5 BoM lines each):');
  for (const s of sampleBom) {
    console.log(`  PLAN ${s.plan} — ${s.sqFt} sqft · base $${s.baseTotal} · ${s.lines} lines`);
    s.first5.forEach(l => console.log('    - ' + l));
  }
  console.log('');
  console.log(COMMIT ? '[COMMIT] Changes applied.' : '[DRY-RUN] Re-run with --commit to apply.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
