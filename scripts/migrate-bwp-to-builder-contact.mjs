#!/usr/bin/env node
// Migrate BwpContact (scraped Build-With-Pulte contacts) → BuilderContact.
//
// Background: BuilderContact is empty across the board; the Builder account
// pages read from it for the "Contacts" tab. BwpContact holds 142 rows of
// Pulte / PulteGroup / Centex / Del Webb contacts scraped during the Pulte
// proposal work (see scripts/import-bwp-pulte.mjs).
//
// All 142 rows have email domains in the Pulte family (pulte.com,
// pultegroup.com, centex.com, delwebb.com), so they all map to the active
// "Pulte Homes" Builder record (the one with 1,273 orders attached).
//
// Behavior:
//   • Idempotent: skips any (builderId, email) that already exists.
//   • Leaves BwpContact rows untouched (historical source of truth).
//   • Splits "name" → firstName/lastName on first space.
//   • Maps department/title → ContactRole enum.
//
// Usage: node scripts/migrate-bwp-to-builder-contact.mjs [--dry-run]

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const DRY_RUN = process.argv.includes('--dry-run');

// ─── ROLE MAPPING ──────────────────────────────────────────────────────────
// ContactRole enum: OWNER, DIVISION_VP, PURCHASING, SUPERINTENDENT,
//                   PROJECT_MANAGER, ESTIMATOR, ACCOUNTS_PAYABLE, OTHER
function mapRole({ title, department }) {
  const t = (title || '').toLowerCase();
  const d = (department || '').toLowerCase();

  if (/\bvp\b|vice president|president/.test(t)) return 'DIVISION_VP';
  if (d === 'procurement' || /purchasing|procurement|buyer/.test(t)) return 'PURCHASING';
  if (d === 'construction' && /superintendent|super\b|field/.test(t)) return 'SUPERINTENDENT';
  if (/superintendent/.test(t)) return 'SUPERINTENDENT';
  if (/construction manager|lead construction/.test(t)) return 'PROJECT_MANAGER';
  if (/project manager|\bpm\b/.test(t)) return 'PROJECT_MANAGER';
  if (/estimator|estimating/.test(t)) return 'ESTIMATOR';
  if (d === 'finance' && /payable|\bap\b/.test(t)) return 'ACCOUNTS_PAYABLE';
  if (/accounts payable|\ba\/p\b/.test(t)) return 'ACCOUNTS_PAYABLE';
  if (/owner|founder|ceo/.test(t)) return 'OWNER';
  return 'OTHER';
}

function splitName(full) {
  const trimmed = (full || '').trim();
  if (!trimmed) return { firstName: '(Unknown)', lastName: '' };
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') };
}

// All BwpContact emails belong to the Pulte family. Map to the active
// Builder (the one with orders). Fallback: newest Pulte record.
async function resolveTargetBuilder() {
  const pulteHomes = await prisma.builder.findFirst({
    where: { companyName: { equals: 'Pulte Homes' } },
    select: { id: true, companyName: true, _count: { select: { orders: true } } },
  });
  if (pulteHomes) return pulteHomes;

  const anyPulte = await prisma.builder.findFirst({
    where: { companyName: { contains: 'Pulte', mode: 'insensitive' } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, companyName: true, _count: { select: { orders: true } } },
  });
  return anyPulte;
}

async function main() {
  console.log(`\n=== BwpContact → BuilderContact migration ${DRY_RUN ? '(DRY RUN)' : ''} ===\n`);

  const target = await resolveTargetBuilder();
  if (!target) {
    console.error('No Pulte-family Builder record found. Aborting.');
    process.exit(1);
  }
  console.log(`Target Builder: ${target.companyName} (${target.id}) — ${target._count.orders} orders\n`);

  const bwpRows = await prisma.bwpContact.findMany({
    orderBy: [{ department: 'asc' }, { name: 'asc' }],
  });
  console.log(`Source rows: ${bwpRows.length}\n`);

  let migrated = 0;
  let skippedExisting = 0;
  let skippedNoEmail = 0;
  const samples = [];

  for (const src of bwpRows) {
    if (!src.email) {
      skippedNoEmail++;
      continue;
    }
    const email = src.email.trim().toLowerCase();

    const existing = await prisma.builderContact.findFirst({
      where: { builderId: target.id, email },
      select: { id: true },
    });
    if (existing) {
      skippedExisting++;
      continue;
    }

    const { firstName, lastName } = splitName(src.name);
    const role = mapRole({ title: src.title, department: src.department });

    // Notes carry the pieces BuilderContact has no column for.
    const noteParts = [];
    if (src.department) noteParts.push(`Dept: ${src.department}`);
    if (src.city || src.state || src.zip) {
      noteParts.push(`Location: ${[src.city, src.state, src.zip].filter(Boolean).join(', ')}`);
    }
    if (src.status && src.status !== 'Active') noteParts.push(`Status: ${src.status}`);
    noteParts.push(`Imported from BwpContact ${src.id}`);
    const notes = noteParts.join(' | ');

    const payload = {
      builderId: target.id,
      firstName,
      lastName,
      email,
      phone: src.phone || null,
      mobile: src.mobile || null,
      title: src.title || null,
      role,
      notes,
      active: (src.status || 'Active') === 'Active',
    };

    if (!DRY_RUN) {
      await prisma.builderContact.create({ data: payload });
    }
    migrated++;
    if (samples.length < 5) samples.push({ ...payload });
  }

  console.log(`Migrated:          ${migrated}`);
  console.log(`Skipped (dupe):    ${skippedExisting}`);
  console.log(`Skipped (no email): ${skippedNoEmail}`);

  console.log('\nSample of first 5 created BuilderContact rows:');
  for (const s of samples) {
    console.log(`  • ${s.firstName} ${s.lastName} <${s.email}> — ${s.title || '(no title)'} [${s.role}]`);
  }

  const totalAfter = await prisma.builderContact.count({ where: { builderId: target.id } });
  console.log(`\nBuilderContact total for ${target.companyName}: ${totalAfter}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
