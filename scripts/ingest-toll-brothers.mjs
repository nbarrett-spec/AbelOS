// Ingest Toll Brothers plans + pricing + (stub) contacts.
//
// Source files (parent workspace, ../):
//   Toll Brothers/Abel Door and Trim Bids - 11.10.2025 - Toll Brothers Copy.xlsx
//   Toll Brothers/1.5.26 PRICING CHANGE WORKSHEET.xlsx
//
// Writes:
//   BuilderPricing        — ~176 Toll SKU rows tagged revisionTag='Bid-2025-11-10'
//   TollBrothersPlanBom   — per-plan BoM rows (CHAMBORD + VIANDEN under Creek Meadows)
//   CommunityFloorPlan    — updated with base totals + door counts from pricing worksheet
//   BuilderContact        — Brittney Werner (primary, from memory/people/abel-team.md)
//
// Idempotent. Default is dry-run; pass --commit to apply.
//
//   node scripts/ingest-toll-brothers.mjs                # dry run
//   node scripts/ingest-toll-brothers.mjs --commit       # apply

import XLSX from 'xlsx';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const COMMIT = process.argv.includes('--commit');
const REVISION_TAG = 'Bid-2025-11-10';
const EFFECTIVE_DATE = '2025-11-10';
const BOM_REVISION_TAG = 'PricingChange-2026-01-05';

const sql = neon(process.env.DATABASE_URL);

function bar(t) {
  console.log('\n' + '='.repeat(64));
  console.log('  ' + t);
  console.log('='.repeat(64));
}

function parseMoney(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  if (/^N\/A$/i.test(s) || s === '-' || s === '') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

async function ensureSchema() {
  // BuilderPricing already has revisionTag + effectiveDate from Brookfield migration.
  await sql`ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "revisionTag" TEXT`;
  await sql`ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "effectiveDate" DATE`;

  // Toll-specific plan BoM table (parallel to BrookfieldPlanBom).
  await sql`
    CREATE TABLE IF NOT EXISTS "TollBrothersPlanBom" (
      "id"            TEXT PRIMARY KEY,
      "planId"        TEXT NOT NULL,
      "section"       TEXT,
      "lineOrder"     INTEGER NOT NULL,
      "itemName"      TEXT NOT NULL,
      "description"   TEXT,
      "quantity"      NUMERIC NOT NULL,
      "unit"          TEXT,
      "unitPrice"     NUMERIC,
      "extended"      NUMERIC,
      "revisionTag"   TEXT NOT NULL,
      "productId"     TEXT,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_tollbom_plan" ON "TollBrothersPlanBom"("planId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_tollbom_rev"  ON "TollBrothersPlanBom"("revisionTag")`;
}

async function getTollBrothers() {
  const r = await sql`
    SELECT "id", "companyName" FROM "Builder"
    WHERE LOWER("companyName") LIKE '%toll%' LIMIT 1
  `;
  if (!r[0]) throw new Error('Toll Brothers builder not found');
  return r[0];
}

async function getCommunity(builderId, name) {
  const r = await sql`
    SELECT "id", "name" FROM "Community"
    WHERE "builderId" = ${builderId} AND LOWER("name") = ${name.toLowerCase()}
    LIMIT 1
  `;
  return r[0] || null;
}

async function getPlanByName(communityId, planName) {
  const r = await sql`
    SELECT "id", "name" FROM "CommunityFloorPlan"
    WHERE "communityId" = ${communityId} AND LOWER("name") = ${planName.toLowerCase()}
    LIMIT 1
  `;
  return r[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// PRICING — Abel Door and Trim Bids - 11.10.2025
// ─────────────────────────────────────────────────────────────────────────

async function getOrCreateProduct(sku, name, unit, description) {
  if (!sku) return null;
  const existing = await sql`SELECT "id" FROM "Product" WHERE "sku" = ${sku} LIMIT 1`;
  if (existing[0]) return existing[0].id;
  if (!COMMIT) return `(DRY:${sku})`;
  try {
    const ins = await sql`
      INSERT INTO "Product"
        ("id","sku","name","category","cost","basePrice","description","createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${sku}, ${name || sku}, ${'Toll Bid Sheet'},
         0, 0, ${description || null}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
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
  if (!COMMIT) return 'ok';
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

async function ingestBidSheet(builderId) {
  const fp = path.join(ABEL_FOLDER, 'Toll Brothers', 'Abel Door and Trim Bids - 11.10.2025 - Toll Brothers Copy.xlsx');
  if (!fs.existsSync(fp)) throw new Error('Bid sheet missing: ' + fp);
  const wb = XLSX.readFile(fp);
  const ws = wb.Sheets[wb.SheetNames[0]]; // '11.10.2025 Bids'
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  // Row 0 header; rows 1..N data.
  // Cols: 0=Sku, 1=Size, 2=Old, 3=New, 4=Discount, 5=UOM, 6=Item desc, 7/8=spacer, 9=Detailed
  let wrote = 0, skippedNoPrice = 0, skippedNoSku = 0, productsTouched = 0;
  const priced = [];
  for (let i = 1; i < m.length; i++) {
    const row = m[i] || [];
    const sku = (row[0] || '').toString().trim();
    const size = (row[1] || '').toString().trim();
    const newPrice = parseMoney(row[3]);
    const unit = (row[5] || 'EA').toString().trim();
    const itemDesc = (row[6] || '').toString().trim();
    const detailed = (row[9] || '').toString().trim();
    if (!sku) { skippedNoSku++; continue; }
    if (newPrice == null) { skippedNoPrice++; continue; }

    const name = itemDesc || sku;
    const description = [size, detailed].filter(Boolean).join(' | ') || null;
    const productId = await getOrCreateProduct(sku, name, unit, description);
    if (!productId) { skippedNoPrice++; continue; }
    productsTouched++;

    const r = await upsertBuilderPricing(builderId, productId, newPrice);
    if (r === 'ok') { wrote++; priced.push({ sku, name, price: newPrice }); }
  }
  return { wrote, skippedNoPrice, skippedNoSku, productsTouched, priced };
}

// ─────────────────────────────────────────────────────────────────────────
// PLAN BOM — 1.5.26 PRICING CHANGE WORKSHEET (CHAMBORD + VIANDEN)
// ─────────────────────────────────────────────────────────────────────────

function parsePlanWorksheet(sheet) {
  // Column semantics (verified against CHAMBORD row 3: qty=2 @ unit=700 → ext=1400):
  //   0  CATEGORY (EXTERIOR, INT DOOR, TRIM, MGMNT FEE)
  //   1  OLD PRICE          (old unit price)
  //   2  <date header>      — NEW UNIT PRICE (12/30/2025 take-off)
  //   3  0.42 header        — 40-42% scaled unit (legacy calc)
  //   4  OLD QTY
  //   5  QTY                (current takeoff qty)
  //   6  OLD PRICE TOTAL    (old_unit × old_qty)
  //   7  OLD PRICE NEW TAKE-OFF (old_unit × new_qty)
  //   8  40-42              — NEW EXTENDED (new_unit × qty)
  //   9  0.42 scaled        (legacy)
  //   10 PRODUCT            (item name)
  //   11 DESCRIPTION        (wall type, e.g. 2X4/2X6)
  //
  // Footer rows: "TOATAL"/"TOTAL" (col 8 = plan base total),
  //              "DIFFERENCE", "% CHANGE".
  const m = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const lines = [];
  let order = 0;
  let baseTotal = null;
  let intDoorCount = 0;
  let extDoorCount = 0;
  for (let i = 1; i < m.length; i++) {
    const row = m[i] || [];
    const category = (row[0] || '').toString().trim();
    if (!category) continue;
    // Footer rows
    if (/^(TOTAL|TOATAL|DIFFERENCE|% CHANGE)/i.test(category)) {
      if (/^(TOTAL|TOATAL)/i.test(category)) {
        // col 8 = NEW EXTENDED total across all items = plan base package price
        const t = parseMoney(row[8]);
        if (t) baseTotal = t;
      }
      continue;
    }
    const product = (row[10] || '').toString().trim();
    const description = (row[11] || '').toString().trim();
    const qtyRaw = row[5];
    const qty = qtyRaw == null ? null : Number(qtyRaw);
    // MGMNT FEE has no qty — keep it as a fee line with qty=1 for reporting.
    const isFee = /MGMNT|FEE/i.test(category);
    const effQty = Number.isFinite(qty) ? qty : (isFee ? 1 : null);
    if (effQty == null) continue;
    const unitPrice = parseMoney(row[2]); // NEW UNIT PRICE
    const extended  = parseMoney(row[8]); // NEW EXTENDED
    // For fee rows without a unit price, fall back to extended as the "unit".
    const effUnit = unitPrice != null ? unitPrice
                    : (isFee ? parseMoney(row[6]) : null);
    const itemName = product || category;
    if (!itemName) continue;

    if (/^INT\s*DOOR/i.test(category) && Number.isFinite(qty)) intDoorCount += qty;
    else if (/^EXTERIOR/i.test(category) && Number.isFinite(qty)) extDoorCount += qty;

    order += 1;
    lines.push({
      section: category,
      lineOrder: order,
      itemName,
      description: description || null,
      quantity: effQty,
      unit: 'EA',
      unitPrice: effUnit,
      extended,
    });
  }
  return { lines, baseTotal, intDoorCount, extDoorCount };
}

async function writePlanBom(planId, lines) {
  if (!COMMIT) return lines.length;
  await sql`
    DELETE FROM "TollBrothersPlanBom"
    WHERE "planId" = ${planId} AND "revisionTag" = ${BOM_REVISION_TAG}
  `;
  let n = 0;
  for (const ln of lines) {
    await sql`
      INSERT INTO "TollBrothersPlanBom"
        ("id","planId","section","lineOrder","itemName","description","quantity",
         "unit","unitPrice","extended","revisionTag","createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${planId}, ${ln.section}, ${ln.lineOrder},
         ${ln.itemName}, ${ln.description}, ${ln.quantity},
         ${ln.unit}, ${ln.unitPrice}, ${ln.extended}, ${BOM_REVISION_TAG},
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    n++;
  }
  return n;
}

async function updateFloorPlan(planId, baseTotal, intCount, extCount) {
  if (!COMMIT) return;
  await sql`
    UPDATE "CommunityFloorPlan" SET
      "basePackagePrice"  = COALESCE(${baseTotal}, "basePackagePrice"),
      "interiorDoorCount" = COALESCE(${Math.round(intCount) || null}, "interiorDoorCount"),
      "exteriorDoorCount" = COALESCE(${Math.round(extCount) || null}, "exteriorDoorCount"),
      "updatedAt"         = CURRENT_TIMESTAMP
    WHERE "id" = ${planId}
  `;
}

// ─────────────────────────────────────────────────────────────────────────
// CONTACTS — seed primary owner from org-memory (no contact file provided)
// ─────────────────────────────────────────────────────────────────────────

async function seedContacts(builderId) {
  // Per CLAUDE.md + memory/customers/toll-brothers.md: Brittney Werner owns
  // Toll Brothers (124+ active jobs). She's internal at Abel, but seeding her
  // as the internal account-owner contact so the Toll record has a primary.
  const contacts = [
    {
      firstName: 'Brittney',
      lastName: 'Werner',
      email: null,
      phone: null,
      title: 'Project Manager (Abel — Toll account owner)',
      role: null,
      isPrimary: true,
      notes: 'Internal Abel PM. Former Pulte Vendor Coordinator. Owns Toll Brothers (~124 active jobs).',
    },
  ];
  let wrote = 0, skipped = 0;
  for (const c of contacts) {
    // Dedupe by (builderId, firstName, lastName)
    const ex = await sql`
      SELECT "id" FROM "BuilderContact"
      WHERE "builderId" = ${builderId}
        AND LOWER("firstName") = ${c.firstName.toLowerCase()}
        AND LOWER("lastName")  = ${c.lastName.toLowerCase()}
      LIMIT 1
    `;
    if (ex[0]) { skipped++; continue; }
    if (!COMMIT) { wrote++; continue; }
    await sql`
      INSERT INTO "BuilderContact"
        ("id","builderId","firstName","lastName","email","phone","title","role",
         "isPrimary","receivesPO","receivesInvoice","notes","active",
         "createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${builderId}, ${c.firstName}, ${c.lastName},
         ${c.email}, ${c.phone}, ${c.title}, ${c.role}, ${c.isPrimary},
         FALSE, FALSE, ${c.notes}, TRUE,
         CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    wrote++;
  }
  return { wrote, skipped };
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  bar(`INGEST TOLL BROTHERS ${COMMIT ? '[COMMIT]' : '[DRY-RUN]'}`);
  console.log(`Pricing revision tag: ${REVISION_TAG}`);
  console.log(`Pricing effective:    ${EFFECTIVE_DATE}`);
  console.log(`BoM revision tag:     ${BOM_REVISION_TAG}`);

  await ensureSchema();

  const builder = await getTollBrothers();
  console.log(`\nBuilder: ${builder.companyName} (${builder.id})`);

  // Pre-count
  const preBp = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builder.id}
  `;
  const preBc = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderContact" WHERE "builderId" = ${builder.id}
  `;

  // 1. Pricing — bid sheet 11.10.2025
  bar('Bid Sheet 11.10.2025 → BuilderPricing');
  const pricing = await ingestBidSheet(builder.id);
  console.log(`   products touched:    ${pricing.productsTouched}`);
  console.log(`   pricing upserts:     ${pricing.wrote}`);
  console.log(`   skipped no-sku:      ${pricing.skippedNoSku}`);
  console.log(`   skipped no-price:    ${pricing.skippedNoPrice}`);

  // 2. Plan BoM — CHAMBORD + VIANDEN (Creek Meadows)
  bar('Pricing Change Worksheet → TollBrothersPlanBom');
  const creekMeadows = await getCommunity(builder.id, 'Creek Meadows');
  if (!creekMeadows) {
    console.warn('   Creek Meadows community not found — skipping plan BoM');
  } else {
    console.log(`   Community: Creek Meadows (${creekMeadows.id})`);
    const fp = path.join(ABEL_FOLDER, 'Toll Brothers', '1.5.26 PRICING CHANGE WORKSHEET.xlsx');
    if (!fs.existsSync(fp)) throw new Error('Pricing change worksheet missing: ' + fp);
    const wb = XLSX.readFile(fp);
    const planSheets = ['CHAMBORD', 'VIANDEN'];
    const sampleBom = [];
    let bomRows = 0, plansTouched = 0;
    for (const sheetName of planSheets) {
      if (!wb.Sheets[sheetName]) { console.warn(`   sheet ${sheetName} missing`); continue; }
      const planRow = await getPlanByName(creekMeadows.id, sheetName);
      if (!planRow) { console.warn(`   plan ${sheetName} not found in Creek Meadows`); continue; }
      const parsed = parsePlanWorksheet(wb.Sheets[sheetName]);
      const n = await writePlanBom(planRow.id, parsed.lines);
      await updateFloorPlan(planRow.id, parsed.baseTotal, parsed.intDoorCount, parsed.extDoorCount);
      bomRows += n;
      plansTouched++;
      console.log(`   plan ${sheetName}: ${parsed.lines.length} BoM lines · base $${parsed.baseTotal?.toFixed(2) ?? '?'} · int ${Math.round(parsed.intDoorCount)} · ext ${Math.round(parsed.extDoorCount)}`);
      sampleBom.push({
        plan: sheetName,
        baseTotal: parsed.baseTotal,
        lines: parsed.lines.length,
        first5: parsed.lines.slice(0, 5).map(l =>
          `${l.itemName} x${l.quantity} @ $${l.unitPrice?.toFixed(2) ?? '?'} [${l.section}]`),
      });
    }
    console.log(`   plans touched:     ${plansTouched}`);
    console.log(`   total BoM rows:    ${bomRows}`);
    // Stash for summary
    main._sampleBom = sampleBom;
    main._bomRows = bomRows;
  }

  // 3. Contacts
  bar('Contacts → BuilderContact');
  const contacts = await seedContacts(builder.id);
  console.log(`   contacts inserted: ${contacts.wrote}`);
  console.log(`   contacts skipped:  ${contacts.skipped}`);

  // Post-count
  const postBp = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builder.id}
  `;
  const postBc = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderContact" WHERE "builderId" = ${builder.id}
  `;
  const postBom = COMMIT ? await sql`
    SELECT COUNT(*)::int AS n FROM "TollBrothersPlanBom" WHERE "revisionTag" = ${BOM_REVISION_TAG}
  ` : [{ n: main._bomRows || 0 }];

  bar('SUMMARY');
  console.log(`Pricing upserts:                 ${pricing.wrote}`);
  console.log(`BoM rows (all Toll plans):       ${postBom[0].n}`);
  console.log(`Contacts inserted:               ${contacts.wrote}`);
  console.log('');
  console.log(`BuilderPricing (Toll):  ${preBp[0].n}  →  ${postBp[0].n}`);
  console.log(`BuilderContact (Toll):  ${preBc[0].n}  →  ${postBc[0].n}`);
  console.log('');
  if (main._sampleBom?.length) {
    console.log('Sample plan BoM (first 5 lines each):');
    for (const s of main._sampleBom) {
      console.log(`  ${s.plan} — base $${s.baseTotal?.toFixed(2) ?? '?'} · ${s.lines} lines`);
      s.first5.forEach(l => console.log('    - ' + l));
    }
  }
  console.log('');
  console.log('Sample priced SKUs (first 8):');
  pricing.priced.slice(0, 8).forEach(p => console.log(`   ${p.sku}  ${p.name.padEnd(38)}  $${p.price.toFixed(2)}`));
  console.log('');
  console.log(COMMIT ? '[COMMIT] Changes applied.' : '[DRY-RUN] Re-run with --commit to apply.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
