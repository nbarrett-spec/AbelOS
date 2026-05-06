import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT c.id, c.name, b."companyName" as builder, c.city,
       (SELECT COUNT(*) FROM "CommunityFloorPlan" fp WHERE fp."communityId" = c.id) as plans
     FROM "Community" c
     JOIN "Builder" b ON b.id = c."builderId"
     ORDER BY b."companyName", c.name`);
  console.log('communities=' + rows.length);
  for (const r of rows) console.log(`${String(r.plans).padStart(3)} plans | ${(r.builder||'').padEnd(30)} | ${r.name}`);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
