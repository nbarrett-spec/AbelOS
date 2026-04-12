// Diagnostic — does Job.community (Brookfield) overlap with HyphenOrder.subdivision?
// The linker's Hyphen pass is stuck at 0/80 after fuzzy matching, so either
// (a) the two sides genuinely describe different neighborhoods, or
// (b) there's a normalization bug. This script dumps both sides so we can eyeball it.
//
// Usage: node scripts/diagnose-hyphen-overlap.mjs
import { PrismaClient } from '@prisma/client';
import { bar } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();

function normalizeCommunity(s) {
  if (!s) return '';
  return String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function tokens(s) {
  return String(s || '').toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length >= 4);
}

async function main() {
  bar('HYPHEN ↔ JOB OVERLAP DIAGNOSTIC');

  const jobRows = await prisma.$queryRawUnsafe(
    `SELECT "community", COUNT(*)::int AS n
       FROM "Job"
      WHERE LOWER("builderName") LIKE '%brookfield%'
        AND "community" IS NOT NULL AND "community" <> ''
      GROUP BY "community"
      ORDER BY n DESC`,
  );
  const hypRows = await prisma.$queryRawUnsafe(
    `SELECT "subdivision", COUNT(*)::int AS n
       FROM "HyphenOrder"
      WHERE "subdivision" IS NOT NULL AND "subdivision" <> ''
      GROUP BY "subdivision"
      ORDER BY n DESC`,
  );

  console.log(`\nJob.community (Brookfield only) — ${jobRows.length} distinct`);
  for (const r of jobRows) console.log(`   ${r.n.toString().padStart(4)}  ${r.community}`);

  console.log(`\nHyphenOrder.subdivision — ${hypRows.length} distinct`);
  for (const r of hypRows) console.log(`   ${r.n.toString().padStart(4)}  ${r.subdivision}`);

  // Normalized token overlap
  const jobTokenSet = new Set();
  for (const r of jobRows) for (const t of tokens(r.community)) jobTokenSet.add(t);
  const hypTokenSet = new Set();
  for (const r of hypRows) for (const t of tokens(r.subdivision)) hypTokenSet.add(t);
  const shared = [...jobTokenSet].filter(t => hypTokenSet.has(t));

  console.log(`\nToken overlap (len>=4): ${shared.length}`);
  console.log(`   Job tokens:    ${[...jobTokenSet].sort().join(', ') || '(none)'}`);
  console.log(`   Hyphen tokens: ${[...hypTokenSet].sort().join(', ') || '(none)'}`);
  console.log(`   Shared:        ${shared.sort().join(', ') || '(NONE — linker cannot work token-wise)'}`);

  // Strict normalized match (letters only)
  const jobNorm = new Set(jobRows.map(r => normalizeCommunity(r.community)));
  const hypNorm = new Set(hypRows.map(r => normalizeCommunity(r.subdivision)));
  const strictShared = [...jobNorm].filter(s => hypNorm.has(s));
  console.log(`\nStrict normalized match: ${strictShared.length}`);
  if (strictShared.length) console.log(`   ${strictShared.join(', ')}`);

  // Does Job carry a street address we could join on instead?
  const addrSample = await prisma.$queryRawUnsafe(
    `SELECT "jobAddress", "lotBlock", "community"
       FROM "Job"
      WHERE LOWER("builderName") LIKE '%brookfield%'
        AND "jobAddress" IS NOT NULL AND "jobAddress" <> ''
      LIMIT 10`,
  );
  console.log(`\nSample Brookfield Job.jobAddress values:`);
  for (const r of addrSample) console.log(`   [${r.community}] lot=${r.lotBlock}  addr=${r.jobAddress}`);

  // Hyphen side has 'address' column too — compare
  const hypAddrSample = await prisma.$queryRawUnsafe(
    `SELECT "address", "lotBlockPlan", "subdivision"
       FROM "HyphenOrder"
      WHERE "address" IS NOT NULL AND "address" <> ''
      LIMIT 10`,
  );
  console.log(`\nSample HyphenOrder.address values:`);
  for (const r of hypAddrSample) console.log(`   [${r.subdivision}] lot=${r.lotBlockPlan}  addr=${r.address}`);

  // Lot number distribution check
  const jobLotCount = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job"
      WHERE LOWER("builderName") LIKE '%brookfield%'
        AND "lotBlock" ~ '\\d'`,
  );
  const hypLotCount = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "HyphenOrder" WHERE "lotBlockPlan" ~ '\\d'`,
  );
  console.log(`\nLot-number bearing rows:  Job(BF)=${jobLotCount[0]?.n}  Hyphen=${hypLotCount[0]?.n}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
