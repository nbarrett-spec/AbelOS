// ─────────────────────────────────────────────────────────────────────────────
// reconcile-bolt-ids.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Rebuilds the Bolt ↔ Aegis bridge after the "15 of 4,884" discovery.
//
// FINDINGS (dry-run diagnostics before writing this):
//   BoltWorkOrder.boltId     → 8-digit WORK-ORDER id (4,884 rows, 4,883 len=8, 1 len=4)
//   Job.boltJobId            → 7-digit JOB id        (197 rows set)
//   BoltJob.boltId           → 7-digit JOB id        (787 rows)
//   ─ These are two distinct Bolt id spaces. WO.boltId NEVER equals Job.boltJobId.
//   ─ Direct match 0. Prefix/suffix/substring 0. The only bridge is via BoltJob
//     (the 7-digit space), and BoltJob ↔ WO is joined by jobAddress.
//
// STRATEGY CASCADE (highest confidence first):
//   Phase A: Backfill Job.boltJobId from BoltJob on unique normalized-address match.
//            (picks up ~148 Jobs that had a BoltJob twin but no id set)
//   Phase B: Link BoltWorkOrder.jobId in this order:
//            B1. WO.addr → BoltJob (unique) → Job(boltJobId)       [confidence: high]
//            B2. WO.addr → Job direct (unique on normalized addr)  [confidence: high]
//            B3. (record unresolved)
//
// SCOPE: Does NOT touch prisma/schema.prisma or InboxItem. Adds two tables/columns
//        via raw CREATE/ALTER IF NOT EXISTS in this script:
//          BoltWorkOrderLink      (boltWorkOrderId, jobId, matchConfidence, matchMethod)
//          BoltWorkOrder.jobId    (already exists — we populate it)
//
// USAGE:
//   node scripts/reconcile-bolt-ids.mjs            # DRY RUN  — report only
//   node scripts/reconcile-bolt-ids.mjs --commit   # APPLY    — write Job + BoltWorkOrder + link table
//
// Idempotent: re-running --commit only updates rows that changed or were blank.
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL);
const COMMIT = process.argv.includes('--commit');

function bar(s) {
  console.log('\n' + '═'.repeat(68));
  console.log('  ' + s);
  console.log('═'.repeat(68));
}
function sub(s) { console.log('\n─── ' + s); }

// ─── Address normalization ──────────────────────────────────────────────────
// "1617 Barnwood Rd." / "1617 Barnwood Road, Fort Worth, TX" → "1617 barnwood"
// Prefix-safe so either side can be a truncated street-only form.
function normAddr(s) {
  if (!s) return '';
  const head = String(s).toLowerCase().split(/,|\s-\s/)[0].trim()
    .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const m = head.match(/^(\d+)\s+([a-z]+(?:\s+[a-z]+){0,3})$/);
  if (!m) return head;
  let out = `${m[1]} ${m[2]}`;
  const suffix = /\s(drive|dr|lane|ln|street|st|road|rd|court|ct|mews|trail|tr|way|circle|cir|place|pl|avenue|ave)$/;
  while (suffix.test(out)) out = out.replace(suffix, '');
  return out.trim();
}

async function ensureSchema() {
  // Link table (audit trail for each match — which method, which confidence).
  await sql`
    CREATE TABLE IF NOT EXISTS "BoltWorkOrderLink" (
      "id"                TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "boltWorkOrderId"   TEXT NOT NULL,
      "jobId"             TEXT NOT NULL,
      "boltJobId"         TEXT,
      "matchMethod"       TEXT NOT NULL,
      "matchConfidence"   TEXT NOT NULL,
      "createdAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"         TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("boltWorkOrderId")
    )`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_bwol_job" ON "BoltWorkOrderLink" ("jobId")`;
}

// ─── Loaders ────────────────────────────────────────────────────────────────
async function loadAll() {
  const [bwos, bjs, jobs] = await Promise.all([
    sql`SELECT "boltId","jobAddress","jobId" FROM "BoltWorkOrder"`,
    sql`SELECT "boltId","address" FROM "BoltJob"`,
    sql`SELECT "id","boltJobId","jobAddress" FROM "Job"`,
  ]);
  return { bwos, bjs, jobs };
}

function buildIndex({ bwos, bjs, jobs }) {
  const bjByAddr = new Map();          // normAddr → [BoltJob]
  for (const bj of bjs) {
    const k = normAddr(bj.address);
    if (!k) continue;
    (bjByAddr.get(k) || bjByAddr.set(k, []).get(k)).push(bj);
  }
  const jobByBoltJobId = new Map();    // 7-digit boltJobId → [Job]
  const jobByAddr      = new Map();    // normAddr → [Job]
  for (const j of jobs) {
    if (j.boltJobId) {
      (jobByBoltJobId.get(j.boltJobId) || jobByBoltJobId.set(j.boltJobId, []).get(j.boltJobId)).push(j);
    }
    const k = normAddr(j.jobAddress);
    if (!k) continue;
    (jobByAddr.get(k) || jobByAddr.set(k, []).get(k)).push(j);
  }
  return { bjByAddr, jobByBoltJobId, jobByAddr };
}

// ─── Phase A: Backfill Job.boltJobId from BoltJob via unique address ────────
// Only when BOTH sides are unique on the address:
//   - exactly 1 BoltJob at that normalized address
//   - exactly 1 Aegis Job at that normalized address
// Backfilling multiple Jobs with the same boltJobId would corrupt identity
// and create chain ambiguity that defeats Phase B.
async function phaseA(jobs, bjByAddr, jobByAddr) {
  sub('Phase A — Backfill Job.boltJobId from BoltJob (unique-on-both-sides)');
  const plan = []; // { jobId, boltJobId, fromAddr }
  for (const j of jobs) {
    if (j.boltJobId) continue;
    const k = normAddr(j.jobAddress);
    const bjList = bjByAddr.get(k) || [];
    const sameAddrJobs = jobByAddr.get(k) || [];
    if (bjList.length !== 1) continue;
    if (sameAddrJobs.length !== 1) continue; // don't propagate a boltJobId to duplicate Jobs
    plan.push({ jobId: j.id, boltJobId: bjList[0].boltId, fromAddr: j.jobAddress });
  }
  console.log(`   candidates: ${plan.length} jobs would get a boltJobId populated`);
  console.log(`   sample:`, plan.slice(0, 5));

  // Always apply in-memory so Phase B reflects the planned final state.
  const jobMap = new Map(jobs.map(j => [j.id, j]));
  for (const p of plan) {
    const row = jobMap.get(p.jobId);
    if (row && !row.boltJobId) row.boltJobId = p.boltJobId;
  }

  if (!COMMIT) return { updated: 0, plan };

  let updated = 0;
  for (const p of plan) {
    try {
      await sql`UPDATE "Job" SET "boltJobId" = ${p.boltJobId}, "updatedAt" = CURRENT_TIMESTAMP
                WHERE "id" = ${p.jobId} AND "boltJobId" IS NULL`;
      updated++;
    } catch (e) {
      if (updated < 3) console.warn(`   phaseA skip ${p.jobId}: ${e.message?.slice(0,120)}`);
    }
  }
  console.log(`   updated: ${updated} jobs (committed)`);
  return { updated, plan };
}

// ─── Phase B: Link BoltWorkOrder.jobId via cascade ──────────────────────────
async function phaseB(bwos, idx) {
  sub('Phase B — Link BoltWorkOrder → Job (cascade)');
  const links = []; // { woBoltId, jobId, boltJobId, method, confidence }
  const stats = {
    B1_chain_unique: 0,
    B1_chain_ambiguous: 0,
    B2_direct_unique: 0,
    B2_direct_ambiguous: 0,
    unresolved_no_boltjob: 0,
    unresolved_boltjob_orphan: 0,
    unresolved_addr_miss: 0,
  };

  for (const w of bwos) {
    const k = normAddr(w.jobAddress);
    const bjList = idx.bjByAddr.get(k) || [];

    // Gather all candidate Jobs from both strategies independently.
    const chainReached = new Map(); // jobId → boltJobId
    for (const bj of bjList) {
      const js = idx.jobByBoltJobId.get(bj.boltId) || [];
      for (const j of js) chainReached.set(j.id, bj.boltId);
    }
    const directJobs = idx.jobByAddr.get(k) || [];

    const chainUnique  = chainReached.size === 1 ? [...chainReached.keys()][0] : null;
    const directUnique = directJobs.length === 1 ? directJobs[0].id : null;

    // Best case: both agree → high confidence
    if (chainUnique && directUnique && chainUnique === directUnique) {
      const jobId = chainUnique;
      links.push({ woBoltId: w.boltId, jobId, boltJobId: chainReached.get(jobId), method: 'addr_to_boltjob_to_job+direct_agree', confidence: 'high' });
      stats.B1_chain_unique++;
      continue;
    }
    // Direct address unique (normalized) — the street address is the primary high-signal field.
    // Preferred over ambiguous-chain cases because "this exact address → this Job" is unambiguous
    // when only one Aegis Job has that address, regardless of how many BoltJobs share the address.
    if (directUnique) {
      const j = directJobs[0];
      links.push({ woBoltId: w.boltId, jobId: directUnique, boltJobId: j.boltJobId || null, method: 'addr_to_job_direct', confidence: j.boltJobId ? 'high' : 'medium' });
      stats.B2_direct_unique++;
      continue;
    }
    // Chain unique (BoltJob disambiguates when multiple Jobs share an address).
    if (chainUnique) {
      links.push({ woBoltId: w.boltId, jobId: chainUnique, boltJobId: chainReached.get(chainUnique), method: 'addr_to_boltjob_to_job', confidence: 'high' });
      stats.B1_chain_unique++;
      continue;
    }

    // Neither unique → unresolved
    if (chainReached.size > 1) stats.B1_chain_ambiguous++;
    if (directJobs.length > 1) stats.B2_direct_ambiguous++;
    if (!bjList.length && !directJobs.length) stats.unresolved_addr_miss++;
    else if (bjList.length && directJobs.length === 0 && chainReached.size === 0) stats.unresolved_boltjob_orphan++;
  }

  console.log(`   total WOs:                  ${bwos.length}`);
  console.log(`   B1 chain (addr→BoltJob→Job) ${stats.B1_chain_unique} unique, ${stats.B1_chain_ambiguous} ambiguous`);
  console.log(`   B2 direct (addr→Job)        ${stats.B2_direct_unique} unique, ${stats.B2_direct_ambiguous} ambiguous`);
  console.log(`   TOTAL linkable              ${links.length}  (${(links.length/bwos.length*100).toFixed(1)}%)`);
  console.log(`   unresolved — BoltJob orphan (no Aegis Job for this addr): ${stats.unresolved_boltjob_orphan}`);
  console.log(`   unresolved — addr not seen in BoltJob or Job:             ${stats.unresolved_addr_miss}`);
  console.log(`   unresolved — ambiguous only:                              ${stats.B1_chain_ambiguous + stats.B2_direct_ambiguous - (stats.B1_chain_ambiguous && stats.B2_direct_ambiguous ? 0 : 0)}`);

  if (!COMMIT) return { written: 0, links, stats };

  // Write links + set BoltWorkOrder.jobId.
  let written = 0;
  for (const l of links) {
    try {
      await sql`
        INSERT INTO "BoltWorkOrderLink"
          ("boltWorkOrderId","jobId","boltJobId","matchMethod","matchConfidence")
        VALUES (${l.woBoltId}, ${l.jobId}, ${l.boltJobId}, ${l.method}, ${l.confidence})
        ON CONFLICT ("boltWorkOrderId") DO UPDATE SET
          "jobId" = EXCLUDED."jobId",
          "boltJobId" = EXCLUDED."boltJobId",
          "matchMethod" = EXCLUDED."matchMethod",
          "matchConfidence" = EXCLUDED."matchConfidence",
          "updatedAt" = CURRENT_TIMESTAMP`;
      await sql`UPDATE "BoltWorkOrder" SET "jobId" = ${l.jobId} WHERE "boltId" = ${l.woBoltId}`;
      written++;
    } catch (e) {
      if (written < 3) console.warn(`   phaseB skip ${l.woBoltId}: ${e.message?.slice(0,160)}`);
    }
  }
  console.log(`   link rows written:          ${written}`);
  return { written, links, stats };
}

// ─── Verify ─────────────────────────────────────────────────────────────────
async function verify() {
  sub('Verification');
  const [jobs, wos, links] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM "Job" WHERE "boltJobId" IS NOT NULL`,
    sql`SELECT COUNT(*)::int AS n FROM "BoltWorkOrder" WHERE "jobId" IS NOT NULL`,
    sql`SELECT COUNT(*)::int AS n FROM "BoltWorkOrderLink"`,
  ]);
  console.log(`   Jobs with boltJobId:            ${jobs[0].n}`);
  console.log(`   BoltWorkOrders with jobId:      ${wos[0].n}`);
  console.log(`   BoltWorkOrderLink rows:         ${links[0].n}`);
  const byMethod = await sql`
    SELECT "matchMethod","matchConfidence",COUNT(*)::int AS n
    FROM "BoltWorkOrderLink"
    GROUP BY "matchMethod","matchConfidence"
    ORDER BY n DESC`;
  console.log(`   Breakdown by method/confidence:`);
  for (const r of byMethod) console.log(`     ${r.matchMethod.padEnd(28)} ${r.matchConfidence.padEnd(8)} ${r.n}`);
}

async function main() {
  bar(`BOLT ↔ AEGIS RECONCILIATION   ${COMMIT ? '(COMMIT)' : '(dry-run)'}`);
  await ensureSchema();

  sub('Loading data');
  const { bwos, bjs, jobs } = await loadAll();
  console.log(`   BoltWorkOrder: ${bwos.length}`);
  console.log(`   BoltJob:       ${bjs.length}`);
  console.log(`   Job:           ${jobs.length}  (${jobs.filter(j => j.boltJobId).length} with boltJobId)`);

  const idx0 = buildIndex({ bwos, bjs, jobs });

  // Phase A updates Job.boltJobId in DB + in-memory
  const A = await phaseA(jobs, idx0.bjByAddr, idx0.jobByAddr);

  // Rebuild index so Phase B sees backfills
  const idx1 = buildIndex({ bwos, bjs, jobs });
  const B = await phaseB(bwos, idx1);

  if (COMMIT) await verify();
  else console.log('\n   (dry-run — no writes. Re-run with --commit to apply.)');

  bar('DONE');
  console.log(`   Phase A: ${A.updated || A.plan.length} Job.boltJobId backfills`);
  console.log(`   Phase B: ${B.written || B.links.length} WO→Job links`);
  console.log(`   Unresolved:`);
  console.log(`     BoltJob orphan (no Aegis Job for addr): ${B.stats.unresolved_boltjob_orphan}`);
  console.log(`     Addr not seen anywhere:                 ${B.stats.unresolved_addr_miss}`);
  console.log(`     Ambiguous:                              ${B.stats.B1_chain_ambiguous + B.stats.B2_direct_ambiguous}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
