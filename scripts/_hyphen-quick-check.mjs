// Temporary — counts only. Delete after use.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  const totalHyphenOrders = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "HyphenOrder"`);
  const linkedJobs = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job" WHERE "hyphenJobId" IS NOT NULL AND LOWER("builderName") LIKE '%brookfield%'`,
  );
  const totalBfJobs = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'`,
  );
  const commList = await prisma.$queryRawUnsafe(
    `SELECT c."id" AS cid, c."name" AS cname, b."companyName" AS builder
       FROM "Community" c
       LEFT JOIN "Builder" b ON b."id" = c."builderId"
      ORDER BY c."name"`,
  );

  console.log(`HyphenOrder total: ${totalHyphenOrders[0].n}`);
  console.log(`Brookfield Jobs total: ${totalBfJobs[0].n}`);
  console.log(`Brookfield Jobs linked to Hyphen: ${linkedJobs[0].n}`);
  console.log(`\nCommunity table rows (Brookfield / no builder):`);
  for (const c of commList) console.log(`   ${c.id}  ${c.name}`);

  // Check if mapping table already exists
  const mapTableRows = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'HyphenCommunityMapping'`,
  );
  console.log(`\nHyphenCommunityMapping table exists: ${mapTableRows.length > 0}`);
}
main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
