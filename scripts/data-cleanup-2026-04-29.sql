-- Data Cleanup Script — April 29, 2026
-- MAJOR-7: Replace @placeholder.bolt emails
-- MAJOR-8: Archive test entries
-- GAP-22 prep: Clean orphaned records

-- 1. Replace @placeholder.bolt emails (MAJOR-7)
UPDATE "Builder" SET "email" = NULL, "updatedAt" = NOW() WHERE "email" LIKE '%@placeholder.bolt';

-- 2. Archive JOB-SCRUB test entries (MAJOR-8)
UPDATE "Job" SET "status" = 'CLOSED', "updatedAt" = NOW() WHERE "jobNumber" LIKE 'JOB-SCRUB-%';

-- 3. Archive ancient JOB-BOLT entries that are 200+ days overdue
UPDATE "Job" SET "status" = 'CLOSED', "updatedAt" = NOW()
WHERE "jobNumber" LIKE 'JOB-BOLT-%'
  AND "status" NOT IN ('COMPLETE', 'CLOSED', 'INVOICED')
  AND "scheduledDate" < NOW() - INTERVAL '180 days';

-- 4. Flag $0 orders for review
-- (Don't auto-fix — just identify them via SELECT)
-- SELECT "id", "orderNumber", "total", "status" FROM "Order" WHERE "total" = 0 AND "status" != 'CANCELLED';

-- 5. Remove SCRUB prefix delivery records
UPDATE "Delivery" SET "status" = 'COMPLETE', "updatedAt" = NOW()
WHERE "deliveryNumber" LIKE 'DEL-SCRUB-%';

-- 6. Fix "Accounting" and "Billing" crew misuse (disable invalid crews)
UPDATE "Crew" SET "active" = false, "updatedAt" = NOW()
WHERE "name" IN ('Accounting', 'Billing');
