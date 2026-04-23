#!/usr/bin/env node
/**
 * scripts/seed-builder-pricing-from-excel.mjs
 *
 * Expand BuilderPricing by mining builder-specific pricing from the Abel Lumber
 * Excel workbook corpus (OneDrive parent folder).
 *
 * Complementary to scripts/seed-builder-pricing.mjs which sources from brain JSONL.
 * Brain JSONL only yielded 1,641 pairs / 11 builders → BuilderPricing = 1,891.
 * Plan target ~8,000. Rich per-builder data lives in Excel:
 *   - Abel_Pricing_Corrections.xlsx               ("All Corrections": 310 explicit rows)
 *   - Abel_Pricing_Corrections.xlsx               ("InFlow Import": wide SKU × builder matrix)
 *   - Abel_Builder_Pricing_Analysis.xlsx          ("Builder Detail": 1,805 rows)
 *   - Abel_Account_Pricing_Rebuild_Q4Q1.xlsx      (per-builder sheets × 3, SKU+Target price)
 *   - Brookfield/Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx ("Pricing Schedule")
 *   - Toll Brothers Pricing Sheet.xlsx            ("Ext. Doors", "Trim Materials" with BC SKUs)
 *
 * Each row contributes a (builderName, sku, price) tuple. We then:
 *   1. Fuzzy-match builder name → Builder.companyName (case-insensitive token overlap)
 *      using the same strategy as seed-builder-pricing.mjs.
 *   2. Lookup Product by sku (upper-cased, trimmed).
 *   3. Upsert BuilderPricing via raw SQL
 *      ON CONFLICT (builderId, productId) DO UPDATE SET customPrice, margin, updatedAt.
 *
 * Usage:
 *   node scripts/seed-builder-pricing-from-excel.mjs            # DRY RUN
 *   node scripts/seed-builder-pricing-from-excel.mjs --commit   # apply
 */

import XLSX from 'xlsx';
import { readFileSync, existsSync } from 'fs';
import { join, dirname, basename } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const ABEL_FOLDER = join(ROOT, '..');

// ── env / DB ────────────────────────────────────────────────────────
const envPath = join(ROOT, '.env');
const envContent = readFileSync(envPath, 'utf-8');
const DB_URL =
  envContent.match(/^DATABASE_URL="([^"]+)"/m)?.[1] ||
  envContent.match(/^DATABASE_URL=([^\s]+)/m)?.[1];
if (!DB_URL) {
  console.error('No DATABASE_URL in .env');
  process.exit(1);
}

const DRY_RUN = !process.argv.includes('--commit');
const { neon } = await import('@neondatabase/serverless');
const sql = neon(DB_URL);

// ── builder-name matching (copied/tuned from seed-builder-pricing.mjs) ──
const STOP_WORDS = new Set([
  'homes', 'home', 'dfw', 'inc', 'inc.', 'llc', 'co', 'co.', 'corp', 'corp.',
  'the', 'and', '&', 'builders', 'builder', 'custom', 'doors', 'door',
  'trim', 'construction', 'group', 'company', 'development', 'developement',
  'properties', 'property', 'contractors', 'contracting', 'of', 'by',
  'a', 'an', 'dallas', 'texas', 'tx', 'residential',
]);
function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenize(raw) {
  return normalize(raw).split(' ').filter(t => t && !STOP_WORDS.has(t));
}
function tokenSet(raw) { return new Set(tokenize(raw)); }
function compressed(raw) { return tokenize(raw).join(''); }

function matchBuilder(name, builders) {
  const srcCompressed = compressed(name);
  const srcTokens = tokenSet(name);
  if (!srcCompressed) return null;
  // 1. exact
  const exact = builders.find(b => b._compressed === srcCompressed);
  if (exact) return { builder: exact, strategy: 'exact' };
  // 2. containment (len >= 3)
  const contained = builders
    .filter(b =>
      b._compressed.length >= 3 &&
      srcCompressed.length >= 3 &&
      (b._compressed.includes(srcCompressed) || srcCompressed.includes(b._compressed)),
    )
    .sort((a, b) => b._compressed.length - a._compressed.length);
  if (contained.length > 0) return { builder: contained[0], strategy: 'containment' };
  // 3. token-overlap >= 2
  const withOverlap = builders
    .map(b => {
      let o = 0;
      for (const t of b._tokens) if (srcTokens.has(t)) o++;
      return { b, o };
    })
    .filter(x => x.o >= 2)
    .sort((a, b) => b.o - a.o);
  if (withOverlap.length > 0) return { builder: withOverlap[0].b, strategy: 'overlap2' };
  // 4. single distinctive token (len >= 5)
  const distinctive = [];
  for (const b of builders) {
    for (const t of b._tokens) {
      if (t.length >= 5 && srcTokens.has(t)) { distinctive.push({ b, t }); break; }
    }
  }
  if (distinctive.length === 1) return { builder: distinctive[0].b, strategy: `distinct:${distinctive[0].t}` };
  if (distinctive.length > 1) {
    distinctive.sort((a, b) => a.b.companyName.length - b.b.companyName.length);
    return { builder: distinctive[0].b, strategy: `distinct-amb:${distinctive[0].t}` };
  }
  return null;
}

// ── price/sku helpers ───────────────────────────────────────────────
function toNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,\s]/g, '').replace(/[()]/g, '-');
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
function cleanSku(v) {
  if (v == null) return null;
  const s = String(v).trim().toUpperCase();
  // Ignore values that obviously aren't Abel BC-SKUs
  if (!/^BC\d{3,7}$/.test(s)) return null;
  return s;
}

// ── parsers ─────────────────────────────────────────────────────────
// Each parser returns tuples: { builderName, sku, price, source }
function parsePricingCorrections(file) {
  const out = [];
  const wb = XLSX.readFile(file);
  // "All Corrections" sheet — explicit columns: Builder, SKU, NEW Builder Price
  const ws1 = wb.Sheets['All Corrections'];
  if (ws1) {
    const m = XLSX.utils.sheet_to_json(ws1, { header: 1, defval: null });
    // Headers on row 1
    const hdr = (m[1] || []).map(h => (h == null ? '' : String(h).trim()));
    const colBuilder = hdr.findIndex(h => /^builder$/i.test(h));
    const colSku = hdr.findIndex(h => /^sku$/i.test(h));
    const colNewPrice = hdr.findIndex(h => /^new\s*builder\s*price$/i.test(h));
    if (colBuilder >= 0 && colSku >= 0 && colNewPrice >= 0) {
      for (let r = 2; r < m.length; r++) {
        const row = m[r] || [];
        const bn = row[colBuilder];
        const sku = cleanSku(row[colSku]);
        const price = toNum(row[colNewPrice]);
        if (!bn || !sku || !price || price <= 0) continue;
        out.push({ builderName: String(bn).trim(), sku, price, source: `${basename(file)}#All Corrections` });
      }
    }
  }
  // "InFlow Import" sheet — wide matrix: SKU in col B, builder names across row 2
  const ws2 = wb.Sheets['InFlow Import'];
  if (ws2) {
    const m = XLSX.utils.sheet_to_json(ws2, { header: 1, defval: null });
    // Header row index 2 (0-indexed)
    const hdr = (m[2] || []).map(h => (h == null ? '' : String(h).trim()));
    const skuCol = hdr.findIndex(h => /^sku$/i.test(h));
    if (skuCol >= 0) {
      const builderCols = [];
      for (let c = 0; c < hdr.length; c++) {
        if (c === skuCol) continue;
        const h = hdr[c];
        if (!h || /^productname$/i.test(h)) continue;
        // heuristic: treat any header after SKU as a builder column
        if (c > skuCol) builderCols.push({ col: c, name: h });
      }
      for (let r = 3; r < m.length; r++) {
        const row = m[r] || [];
        const sku = cleanSku(row[skuCol]);
        if (!sku) continue;
        for (const { col, name } of builderCols) {
          const price = toNum(row[col]);
          if (price == null || price <= 0) continue;
          out.push({ builderName: name, sku, price, source: `${basename(file)}#InFlow Import` });
        }
      }
    }
  }
  return out;
}

function parseBuilderPricingAnalysis(file) {
  const out = [];
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets['Builder Detail'];
  if (!ws) return out;
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const hdr = (m[0] || []).map(h => (h == null ? '' : String(h).trim()));
  const colBuilder = hdr.findIndex(h => /^builder$/i.test(h));
  const colSku = hdr.findIndex(h => /^sku$/i.test(h));
  const colPrice = hdr.findIndex(h => /^builder\s*price$/i.test(h));
  if (colBuilder < 0 || colSku < 0 || colPrice < 0) return out;
  for (let r = 1; r < m.length; r++) {
    const row = m[r] || [];
    const bn = row[colBuilder];
    const sku = cleanSku(row[colSku]);
    const price = toNum(row[colPrice]);
    if (!bn || !sku || price == null || price <= 0) continue;
    out.push({ builderName: String(bn).trim(), sku, price, source: `${basename(file)}#Builder Detail` });
  }
  return out;
}

function parseAccountPricingRebuild(file) {
  const out = [];
  const wb = XLSX.readFile(file);
  // Sheet names: "<BUILDER> Pricing"
  for (const sn of wb.SheetNames) {
    const match = sn.match(/^(.+?)\s+Pricing$/i);
    if (!match) continue;
    const builderName = match[1].trim();
    const ws = wb.Sheets[sn];
    const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
    // Header row is index 3
    const hdr = (m[3] || []).map(h => (h == null ? '' : String(h).trim()));
    const colSku = hdr.findIndex(h => /^sku$/i.test(h));
    // Prefer Target Unit Price; fall back to Current Unit Price
    const colTarget = hdr.findIndex(h => /^target\s*unit\s*price$/i.test(h));
    const colCurrent = hdr.findIndex(h => /^current\s*unit\s*price$/i.test(h));
    if (colSku < 0 || (colTarget < 0 && colCurrent < 0)) continue;
    for (let r = 4; r < m.length; r++) {
      const row = m[r] || [];
      const sku = cleanSku(row[colSku]);
      if (!sku) continue;
      let price = colTarget >= 0 ? toNum(row[colTarget]) : null;
      if (price == null || price <= 0) {
        price = colCurrent >= 0 ? toNum(row[colCurrent]) : null;
      }
      if (price == null || price <= 0) continue;
      out.push({ builderName, sku, price, source: `${basename(file)}#${sn}` });
    }
  }
  return out;
}

function parseBrookfieldSchedule(file) {
  const out = [];
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets['Pricing Schedule'];
  if (!ws) return out;
  const m = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
  const hdr = (m[3] || []).map(h => (h == null ? '' : String(h).trim()));
  const colSku = hdr.findIndex(h => /^sku$/i.test(h));
  const colPrice = hdr.findIndex(h => /^price$/i.test(h));
  if (colSku < 0 || colPrice < 0) return out;
  for (let r = 4; r < m.length; r++) {
    const row = m[r] || [];
    const sku = cleanSku(row[colSku]);
    const price = toNum(row[colPrice]);
    if (!sku || price == null || price <= 0) continue;
    out.push({ builderName: 'Brookfield', sku, price, source: `${basename(file)}#Pricing Schedule` });
  }
  return out;
}

function parseTollBrothersPricingSheet(file) {
  // Known shape: "Ext. Doors" [SKU, LH/RH, desc, price], "Trim Materials" [desc, size, SKU, PRICE, UoM]
  const out = [];
  const wb = XLSX.readFile(file);
  const ext = wb.Sheets['Ext. Doors'];
  if (ext) {
    const m = XLSX.utils.sheet_to_json(ext, { header: 1, defval: null });
    for (const row of m) {
      if (!row) continue;
      const sku = cleanSku(row[0]);
      const price = toNum(row[3]);
      if (!sku || price == null || price <= 0) continue;
      out.push({ builderName: 'Toll Brothers', sku, price, source: `${basename(file)}#Ext. Doors` });
    }
  }
  const trim = wb.Sheets['Trim Materials'];
  if (trim) {
    const m = XLSX.utils.sheet_to_json(trim, { header: 1, defval: null });
    const hdr = (m[0] || []).map(h => (h == null ? '' : String(h).trim()));
    const colSku = hdr.findIndex(h => /^sku$/i.test(h));
    const colPrice = hdr.findIndex(h => /^price$/i.test(h));
    if (colSku >= 0 && colPrice >= 0) {
      for (let r = 1; r < m.length; r++) {
        const row = m[r] || [];
        const sku = cleanSku(row[colSku]);
        const price = toNum(row[colPrice]);
        if (!sku || price == null || price <= 0) continue;
        out.push({ builderName: 'Toll Brothers', sku, price, source: `${basename(file)}#Trim Materials` });
      }
    }
  }
  return out;
}

// ── source definitions ──────────────────────────────────────────────
const SOURCES = [
  {
    path: join(ABEL_FOLDER, 'Abel_Pricing_Corrections.xlsx'),
    parser: parsePricingCorrections,
  },
  {
    path: join(ABEL_FOLDER, 'Pricing & Catalog/Abel_Pricing_Corrections.xlsx'),
    parser: parsePricingCorrections,
  },
  {
    path: join(ABEL_FOLDER, 'Abel_Builder_Pricing_Analysis.xlsx'),
    parser: parseBuilderPricingAnalysis,
  },
  {
    path: join(ABEL_FOLDER, 'Abel_Account_Pricing_Rebuild_Q4Q1.xlsx'),
    parser: parseAccountPricingRebuild,
  },
  {
    path: join(ABEL_FOLDER, 'Brookfield/Brookfield_Pricing_Schedule_Rev2_April_2026.xlsx'),
    parser: parseBrookfieldSchedule,
  },
  {
    path: join(ABEL_FOLDER, 'Abel Door & Trim_ DFW Box Export/Abel Door & Trim_ DFW/Customers/Toll Brothers DFW/Toll Docs/Bid Templates/Bid Templates/Toll Brothers Pricing Sheet.xlsx'),
    parser: parseTollBrothersPricingSheet,
  },
  {
    path: join(ABEL_FOLDER, 'Abel Door & Trim_ DFW Box Export/Abel Door & Trim_ DFW/Project Management/Builder Accounts/Toll Brothers/Bid Templates/Toll Brothers Pricing Sheet.xlsx'),
    parser: parseTollBrothersPricingSheet,
  },
];

// ── run ─────────────────────────────────────────────────────────────
console.log(`\n── seed-builder-pricing-from-excel ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ──\n`);

console.log('Loading Builder + Product from DB…');
const [builderRows, productRows, beforeCount] = await Promise.all([
  sql`SELECT id, "companyName" FROM "Builder" WHERE "companyName" IS NOT NULL AND "companyName" != ''`,
  sql`SELECT id, sku, cost FROM "Product" WHERE sku IS NOT NULL AND sku != ''`,
  sql`SELECT count(*)::int AS n FROM "BuilderPricing"`,
]);
console.log(`  builders=${builderRows.length}  products=${productRows.length}  BuilderPricing(before)=${beforeCount[0].n}`);

const builders = builderRows.map(b => ({
  ...b,
  _tokens: tokenSet(b.companyName),
  _compressed: compressed(b.companyName),
}));
const productBySku = new Map();
for (const p of productRows) {
  const key = String(p.sku).trim().toUpperCase();
  if (!productBySku.has(key)) productBySku.set(key, p);
}

// Gather tuples from every source
const allTuples = [];
const perFile = [];
for (const src of SOURCES) {
  if (!existsSync(src.path)) {
    perFile.push({ file: basename(src.path), exists: false, tuples: 0 });
    console.log(`  (skip — not found) ${basename(src.path)}`);
    continue;
  }
  try {
    const tuples = src.parser(src.path);
    perFile.push({ file: basename(src.path), exists: true, tuples: tuples.length });
    console.log(`  ${basename(src.path).padEnd(58)} ${String(tuples.length).padStart(5)} tuples`);
    for (const t of tuples) allTuples.push(t);
  } catch (e) {
    perFile.push({ file: basename(src.path), exists: true, tuples: 0, error: e.message });
    console.log(`  ERR ${basename(src.path)}: ${e.message}`);
  }
}
console.log(`\n  total tuples gathered: ${allTuples.length}`);

// Match + dedup
const matchCache = new Map();
function matchCached(name) {
  if (matchCache.has(name)) return matchCache.get(name);
  const m = matchBuilder(name, builders);
  matchCache.set(name, m);
  return m;
}

const plan = [];
const stats = {
  totalTuples: allTuples.length,
  matched: 0,
  skippedBuilderUnmatched: 0,
  skippedProductMissing: 0,
  skippedInvalidPrice: 0,
};
const unmatchedBuilders = new Map();
const missingSkus = new Map();

for (const t of allTuples) {
  if (!t.price || t.price <= 0) { stats.skippedInvalidPrice++; continue; }
  const prod = productBySku.get(t.sku);
  if (!prod) {
    missingSkus.set(t.sku, (missingSkus.get(t.sku) || 0) + 1);
    stats.skippedProductMissing++;
    continue;
  }
  const m = matchCached(t.builderName);
  if (!m) {
    unmatchedBuilders.set(t.builderName, (unmatchedBuilders.get(t.builderName) || 0) + 1);
    stats.skippedBuilderUnmatched++;
    continue;
  }
  stats.matched++;
  const cost = prod.cost == null ? null : Number(prod.cost);
  const margin = cost != null && Number.isFinite(cost) && t.price > 0
    ? (t.price - cost) / t.price
    : null;
  plan.push({
    builderId: m.builder.id,
    builderName: m.builder.companyName,
    jsonlName: t.builderName,
    productId: prod.id,
    sku: t.sku,
    customPrice: t.price,
    margin,
    source: t.source,
  });
}

// Dedup on (builderId, productId). Keep the last tuple (later sources override).
const dedup = new Map();
for (const r of plan) dedup.set(`${r.builderId}::${r.productId}`, r);
const upserts = [...dedup.values()];

console.log('\n── Plan summary ──');
console.log(`  total tuples:                 ${stats.totalTuples}`);
console.log(`  matched (builder + product):  ${stats.matched}`);
console.log(`  skipped (product missing):    ${stats.skippedProductMissing}`);
console.log(`  skipped (builder unmatched):  ${stats.skippedBuilderUnmatched}`);
console.log(`  skipped (invalid price):      ${stats.skippedInvalidPrice}`);
console.log(`  upserts (deduped):            ${upserts.length}`);

// Builder-match report
console.log('\n── Builder matches ──');
const matched = new Map();
for (const r of upserts) {
  const k = `${r.jsonlName} → ${r.builderName}`;
  matched.set(k, (matched.get(k) || 0) + 1);
}
for (const [k, n] of [...matched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) {
  console.log(`  ${k.padEnd(60)} ${n}`);
}
if (unmatchedBuilders.size) {
  console.log('\n  UNMATCHED builder names:');
  for (const [k, n] of [...unmatchedBuilders.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) {
    console.log(`    ${k.padEnd(40)} ${n}`);
  }
}
if (missingSkus.size) {
  console.log(`\n  ${missingSkus.size} SKUs not in Product (first 10):`);
  for (const [k, n] of [...missingSkus.entries()].slice(0, 10)) {
    console.log(`    ${k.padEnd(12)} count=${n}`);
  }
}

// Sample
console.log('\n── Sample upserts (first 5) ──');
for (const r of upserts.slice(0, 5)) {
  const mg = r.margin != null ? (r.margin * 100).toFixed(1) + '%' : 'n/a';
  console.log(`  sku=${r.sku.padEnd(10)} builder=${r.builderName.padEnd(28)} price=$${r.customPrice.toFixed(2).padStart(8)}  margin=${mg}`);
}

if (DRY_RUN) {
  console.log('\nDRY RUN — no writes. Re-run with --commit to apply.');
  process.exit(0);
}

// ── Apply ──
console.log('\n── Applying upserts ──');
const BATCH = 200;
let applied = 0;
const now = new Date();
for (let i = 0; i < upserts.length; i += BATCH) {
  const chunk = upserts.slice(i, i + BATCH);
  const values = [];
  const params = [];
  let idx = 1;
  for (const r of chunk) {
    const id = randomUUID();
    values.push(`($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`);
    params.push(id, r.builderId, r.productId, r.customPrice, r.margin, now, now);
  }
  const text = `
    INSERT INTO "BuilderPricing"
      (id, "builderId", "productId", "customPrice", margin, "createdAt", "updatedAt")
    VALUES ${values.join(',')}
    ON CONFLICT ("builderId", "productId")
    DO UPDATE SET
      "customPrice" = EXCLUDED."customPrice",
      margin        = EXCLUDED.margin,
      "updatedAt"   = EXCLUDED."updatedAt"
  `;
  await sql.query(text, params);
  applied += chunk.length;
  if (applied % 600 === 0 || applied === upserts.length) {
    console.log(`  ${applied}/${upserts.length}`);
  }
}

const after = await sql`SELECT count(*)::int AS n FROM "BuilderPricing"`;
console.log(`\n── Done ──  BuilderPricing: ${beforeCount[0].n} → ${after[0].n}  (+${after[0].n - beforeCount[0].n}, upserts=${applied})`);
