import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const comms = await prisma.$queryRawUnsafe(
    `SELECT c."id", c."name", b."companyName" AS builder
       FROM "Community" c
       LEFT JOIN "Builder" b ON b."id" = c."builderId"
       ORDER BY c."name"`);
  console.log('COMMUNITIES:');
  for (const c of comms) console.log(`   [${c.id}] ${c.name} (builder=${c.builder || 'null'})`);

  const subs = await prisma.$queryRawUnsafe(
    `SELECT "subdivision", COUNT(*)::int AS n
       FROM "HyphenOrder" GROUP BY "subdivision"`);
  console.log('\nHYPHEN SUBDIVISIONS:');
  for (const s of subs) console.log(`   ${s.n}x  ${s.subdivision}`);

  const lots = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "lotBlockPlan", "subdivision" FROM "HyphenOrder" ORDER BY "subdivision", "lotBlockPlan"`);
  console.log(`\nHYPHEN LOT PATTERNS (${lots.length} distinct):`);
  for (const l of lots) console.log(`   [${l.subdivision}] ${l.lotBlockPlan}`);

  const jobs = await prisma.$queryRawUnsafe(
    `SELECT id, "lotBlock", community, "jobAddress"
       FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'
        AND "lotBlock" IS NOT NULL
       ORDER BY community, "lotBlock" LIMIT 30`);
  console.log(`\nBROOKFIELD JOBS sample (first 30):`);
  for (const j of jobs) console.log(`   ${j.community} | ${j.lotBlock} | ${j.jobAddress}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
