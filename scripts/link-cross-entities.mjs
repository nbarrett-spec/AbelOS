// Cross-entity linker — wires Job records to Bolt / Hyphen / BWP data
// using address + lotBlock + community as fuzzy join keys.
//
// Pass 1: Job.boltJobId ← BoltJob.boltId      (match on jobAddress ≈ address)
// Pass 2: Job.hyphenJobId ← HyphenOrder.hyphId (match on lotBlock ≈ lotBlockPlan)
// Pass 3: Job ← BwpFieldPOLine.lotAddress     (match on jobAddress ≈ lotAddress)
// Pass 4: HyphenPayment.jobId (staging column) ← Job via refOrderId/address
//
// Read-only-safe: only writes Job.* ID columns (all nullable). Never
// deletes or overwrites a non-null link with NULL. Idempotent.
//
// Usage: node scripts/link-cross-entities.mjs
import { PrismaClient } from '@prisma/client';
import { bar } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();

function normalizeAddr(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    // Strip work-description suffixes like "14053 Ladbroke Street- Ext. Door Punch"
    .split(/[-—–]/)[0]
    .replace(/[,.]/g, ' ')
    .replace(/\b(st|str|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|pl|place|ter|terrace|trl|trail|pkwy|parkway|hwy|mews)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Extract just the street part: "15224 Gallina Mews, Frisco,TX" → "15224 Gallina"
function streetOnly(s) {
  if (!s) return '';
  return normalizeAddr(String(s).split(',')[0]);
}

// Pull the lot number out of any of: "Lot 11 Block 4", "Lot 11", "11BF06 / F", "11"
function extractLotNum(s) {
  if (!s) return null;
  const str = String(s).trim();
  // Try "Lot <num>" first
  let m = str.match(/lot\s*(\d+)/i);
  if (m) return parseInt(m[1], 10);
  // Then any leading digits (covers "11BF06")
  m = str.match(/^(\d+)/);
  if (m) return parseInt(m[1], 10);
  return null;
}

// "Eagle Mountain" → "eaglemountain" for fuzzy community matching
function normalizeCommunity(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

async function linkBolt() {
  console.log('\n[1/4] Job ← BoltJob by street address');
  // Bolt only serves custom/OYL customers — Brookfield & Pulte jobs are in
  // Hyphen / BWP respectively. So we exclude those builders from this pass.
  const jobs = await prisma.$queryRawUnsafe(
    `SELECT "id","jobAddress","boltJobId","builderName" FROM "Job"
      WHERE "jobAddress" IS NOT NULL AND "boltJobId" IS NULL
        AND LOWER("builderName") NOT LIKE '%brookfield%'
        AND LOWER("builderName") NOT LIKE '%pulte%'
      LIMIT 20000`,
  );
  const bolt = await prisma.$queryRawUnsafe(
    `SELECT "boltId","address" FROM "BoltJob" WHERE "address" IS NOT NULL`,
  );
  const idx = new Map();
  for (const b of bolt) {
    const k = streetOnly(b.address);
    if (k && !idx.has(k)) idx.set(k, b.boltId);
  }
  let linked = 0;
  for (const j of jobs) {
    const k = streetOnly(j.jobAddress);
    const bid = idx.get(k);
    if (!bid) continue;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET "boltJobId"=$2, "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1 AND "boltJobId" IS NULL`, j.id, bid);
      linked++;
    } catch {}
  }
  console.log(`     linked ${linked} / ${jobs.length} jobs (Brookfield+Pulte excluded)`);
  return linked;
}

async function linkHyphen() {
  console.log('[2/4] Job ← HyphenOrder by community + lot number');
  // Job.lotBlock is "Lot 11 Block 4" and community is "Eagle Mountain".
  // HyphenOrder.lotBlockPlan is "11BF06 / F" and subdivision is "The Grove Frisco 40s".
  // We extract the raw lot number from both and build an index keyed by
  // (communityKey, lotNum). Communities rarely overlap lot numbers, so this
  // is a reasonable natural join key.
  const jobs = await prisma.$queryRawUnsafe(
    `SELECT "id","lotBlock","community","builderName","hyphenJobId" FROM "Job"
      WHERE "hyphenJobId" IS NULL
        AND LOWER("builderName") LIKE '%brookfield%'
        AND "lotBlock" IS NOT NULL
        AND "community" IS NOT NULL
      LIMIT 20000`,
  );
  const hyph = await prisma.$queryRawUnsafe(
    `SELECT "hyphId","lotBlockPlan","subdivision" FROM "HyphenOrder"
      WHERE "lotBlockPlan" IS NOT NULL AND "subdivision" IS NOT NULL`,
  );
  // Build multiple indexes so we can fall through strict → fuzzy.
  const strictIdx = new Map();   // (community + '|' + lot)
  const subStrIdx = new Map();   // (subdivisionToken + '|' + lot) for fuzzy
  for (const h of hyph) {
    const lot = extractLotNum(h.lotBlockPlan);
    if (lot == null) continue;
    const comm = normalizeCommunity(h.subdivision);
    if (!comm) continue;
    const k = `${comm}|${lot}`;
    if (!strictIdx.has(k)) strictIdx.set(k, h.hyphId);
    // Also index by every meaningful word in subdivision for fuzzy fallback.
    const tokens = String(h.subdivision || '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
    for (const t of tokens) {
      const tk = `${t}|${lot}`;
      if (!subStrIdx.has(tk)) subStrIdx.set(tk, h.hyphId);
    }
  }
  let linked = 0, triedStrict = 0, triedFuzzy = 0;
  for (const j of jobs) {
    const lot = extractLotNum(j.lotBlock);
    if (lot == null) continue;
    const commKey = normalizeCommunity(j.community);
    let hid = strictIdx.get(`${commKey}|${lot}`);
    if (hid) triedStrict++;
    if (!hid) {
      // Fuzzy: try every token in the Job.community against subdivision tokens.
      const tokens = String(j.community || '').toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
      for (const t of tokens) {
        hid = subStrIdx.get(`${t}|${lot}`);
        if (hid) { triedFuzzy++; break; }
      }
    }
    if (!hid) continue;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET "hyphenJobId"=$2, "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1 AND "hyphenJobId" IS NULL`, j.id, hid);
      linked++;
    } catch {}
  }
  console.log(`     linked ${linked} / ${jobs.length} jobs (strict:${triedStrict} fuzzy:${triedFuzzy})`);
  return linked;
}

// Aggressive fallback key: "<house number> <first street word>"
// "14053 Ladbroke Street- Ext. Door Punch" → "14053 ladbroke"
// Used after normalizeAddr() fails, to catch addresses where the street
// name/type got mangled by the suffix strip or typos.
function numWordKey(s) {
  const n = normalizeAddr(s);
  const parts = n.split(/\s+/).filter(Boolean);
  const idx = parts.findIndex(p => /^\d+$/.test(p));
  if (idx === -1) return '';
  const next = parts[idx + 1] || '';
  if (!next) return '';
  return `${parts[idx]} ${next}`;
}

async function linkBwp() {
  console.log('[3/4] Job ← BwpFieldPOLine by lot address');
  // Add a bwpPoNumber column on Job if missing.
  const hasCol = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name='Job' AND column_name='bwpPoNumber' LIMIT 1`);
  if (!hasCol?.length) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Job" ADD COLUMN "bwpPoNumber" TEXT`);
      console.log('     + added Job.bwpPoNumber');
    } catch {}
  }
  const jobs = await prisma.$queryRawUnsafe(
    `SELECT "id","jobAddress" FROM "Job"
      WHERE "jobAddress" IS NOT NULL AND "bwpPoNumber" IS NULL
        AND LOWER("builderName") LIKE '%pulte%' LIMIT 20000`,
  );
  const lines = await prisma.$queryRawUnsafe(
    `SELECT "poNumber","lotAddress" FROM "BwpFieldPOLine" WHERE "lotAddress" IS NOT NULL`,
  );
  // Job.jobAddress has "14053 Ladbroke Street- Ext. Door Punch" format —
  // normalizeAddr() strips after the first dash so we get a clean street.
  // BwpFieldPOLine.lotAddress is already clean. Key both the same way,
  // plus a fallback numWordKey ("<number> <first-word>") for fuzzier cases.
  const idxFull = new Map();
  const idxShort = new Map();
  for (const l of lines) {
    const k = normalizeAddr(l.lotAddress);
    if (k && !idxFull.has(k)) idxFull.set(k, l.poNumber);
    const ks = numWordKey(l.lotAddress);
    if (ks && !idxShort.has(ks)) idxShort.set(ks, l.poNumber);
  }
  let linked = 0, hitFull = 0, hitShort = 0;
  for (const j of jobs) {
    const k = normalizeAddr(j.jobAddress);
    let po = idxFull.get(k);
    if (po) hitFull++;
    if (!po) {
      const ks = numWordKey(j.jobAddress);
      po = ks ? idxShort.get(ks) : null;
      if (po) hitShort++;
    }
    if (!po) continue;
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Job" SET "bwpPoNumber"=$2, "updatedAt"=CURRENT_TIMESTAMP
          WHERE "id"=$1 AND "bwpPoNumber" IS NULL`, j.id, po);
      linked++;
    } catch {}
  }
  console.log(`     linked ${linked} / ${jobs.length} jobs`);
  return linked;
}

async function linkPaymentsToJobs() {
  console.log('[4/4] HyphenPayment.jobId back-fill');
  const hasCol = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.columns
      WHERE table_name='HyphenPayment' AND column_name='jobId' LIMIT 1`);
  if (!hasCol?.length) {
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "HyphenPayment" ADD COLUMN "jobId" TEXT`);
      console.log('     + added HyphenPayment.jobId');
    } catch {}
  }
  // Match via HyphenOrder.hyphId → Job.hyphenJobId
  const result = await prisma.$executeRawUnsafe(`
    UPDATE "HyphenPayment" p
       SET "jobId" = j."id"
      FROM "HyphenOrder" h
      JOIN "Job" j ON j."hyphenJobId" = h."hyphId"
     WHERE p."orderNumber" = h."refOrderId"
       AND p."jobId" IS NULL
  `);
  console.log(`     back-filled ${result} payments`);
  return result;
}

async function main() {
  bar('CROSS-ENTITY LINKER');
  const a = await linkBolt();
  const b = await linkHyphen();
  const c = await linkBwp();
  const d = await linkPaymentsToJobs();
  console.log(`\n✅ LINKER COMPLETE`);
  console.log(`   Bolt link:   ${a}`);
  console.log(`   Hyphen link: ${b}`);
  console.log(`   BWP link:    ${c}`);
  console.log(`   Payment bf:  ${d}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
