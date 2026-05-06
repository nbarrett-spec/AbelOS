import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

function extractStreetNum(s) {
  if (!s) return null;
  const m = String(s).match(/\b(\d{3,5})\b/);
  return m ? m[1] : null;
}
function extractStreetName(s) {
  if (!s) return null;
  // Pull out street name after the number.
  const m = String(s).match(/\d{3,5}\s+([A-Za-z]+)/);
  return m ? m[1].toLowerCase() : null;
}

async function main() {
  const jobs = await prisma.$queryRawUnsafe(
    `SELECT id, "jobAddress", community, "lotBlock", "builderName"
       FROM "Job" WHERE LOWER("builderName") LIKE '%brookfield%'
        AND "jobAddress" IS NOT NULL`);
  const hyph = await prisma.$queryRawUnsafe(
    `SELECT "hyphId", "address", "subdivision", "lotBlockPlan"
       FROM "HyphenOrder" WHERE "address" IS NOT NULL`);

  // Build hyph index by (streetNum, streetName)
  const hyphByNumName = new Map();
  const hyphByNumOnly = new Map();
  for (const h of hyph) {
    const num = extractStreetNum(h.address);
    const name = extractStreetName(h.address);
    if (num && name) {
      const k = `${num}|${name}`;
      if (!hyphByNumName.has(k)) hyphByNumName.set(k, []);
      hyphByNumName.get(k).push(h);
    }
    if (num) {
      if (!hyphByNumOnly.has(num)) hyphByNumOnly.set(num, []);
      hyphByNumOnly.get(num).push(h);
    }
  }

  let matchedNumName = 0, matchedNumOnly = 0;
  const matches = [];
  for (const j of jobs) {
    const num = extractStreetNum(j.jobAddress);
    const name = extractStreetName(j.jobAddress);
    if (!num) continue;
    let hits;
    if (name && hyphByNumName.has(`${num}|${name}`)) {
      hits = hyphByNumName.get(`${num}|${name}`);
      matchedNumName++;
      matches.push({ job: j.jobAddress, match: hits[0].address, type: 'num+name' });
    } else if (hyphByNumOnly.has(num)) {
      hits = hyphByNumOnly.get(num);
      if (hits.length === 1) {
        matchedNumOnly++;
        matches.push({ job: j.jobAddress, match: hits[0].address, type: 'num-only' });
      }
    }
  }

  console.log(`Brookfield jobs with street num: ${jobs.filter(j => extractStreetNum(j.jobAddress)).length}`);
  console.log(`  Matched num+name: ${matchedNumName}`);
  console.log(`  Matched num-only: ${matchedNumOnly}`);
  console.log(`\nFirst 20 matches:`);
  for (const m of matches.slice(0, 20)) console.log(`   [${m.type}] ${m.job}  →  ${m.match}`);
}
main().catch(e => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
