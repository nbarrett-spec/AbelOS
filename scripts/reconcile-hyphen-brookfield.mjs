// ─────────────────────────────────────────────────────────────────────────────
// reconcile-hyphen-brookfield.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Diagnoses and repairs the Hyphen → Aegis Job linker for Brookfield orders.
//
// Why this exists:
//   HyphenOrder.subdivision carries plan-tier variants like "The Grove Frisco 55s"
//   and "The Grove Frisco 40s". Aegis Community stores the canonical neighborhood
//   as a single row ("The Grove", Frisco, Brookfield). Name-only matching misses
//   every row. This script:
//     1. Prints before-state counts (HyphenOrder total, Brookfield jobs, links).
//     2. Ensures a HyphenCommunityMapping audit table exists.
//     3. Fuzzy-maps each distinct Hyphen subdivision to a Brookfield Community
//        row (token-overlap, cascading to "primary fallback" for plan-tier labels).
//     4. Links HyphenOrder → Job using street-address prefix (the only shared
//        high-signal field). Sets Job.hyphenJobId and Job.communityId.
//     5. Prints after-state and a diff.
//
// Usage:   node scripts/reconcile-hyphen-brookfield.mjs           # dry-run preview
//          node scripts/reconcile-hyphen-brookfield.mjs --apply   # write changes
//
// Idempotent: re-running --apply is safe (upserts on mapping, skips already-linked
// jobs). Budget: < 5 seconds on current volumes (~72 Hyphen orders, ~80 Jobs).
// ─────────────────────────────────────────────────────────────────────────────
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

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
  // Drop trailing "drive/ln/st/ct/mews/lane/trail/rd" so prefix match works both ways
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
    // score = shared tokens / community token count (favors fully-contained community names)
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

async function snapshotCounts() {
  const [hypTotal] = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "HyphenOrder"`);
  const [bfJobs] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'`,
  );
  const [linked] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job"
      WHERE LOWER("builderName") LIKE '%brookfield%' AND "hyphenJobId" IS NOT NULL`,
  );
  const [withComm] = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job"
      WHERE LOWER("builderName") LIKE '%brookfield%' AND "communityId" IS NOT NULL`,
  );
  return { hypTotal: hypTotal.n, bfJobs: bfJobs.n, linked: linked.n, withComm: withComm.n };
}

async function main() {
  bar(APPLY ? 'HYPHEN BROOKFIELD RECONCILIATION (APPLY)' : 'HYPHEN BROOKFIELD RECONCILIATION (DRY-RUN)');

  // ── BEFORE ──────────────────────────────────────────────────────────────
  const before = await snapshotCounts();
  console.log(`\nBefore:`);
  console.log(`  HyphenOrder total:           ${before.hypTotal}`);
  console.log(`  Brookfield Jobs:             ${before.bfJobs}`);
  console.log(`  Jobs with hyphenJobId:       ${before.linked}`);
  console.log(`  Jobs with communityId:       ${before.withComm}`);

  // ── STEP 1: community mappings ──────────────────────────────────────────
  await ensureMappingTable();

  // Prefer the Brookfield builder that actually owns Community rows. There are
  // two Brookfield rows in the DB (a Bolt-imported stub + the real one); only
  // one has communities attached.
  const brookfieldCandidates = await prisma.$queryRawUnsafe(`
    SELECT b."id", b."companyName", COUNT(c."id")::int AS comm_count
      FROM "Builder" b
      LEFT JOIN "Community" c ON c."builderId" = b."id"
     WHERE LOWER(b."companyName") LIKE '%brookfield%'
     GROUP BY b."id", b."companyName"
     ORDER BY comm_count DESC, b."companyName"
  `);
  if (!brookfieldCandidates.length) {
    console.log('\nNo Brookfield builder row found — aborting.');
    return;
  }
  console.log(`\nBrookfield builder candidates:`);
  brookfieldCandidates.forEach(b => console.log(`   ${b.id}  ${b.companyName}  (communities: ${b.comm_count})`));
  const bfBuilderId = brookfieldCandidates[0].id;
  console.log(`Using: ${bfBuilderId} (${brookfieldCandidates[0].companyName})`);

  const communities = await prisma.$queryRawUnsafe(
    `SELECT "id", "name" FROM "Community" WHERE "builderId" = $1`, bfBuilderId,
  );
  if (!communities.length) {
    console.log(`\nSelected Brookfield builder has no Community rows — aborting.`);
    return;
  }

  const hypSubs = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "subdivision" FROM "HyphenOrder"
     WHERE "subdivision" IS NOT NULL AND "subdivision" <> ''
  `);

  bar('STEP 1 — Community mapping');
  console.log(`\nHyphen subdivisions:        ${hypSubs.length}`);
  console.log(`Brookfield communities:     ${communities.length}`);
  communities.forEach(c => console.log(`  [${c.id.slice(0, 8)}…]  ${c.name}`));

  const mappings = [];
  for (const { subdivision } of hypSubs) {
    const hit = matchCommunity(subdivision, communities);
    if (hit) {
      mappings.push({ subdivision, communityId: hit.id, communityName: hit.name, score: hit.score, method: 'token-overlap' });
    } else {
      // Fallback: if there's exactly ONE Brookfield community, assume it
      if (communities.length === 1) {
        mappings.push({
          subdivision, communityId: communities[0].id,
          communityName: communities[0].name, score: 0, method: 'single-community-fallback',
        });
      } else {
        mappings.push({ subdivision, communityId: null, communityName: null, score: 0, method: 'NO-MATCH' });
      }
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
      `, m.subdivision, m.communityId, bfBuilderId, m.method, m.score);
    }
    console.log(`\n  Wrote ${mappings.filter(m => m.communityId).length} mapping rows.`);
  }

  // ── STEP 2: Link Jobs → HyphenOrders by normalized street address ──────
  bar('STEP 2 — Job ↔ HyphenOrder link by street address');

  const bfJobs = await prisma.$queryRawUnsafe(`
    SELECT "id", "jobAddress", "community", "communityId", "hyphenJobId"
      FROM "Job"
     WHERE LOWER("builderName") LIKE '%brookfield%'
       AND "jobAddress" IS NOT NULL AND "jobAddress" <> ''
  `);
  const hypOrders = await prisma.$queryRawUnsafe(`
    SELECT "hyphId", "address", "subdivision"
      FROM "HyphenOrder"
     WHERE "address" IS NOT NULL AND "address" <> ''
  `);

  // Index Hyphen orders by normalized street (multiple orders can share one street)
  const hypByStreet = new Map();
  for (const h of hypOrders) {
    const k = normStreet(h.address);
    if (!k || !/^\d/.test(k)) continue;
    if (!hypByStreet.has(k)) hypByStreet.set(k, []);
    hypByStreet.get(k).push(h);
  }
  // Also index by "partial" keys so "15367 boxthorn" matches "15367 boxthorn drive"
  const hypStreetKeys = [...hypByStreet.keys()];

  const plan = []; // { jobId, jobAddr, hyphId, communityId }
  for (const j of bfJobs) {
    const js = normStreet(j.jobAddress);
    if (!js || !/^\d/.test(js)) continue;
    // exact, then prefix (either direction)
    let matchKey = hypByStreet.has(js)
      ? js
      : hypStreetKeys.find(k => k.startsWith(js + ' ') || js.startsWith(k + ' ') || k === js);
    if (!matchKey) continue;
    const hit = hypByStreet.get(matchKey)[0]; // any matching HyphenOrder is fine for linking
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

  console.log(`\nCandidate links:  ${plan.length} / ${bfJobs.length} Brookfield jobs with addresses`);
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
  const after = await snapshotCounts();
  console.log(`\n  Before → After`);
  console.log(`    Jobs with hyphenJobId:   ${before.linked} → ${after.linked}  (+${after.linked - before.linked})`);
  console.log(`    Jobs with communityId:   ${before.withComm} → ${after.withComm}  (+${after.withComm - before.withComm})`);
  console.log(`    Universe: ${after.hypTotal} HyphenOrders, ${after.bfJobs} Brookfield Jobs`);

  // Why isn't it 80/80? Most of the 80 BF jobs carry seed jobAddress like
  // "Copper Canyon - Lot 50" — no street number. Print the gap.
  const noStreet = await prisma.$queryRawUnsafe(`
    SELECT COUNT(*)::int AS n FROM "Job"
     WHERE LOWER("builderName") LIKE '%brookfield%'
       AND ("jobAddress" IS NULL OR "jobAddress" !~ '^\\d+ ')
  `);
  console.log(`\n  Jobs without a real street address (un-linkable): ${noStreet[0].n}`);

  if (!APPLY) console.log(`\n  (dry-run — re-run with --apply to write)`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
