-- cleanup-test-audit-data.sql
-- Generated 2026-04-23T03:00:41.943Z
-- Safe-to-run-manually cleanup of orphan test rows (id prefix 'test-audit-').
-- Ordered for FK safety: Invoice -> PurchaseOrder -> Project -> Order -> Builder.
-- Review before executing in production.

BEGIN;

-- Project: 7 rows
DELETE FROM "Project" WHERE id LIKE 'test-audit-%';

-- Order: 5 rows
DELETE FROM "Order" WHERE id LIKE 'test-audit-%';

-- Builder: 7 rows
DELETE FROM "Builder" WHERE id LIKE 'test-audit-%';

COMMIT;
