#!/usr/bin/env node
/**
 * Seed Brookfield Homes BuilderContact rows.
 *
 * Context: After the Pulte loss on 2026-04-20, Brookfield is Abel's top active
 * builder. The account portal contacts tab is empty (0 rows). This script
 * seeds the known contacts so the portal renders correctly.
 *
 * Sources (all from workspace, no invented data):
 *  - memory/customers/brookfield.md (Amanda Barham + CC list: Michael Todd,
 *    Raquel Conner, Cory Finch — all on the Rev 4 Plan Breakdown thread)
 *  - abel-brain-v4.json (Brittney Lane — historical InFlow SO-000875 contact)
 *
 * Only Amanda has a confirmed title ("Purchasing Director" per brookfield.md).
 * Others are flagged OTHER with a title of "CC on pricing thread" until Nate
 * confirms their roles with Amanda. Do NOT invent titles.
 *
 * Idempotent on (builderId, email) — safe to re-run.
 *
 * Run:  node scripts/seed-brookfield-contacts.mjs
 */

import { PrismaClient } from '@prisma/client';
import 'dotenv/config';

const prisma = new PrismaClient();

// Canonical Builder.id lookup — we match on companyName ILIKE '%brookfield%'
// and take the oldest record (post-dedup canonical one, per prior agent notes).
async function findBrookfieldBuilder() {
  const candidates = await prisma.builder.findMany({
    where: { companyName: { contains: 'brookfield', mode: 'insensitive' } },
    select: { id: true, companyName: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });
  if (candidates.length === 0) {
    throw new Error('No Builder row matches /brookfield/i — seed Builder first.');
  }
  if (candidates.length > 1) {
    console.warn(
      `Found ${candidates.length} Brookfield Builder rows — using oldest:`,
      candidates.map((c) => `${c.id} (${c.companyName})`).join(', '),
    );
  }
  return candidates[0];
}

// Contacts sourced from workspace files — DO NOT add contacts here without
// a workspace citation. If you need more (Division VP, Superintendent,
// Construction Manager), ask Amanda Barham directly — none of those roles
// appear in the workspace today.
const CONTACTS = [
  {
    firstName: 'Amanda',
    lastName: 'Barham',
    email: 'Amanda.Barham@brookfieldrp.com',
    title: 'Purchasing Director',
    role: 'PURCHASING',
    isPrimary: true,
    receivesPO: true,
    receivesInvoice: false,
    notes:
      'Primary pricing contact. Accepted Rev 4 Plan Breakdown 2026-04-21. ' +
      'Per memory/customers/brookfield.md.',
  },
  {
    firstName: 'Michael',
    lastName: 'Todd',
    email: 'Michael.Todd@brookfieldrp.com',
    title: 'CC on pricing thread',
    role: 'OTHER',
    isPrimary: false,
    receivesPO: false,
    receivesInvoice: false,
    notes:
      'CC on Rev 4 Plan Breakdown thread. Title unconfirmed — ask Amanda. ' +
      'Per memory/customers/brookfield.md.',
  },
  {
    firstName: 'Raquel',
    lastName: 'Conner',
    email: 'Raquel.Conner@brookfieldrp.com',
    title: 'CC on pricing thread',
    role: 'OTHER',
    isPrimary: false,
    receivesPO: false,
    receivesInvoice: false,
    notes:
      'CC on Rev 4 Plan Breakdown thread. Title unconfirmed — ask Amanda. ' +
      'Per memory/customers/brookfield.md.',
  },
  {
    firstName: 'Cory',
    lastName: 'Finch',
    email: 'Cory.Finch@brookfieldrp.com',
    title: 'CC on pricing thread',
    role: 'OTHER',
    isPrimary: false,
    receivesPO: false,
    receivesInvoice: false,
    notes:
      'CC on Rev 4 Plan Breakdown thread. Title unconfirmed — ask Amanda. ' +
      'Per memory/customers/brookfield.md.',
  },
  {
    firstName: 'Brittney',
    lastName: 'Lane',
    email: 'Brittney.Lane@brookfieldrp.com',
    title: 'Historical PO contact',
    role: 'OTHER',
    isPrimary: false,
    receivesPO: false,
    receivesInvoice: false,
    notes:
      'Appeared on InFlow SO-000875 (12/2024) as Brookfield Residential PO ' +
      'recipient. May still be active — confirm with Amanda before using. ' +
      'Per abel-brain-v4.json.',
  },
];

async function main() {
  const builder = await findBrookfieldBuilder();
  console.log(`Seeding Brookfield contacts for Builder ${builder.id} (${builder.companyName})`);

  let created = 0;
  let updated = 0;
  let skipped = 0;

  for (const c of CONTACTS) {
    // Idempotent: match on (builderId, email). Update notes/role/title on
    // re-run so we can correct data without a wipe.
    const existing = await prisma.builderContact.findFirst({
      where: { builderId: builder.id, email: c.email },
      select: { id: true, firstName: true, lastName: true },
    });

    if (existing) {
      await prisma.builderContact.update({
        where: { id: existing.id },
        data: {
          firstName: c.firstName,
          lastName: c.lastName,
          title: c.title,
          role: c.role,
          isPrimary: c.isPrimary,
          receivesPO: c.receivesPO,
          receivesInvoice: c.receivesInvoice,
          notes: c.notes,
          active: true,
        },
      });
      updated += 1;
      console.log(`  ~ updated ${c.firstName} ${c.lastName} <${c.email}>`);
    } else {
      await prisma.builderContact.create({
        data: {
          builderId: builder.id,
          firstName: c.firstName,
          lastName: c.lastName,
          email: c.email,
          title: c.title,
          role: c.role,
          isPrimary: c.isPrimary,
          receivesPO: c.receivesPO,
          receivesInvoice: c.receivesInvoice,
          notes: c.notes,
        },
      });
      created += 1;
      console.log(`  + created ${c.firstName} ${c.lastName} <${c.email}> [${c.role}]`);
    }
  }

  const total = await prisma.builderContact.count({ where: { builderId: builder.id } });
  const byRole = await prisma.builderContact.groupBy({
    by: ['role'],
    where: { builderId: builder.id },
    _count: { _all: true },
  });

  console.log('');
  console.log(`Done. created=${created} updated=${updated} skipped=${skipped}`);
  console.log(`Total Brookfield contacts in DB: ${total}`);
  console.log('Breakdown by role:');
  for (const r of byRole) {
    console.log(`  ${r.role}: ${r._count._all}`);
  }
}

main()
  .catch((err) => {
    console.error('seed-brookfield-contacts FAILED:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
