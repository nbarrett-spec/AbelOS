#!/usr/bin/env node
/**
 * scripts/consolidate-floorplans.mjs
 *
 * Consolidates BoltFloorplan (77 rows, legacy Bolt scrape) into the canonical
 * CommunityFloorPlan table (the one the ops/communities UI reads from).
 *
 * Why this script exists:
 *   Three tables currently hold floor-plan-like data:
 *     - FloorPlan         (2 rows)  -- Prisma-declared, BUT tied to Project.id
 *                                      and stores blueprint PDF uploads. Totally
 *                                      different concept from community plan
 *                                      catalog. LEFT ALONE.
 *     - CommunityFloorPlan (38 rows) -- canonical community catalog (The Aspen,
 *                                      Plan 2450, sqft, bedrooms). This is what
 *                                      /api/ops/communities/[id] returns for the
 *                                      community detail page. TARGET.
 *     - BoltFloorplan     (77 rows) -- scraped from legacy Bolt ERP. SOURCE.
 *
 * UI surface:
 *   - src/app/api/ops/communities/[id]/route.ts:53 reads CommunityFloorPlan.
 *   - src/app/api/ops/communities/route.ts:52 counts CommunityFloorPlan.
 *   No UI change required — we just enrich the canonical table.
 *
 * Filtering logic (quality gate):
 *   - Skip BoltFloorplan rows with community = 'OYL' (one-year-later bucket,
 *     not an actual community).
 *   - Skip rows with junk plan names: 'NOT KNOWN', 'Floor Plan', or any name
 *     starting with 'NOT KNOWN -' or 'BUILDER SERVICE'.
 *   - For remaining rows:
 *       a) Match community by case-insensitive name against existing Community.
 *       b) If no Community match, look up Builder by customer name
 *          (case-insensitive, containment on either side). If builder found,
 *          create a minimal Community shell (name + builderId).
 *       c) If no builder can be resolved, skip and log.
 *
 * Idempotency:
 *   CommunityFloorPlan has @@unique([communityId, name]), so we use
 *   ON CONFLICT (communityId, name) DO NOTHING. Safe to re-run.
 *
 * Usage:
 *   node scripts/consolidate-floorplans.mjs           # dry run (default)
 *   node scripts/consolidate-floorplans.mjs --apply   # write to DB
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, '..', '.env');
const dbUrl = readFileSync(envPath, 'utf-8').match(/DATABASE_URL="([^"]+)"/)?.[1];
if (!dbUrl) {
  console.error('No DATABASE_URL found in .env');
  process.exit(1);
}

const APPLY = process.argv.includes('--apply');

const { neon } = await import('@neondatabase/serverless');
const sql = neon(dbUrl);

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const JUNK_COMMUNITY_NAMES = new Set(['oyl', '']);
const JUNK_PLAN_PATTERNS = [
  /^not known$/i,
  /^floor plan$/i,
  /^not known\s*-/i,
  /^builder service/i,
];

function isJunkCommunity(name) {
  if (!name) return true;
  return JUNK_COMMUNITY_NAMES.has(String(name).trim().toLowerCase());
}

function isJunkPlanName(name) {
  if (!name) return true;
  const n = String(name).trim();
  if (!n) return true;
  return JUNK_PLAN_PATTERNS.some(rx => rx.test(n));
}

function cleanStr(s) {
  return s == null ? null : String(s).trim() || null;
}

function cuid() {
  // Lightweight cuid-ish (good enough for a short-running script; unique check is on
  // (communityId, name) anyway). Format: c + ~14 chars.
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/**
 * Match a customer string to a Builder row.
 * Tries exact case-insensitive, then containment (either direction).
 */
async function resolveBuilder(customer, builderCache) {
  if (!customer) return null;
  const key = customer.trim().toLowerCase();
  if (builderCache.has(key)) return builderCache.get(key);

  // Exact match
  const exact = await sql`
    SELECT id, "companyName" FROM "Builder"
    WHERE LOWER("companyName") = ${key}
    ORDER BY "createdAt" ASC
    LIMIT 1
  `;
  if (exact.length) {
    builderCache.set(key, exact[0]);
    return exact[0];
  }

  // Containment
  const like = `%${key}%`;
  const partial = await sql`
    SELECT id, "companyName" FROM "Builder"
    WHERE LOWER("companyName") LIKE ${like}
       OR ${key} LIKE LOWER("companyName") || '%'
    ORDER BY LENGTH("companyName") ASC
    LIMIT 1
  `;
  if (partial.length) {
    builderCache.set(key, partial[0]);
    return partial[0];
  }

  builderCache.set(key, null);
  return null;
}

/**
 * Find Community by case-insensitive name (optionally scoped to a builder).
 * If multiple match the name across builders, prefer the builder-scoped one.
 */
async function resolveCommunity(communityName, builderId, communityCache) {
  const key = `${(builderId || '*')}::${communityName.trim().toLowerCase()}`;
  if (communityCache.has(key)) return communityCache.get(key);

  if (builderId) {
    const scoped = await sql`
      SELECT id, name, "builderId" FROM "Community"
      WHERE "builderId" = ${builderId}
        AND LOWER(name) = ${communityName.trim().toLowerCase()}
      LIMIT 1
    `;
    if (scoped.length) {
      communityCache.set(key, scoped[0]);
      return scoped[0];
    }
  }

  const any = await sql`
    SELECT id, name, "builderId" FROM "Community"
    WHERE LOWER(name) = ${communityName.trim().toLowerCase()}
    LIMIT 1
  `;
  if (any.length) {
    communityCache.set(key, any[0]);
    return any[0];
  }

  communityCache.set(key, null);
  return null;
}

async function createCommunity(name, builderId) {
  const id = cuid();
  await sql`
    INSERT INTO "Community" (id, "builderId", name, status, "totalLots", "activeLots", "totalRevenue", "totalOrders", "createdAt", "updatedAt")
    VALUES (${id}, ${builderId}, ${name}, 'ACTIVE', 0, 0, 0, 0, NOW(), NOW())
    ON CONFLICT ("builderId", name) DO NOTHING
  `;
  const created = await sql`
    SELECT id, name, "builderId" FROM "Community"
    WHERE "builderId" = ${builderId} AND name = ${name}
    LIMIT 1
  `;
  return created[0];
}

async function upsertCommunityFloorPlan({ communityId, name, planNumber, sqFootage }) {
  const id = cuid();
  const result = await sql`
    INSERT INTO "CommunityFloorPlan" (
      id, "communityId", name, "planNumber", "sqFootage", active, "createdAt", "updatedAt"
    )
    VALUES (
      ${id}, ${communityId}, ${name}, ${planNumber}, ${sqFootage}, true, NOW(), NOW()
    )
    ON CONFLICT ("communityId", name) DO NOTHING
    RETURNING id
  `;
  return result.length > 0; // true if inserted, false if conflict
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(72));
  console.log('  Floor Plan Consolidation');
  console.log(`  Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log('='.repeat(72));

  const before = {
    FloorPlan: (await sql`SELECT COUNT(*)::int c FROM "FloorPlan"`)[0].c,
    CommunityFloorPlan: (await sql`SELECT COUNT(*)::int c FROM "CommunityFloorPlan"`)[0].c,
    BoltFloorplan: (await sql`SELECT COUNT(*)::int c FROM "BoltFloorplan"`)[0].c,
    Community: (await sql`SELECT COUNT(*)::int c FROM "Community"`)[0].c,
  };
  console.log('\nBefore:');
  console.log(`  FloorPlan:          ${before.FloorPlan}`);
  console.log(`  CommunityFloorPlan: ${before.CommunityFloorPlan}`);
  console.log(`  BoltFloorplan:      ${before.BoltFloorplan}`);
  console.log(`  Community:          ${before.Community}`);

  const boltRows = await sql`
    SELECT "boltId", name, sqft, community, customer, city, state
    FROM "BoltFloorplan"
    ORDER BY community, name
  `;

  const builderCache = new Map();
  const communityCache = new Map();
  const stats = {
    totalScanned: boltRows.length,
    skippedJunkCommunity: 0,
    skippedJunkPlanName: 0,
    skippedNoBuilder: 0,
    matchedCommunity: 0,
    createdCommunity: 0,
    insertedFloorPlan: 0,
    skippedDuplicate: 0,
  };
  const skips = [];
  const creates = [];
  const inserts = [];
  const dupes = [];

  for (const row of boltRows) {
    const community = cleanStr(row.community);
    const name = cleanStr(row.name);
    const customer = cleanStr(row.customer);

    if (isJunkCommunity(community)) {
      stats.skippedJunkCommunity++;
      skips.push({ boltId: row.boltId, reason: 'junk community', community, name, customer });
      continue;
    }
    if (isJunkPlanName(name)) {
      stats.skippedJunkPlanName++;
      skips.push({ boltId: row.boltId, reason: 'junk plan name', community, name, customer });
      continue;
    }

    // Resolve or create Community
    let comm = await resolveCommunity(community, null, communityCache);
    if (!comm) {
      const builder = await resolveBuilder(customer, builderCache);
      if (!builder) {
        stats.skippedNoBuilder++;
        skips.push({ boltId: row.boltId, reason: 'no builder match', community, name, customer });
        continue;
      }
      if (APPLY) {
        comm = await createCommunity(community, builder.id);
      } else {
        comm = { id: '<new>', name: community, builderId: builder.id };
      }
      stats.createdCommunity++;
      creates.push({ community, builder: builder.companyName, builderId: builder.id });
      communityCache.set(`*::${community.toLowerCase()}`, comm);
    } else {
      stats.matchedCommunity++;
    }

    // Upsert the floor plan
    if (APPLY) {
      const inserted = await upsertCommunityFloorPlan({
        communityId: comm.id,
        name,
        planNumber: null,
        sqFootage: row.sqft ?? null,
      });
      if (inserted) {
        stats.insertedFloorPlan++;
        inserts.push({ community: comm.name, name, sqft: row.sqft });
      } else {
        stats.skippedDuplicate++;
        dupes.push({ community: comm.name, name });
      }
    } else {
      // Dry run: predict dupe
      const existing = await sql`
        SELECT 1 FROM "CommunityFloorPlan"
        WHERE "communityId" = ${comm.id === '<new>' ? '__never__' : comm.id}
          AND name = ${name}
        LIMIT 1
      `;
      if (existing.length) {
        stats.skippedDuplicate++;
        dupes.push({ community: comm.name, name });
      } else {
        stats.insertedFloorPlan++;
        inserts.push({ community: comm.name, name, sqft: row.sqft });
      }
    }
  }

  console.log('\n' + '─'.repeat(72));
  console.log('Results:');
  console.log('─'.repeat(72));
  console.log(`  Bolt rows scanned:         ${stats.totalScanned}`);
  console.log(`  Skipped (junk community):  ${stats.skippedJunkCommunity}`);
  console.log(`  Skipped (junk plan name):  ${stats.skippedJunkPlanName}`);
  console.log(`  Skipped (no builder):      ${stats.skippedNoBuilder}`);
  console.log(`  Matched existing Community: ${stats.matchedCommunity}`);
  console.log(`  Created new Community:     ${stats.createdCommunity}`);
  console.log(`  CommunityFloorPlan ${APPLY ? 'inserted' : 'would insert'}: ${stats.insertedFloorPlan}`);
  console.log(`  Duplicate (skipped):       ${stats.skippedDuplicate}`);

  if (creates.length) {
    console.log('\nCommunities to create:');
    creates.forEach(c => console.log(`  + ${c.community}  (builder: ${c.builder})`));
  }
  if (inserts.length) {
    console.log(`\nFloor plans to insert (${inserts.length}):`);
    inserts.slice(0, 30).forEach(i => console.log(`  + [${i.community}] ${i.name}${i.sqft ? ` (${i.sqft} sqft)` : ''}`));
    if (inserts.length > 30) console.log(`  ... and ${inserts.length - 30} more`);
  }
  if (skips.length) {
    const reasonCounts = skips.reduce((acc, s) => { acc[s.reason] = (acc[s.reason] || 0) + 1; return acc; }, {});
    console.log('\nSkip reasons:');
    Object.entries(reasonCounts).forEach(([r, n]) => console.log(`  ${r}: ${n}`));
  }

  const after = {
    FloorPlan: (await sql`SELECT COUNT(*)::int c FROM "FloorPlan"`)[0].c,
    CommunityFloorPlan: (await sql`SELECT COUNT(*)::int c FROM "CommunityFloorPlan"`)[0].c,
    BoltFloorplan: (await sql`SELECT COUNT(*)::int c FROM "BoltFloorplan"`)[0].c,
    Community: (await sql`SELECT COUNT(*)::int c FROM "Community"`)[0].c,
  };
  console.log('\nAfter:');
  console.log(`  FloorPlan:          ${after.FloorPlan}  (${after.FloorPlan - before.FloorPlan >= 0 ? '+' : ''}${after.FloorPlan - before.FloorPlan})`);
  console.log(`  CommunityFloorPlan: ${after.CommunityFloorPlan}  (${after.CommunityFloorPlan - before.CommunityFloorPlan >= 0 ? '+' : ''}${after.CommunityFloorPlan - before.CommunityFloorPlan})`);
  console.log(`  BoltFloorplan:      ${after.BoltFloorplan}  (unchanged — legacy table left intact)`);
  console.log(`  Community:          ${after.Community}  (${after.Community - before.Community >= 0 ? '+' : ''}${after.Community - before.Community})`);

  if (!APPLY) {
    console.log('\n[DRY RUN] No changes were written. Re-run with --apply to commit.');
  }
}

main().catch(err => {
  console.error('\nFATAL:', err);
  process.exit(1);
});
