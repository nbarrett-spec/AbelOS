#!/usr/bin/env node
/**
 * Quick progress checker — safe to run in a second cmd window
 * while imports are executing in the first one.
 *
 *   node scripts/check-progress.mjs
 *
 * Covers all 25+ tables that Phase 2 touches. Uses raw SQL for the
 * new Bolt/Hyphen/BWP tables because they're not in prisma.schema yet
 * (they were created via CREATE TABLE IF NOT EXISTS in the importers).
 */
import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function rawCount(table) {
  try {
    const r = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    return r?.[0]?.n ?? 0;
  } catch { return null; } // table doesn't exist yet
}

const core = await Promise.all([
  prisma.staff.count(),
  prisma.builder.count(),
  prisma.product.count(),
  prisma.vendor.count(),
  prisma.purchaseOrder.count(),
  prisma.purchaseOrderItem.count(),
  prisma.inventoryItem.count(),
  prisma.bomEntry.count(),
  prisma.builderPricing.count(),
  prisma.job.count().catch(() => 0),
]);

const [staff, builders, products, vendors, pos, poItems, inv, bom, pricing, jobs] = core;

const extraTables = [
  'HyphenOrder', 'HyphenPayment',
  'BwpFieldPO', 'BwpFieldPOLine', 'BwpInvoice', 'BwpCheck', 'BwpContact', 'BwpBackcharge',
  'BoltWorkOrder', 'BoltJob', 'BoltCommunity', 'BoltCustomer', 'BoltCrew', 'BoltFloorplan', 'BoltEmployee',
  'StaffPayrollStaging',
];
const extraCounts = {};
for (const t of extraTables) extraCounts[t] = await rawCount(t);

// Link coverage — how many jobs are wired to each external source?
const linkStats = await prisma.$queryRawUnsafe(`
  SELECT
    COUNT(*)::int                                                           AS total,
    COUNT("boltJobId")::int                                                 AS bolt_linked,
    COUNT("hyphenJobId")::int                                               AS hyphen_linked,
    (SELECT COUNT(*)::int FROM "Job" WHERE "bwpPoNumber" IS NOT NULL)       AS bwp_linked
  FROM "Job"
`).catch(() => [{ total: 0, bolt_linked: 0, hyphen_linked: 0, bwp_linked: 0 }]);

const hyphenPayLinked = await prisma.$queryRawUnsafe(
  `SELECT COUNT(*)::int AS n FROM "HyphenPayment" WHERE "jobId" IS NOT NULL`
).catch(() => [{ n: 0 }]);

const pad = (l, n) => `${l}:`.padEnd(24) + String(n ?? '—').padStart(9);
const sec = (s) => `\n▸ ${s}\n` + '─'.repeat(34);

console.log('\n📊 ABEL OS — CURRENT DB COUNTS ' + new Date().toLocaleTimeString());
console.log('═'.repeat(36));

console.log(sec('CORE'));
console.log(pad('Staff', staff));
console.log(pad('Builder', builders));
console.log(pad('Product', products));
console.log(pad('Vendor', vendors));
console.log(pad('PurchaseOrder', pos));
console.log(pad('PurchaseOrderItem', poItems));
console.log(pad('InventoryItem', inv));
console.log(pad('BomEntry', bom));
console.log(pad('BuilderPricing', pricing));
console.log(pad('Job', jobs));

console.log(sec('HYPHEN (Brookfield)'));
console.log(pad('HyphenOrder', extraCounts.HyphenOrder));
console.log(pad('HyphenPayment', extraCounts.HyphenPayment));

console.log(sec('BWP (Pulte)'));
console.log(pad('BwpFieldPO', extraCounts.BwpFieldPO));
console.log(pad('BwpFieldPOLine', extraCounts.BwpFieldPOLine));
console.log(pad('BwpInvoice', extraCounts.BwpInvoice));
console.log(pad('BwpCheck', extraCounts.BwpCheck));
console.log(pad('BwpContact', extraCounts.BwpContact));
console.log(pad('BwpBackcharge', extraCounts.BwpBackcharge));

console.log(sec('BOLT (ECI)'));
console.log(pad('BoltWorkOrder', extraCounts.BoltWorkOrder));
console.log(pad('BoltJob', extraCounts.BoltJob));
console.log(pad('BoltCommunity', extraCounts.BoltCommunity));
console.log(pad('BoltCustomer', extraCounts.BoltCustomer));
console.log(pad('BoltCrew', extraCounts.BoltCrew));
console.log(pad('BoltFloorplan', extraCounts.BoltFloorplan));
console.log(pad('BoltEmployee', extraCounts.BoltEmployee));

console.log(sec('STAGING'));
console.log(pad('StaffPayrollStaging', extraCounts.StaffPayrollStaging));

console.log(sec('LINK COVERAGE'));
const ls = linkStats[0];
const pct = (n, d) => d ? `${n} (${Math.round(100 * n / d)}%)` : String(n);
console.log(pad('Job total', ls.total));
console.log(pad('Job → Bolt', pct(ls.bolt_linked, ls.total)));
console.log(pad('Job → Hyphen', pct(ls.hyphen_linked, ls.total)));
console.log(pad('Job → BWP', pct(ls.bwp_linked, ls.total)));
console.log(pad('HyphenPayment→Job', hyphenPayLinked[0].n));

console.log('\n' + '═'.repeat(36));
await prisma.$disconnect();
