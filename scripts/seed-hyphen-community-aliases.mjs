// ─────────────────────────────────────────────────────────────────────────────
// seed-hyphen-community-aliases.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Creates the HyphenCommunityAlias table (if absent) and seeds rows that bridge
// Hyphen's portal community names (e.g. "The Grove Frisco 55s") to Aegis
// Community.id rows (e.g. "The Grove" under Brookfield Homes).
//
// Sources of truth, merged in priority order:
//   1. Existing HyphenCommunityMapping rows (reconcile-hyphen-brookfield.mjs
//      seeded 2 Brookfield rows on 4/11). Imported as matchConfidence=MEDIUM
//      + source='LEGACY_MAPPING' unless a stricter rule upgrades them.
//   2. DISTINCT HyphenOrder.subdivision values — fuzzy-matched against every
//      Community row (builder-scoped when a builder name is inferrable from
//      HyphenOrder.builderName). Exact token-set equality → HIGH/EXACT. Token
//      overlap ≥ 2 → MEDIUM/FUZZY. Single-community builder → MEDIUM/FALLBACK.
//
// Unresolved subdivisions are written with aegisCommunityId = NULL and
// source='UNMATCHED' so the admin UI can surface them for manual linking.
//
// Usage:   node scripts/seed-hyphen-community-aliases.mjs              # dry-run
//          node scripts/seed-hyphen-community-aliases.mjs --apply      # write
//
// Idempotent: re-running --apply upserts on hyphenName.
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function bar(label) {
  console.log('\n' + '═'.repeat(66));
  console.log('  ' + label);
  console.log('═'.repeat(66));
}

// ── Normalizer (mirrors correlate.ts conventions) ──────────────────────────
const STOP_WORDS = new Set([
  'homes','home','dfw','inc','llc','co','corp','the','and','of','by','a','an',
  'group','development','community','communities','phase','subdivision','sub',
]);
const tokens = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && t.length >= 3 && !STOP_WORDS.has(t));

async function ensureAliasTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenCommunityAlias" (
      "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "hyphenName"        TEXT UNIQUE NOT NULL,
      "aegisCommunityId"  TEXT,
      "builderId"         TEXT,
      "matchConfidence"   TEXT,
      "source"            TEXT,
      "notes"             TEXT,
      "createdAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "HyphenCommunityAlias_community_fk"
        FOREIGN KEY ("aegisCommunityId") REFERENCES "Community"("id") ON DELETE SET NULL,
      CONSTRAINT "HyphenCommunityAlias_builder_fk"
        FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE SET NULL
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_hca_community" ON "HyphenCommunityAlias" ("aegisCommunityId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_hca_builder" ON "HyphenCommunityAlias" ("builderId")`,
  );
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_hca_confidence" ON "HyphenCommunityAlias" ("matchConfidence")`,
  );
}

// ── Fuzzy matcher ──────────────────────────────────────────────────────────
function bestCommunityMatch(hyphenName, communities) {
  const hTokens = new Set(tokens(hyphenName));
  if (hTokens.size === 0) return null;

  let best = null;
  for (const c of communities) {
    const cTokens = new Set(tokens(c.name));
    if (cTokens.size === 0) continue;
    const shared = [...cTokens].filter((t) => hTokens.has(t));
    if (shared.length === 0) continue;

    // Exact set equality → HIGH/EXACT
    if (cTokens.size === hTokens.size && shared.length === cTokens.size) {
      return { community: c, confidence: 'HIGH', source: 'EXACT', score: 1.0, shared };
    }

    // Full containment of community tokens inside hyphen tokens ("The Grove"
    // fully inside "The Grove Frisco 55s"). Strong signal → HIGH/CONTAINED.
    if (shared.length === cTokens.size) {
      if (!best || best.score < 0.95) {
        best = { community: c, confidence: 'HIGH', source: 'CONTAINED', score: 0.95, shared };
      }
      continue;
    }

    const score = shared.length / Math.max(cTokens.size, hTokens.size);
    // Token overlap ≥ 2 → MEDIUM/FUZZY. Single shared token → LOW/FUZZY.
    const confidence = shared.length >= 2 ? 'MEDIUM' : 'LOW';
    if (!best || score > best.score) {
      best = { community: c, confidence, source: 'FUZZY', score, shared };
    }
  }
  return best;
}

async function main() {
  bar(APPLY ? 'HYPHEN COMMUNITY ALIAS SEED (APPLY)' : 'HYPHEN COMMUNITY ALIAS SEED (DRY-RUN)');

  // ── STEP 0: ensure table ────────────────────────────────────────────────
  await ensureAliasTable();
  console.log('\nHyphenCommunityAlias table ready.');

  // ── STEP 1: load data ───────────────────────────────────────────────────
  // All communities, with builder for disambiguation.
  const allCommunities = await prisma.$queryRawUnsafe(`
    SELECT c."id", c."name", c."builderId", b."companyName" AS builder_name
      FROM "Community" c
      LEFT JOIN "Builder" b ON b."id" = c."builderId"
     WHERE c."status" <> 'CLOSED'
  `);
  console.log(`Communities in scope: ${allCommunities.length}`);

  // Existing legacy mapping rows — import verbatim
  const legacy = await prisma.$queryRawUnsafe(`
    SELECT "hyphenSubdivision", "communityId", "builderId", "matchScore"
      FROM "HyphenCommunityMapping"
  `);
  console.log(`Legacy HyphenCommunityMapping rows: ${legacy.length}`);

  // Distinct Hyphen subdivision strings in the wild
  const distinctFromOrders = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "subdivision", "builderName"
      FROM "HyphenOrder"
     WHERE "subdivision" IS NOT NULL AND "subdivision" <> ''
  `);
  // Also distinct subdivisions from the HyphenDocument table (if any ingested)
  const distinctFromDocs = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "subdivision", "builderName"
      FROM "HyphenDocument"
     WHERE "subdivision" IS NOT NULL AND "subdivision" <> ''
  `);

  // Merge: one entry per hyphenName, last-writer-wins on builderName hint.
  const byName = new Map();
  for (const r of [...distinctFromOrders, ...distinctFromDocs]) {
    if (!byName.has(r.subdivision)) byName.set(r.subdivision, { builderNameHint: r.builderName });
  }
  // Include legacy subdivisions we might have already mapped
  for (const r of legacy) {
    if (!byName.has(r.hyphenSubdivision)) byName.set(r.hyphenSubdivision, {});
  }

  console.log(`\nDistinct Hyphen subdivision names to alias: ${byName.size}`);

  // ── STEP 2: build proposed aliases ──────────────────────────────────────
  const legacyByName = new Map(legacy.map((r) => [r.hyphenSubdivision, r]));
  const proposed = [];

  for (const [hyphenName, meta] of byName.entries()) {
    // Filter communities by builder hint when possible
    let candidates = allCommunities;
    let scopedByBuilder = false;
    if (meta.builderNameHint) {
      const hint = meta.builderNameHint.toLowerCase();
      const scoped = allCommunities.filter(
        (c) => (c.builder_name || '').toLowerCase().includes(hint.split(' ')[0]),
      );
      if (scoped.length) {
        candidates = scoped;
        scopedByBuilder = true;
      }
    }

    let row;
    const match = bestCommunityMatch(hyphenName, candidates);

    if (match) {
      row = {
        hyphenName,
        aegisCommunityId: match.community.id,
        builderId: match.community.builderId,
        matchConfidence: match.confidence,
        source: match.source,
        notes: `score=${match.score.toFixed(2)} shared=[${match.shared.join(',')}]${scopedByBuilder ? ' builder-scoped' : ''}`,
      };
    } else if (scopedByBuilder && candidates.length === 1) {
      // Single-community-builder fallback (covers e.g. Brookfield → The Grove)
      row = {
        hyphenName,
        aegisCommunityId: candidates[0].id,
        builderId: candidates[0].builderId,
        matchConfidence: 'MEDIUM',
        source: 'SINGLE_BUILDER_FALLBACK',
        notes: `only community for builder "${candidates[0].builder_name}"`,
      };
    } else {
      row = {
        hyphenName,
        aegisCommunityId: null,
        builderId: null,
        matchConfidence: 'UNMATCHED',
        source: 'UNMATCHED',
        notes: scopedByBuilder ? 'no community match within builder scope' : 'no candidate community',
      };
    }

    // Upgrade from legacy if the legacy mapping had a higher-quality link
    // (legacy rows had matchScore=1.0 for token-overlap).
    const legacyRow = legacyByName.get(hyphenName);
    if (legacyRow && (!row.aegisCommunityId || row.matchConfidence === 'UNMATCHED')) {
      row.aegisCommunityId = legacyRow.communityId;
      row.builderId = legacyRow.builderId;
      row.matchConfidence = 'MEDIUM';
      row.source = 'LEGACY_MAPPING';
      row.notes = `imported from HyphenCommunityMapping (score=${legacyRow.matchScore ?? 'n/a'})`;
    }

    proposed.push(row);
  }

  bar('PROPOSED ALIASES');
  const byConf = proposed.reduce((acc, r) => {
    acc[r.matchConfidence] = (acc[r.matchConfidence] || 0) + 1;
    return acc;
  }, {});
  console.log(`\nBreakdown: ${JSON.stringify(byConf)}`);
  proposed.slice(0, 30).forEach((r) => {
    const tag = r.aegisCommunityId
      ? `→ ${r.aegisCommunityId.slice(0, 10)}...  [${r.matchConfidence}/${r.source}]`
      : `→ UNMATCHED  [${r.source}]`;
    console.log(`   "${r.hyphenName}"  ${tag}  — ${r.notes}`);
  });
  if (proposed.length > 30) console.log(`   ... and ${proposed.length - 30} more`);

  // ── STEP 3: write ───────────────────────────────────────────────────────
  if (APPLY) {
    let inserted = 0;
    for (const r of proposed) {
      await prisma.$executeRawUnsafe(
        `
        INSERT INTO "HyphenCommunityAlias"
          ("id","hyphenName","aegisCommunityId","builderId","matchConfidence","source","notes","createdAt","updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("hyphenName") DO UPDATE SET
          "aegisCommunityId" = EXCLUDED."aegisCommunityId",
          "builderId"        = EXCLUDED."builderId",
          "matchConfidence"  = EXCLUDED."matchConfidence",
          "source"           = EXCLUDED."source",
          "notes"            = EXCLUDED."notes",
          "updatedAt"        = CURRENT_TIMESTAMP
        `,
        r.hyphenName,
        r.aegisCommunityId,
        r.builderId,
        r.matchConfidence,
        r.source,
        r.notes,
      );
      inserted++;
    }
    console.log(`\n  Upserted ${inserted} HyphenCommunityAlias rows.`);
  } else {
    console.log(`\n  (dry-run — re-run with --apply to write)`);
  }

  // ── SUMMARY ─────────────────────────────────────────────────────────────
  bar('SUMMARY');
  if (APPLY) {
    const after = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "HyphenCommunityAlias"`);
    console.log(`\n  HyphenCommunityAlias row count: ${after[0].n}`);
    const sample = await prisma.$queryRawUnsafe(`
      SELECT a."hyphenName", a."matchConfidence", a."source", c."name" AS community_name, b."companyName" AS builder_name
        FROM "HyphenCommunityAlias" a
        LEFT JOIN "Community" c ON c."id" = a."aegisCommunityId"
        LEFT JOIN "Builder" b ON b."id" = a."builderId"
       ORDER BY a."matchConfidence", a."hyphenName"
       LIMIT 15
    `);
    console.log(`\n  Sample rows:`);
    sample.forEach((s) =>
      console.log(`    "${s.hyphenName}"  →  ${s.community_name || '(unmatched)'}  [${s.builder_name || '-'}]  (${s.matchConfidence}/${s.source})`),
    );
  }
}

main()
  .catch((e) => {
    console.error('FATAL:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
