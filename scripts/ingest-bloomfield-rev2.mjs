// Ingest Bloomfield Homes Rev2 plan breakdown + pricing schedule + contacts.
//
// Source files (parent workspace, ../):
//   Bloomfield Homes/Bloomfield_Rev2_Pricing.xlsx          (5 plans × 3 tiers + Cost Inputs)
//   Bloomfield Homes/SEND TO BLOOMFIELD/
//     Bloomfield_Master_Pricebook_Abel.xlsx                (turnkey options + add-ons)
//   Bloomfield Homes/Abel_Bloomfield_Presentation.html     (embedded plan BoM JSON: 5 plans,
//                                                           extDoors/intDoors/trim w/ qty)
//
// Writes:
//   CommunityFloorPlan      — 5 plans under Bloomfield Homes → "Bloomfield Homes DFW"
//                              (Carolina, Cypress, Hawthorne, Magnolia, Bayberry/Dewberry II)
//                              fills sqFootage, door counts, basePackagePrice (CLASSIC tier)
//   BloomfieldPlanBom       — per-plan BoM rows parsed from Rev2 workbook (mirrors Brookfield)
//   Product                 — upserts BLOOM-<hash> SKUs for items not in core catalog
//   BuilderPricing          — customPrice = unit cost × 1.37 markup, revisionTag='Rev2-April-2026'
//   BuilderContact          — Avery Cadena (Partnership Director) + fallback primary
//
// Idempotent. Default is dry-run; pass --commit to apply.
//
//   node scripts/ingest-bloomfield-rev2.mjs                # dry run
//   node scripts/ingest-bloomfield-rev2.mjs --commit       # apply

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
const BLOOMFIELD_DIR = path.join(ABEL_FOLDER, 'Bloomfield Homes');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const COMMIT = process.argv.includes('--commit');
const REVISION_TAG = 'Rev2-April-2026';
const EFFECTIVE_DATE = '2026-04-15';
const MATERIAL_MARKUP = 1.37; // 37% per Rev2 Cost Inputs r48

const sql = neon(process.env.DATABASE_URL);

function bar(t) {
  console.log('\n' + '='.repeat(64));
  console.log('  ' + t);
  console.log('='.repeat(64));
}

function parseMoney(v) {
  if (v == null || v === '' || v === 'TBD') return 0;
  if (typeof v === 'number') return v;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

function bloomSku(category, item) {
  const key = [category, item].join('|').toUpperCase();
  const hash = crypto.createHash('md5').update(key).digest('hex').slice(0, 10).toUpperCase();
  return `BLOOM-${hash}`;
}

async function ensureSchema() {
  // BuilderPricing revision columns (same as Brookfield flow).
  await sql`ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "revisionTag" TEXT`;
  await sql`ALTER TABLE "BuilderPricing" ADD COLUMN IF NOT EXISTS "effectiveDate" DATE`;

  // Per-plan BoM table — mirrors BrookfieldPlanBom shape.
  await sql`
    CREATE TABLE IF NOT EXISTS "BloomfieldPlanBom" (
      "id"            TEXT PRIMARY KEY,
      "planId"        TEXT NOT NULL,
      "section"       TEXT,
      "tier"          TEXT,
      "lineOrder"     INTEGER NOT NULL,
      "itemName"      TEXT NOT NULL,
      "quantity"      NUMERIC NOT NULL,
      "unit"          TEXT,
      "unitPrice"     NUMERIC,
      "material"      NUMERIC,
      "margin"        NUMERIC,
      "labor"         NUMERIC,
      "extended"      NUMERIC,
      "location"      TEXT,
      "revisionTag"   TEXT NOT NULL,
      "productId"     TEXT,
      "createdAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_bfldbom_plan" ON "BloomfieldPlanBom"("planId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_bfldbom_rev"  ON "BloomfieldPlanBom"("revisionTag")`;
}

async function getBloomfield() {
  const r = await sql`
    SELECT "id", "companyName" FROM "Builder"
    WHERE LOWER("companyName") LIKE '%bloomfield%' LIMIT 1
  `;
  if (!r[0]) throw new Error('Bloomfield builder not found');
  return r[0];
}

async function getOrCreateCommunity(builderId) {
  let r = await sql`
    SELECT "id", "name" FROM "Community"
    WHERE "builderId" = ${builderId}
      AND LOWER("name") LIKE '%bloomfield%dfw%' LIMIT 1
  `;
  if (r[0]) return r[0];
  r = await sql`
    SELECT "id", "name" FROM "Community" WHERE "builderId" = ${builderId} LIMIT 1
  `;
  if (r[0]) return r[0];
  if (!COMMIT) return { id: '(DRY-RUN:new-community)', name: 'Bloomfield Homes DFW' };
  const ins = await sql`
    INSERT INTO "Community" ("id","builderId","name","status","createdAt","updatedAt")
    VALUES (gen_random_uuid()::text, ${builderId}, 'Bloomfield Homes DFW', 'ACTIVE',
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING "id","name"
  `;
  return ins[0];
}

// ─────────────────────────────────────────────────────────────────────────
// PLAN BREAKDOWN  (Bloomfield_Rev2_Pricing.xlsx)
// ─────────────────────────────────────────────────────────────────────────

// Plan-name → canonical builder plan name mapping.
// Dewberry II is listed as "Bayberry" in Rev2 and "Bayberry II" on bloomfieldhomes.com,
// but the canonical CommunityFloorPlan row in Aegis is "Dewberry".
const PLAN_SHEETS = [
  { sheet: 'Carolina',  planName: 'Carolina'  },
  { sheet: 'Cypress',   planName: 'Cypress'   },
  { sheet: 'Hawthorne', planName: 'Hawthorne' },
  { sheet: 'Magnolia',  planName: 'Magnolia'  },
  { sheet: 'Bayberry',  planName: 'Dewberry'  }, // == Dewberry II / Bayberry II
];

const SECTION_ALIASES = {
  'EXTERIOR DOORS':     'EXTERIOR DOORS',
  'INTERIOR DOORS':     'INTERIOR DOORS',
  'TRIM & MILLWORK':    'TRIM & MILLWORK',
  'HARDWARE':           'HARDWARE',
  'STAIR':              'STAIR',
  'SHELVING & CLOSET':  'SHELVING & CLOSET',
  'GRAND TOTALS':       null,
};

function normSection(s) {
  if (!s) return null;
  const up = String(s).trim().toUpperCase();
  for (const k of Object.keys(SECTION_ALIASES)) {
    if (up === k) return SECTION_ALIASES[k];
  }
  return null;
}

function parseTierMarker(s) {
  if (!s) return null;
  const m = String(s).match(/^---\s*(.+?)\s*---$/);
  if (!m) return null;
  const up = m[1].toUpperCase();
  if (up.includes('ELEMENT')) return 'ELEMENT';
  if (up.includes('CLASSIC') || up.includes('SIGNATURE') || up.includes('DAYLON')) return 'CLASSIC';
  return null;
}

function parsePlanSheet(sheet, planName) {
  const m = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null });
  const metaRow = String(m[1]?.[0] || '');
  const sqFtMatch = metaRow.match(/Sq\s*Ft:\s*([\d,]+)/i);
  const sqFt = sqFtMatch ? parseInt(sqFtMatch[1].replace(/,/g, ''), 10) : null;
  const intDoorsMatch = metaRow.match(/Interior\s*Doors:\s*(\d+)/i);
  const intDoors = intDoorsMatch ? parseInt(intDoorsMatch[1], 10) : null;

  // Grand totals from rows 3/4/5 (col 7)
  const classicTotal = typeof m[3]?.[7] === 'number' ? m[3][7] : null;
  const signatureTotal = typeof m[4]?.[7] === 'number' ? m[4][7] : null;
  const elementTotal = typeof m[5]?.[7] === 'number' ? m[5][7] : null;

  const lines = [];
  let section = null;
  let tier = null; // CLASSIC | ELEMENT — applies to trim & hardware sub-sections
  let order = 0;
  let extDoorQty = 0;

  for (let i = 6; i < m.length; i++) {
    const row = m[i] || [];
    const a = row[0];
    if (a == null || a === '') continue;
    const astr = String(a).trim();

    // Section header like "EXTERIOR DOORS"
    const maybeSection = normSection(astr);
    if (maybeSection) {
      section = maybeSection;
      tier = null;
      continue;
    }
    // Tier marker "--- CLASSIC ---" / "--- ELEMENT ---" / "--- CLASSIC / SIGNATURE (Daylon) ---"
    const tierMark = parseTierMarker(astr);
    if (tierMark) { tier = tierMark; continue; }

    // Skip the GRAND TOTALS footer block once reached.
    if (/GRAND TOTALS/i.test(astr)) break;

    // Skip column-header rows ("Item", "$/LF", etc.)
    if (astr === 'Item') continue;

    // Skip "...TOTAL" summary rows (e.g. "EXT DOORS TOTAL", "CLASSIC TOTAL")
    if (/\bTOTAL\b/i.test(astr) && row.slice(1, 7).every(x => x == null)) continue;
    if (/\bTOTAL\b/i.test(astr)) continue;

    // Columns per section:
    //   EXT/INT DOORS: [Item, UnitCost, Qty, Material, Margin, Labor, Total]
    //   TRIM:          [Item, $/LF,    LF,  Material, Margin, null,   Total]
    //   HARDWARE:      [Item, UnitCost, Qty, Material, Margin, null,   Total]
    //   STAIR:         [Item, UnitCost, Qty, Material, null,   null,   null]
    //   SHELVING:      [Item, UnitCost, Qty, Material, Margin, null,   null]
    const unitCost = typeof row[1] === 'number' ? row[1] : null;
    const qty = typeof row[2] === 'number' ? row[2] : null;
    const material = typeof row[3] === 'number' ? row[3] : null;
    const margin = typeof row[4] === 'number' ? row[4] : null;
    const labor = typeof row[5] === 'number' ? row[5] : null;
    const extended = typeof row[6] === 'number' ? row[6] : null;

    // Pure labor rows ("Ext Door Labor", "D&T Labor", "Attic Labor")
    if (unitCost == null && qty == null && material == null && labor != null) {
      order += 1;
      lines.push({
        section, tier,
        lineOrder: order,
        itemName: astr,
        quantity: 1,
        unit: 'LOT',
        unitPrice: labor,
        material: null, margin: null, labor,
        extended: labor,
        location: null,
      });
      continue;
    }

    // Valid BoM line needs at least (unit cost OR material) AND a quantity.
    if (qty == null) continue;
    if (unitCost == null && material == null) continue;

    // Detect trim ("$/LF") vs discrete (EA). TRIM section has unitPrice < 2 typically.
    const unit = (section === 'TRIM & MILLWORK') ? 'LF'
               : (section === 'SHELVING & CLOSET') ? 'EA'
               : (section === 'STAIR') ? (astr.includes('Rail Package') ? 'LOT' : 'EA')
               : 'EA';

    order += 1;
    lines.push({
      section, tier,
      lineOrder: order,
      itemName: astr,
      quantity: qty,
      unit,
      unitPrice: unitCost,
      material, margin, labor: null,
      extended: extended != null ? extended : (material != null ? material + (margin || 0) : null),
      location: null,
    });

    // Track exterior door count (discrete door units, not sill pans / labor)
    if (section === 'EXTERIOR DOORS' && /door|panel|lite|garage|attic stair/i.test(astr)
        && !/labor|sill/i.test(astr)) {
      extDoorQty += Math.abs(qty);
    }
  }

  return {
    planName, sqFt, intDoors,
    classicTotal, signatureTotal, elementTotal,
    extDoorCount: Math.round(extDoorQty) || null,
    lines,
  };
}

async function upsertFloorPlan({ communityId, planName, sqFt, intDoors, extDoors, baseTotal }) {
  if (!COMMIT) return { id: `(DRY:${planName})`, created: false };
  // Prefer existing match on (communityId, name) — 24 plans already seeded.
  const existing = await sql`
    SELECT "id", "name" FROM "CommunityFloorPlan"
    WHERE "communityId" = ${communityId} AND LOWER("name") = LOWER(${planName})
    LIMIT 1
  `;
  if (existing[0]) {
    await sql`
      UPDATE "CommunityFloorPlan" SET
        "sqFootage"         = COALESCE(${sqFt}, "sqFootage"),
        "interiorDoorCount" = COALESCE(${intDoors}, "interiorDoorCount"),
        "exteriorDoorCount" = COALESCE(${extDoors}, "exteriorDoorCount"),
        "basePackagePrice"  = COALESCE(${baseTotal}, "basePackagePrice"),
        "updatedAt"         = CURRENT_TIMESTAMP
      WHERE "id" = ${existing[0].id}
    `;
    return { id: existing[0].id, created: false };
  }
  const ins = await sql`
    INSERT INTO "CommunityFloorPlan"
      ("id","communityId","name","sqFootage","interiorDoorCount","exteriorDoorCount",
       "basePackagePrice","active","createdAt","updatedAt")
    VALUES (gen_random_uuid()::text, ${communityId}, ${planName},
            ${sqFt}, ${intDoors}, ${extDoors}, ${baseTotal}, TRUE,
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    RETURNING "id"
  `;
  return { id: ins[0].id, created: true };
}

async function writePlanBom(planId, lines) {
  if (!COMMIT) return lines.length;
  await sql`
    DELETE FROM "BloomfieldPlanBom"
    WHERE "planId" = ${planId} AND "revisionTag" = ${REVISION_TAG}
  `;
  let n = 0;
  for (const ln of lines) {
    await sql`
      INSERT INTO "BloomfieldPlanBom"
        ("id","planId","section","tier","lineOrder","itemName","quantity","unit","unitPrice",
         "material","margin","labor","extended","location","revisionTag","createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${planId}, ${ln.section}, ${ln.tier}, ${ln.lineOrder},
         ${ln.itemName}, ${ln.quantity}, ${ln.unit}, ${ln.unitPrice},
         ${ln.material}, ${ln.margin}, ${ln.labor}, ${ln.extended}, ${ln.location},
         ${REVISION_TAG}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    n++;
  }
  return n;
}

// ─────────────────────────────────────────────────────────────────────────
// PRICING SCHEDULE  (Cost Inputs sheet → BuilderPricing)
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

async function ingestPricingSchedule(builderId) {
  const fp = path.join(BLOOMFIELD_DIR, 'Bloomfield_Rev2_Pricing.xlsx');
  if (!fs.existsSync(fp)) throw new Error('Rev2 pricing file missing: ' + fp);
  const wb = XLSX.readFile(fp);
  const ws = wb.Sheets['Cost Inputs'];
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });

  let wrote = 0, skipped = 0, productsTouched = 0;
  const unmatched = [];

  // Header at row 3: [Category, Item, Unit, Cost, Source, Status]
  for (let i = 4; i < m.length; i++) {
    const row = m[i] || [];
    const category = (row[0] || '').toString().trim();
    const item = (row[1] || '').toString().trim();
    const unit = (row[2] || '').toString().trim();
    const costRaw = row[3];
    if (!category || !item) { skipped++; continue; }

    // "Material Markup" / "D&T Labor $/SF" rows are meta, not products.
    if (/markup|labor\s*\$\/sf/i.test(item) || category === 'MARGIN' || category === 'LABOR') continue;

    // TBD / non-numeric costs are skipped (Monza / Basic bath hw pending).
    if (costRaw == null || costRaw === '' || costRaw === 'TBD') { skipped++; continue; }
    const cost = parseMoney(costRaw);
    if (!cost || cost <= 0) { skipped++; continue; }

    const price = +(cost * MATERIAL_MARKUP).toFixed(2);
    const sku = bloomSku(category, item);
    const productId = await getOrCreateProduct(sku, item, category, unit || 'EA');
    if (!productId) { skipped++; unmatched.push(sku); continue; }
    productsTouched++;

    const r = await upsertBuilderPricing(builderId, productId, price);
    if (r === 'ok') wrote++;
    else { skipped++; if (unmatched.length < 10) unmatched.push(sku + ' ' + r); }
  }

  return { wrote, skipped, productsTouched, unmatched };
}

// ─────────────────────────────────────────────────────────────────────────
// CONTACTS  (BuilderContact)
// ─────────────────────────────────────────────────────────────────────────

const BLOOMFIELD_CONTACTS = [
  {
    firstName:  'Avery',
    lastName:   'Cadena',
    email:      'avery@bloomfieldhomes.net',
    phone:      null,
    title:      'Specs/Purchasing',
    role:       'PURCHASING',
    isPrimary:  true,
    receivesPO: true,
    notes:      'Primary purchasing contact. Rev2 specs (April 2026) confirmed via Avery. '
              + 'Classic→Daylon + Sure-Loc Monza; Element→Delta + Sure-Loc Basic + B623 base.',
  },
  {
    firstName:  'Cathleen',
    lastName:   '',
    email:      'cathleen@bloomfieldhomes.net',
    phone:      null,
    title:      'Decision maker',
    role:       'OTHER',
    isPrimary:  false,
    notes:      'Decision maker. Part of Bloomfield purchasing approval chain.',
  },
];

async function upsertContact(builderId, c) {
  if (!COMMIT) {
    // Mirror what --commit would do so the dry-run summary is realistic.
    const existing = await sql`
      SELECT "id" FROM "BuilderContact"
      WHERE "builderId" = ${builderId}
        AND LOWER("firstName") = LOWER(${c.firstName})
        AND LOWER("lastName")  = LOWER(${c.lastName})
      LIMIT 1
    `;
    return existing[0] ? 'updated' : 'created';
  }
  try {
    // Idempotency key: (builderId, firstName, lastName) — schema has no unique,
    // so match-or-insert manually.
    const existing = await sql`
      SELECT "id" FROM "BuilderContact"
      WHERE "builderId" = ${builderId}
        AND LOWER("firstName") = LOWER(${c.firstName})
        AND LOWER("lastName")  = LOWER(${c.lastName})
      LIMIT 1
    `;
    if (existing[0]) {
      await sql`
        UPDATE "BuilderContact" SET
          "email"           = COALESCE(${c.email}, "email"),
          "phone"           = COALESCE(${c.phone}, "phone"),
          "title"           = ${c.title},
          "role"            = ${c.role}::"ContactRole",
          "isPrimary"       = ${c.isPrimary},
          "receivesPO"      = ${c.receivesPO || false},
          "receivesInvoice" = ${c.receivesInvoice || false},
          "notes"           = ${c.notes},
          "active"          = TRUE,
          "updatedAt"       = CURRENT_TIMESTAMP
        WHERE "id" = ${existing[0].id}
      `;
      return 'updated';
    }
    await sql`
      INSERT INTO "BuilderContact"
        ("id","builderId","firstName","lastName","email","phone","title","role",
         "isPrimary","receivesPO","receivesInvoice","notes","active","createdAt","updatedAt")
      VALUES
        (gen_random_uuid()::text, ${builderId}, ${c.firstName}, ${c.lastName},
         ${c.email}, ${c.phone}, ${c.title}, ${c.role}::"ContactRole",
         ${c.isPrimary}, ${c.receivesPO || false}, ${c.receivesInvoice || false},
         ${c.notes}, TRUE, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `;
    return 'created';
  } catch (e) {
    return 'fail: ' + String(e.message).slice(0, 140);
  }
}

async function ingestContacts(builderId) {
  let created = 0, updated = 0, failed = 0;
  for (const c of BLOOMFIELD_CONTACTS) {
    const r = await upsertContact(builderId, c);
    if (r === 'created') created++;
    else if (r === 'updated') updated++;
    else { failed++; console.warn('   contact fail:', r); }
  }
  return { created, updated, failed };
}

// ─────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────

async function main() {
  bar(`INGEST BLOOMFIELD REV2 ${COMMIT ? '[COMMIT]' : '[DRY-RUN]'}`);
  console.log(`Revision tag:   ${REVISION_TAG}`);
  console.log(`Effective date: ${EFFECTIVE_DATE}`);
  console.log(`Material markup: ${MATERIAL_MARKUP} (from Rev2 Cost Inputs)`);

  await ensureSchema();

  const builder = await getBloomfield();
  console.log(`\nBuilder: ${builder.companyName} (${builder.id})`);

  const community = await getOrCreateCommunity(builder.id);
  console.log(`Community: ${community.name} (${community.id})`);

  // Pre-counts
  const preBp = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builder.id}
  `;
  const prePlans = await sql`
    SELECT COUNT(*)::int AS n FROM "CommunityFloorPlan" WHERE "communityId" = ${community.id}
  `;
  const preBc = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderContact" WHERE "builderId" = ${builder.id}
  `;
  let preBom = 0;
  try {
    const r = await sql`SELECT COUNT(*)::int AS n FROM "BloomfieldPlanBom" WHERE "revisionTag" = ${REVISION_TAG}`;
    preBom = r[0].n;
  } catch {}

  // 1. Plan breakdowns
  bar('Plan Breakdown Rev2 → CommunityFloorPlan + BloomfieldPlanBom');
  const fpPlan = path.join(BLOOMFIELD_DIR, 'Bloomfield_Rev2_Pricing.xlsx');
  const wbPlan = XLSX.readFile(fpPlan);
  let plansSeeded = 0, plansCreated = 0, bomRows = 0;
  const sampleBom = [];
  for (const cfg of PLAN_SHEETS) {
    const sheet = wbPlan.Sheets[cfg.sheet];
    if (!sheet) { console.warn(`   skip: sheet "${cfg.sheet}" not found`); continue; }
    const parsed = parsePlanSheet(sheet, cfg.planName);

    const { id: planId, created } = await upsertFloorPlan({
      communityId:    community.id,
      planName:       cfg.planName,
      sqFt:           parsed.sqFt,
      intDoors:       parsed.intDoors,
      extDoors:       parsed.extDoorCount,
      baseTotal:      parsed.classicTotal,
    });
    plansSeeded++;
    if (created) plansCreated++;
    const n = await writePlanBom(planId, parsed.lines);
    bomRows += n;

    if (sampleBom.length < 3) {
      sampleBom.push({
        plan:        cfg.planName,
        sqFt:        parsed.sqFt,
        intDoors:    parsed.intDoors,
        extDoors:    parsed.extDoorCount,
        classic:     parsed.classicTotal,
        element:     parsed.elementTotal,
        lines:       parsed.lines.length,
        first5:      parsed.lines.slice(0, 5).map(l =>
                       `${l.itemName} × ${l.quantity} @ $${l.unitPrice} [${l.section}${l.tier ? '/' + l.tier : ''}]`),
      });
    }
    console.log(`   plan ${cfg.planName.padEnd(10)}: ${String(parsed.lines.length).padStart(3)} BoM lines · `
              + `${parsed.sqFt || '?'} sqft · ${parsed.intDoors || '?'} int doors · `
              + `CLASSIC $${parsed.classicTotal?.toFixed(2) ?? '?'} · ELEMENT $${parsed.elementTotal?.toFixed(2) ?? '?'}`);
  }

  // 2. Pricing schedule
  bar('Cost Inputs Rev2 → Product + BuilderPricing');
  const pricing = await ingestPricingSchedule(builder.id);
  console.log(`   products touched:  ${pricing.productsTouched}`);
  console.log(`   pricing upserts:   ${pricing.wrote}`);
  console.log(`   skipped/unmatched: ${pricing.skipped}`);
  if (pricing.unmatched.length) {
    console.log(`   unmatched SKUs (first 10): ${pricing.unmatched.slice(0, 10).join(', ')}`);
  }

  // 3. Contacts
  bar('Contacts → BuilderContact');
  const contacts = await ingestContacts(builder.id);
  console.log(`   contacts created: ${contacts.created}`);
  console.log(`   contacts updated: ${contacts.updated}`);
  console.log(`   contacts failed:  ${contacts.failed}`);

  // Post-counts
  const postBp = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderPricing" WHERE "builderId" = ${builder.id}
  `;
  const postPlans = await sql`
    SELECT COUNT(*)::int AS n FROM "CommunityFloorPlan" WHERE "communityId" = ${community.id}
  `;
  const postBc = await sql`
    SELECT COUNT(*)::int AS n FROM "BuilderContact" WHERE "builderId" = ${builder.id}
  `;
  let postBom = 0;
  try {
    const r = await sql`SELECT COUNT(*)::int AS n FROM "BloomfieldPlanBom" WHERE "revisionTag" = ${REVISION_TAG}`;
    postBom = r[0].n;
  } catch {}

  bar('SUMMARY');
  console.log(`Plans touched:                 ${plansSeeded} (new: ${plansCreated})`);
  console.log(`BoM rows written:              ${bomRows}`);
  console.log(`Pricing rows upserted:         ${pricing.wrote}`);
  console.log(`Contacts upserted:             ${contacts.created + contacts.updated}`);
  console.log(`Skipped unmatched cost rows:   ${pricing.skipped}`);
  console.log('');
  console.log(`CommunityFloorPlan (Bloomfield DFW):   ${prePlans[0].n}  →  ${postPlans[0].n}`);
  console.log(`BloomfieldPlanBom (Rev2):              ${preBom}  →  ${postBom}`);
  console.log(`BuilderPricing (Bloomfield):           ${preBp[0].n}  →  ${postBp[0].n}`);
  console.log(`BuilderContact (Bloomfield):           ${preBc[0].n}  →  ${postBc[0].n}`);
  console.log('');
  console.log('Sample plans (first 3 with first 5 BoM lines each):');
  for (const s of sampleBom) {
    console.log(`  PLAN ${s.plan} — ${s.sqFt} sqft · ${s.intDoors} int / ${s.extDoors} ext doors`);
    console.log(`    CLASSIC $${s.classic?.toFixed(2)} · ELEMENT $${s.element?.toFixed(2)} · ${s.lines} BoM lines`);
    s.first5.forEach(l => console.log('    - ' + l));
  }
  console.log('');
  console.log(COMMIT ? '[COMMIT] Changes applied.' : '[DRY-RUN] Re-run with --commit to apply.');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
