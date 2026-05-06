import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  // Jobs in Grove community
  const groveJobs = await prisma.$queryRawUnsafe(
    `SELECT id, "lotBlock", community, "jobAddress", "builderName", "hyphenJobId"
       FROM "Job" WHERE community ILIKE '%grove%' OR "jobAddress" ILIKE '%grove%' LIMIT 30`);
  console.log(`Jobs with "grove":`);
  for (const j of groveJobs) console.log(`   [${j.builderName}] ${j.community} | ${j.lotBlock} | ${j.jobAddress} | hyph=${j.hyphenJobId}`);

  // Check total Brookfield jobs breakdown
  const counts = await prisma.$queryRawUnsafe(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(CASE WHEN "lotBlock" IS NOT NULL THEN 1 END)::int AS has_lot,
       COUNT(CASE WHEN community IS NOT NULL THEN 1 END)::int AS has_community,
       COUNT(CASE WHEN "jobAddress" IS NOT NULL THEN 1 END)::int AS has_addr
     FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'`);
  console.log(`\nBrookfield Job totals:`, counts[0]);

  // Hyphen address sample
  const hyph = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "lotBlockPlan", "address", "subdivision"
       FROM "HyphenOrder" WHERE "address" IS NOT NULL ORDER BY "address" LIMIT 30`);
  console.log(`\nHyphen address samples:`);
  for (const h of hyph) console.log(`   [${h.subdivision}] ${h.lotBlockPlan} | ${h.address}`);

  // Sample Brookfield addresses that look real
  const realBf = await prisma.$queryRawUnsafe(
    `SELECT community, "lotBlock", "jobAddress"
       FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'
         AND "jobAddress" ILIKE '%,%' LIMIT 30`);
  console.log(`\nBrookfield Jobs with comma-address (possibly real):`);
  for (const j of realBf) console.log(`   ${j.community} | ${j.lotBlock} | ${j.jobAddress}`);

  // Check Brookfield builder ID
  const bf = await prisma.$queryRawUnsafe(
    `SELECT id, "companyName" FROM "Builder" WHERE LOWER("companyName") LIKE '%brookfield%'`);
  console.log(`\nBrookfield builders:`);
  for (const b of bf) console.log(`   [${b.id}] ${b.companyName}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
