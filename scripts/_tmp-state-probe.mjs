// Temporary probe — inspect DB state before building alias table.
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Builders with "brookfield" in name
  const builders = await prisma.$queryRawUnsafe(`
    SELECT b."id", b."companyName", COUNT(c."id")::int AS comm_count
      FROM "Builder" b
      LEFT JOIN "Community" c ON c."builderId" = b."id"
     WHERE LOWER(b."companyName") LIKE '%brookfield%'
     GROUP BY b."id", b."companyName"
     ORDER BY comm_count DESC
  `);
  console.log('Brookfield builder rows:');
  builders.forEach((b) => console.log(`   ${b.id}  ${b.companyName}  (communities=${b.comm_count})`));

  if (builders.length) {
    const bfId = builders[0].id;
    const comms = await prisma.$queryRawUnsafe(
      `SELECT "id","name","city","status" FROM "Community" WHERE "builderId" = $1 ORDER BY "name"`,
      bfId,
    );
    console.log(`\nBrookfield communities (${comms.length}):`);
    comms.forEach((c) => console.log(`   ${c.id.slice(0, 10)}...  ${c.name}  [${c.city || ''} / ${c.status}]`));
  }

  // Hyphen subdivisions distinct
  const subs = await prisma.$queryRawUnsafe(`
    SELECT DISTINCT "subdivision", COUNT(*)::int AS n
      FROM "HyphenOrder"
     WHERE "subdivision" IS NOT NULL AND "subdivision" <> ''
  GROUP BY "subdivision"
  ORDER BY n DESC
  `);
  console.log(`\nDistinct Hyphen subdivisions (${subs.length}):`);
  subs.forEach((s) => console.log(`   [${s.n}]  ${s.subdivision}`));

  // Existing HyphenCommunityMapping
  const tableExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'HyphenCommunityMapping'`,
  );
  console.log(`\nHyphenCommunityMapping exists: ${tableExists.length > 0}`);
  if (tableExists.length > 0) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "hyphenSubdivision", "communityId", "matchMethod", "matchScore" FROM "HyphenCommunityMapping"`,
    );
    console.log(`  rows: ${rows.length}`);
    rows.forEach((r) => console.log(`   "${r.hyphenSubdivision}" -> ${r.communityId?.slice(0, 10)}... (${r.matchMethod}, score=${r.matchScore})`));
  }

  // HyphenCommunityAlias (new target)
  const aliasExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'HyphenCommunityAlias'`,
  );
  console.log(`\nHyphenCommunityAlias exists: ${aliasExists.length > 0}`);

  // HyphenDocument
  const docExists = await prisma.$queryRawUnsafe(
    `SELECT 1 FROM information_schema.tables WHERE table_name = 'HyphenDocument'`,
  );
  console.log(`HyphenDocument exists: ${docExists.length > 0}`);
  if (docExists.length > 0) {
    const cnt = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "HyphenDocument"`);
    console.log(`  rows: ${cnt[0].n}`);
  }
}
main().catch((e) => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
