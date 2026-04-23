// Seed DataQualityRule with baseline rules (idempotent)
// Mirrors DEFAULT_RULES in src/app/api/cron/data-quality/route.ts
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const RULES = [
  { name: 'Jobs missing scheduled date',       description: 'Active jobs without a scheduled delivery/install date', entity: 'Job',           severity: 'CRITICAL', query: `SELECT id, "jobNumber" FROM "Job" WHERE "scheduledDate" IS NULL AND status NOT IN ('CANCELLED', 'COMPLETED')`, fixUrl: '/ops/jobs/{id}' },
  { name: 'Jobs missing builder assignment',   description: 'Active jobs not assigned to a PM',                      entity: 'Job',           severity: 'WARNING',  query: `SELECT id, "jobNumber" FROM "Job" WHERE "builderId" IS NULL AND status NOT IN ('CANCELLED')`, fixUrl: '/ops/jobs/{id}' },
  { name: 'Products missing preferred vendor', description: 'Active products without a preferred vendor selected',   entity: 'Product',       severity: 'WARNING',  query: `SELECT id, name FROM "Product" WHERE id NOT IN (SELECT "productId" FROM "VendorProduct" WHERE preferred = true) AND active = true`, fixUrl: '/ops/catalog/{id}' },
  { name: 'Builders missing credit terms',     description: 'Active builders without payment terms configured',      entity: 'Builder',       severity: 'WARNING',  query: `SELECT id, "companyName" FROM "Builder" WHERE ("paymentTermDays" IS NULL OR "paymentTermDays" = 0) AND status = 'ACTIVE'`, fixUrl: '/ops/accounts/{id}' },
  { name: 'Builders missing contact email',    description: 'Active builders without a contact email',               entity: 'Builder',       severity: 'CRITICAL', query: `SELECT id, "companyName" FROM "Builder" WHERE (email IS NULL OR email = '') AND status = 'ACTIVE'`, fixUrl: '/ops/accounts/{id}' },
  { name: 'Invoices overdue 90+ days',         description: 'Invoices unpaid for 90+ days',                          entity: 'Invoice',       severity: 'CRITICAL', query: `SELECT id, "invoiceNumber" FROM "Invoice" WHERE "dueDate" < NOW() - INTERVAL '90 days' AND status::text NOT IN ('PAID', 'VOID', 'WRITE_OFF')`, fixUrl: '/ops/finance/invoices/{id}' },
  { name: 'POs stuck in DRAFT >7 days',        description: 'Purchase orders in draft status for more than 7 days',  entity: 'PurchaseOrder', severity: 'INFO',     query: `SELECT id, "poNumber" FROM "PurchaseOrder" WHERE status = 'DRAFT' AND "createdAt" < NOW() - INTERVAL '7 days'`, fixUrl: '/ops/purchasing/po/{id}' },
  { name: 'Open jobs with no recent activity', description: 'Active jobs not updated in 30+ days',                   entity: 'Job',           severity: 'WARNING',  query: `SELECT id, "jobNumber" FROM "Job" WHERE "updatedAt" < NOW() - INTERVAL '30 days' AND status NOT IN ('CANCELLED', 'COMPLETED')`, fixUrl: '/ops/jobs/{id}' },
  { name: 'Products with zero cost',           description: 'Active products without a cost set',                    entity: 'Product',       severity: 'WARNING',  query: `SELECT id, name FROM "Product" WHERE (cost IS NULL OR cost = 0) AND active = true`, fixUrl: '/ops/catalog/{id}' },
];

const prisma = new PrismaClient();
try {
  const before = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "DataQualityRule"`);
  console.log('BEFORE:', before[0].c);
  const now = new Date().toISOString();
  let inserted = 0, skipped = 0;
  for (const r of RULES) {
    const existing = await prisma.$queryRawUnsafe(`SELECT id FROM "DataQualityRule" WHERE name = $1 LIMIT 1`, r.name);
    if (existing.length) { skipped++; continue; }
    const id = `dqr_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO "DataQualityRule" (id, name, description, entity, severity, query, "fixUrl", "isActive", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())`,
      id, r.name, r.description, r.entity, r.severity, r.query, r.fixUrl
    );
    inserted++;
  }
  const after = await prisma.$queryRawUnsafe(`SELECT COUNT(*)::int AS c FROM "DataQualityRule"`);
  console.log(`INSERTED: ${inserted}  SKIPPED: ${skipped}  AFTER: ${after[0].c}`);
} catch (e) {
  console.error('FATAL:', e.message);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
