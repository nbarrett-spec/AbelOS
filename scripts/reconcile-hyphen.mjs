// ─────────────────────────────────────────────────────────────────────────────
// reconcile-hyphen.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Generalized Hyphen → Aegis Job linker. Supersedes reconcile-hyphen-brookfield.mjs
// by parameterizing on --builder <name>. Case-insensitive. DRY-RUN by default.
//
// Tenant model:
//   HyphenCredential has no builderId FK (it's a label-only row), so the only
//   reliable per-tenant marker available today is HyphenOrder.builderName (text).
//   This script filters BOTH sides (Job and HyphenOrder) by case-insensitive
//   builderName match. That's the only join key we have until the sync side
//   tags orders with an Aegis Builder.id.
//
// Steps (per --builder):
//   1. Resolve Builder row (communities attached preferred).
//   2. Pull distinct HyphenOrder.subdivision where builderName ~* <builder>.
//   3. Upsert HyphenCommunityMapping rows (token-overlap, single-community fallback).
//   4. Link Job ↔ HyphenOrder by normalized street address (both filtered to
//      the same builderName).
//
// Usage:
//   node scripts/reconcile-hyphen.mjs --builder "Brookfield"
//   node scripts/reconcile-hyphen.mjs --builder "Toll Brothers" --apply
//   node scripts/reconcile-hyphen.mjs --builder "Shaddock Homes"
//
// Idempotent.
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  const v = process.argv[idx + 1];
  return v && !v.startsWith('--') ? v : null;
}

const BUILDER_ARG = argValue('--builder');
if (!BUILDER_ARG) {
  console.error('ERROR: --builder "<name>" is required. e.g. --builder "Toll Brothers"');
  process.exit(1);
}

function bar(label) {
  console.log('\n' + '═'.repeat(66));
  console.log('  ' + label);
  console.log('═'.repeat(66));
}

/** "15367 Boxthorn Drive, Frisco,TX" → "15367 boxthorn"  (prefix-safe) */
function normStreet(s) {
  if (!s) return '';
  const head = String(s).toLowerCase().split(/,|\s-\s/)[0].trim()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = head.match(/^(\d+)\s+([a-z]+(?:\s+[a-z]+){0,3})/);
  if (!m) return head;
  const suffix = /\s(drive|dr|lane|ln|street|st|road|rd|court|ct|mews|trail|tr|way|circle|cir|place|pl)$/;
  let s2 = `${m[1]} ${m[2]}`;
  while (suffix.test(s2)) s2 = s2.replace(suffix, '');
  return s2.trim();
}

/** tokens of length >= 4 (lowercased, alpha-only) */
function tokens(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/).filter(w => w.length >= 4);
}

/** Best Community match for a Hyphen subdivision. Returns { id, name, score } or null. */
function matchCommunity(subdivision, communities) {
  const subTokens = new Set(tokens(subdivision));
  if (subTokens.size === 0) return null;
  let best = null;
  for (const c of communities) {
    const cTokens = new Set(tokens(c.name));
    if (cTokens.size === 0) continue;
    const shared = [...cTokens].filter(t => subTokens.has(t));
    if (shared.length === 0) continue;
    const score = shared.length / cTokens.size;
    if (!best || score > best.score) best = { id: c.id, name: c.name, score, shared };
  }
  return best;
}

async function ensureMappingTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "HyphenCommunityMapping" (
      "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "hyphenSubdivision" TEXT UNIQUE NOT NULL,
      "communityId"       TEXT NOT NULL,
      "builderId"         TEXT,
      "matchMethod"       TEXT,
      "matchScore"        DOUBLE PRECISION,
      "createdAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe(
    `CREATE INDEX IF NOT EXISTS "idx_hyphen_map_community" ON "HyphenCommunityMapping" ("communityId")`,
  );
}

/**
 * Build a LIKE pattern from the builder arg. "Toll Brothers" → "%toll brothers%"
 * so it catches "Toll Brothers", "TOLL BROTHERS", "Toll Brothers, Inc.", etc.
 */
function builderLikePattern(raw) {
  return '%' + raw.toLowerCase().trim().replace(/\s+/g, '%') + '%';
}

async function snapshotCounts(likePat) {
  const [hypTotal] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "HyphenOrder" WHERE LOWER("builderName") LIKE $1`, likePat,
  );
  const [jobs] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job" WHERE LOWER("builderName") LIKE $1`, likePat,
  );
  const [linked] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job"
      WHERE LOWER("builderName") LIKE $1 AND "hyphenJobId" IS NOT NULL`, likePat,
  );
  const [withComm] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job"
      WHERE LOWER("builderName") LIKE $1 AND "communityId" IS NOT NULL`, likePat,
  );
  return { hypTotal: hypTotal.n, jobs: jobs.n, linked: linked.n, withComm: withComm.n };
}

async function main() {
  const likePat = builderLikePattern(BUILDER_ARG);
  bar(`${APPLY ? 'APPLY' : 'DRY-RUN'}: Hyphen reconciliation — builder="${BUILDER_ARG}" (LIKE ${likePat})`);

  // ── BEFORE ──────────────────────────────────────────────────────────────
  const before = await snapshotCounts(likePat);
  console.log(`\nBefore:`);
  console.log(`  HyphenOrder rows (this builder):  ${before.hypTotal}`);
  console.log(`  Jobs (this builder):              ${before.jobs}`);
  console.log(`  Jobs with hyphenJobId:            ${before.linked}`);
  console.log(`  Jobs with communityId:            ${before.withComm}`);

  if (before.hypTotal === 0) {
    console.log(`\n  NOTE: Zero HyphenOrder rows match this builder. Sync has not ingested`);
    console.log(`        any orders for this tenant yet. Nothing to link.`);
    bar('RESULT');
    console.log(`  Match rate: 0/${before.jobs} (0.0%)`);
    if (!APPLY) console.log(`  (dry-run — re-run with --apply to write)`);
    return;
  }

  // ── STEP 1: community mappings ──────────────────────────────────────────
  await ensureMappingTable();

  // Resolve the best Builder row (the one that actually owns Community rows).
  const builderCandidates = await prisma.$queryRawUnsafe(`
    SELECT b."id", b."companyName", COUNT(c."id")::int AS comm_count
      FROM "Builder" b
      LEFT JOIN "Community" c ON c."builderId" = b."id"
     WHERE LOWER(b."companyName") LIKE $1
     GROUP BY b."id", b."companyName"
     ORDER BY comm_count DESC, b."companyName"
  `, likePat);
  if (!builderCandidates.length) {
    console.log(`\nNo Builder row matches "${BUILDER_ARG}" — aborting.`);
    return;
  }
  console.log(`\nBuilder candidates:`);
  builderCandidates.forEach(b =>
    console.log(`   ${b.id}  ${b.companyName}  (communities: ${b.comm_count})`));
  const builderId = builderCandidates[0].id;
  console.log(`Using: ${builderId} (${builderCandidates[0].companyName})`);

  const communities = await prisma.$queryRawUnsafe(
    `SELECT "id", "name" FROM "Community" WHERE "builderId" = $1`, builderId,
  );
  if (!communities.length) {
    console.log(`\nSelected Builder has no Community rows — aborting.`);
    return;
  }

  const hypSubs = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "subdivision" FROM "HyphenOrder"
     WHERE LOWER("builderName") LIKE $1
       AND "subdivision" IS NOT NULL AND "subdivision" <> ''
  `, likePat);

  bar('STEP 1 — Community mapping');
  console.log(`\nHyphen subdivisions:        ${hypSubs.length}`);
  console.log(`Aegis communities:          ${communities.length}`);
  communities.forEach(c => console.log(`  [${c.id.slice(0, 8)}…]  ${c.name}`));

  const mappings = [];
  for (const { subdivision } of hypSubs) {
    const hit = matchCommunity(subdivision, communities);
    if (hit) {
      mappings.push({ subdivision, communityId: hit.id, communityName: hit.name, score: hit.score, method: 'token-overlap' });
    } else if (communities.length === 1) {
      mappings.push({
        subdivision, communityId: communities[0].id,
        communityName: communities[0].name, score: 0, method: 'single-community-fallback',
      });
    } else {
      mappings.push({ subdivision, communityId: null, communityName: null, score: 0, method: 'NO-MATCH' });
    }
  }

  console.log(`\nProposed mappings:`);
  for (const m of mappings) {
    const tag = m.communityId ? `→ ${m.communityName}  (${m.method}, score=${m.score.toFixed(2)})` : `→ NO MATCH`;
    console.log(`   "${m.subdivision}"  ${tag}`);
  }

  if (APPLY) {
    for (const m of mappings) {
      if (!m.communityId) continue;
      await prisma.$executeRawUnsafe(`
        INSERT INTO "HyphenCommunityMapping" ("id","hyphenSubdivision","communityId","builderId","matchMethod","matchScore","createdAt","updatedAt")
        VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        ON CONFLICT ("hyphenSubdivision") DO UPDATE SET
          "communityId" = EXCLUDED."communityId",
          "builderId"   = EXCLUDED."builderId",
          "matchMethod" = EXCLUDED."matchMethod",
          "matchScore"  = EXCLUDED."matchScore",
          "updatedAt"   = CURRENT_TIMESTAMP
      `, m.subdivision, m.communityId, builderId, m.method, m.score);
    }
    console.log(`\n  Wrote ${mappings.filter(m => m.communityId).length} mapping rows.`);
  }

  // ── STEP 2: Link Jobs → HyphenOrders by normalized street address ──────
  bar('STEP 2 — Job ↔ HyphenOrder link by street address');

  const jobs = await prisma.$queryRawUnsafe(`
    SELECT "id", "jobAddress", "community", "communityId", "hyphenJobId"
      FROM "Job"
     WHERE LOWER("builderName") LIKE $1
       AND "jobAddress" IS NOT NULL AND "jobAddress" <> ''
  `, likePat);
  const hypOrders = await prisma.$queryRawUnsafe(`
    SELECT "hyphId", "address", "subdivision"
      FROM "HyphenOrder"
     WHERE LOWER("builderName") LIKE $1
       AND "address" IS NOT NULL AND "address" <> ''
  `, likePat);

  const hypByStreet = new Map();
  for (const h of hypOrders) {
    const k = normStreet(h.address);
    if (!k || !/^\d/.test(k)) continue;
    if (!hypByStreet.has(k)) hypByStreet.set(k, []);
    hypByStreet.get(k).push(h);
  }
  const hypStreetKeys = [...hypByStreet.keys()];

  const plan = [];
  for (const j of jobs) {
    const js = normStreet(j.jobAddress);
    if (!js || !/^\d/.test(js)) continue;
    let matchKey = hypByStreet.has(js)
      ? js
      : hypStreetKeys.find(k => k.startsWith(js + ' ') || js.startsWith(k + ' ') || k === js);
    if (!matchKey) continue;
    const hit = hypByStreet.get(matchKey)[0];
    const mapped = mappings.find(m => m.subdivision === hit.subdivision);
    plan.push({
      jobId: j.id,
      jobAddr: j.jobAddress,
      hyphId: hit.hyphId,
      subdivision: hit.subdivision,
      communityId: mapped?.communityId || null,
      alreadyLinked: j.hyphenJobId === hit.hyphId && j.communityId === (mapped?.communityId || null),
    });
  }

  console.log(`\nCandidate links:  ${plan.length} / ${jobs.length} jobs with addresses`);
  for (const p of plan.slice(0, 20)) {
    console.log(`   Job ${p.jobId.slice(0, 8)}…  "${p.jobAddr}"  →  HYP-${p.hyphId}  [${p.subdivision}]`);
  }
  if (plan.length > 20) console.log(`   … and ${plan.length - 20} more`);

  if (APPLY) {
    let updated = 0, skipped = 0;
    for (const p of plan) {
      if (p.alreadyLinked) { skipped++; continue; }
      await prisma.$executeRawUnsafe(
        `UPDATE "Job"
            SET "hyphenJobId" = $1,
                "communityId" = COALESCE($2, "communityId"),
                "updatedAt"   = CURRENT_TIMESTAMP
          WHERE "id" = $3`,
        p.hyphId, p.communityId, p.jobId,
      );
      updated++;
    }
    console.log(`\n  Linked ${updated} jobs (${skipped} already linked).`);
  }

  // ── AFTER ───────────────────────────────────────────────────────────────
  bar('RESULT');
  const after = await snapshotCounts(likePat);
  const rate = after.jobs ? (after.linked / after.jobs * 100).toFixed(1) : '0.0';
  console.log(`\n  Before → After (builder: ${BUILDER_ARG})`);
  console.log(`    Jobs with hyphenJobId:   ${before.linked} → ${after.linked}  (+${after.linked - before.linked})`);
  console.log(`    Jobs with communityId:   ${before.withComm} → ${after.withComm}  (+${after.withComm - before.withComm})`);
  console.log(`    Match rate:              ${after.linked}/${after.jobs} (${rate}%)`);
  console.log(`    Universe:                ${after.hypTotal} HyphenOrders, ${after.jobs} Jobs`);

  const [noStreet] = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "Job"
     WHERE LOWER("builderName") LIKE $1
       AND ("jobAddress" IS NULL OR "jobAddress" !~ '^\\d+ ')
  `, likePat);
  console.log(`\n  Jobs without a real street address (un-linkable): ${noStreet.n}`);

  if (!APPLY) console.log(`\n  (dry-run — re-run with --apply to write)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
