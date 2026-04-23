#!/usr/bin/env node
/**
 * scripts/seed-builder-pricing.mjs
 *
 * Populate BuilderPricing from brain_export/products.jsonl.
 *
 * Source: C:/Users/natha/OneDrive/Abel Lumber/NUC_CLUSTER/brain_export/products.jsonl
 *   Each line: { data: { sku, cost, builder_prices: { builderName: "123.45", ... } } }
 *
 * Per pair (product SKU × builder name):
 *   - Resolve Product by sku
 *   - Fuzzy-match builder name → Builder.companyName
 *       * normalize: lowercase, strip whitespace, drop stop-words
 *         (homes, home, dfw, inc, llc, co, the, &, and, builders, custom, doors, trim, etc.)
 *       * accept if normalized-one contains the other OR token-overlap >= 2
 *   - UPSERT BuilderPricing (builderId, productId) with customPrice and margin
 *     margin = (customPrice - product.cost) / customPrice  (guarded)
 *
 * Idempotent — ON CONFLICT (builderId, productId) DO UPDATE.
 *
 * Usage:
 *   node scripts/seed-builder-pricing.mjs              # DRY-RUN (no writes)
 *   node scripts/seed-builder-pricing.mjs --commit     # apply
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Load DATABASE_URL from .env
const envPath = join(ROOT, '.env');
const envContent = readFileSync(envPath, 'utf-8');
const DB_URL =
  envContent.match(/^DATABASE_URL="([^"]+)"/m)?.[1] ||
  envContent.match(/^DATABASE_URL=([^\s]+)/m)?.[1];
if (!DB_URL) {
  console.error('No DATABASE_URL in .env');
  process.exit(1);
}

const SOURCE_JSONL =
  'C:/Users/natha/OneDrive/Abel Lumber/NUC_CLUSTER/brain_export/products.jsonl';
const DRY_RUN = !process.argv.includes('--commit');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(DB_URL);

// ── normalizer ──────────────────────────────────────────────────────
const STOP_WORDS = new Set([
  'homes', 'home', 'dfw', 'inc', 'inc.', 'llc', 'co', 'co.', 'corp', 'corp.',
  'the', 'and', '&', 'builders', 'builder', 'custom', 'doors', 'door',
  'trim', 'construction', 'group', 'company', 'development', 'developement',
  'development.', 'design', 'designs', 'homebuilders', 'homebuilder',
  'properties', 'property', 'contractors', 'contracting', 'of', 'by',
  'a', 'an',
]);

function normalize(raw) {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function tokenize(raw) {
  return normalize(raw)
    .split(' ')
    .filter((t) => t && !STOP_WORDS.has(t));
}
function tokenSet(raw) {
  return new Set(tokenize(raw));
}
function compressed(raw) {
  // tokens joined — "Pulte Homes DFW" → "pulte"
  return tokenize(raw).join('');
}

/**
 * Match a JSONL builder_prices key to a Builder row.
 * Returns {builder, strategy} or null.
 * Strategies (ranked):
 *   1. exact normalized compressed match
 *   2. one compressed string contains the other (len >= 3)
 *   3. token-overlap >= 2
 *   4. single shared distinctive token (len >= 5)
 */
function matchBuilder(jsonlName, builders) {
  const srcCompressed = compressed(jsonlName);
  const srcTokens = tokenSet(jsonlName);
  if (!srcCompressed) return null;

  // 1. exact compressed
  const exact = builders.find((b) => b._compressed === srcCompressed);
  if (exact) return { builder: exact, strategy: 'exact' };

  // 2. containment
  const contained = builders
    .filter(
      (b) =>
        b._compressed.length >= 3 &&
        srcCompressed.length >= 3 &&
        (b._compressed.includes(srcCompressed) ||
          srcCompressed.includes(b._compressed)),
    )
    .sort((a, b) => b._compressed.length - a._compressed.length);
  if (contained.length > 0)
    return { builder: contained[0], strategy: 'containment' };

  // 3. token overlap >= 2
  const withOverlap = builders
    .map((b) => {
      let overlap = 0;
      for (const t of b._tokens) if (srcTokens.has(t)) overlap++;
      return { b, overlap };
    })
    .filter((x) => x.overlap >= 2)
    .sort((a, b) => b.overlap - a.overlap);
  if (withOverlap.length > 0)
    return { builder: withOverlap[0].b, strategy: 'token-overlap-2' };

  // 4. single distinctive token (len >= 5) — catches "BROOKFIELD" → "Brookfield Homes"
  const distinctive = builders
    .map((b) => {
      for (const t of b._tokens) {
        if (t.length >= 5 && srcTokens.has(t)) return { b, token: t };
      }
      return null;
    })
    .filter(Boolean);
  if (distinctive.length === 1)
    return {
      builder: distinctive[0].b,
      strategy: `distinctive:${distinctive[0].token}`,
    };
  if (distinctive.length > 1) {
    // prefer shortest companyName (less noise)
    distinctive.sort(
      (a, b) => a.b.companyName.length - b.b.companyName.length,
    );
    return {
      builder: distinctive[0].b,
      strategy: `distinctive-ambiguous:${distinctive[0].token}`,
    };
  }

  return null;
}

// ── main ───────────────────────────────────────────────────────────
console.log(`\n── seed-builder-pricing ${DRY_RUN ? '(DRY RUN)' : '(LIVE)'} ──\n`);

console.log('Loading Builder + Product from DB…');
const [builderRows, productRows, beforeCount] = await Promise.all([
  sql`SELECT id, "companyName" FROM "Builder" WHERE "companyName" IS NOT NULL AND "companyName" != ''`,
  sql`SELECT id, sku, cost FROM "Product" WHERE sku IS NOT NULL AND sku != ''`,
  sql`SELECT count(*)::int AS n FROM "BuilderPricing"`,
]);
console.log(
  `  builders=${builderRows.length}  products=${productRows.length}  BuilderPricing(before)=${beforeCount[0].n}`,
);

// Enrich builders with normalized fields
const builders = builderRows.map((b) => ({
  ...b,
  _tokens: tokenSet(b.companyName),
  _compressed: compressed(b.companyName),
}));

// Product by SKU (some SKU dupes theoretically — keep first)
const productBySku = new Map();
for (const p of productRows) {
  const key = String(p.sku).trim().toUpperCase();
  if (!productBySku.has(key)) productBySku.set(key, p);
}

// Parse JSONL
console.log(`Reading ${SOURCE_JSONL}…`);
const raw = readFileSync(SOURCE_JSONL, 'utf-8');
const lines = raw.split(/\r?\n/).filter(Boolean);
console.log(`  ${lines.length} records`);

// Match cache for builders
const matchCache = new Map();
function matchCached(name) {
  if (matchCache.has(name)) return matchCache.get(name);
  const m = matchBuilder(name, builders);
  matchCache.set(name, m);
  return m;
}

// Build upsert plan
const plan = []; // {builderId, productId, customPrice, margin, sku, builderName, jsonlName}
const stats = {
  records: 0,
  recordsWithBP: 0,
  pairs: 0,
  skippedBuilderUnmatched: 0,
  skippedProductMissing: 0,
  skippedInvalidPrice: 0,
};
const unmatchedBuilders = new Map(); // name → count
const missingSkus = new Map();

for (const ln of lines) {
  let rec;
  try {
    rec = JSON.parse(ln);
  } catch {
    continue;
  }
  stats.records++;
  const d = rec.data || {};
  const bp = d.builder_prices;
  if (!bp || typeof bp !== 'object') continue;
  const keys = Object.keys(bp);
  if (keys.length === 0) continue;
  stats.recordsWithBP++;

  const sku = String(d.sku || '').trim().toUpperCase();
  if (!sku) continue;
  const product = productBySku.get(sku);
  if (!product) {
    for (const k of keys) stats.pairs++; // pair-visit counting
    missingSkus.set(sku, (missingSkus.get(sku) || 0) + keys.length);
    stats.skippedProductMissing += keys.length;
    continue;
  }
  const cost = product.cost == null ? null : Number(product.cost);

  for (const bName of keys) {
    stats.pairs++;
    const priceRaw = bp[bName];
    const price = Number(priceRaw);
    if (!Number.isFinite(price) || price <= 0) {
      stats.skippedInvalidPrice++;
      continue;
    }
    const m = matchCached(bName);
    if (!m) {
      unmatchedBuilders.set(bName, (unmatchedBuilders.get(bName) || 0) + 1);
      stats.skippedBuilderUnmatched++;
      continue;
    }
    const margin =
      cost != null && Number.isFinite(cost) && price > 0
        ? (price - cost) / price
        : null;
    plan.push({
      builderId: m.builder.id,
      builderName: m.builder.companyName,
      jsonlName: bName,
      productId: product.id,
      sku,
      customPrice: price,
      margin,
    });
  }
}

// Dedup plan on (builderId, productId) — keep last (latest definition wins)
const dedup = new Map();
for (const row of plan) {
  dedup.set(`${row.builderId}::${row.productId}`, row);
}
const upserts = [...dedup.values()];

console.log('\n── Plan summary ──');
console.log(`  records scanned:              ${stats.records}`);
console.log(`  records with builder_prices:  ${stats.recordsWithBP}`);
console.log(`  total pairs seen:             ${stats.pairs}`);
console.log(`  skipped (product missing):    ${stats.skippedProductMissing}`);
console.log(`  skipped (builder unmatched):  ${stats.skippedBuilderUnmatched}`);
console.log(`  skipped (invalid price):      ${stats.skippedInvalidPrice}`);
console.log(`  upserts queued (deduped):     ${upserts.length}`);

// Builder-match report
console.log('\n── Builder matches ──');
const matchedBuilders = new Map();
for (const row of upserts) {
  const k = `${row.jsonlName} → ${row.builderName}`;
  matchedBuilders.set(k, (matchedBuilders.get(k) || 0) + 1);
}
for (const [k, n] of [...matchedBuilders.entries()].sort(
  (a, b) => b[1] - a[1],
)) {
  console.log(`  ${k.padEnd(60)} ${n}`);
}
if (unmatchedBuilders.size) {
  console.log('\n  UNMATCHED builders:');
  for (const [k, n] of [...unmatchedBuilders.entries()].sort(
    (a, b) => b[1] - a[1],
  )) {
    console.log(`    ${k.padEnd(40)} ${n}`);
  }
}
if (missingSkus.size) {
  console.log(
    `\n  ${missingSkus.size} SKUs with builder_prices had no matching Product (showing first 10):`,
  );
  for (const [k, n] of [...missingSkus.entries()].slice(0, 10)) {
    console.log(`    ${k.padEnd(20)} pairs=${n}`);
  }
}

// Sample
console.log('\n── Sample upserts (first 5) ──');
for (const r of upserts.slice(0, 5)) {
  console.log(
    `  sku=${r.sku.padEnd(12)} builder=${r.builderName.padEnd(
      28,
    )} price=$${r.customPrice.toFixed(2).padStart(8)}  margin=${
      r.margin != null ? (r.margin * 100).toFixed(1) + '%' : 'n/a'
    }`,
  );
}

if (DRY_RUN) {
  console.log('\nDRY RUN — no writes. Re-run with --commit to apply.');
  process.exit(0);
}

// ── Apply in batches ──────────────────────────────────────────
console.log('\n── Applying upserts ──');
const BATCH = 200;
let applied = 0;
const now = new Date();

for (let i = 0; i < upserts.length; i += BATCH) {
  const chunk = upserts.slice(i, i + BATCH);
  // Build parameterised INSERT with ON CONFLICT
  const values = [];
  const params = [];
  let idx = 1;
  for (const r of chunk) {
    const id = randomUUID();
    values.push(
      `($${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++}, $${idx++})`,
    );
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
console.log(
  `\n── Done ──  BuilderPricing: ${beforeCount[0].n} → ${after[0].n}  (+${
    after[0].n - beforeCount[0].n
  }, upserts=${applied})`,
);
