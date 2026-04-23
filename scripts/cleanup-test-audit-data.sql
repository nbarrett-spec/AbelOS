-- cleanup-test-audit-data.sql
-- Authoritative manual-run cleanup of E2E / audit / probe test rows.
--
-- This file is kept in sync with scripts/cleanup-test-data.mjs (which is the
-- preferred tool — runs in a transaction, archives rows to JSON first, and
-- uses a single DATABASE_URL pulled from .env). Use this SQL only as a
-- reference or for psql one-shots when you cannot run Node.
--
-- SCOPE (must match cleanup-test-data.mjs):
--   * id LIKE 'test-audit-%' OR 'test-probe-%' OR 'test-%' OR 'audit-test-%'
--   * Builder.companyName ILIKE '%E2E Probe%' OR '%Audit Test%'
--
-- Order is child -> parent for FK safety. Review BEFORE executing in prod.
-- Wrap in a single BEGIN / COMMIT transaction.

BEGIN;

-- ── Children of Invoice ──────────────────────────────────────────────
DELETE FROM "Payment"
 WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "InvoiceItem"
 WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "CollectionAction"
 WHERE "invoiceId" IN (SELECT id FROM "Invoice" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "Invoice"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of PurchaseOrder ───────────────────────────────────────
DELETE FROM "PurchaseOrderItem"
 WHERE "purchaseOrderId" IN (SELECT id FROM "PurchaseOrder" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "PurchaseOrder"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Delivery ────────────────────────────────────────────
DELETE FROM "DeliveryTracking"
 WHERE "deliveryId" IN (SELECT id FROM "Delivery" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "Delivery"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Job ─────────────────────────────────────────────────
DELETE FROM "DecisionNote"  WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "MaterialPick"  WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "QualityCheck"  WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "Installation"  WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "Task"          WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "Activity"      WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "ScheduleEntry" WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');
DELETE FROM "JobPhase"      WHERE "jobId" IN (SELECT id FROM "Job" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "Job"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Order ───────────────────────────────────────────────
DELETE FROM "OrderItem"
 WHERE "orderId" IN (SELECT id FROM "Order" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "Order"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Quote ───────────────────────────────────────────────
DELETE FROM "QuoteItem"
 WHERE "quoteId" IN (SELECT id FROM "Quote" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "Quote"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Takeoff ────────────────────────────────────────────
DELETE FROM "TakeoffItem"
 WHERE "takeoffId" IN (SELECT id FROM "Takeoff" WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%');

DELETE FROM "Takeoff"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- Blueprint (Takeoff's parent but Blueprint may be referenced by other Takeoffs)
DELETE FROM "Blueprint"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Project ────────────────────────────────────────────
DELETE FROM "Project"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%';

-- ── Children of Builder (by id prefix OR by companyName match) ─────
-- First wipe any remaining Builder-scoped rows for companyName matches
-- (handles the "E2E Probe Builder" dupes where id may not match a prefix).
DELETE FROM "Order"
 WHERE "builderId" IN (
   SELECT id FROM "Builder"
    WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%'
       OR "companyName" ILIKE '%E2E Probe%' OR "companyName" ILIKE '%Audit Test%'
 );

DELETE FROM "Project"
 WHERE "builderId" IN (
   SELECT id FROM "Builder"
    WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%'
       OR "companyName" ILIKE '%E2E Probe%' OR "companyName" ILIKE '%Audit Test%'
 );

DELETE FROM "Invoice"
 WHERE "builderId" IN (
   SELECT id FROM "Builder"
    WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%'
       OR "companyName" ILIKE '%E2E Probe%' OR "companyName" ILIKE '%Audit Test%'
 );

DELETE FROM "Activity"
 WHERE "builderId" IN (
   SELECT id FROM "Builder"
    WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%'
       OR "companyName" ILIKE '%E2E Probe%' OR "companyName" ILIKE '%Audit Test%'
 );

-- Builder itself
DELETE FROM "Builder"
 WHERE id LIKE 'test-audit-%' OR id LIKE 'test-probe-%' OR id LIKE 'test-%' OR id LIKE 'audit-test-%'
    OR "companyName" ILIKE '%E2E Probe%' OR "companyName" ILIKE '%Audit Test%';

-- AuditLog rows intentionally NOT purged: the test probe itself produces
-- audit-trail signal that operators may want to retain. Leave alone.

COMMIT;
