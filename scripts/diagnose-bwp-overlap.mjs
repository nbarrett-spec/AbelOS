// Diagnostic — why is Job ← BwpFieldPOLine matching only 31/562?
// Dump normalized keys from both sides and print samples + intersection size.
//
// Usage: node scripts/diagnose-bwp-overlap.mjs
import { PrismaClient } from '@prisma/client';
import { bar } from './_brain-xlsx.mjs';

const prisma = new PrismaClient();

function normalizeAddr(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .split(/[-—–]/)[0]
    .replace(/[,.]/g, ' ')
    .replace(/\b(st|str|street|ave|avenue|rd|road|dr|drive|ln|lane|ct|court|cir|circle|blvd|boulevard|way|pl|place|ter|terrace|trl|trail|pkwy|parkway|hwy|mews)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// House number + first street word only — very aggressive
function numWord(s) {
  const n = normalizeAddr(s);
  const parts = n.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return '';
  // Want first token that's a number, and the next word
  let idx = parts.findIndex(p => /^\d+$/.test(p));
  if (idx === -1) return '';
  return `${parts[idx]} ${parts[idx + 1] || ''}`.trim();
}

async function main() {
  bar('BWP ↔ JOB OVERLAP DIAGNOSTIC');

  const jobs = await prisma.$queryRawUnsafe(
    `SELECT "id","jobAddress" FROM "Job"
      WHERE LOWER("builderName") LIKE '%pulte%'
        AND "jobAddress" IS NOT NULL`,
  );
  const lines = await prisma.$queryRawUnsafe(
    `SELECT DISTINCT "lotAddress" FROM "BwpFieldPOLine" WHERE "lotAddress" IS NOT NULL`,
  );

  console.log(`Pulte Jobs: ${jobs.length}`);
  console.log(`BWP distinct lotAddresses: ${lines.length}`);

  const jobFull = new Set(jobs.map(j => normalizeAddr(j.jobAddress)).filter(Boolean));
  const jobShort = new Set(jobs.map(j => numWord(j.jobAddress)).filter(Boolean));
  const bwpFull = new Set(lines.map(l => normalizeAddr(l.lotAddress)).filter(Boolean));
  const bwpShort = new Set(lines.map(l => numWord(l.lotAddress)).filter(Boolean));

  const fullHit = [...jobFull].filter(k => bwpFull.has(k));
  const shortHit = [...jobShort].filter(k => bwpShort.has(k));

  console.log(`\nFull normalized key overlap:  ${fullHit.length}`);
  console.log(`Number+first-word overlap:    ${shortHit.length}`);

  console.log(`\nSample Job.jobAddress → normalized / numWord:`);
  for (const j of jobs.slice(0, 15)) {
    console.log(`   ${(j.jobAddress || '').slice(0, 45).padEnd(45)} → [${normalizeAddr(j.jobAddress)}] [${numWord(j.jobAddress)}]`);
  }

  console.log(`\nSample BwpFieldPOLine.lotAddress → normalized / numWord:`);
  for (const l of lines.slice(0, 15)) {
    console.log(`   ${(l.lotAddress || '').slice(0, 45).padEnd(45)} → [${normalizeAddr(l.lotAddress)}] [${numWord(l.lotAddress)}]`);
  }

  // Sample ones that DO match
  console.log(`\nFirst 10 matching numWord keys:`);
  for (const k of shortHit.slice(0, 10)) console.log(`   ${k}`);
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); }).finally(() => prisma.$disconnect());
