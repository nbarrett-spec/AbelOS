#!/usr/bin/env node
/**
 * backfill-scheduled-dates.mjs
 *
 * Phase 2.1 — Backfill missing Job.scheduledDate.
 *
 * Resolution order (first hit wins):
 *   1. BoltWorkOrder.scheduledDate by matching jobAddress
 *      (Bolt.jobId is almost never populated and Bolt.boltId uses a
 *       different ID space than Job.boltJobId, so address is the only
 *       reliable bridge in current data.)
 *   2. Related Order.deliveryDate → Order.dueDate → Order.orderDate
 *      (only applies if Job.orderId is set).
 *   3. Default: Job.createdAt + 14 days (standard lead time).
 *
 * For defaulted rows we annotate Job.buildSheetNotes with a
 * [NEEDS_REVIEW | DEFAULT_LEAD_TIME] marker so PMs can triage.
 *
 * Idempotent: only updates rows where scheduledDate IS NULL.
 * Safe to re-run.
 */

import { PrismaClient } from '@prisma/client';
import { config } from 'dotenv';
config();

const prisma = new PrismaClient();
const LEAD_TIME_DAYS = 14;
const REVIEW_MARKER = '[NEEDS_REVIEW | DEFAULT_LEAD_TIME]';

function addDays(d, days) {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}

async function main() {
  const start = Date.now();

  const nullJobs = await prisma.job.findMany({
    where: { scheduledDate: null },
    select: {
      id: true,
      jobNumber: true,
      jobAddress: true,
      boltJobId: true,
      createdAt: true,
      orderId: true,
      status: true,
      buildSheetNotes: true,
    },
  });

  console.log(`Found ${nullJobs.length} Jobs with scheduledDate IS NULL`);

  let boltCount = 0;
  let orderCount = 0;
  let defaultCount = 0;
  let failed = 0;

  for (const job of nullJobs) {
    let source = null;
    let newDate = null;

    // 1. Try BoltWorkOrder via jobAddress
    if (job.jobAddress) {
      const wo = await prisma.boltWorkOrder.findFirst({
        where: {
          jobAddress: job.jobAddress,
          scheduledDate: { not: null },
        },
        orderBy: { scheduledDate: 'asc' }, // earliest planned WO wins
        select: { scheduledDate: true, boltId: true },
      });
      if (wo?.scheduledDate) {
        newDate = wo.scheduledDate;
        source = 'BOLT';
      }
    }

    // 2. Try related Order
    if (!newDate && job.orderId) {
      const order = await prisma.order.findUnique({
        where: { id: job.orderId },
        select: { deliveryDate: true, dueDate: true, orderDate: true },
      });
      const pick = order?.deliveryDate || order?.dueDate || order?.orderDate;
      if (pick) {
        newDate = pick;
        source = 'ORDER';
      }
    }

    // 3. Default to createdAt + 14 days
    if (!newDate) {
      newDate = addDays(job.createdAt, LEAD_TIME_DAYS);
      source = 'DEFAULT';
    }

    try {
      const data = { scheduledDate: newDate };

      if (source === 'DEFAULT') {
        // Flag for review via buildSheetNotes (no metadata/needsReview column).
        const existing = job.buildSheetNotes || '';
        if (!existing.includes(REVIEW_MARKER)) {
          data.buildSheetNotes = existing
            ? `${REVIEW_MARKER} ${existing}`
            : `${REVIEW_MARKER} Auto-backfilled to createdAt + ${LEAD_TIME_DAYS}d. Verify with builder.`;
        }
      }

      await prisma.job.update({
        where: { id: job.id, scheduledDate: null }, // idempotent guard
        data,
      });

      if (source === 'BOLT') boltCount++;
      else if (source === 'ORDER') orderCount++;
      else defaultCount++;
    } catch (err) {
      failed++;
      console.error(`FAILED ${job.jobNumber} (${job.id}):`, err.message);
    }
  }

  const remaining = await prisma.job.count({ where: { scheduledDate: null } });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);

  console.log('');
  console.log('─── BACKFILL REPORT ────────────────────────');
  console.log(`  From Bolt (address match): ${boltCount}`);
  console.log(`  From Order:                ${orderCount}`);
  console.log(`  Defaulted (+${LEAD_TIME_DAYS}d):          ${defaultCount}`);
  console.log(`  Failed:                    ${failed}`);
  console.log(`  Total processed:           ${nullJobs.length}`);
  console.log(`  Jobs still NULL:           ${remaining}`);
  console.log(`  Elapsed:                   ${elapsed}s`);
  console.log('────────────────────────────────────────────');

  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
