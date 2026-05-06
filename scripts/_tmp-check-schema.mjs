import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='Community' ORDER BY ordinal_position`);
  console.log('Community:', cols.map(c => c.column_name).join(', '));

  const hyph = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name='HyphenOrder' ORDER BY ordinal_position`);
  console.log('\nHyphenOrder:', hyph.map(c => c.column_name).join(', '));

  const jobComm = await prisma.$queryRawUnsafe(
    `SELECT community, "communityId", COUNT(*)::int as n
       FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'
      GROUP BY community, "communityId" ORDER BY n DESC`);
  console.log('\nBrookfield Job community/communityId breakdown:');
  for (const r of jobComm) console.log(`  ${r.n} x [${r.community}] cid=${r.communityId}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
