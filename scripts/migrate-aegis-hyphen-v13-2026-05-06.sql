-- Hyphen SPConnect v13 — schema foundation (2026-05-06)
--
-- Idempotent. Safe to apply on a populated DB. All additive.
--
-- Lays the storage foundation for v13 conformance. Three tables touched:
--
-- (1) OrderItem — door spec persistence + change-order targeting.
--     Brookfield (and other v13 builders) ship per-line door specs in
--     optionColor1-3 + extText1-6. The mapper (Agent 2/4) will populate
--     these instead of cramming them into a free-text description blob.
--     doorSwing / doorHand / jambDepth / throatDepth are derived fields
--     parsed by the mapper. builderLineItemNum is Hyphen's int line ID,
--     used by the change-order processor (Agent 3) for line targeting.
--
-- (2) Builder — extended primaryContacts emails.
--     v13 header.primaryContacts carries up to 6 role-account emails
--     (purchasing / accounting / warranty / eDestination / bidConnect /
--     purchasingCC). Stored on Builder so each builder org has them in
--     one place; the mapper (Agent 2/4) writes these on inbound order.
--
-- (3) HyphenOrderEvent — change-order replay lookup.
--     CO payloads carry header.changeOrderNumber that targets an original
--     PO. Persisting it lets the processor (Agent 3) find the original
--     event for replay and stay idempotent on duplicate-CO redelivery.
--
-- Run with:
--   npx prisma db execute --file scripts/migrate-aegis-hyphen-v13-2026-05-06.sql --schema prisma/schema.prisma
-- Then `npx prisma generate`.

BEGIN;

-- ───────────────────────────────────────────────────────────────────
-- (1) OrderItem — door spec persistence + change-order targeting
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "optionColor1" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "optionColor2" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "optionColor3" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "extText1" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "extText2" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "extText3" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "extText4" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "extText5" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "extText6" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "doorSwing" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "doorHand" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "jambDepth" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "throatDepth" TEXT;
-- BIGINT to match Prisma BigInt? — Hyphen sends int values like 43179622
-- which approach Int32's 2.1B ceiling. BIGINT is future-proof.
ALTER TABLE "OrderItem" ADD COLUMN IF NOT EXISTS "builderLineItemNum" BIGINT;

CREATE INDEX IF NOT EXISTS "OrderItem_builderLineItemNum_idx"
  ON "OrderItem" ("builderLineItemNum");

-- ───────────────────────────────────────────────────────────────────
-- (2) Builder — extended primaryContacts emails
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "hyphenPurchasingEmail"   TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "hyphenAccountingEmail"   TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "hyphenWarrantyEmail"     TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "hyphenEDestinationEmail" TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "hyphenBidConnectEmail"   TEXT;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "hyphenPurchasingCcEmail" TEXT;

-- ───────────────────────────────────────────────────────────────────
-- (3) HyphenOrderEvent — change-order replay lookup
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "HyphenOrderEvent"
  ADD COLUMN IF NOT EXISTS "changeOrderNumber" TEXT;

CREATE INDEX IF NOT EXISTS "HyphenOrderEvent_changeOrderNumber_idx"
  ON "HyphenOrderEvent" ("changeOrderNumber");

COMMIT;
