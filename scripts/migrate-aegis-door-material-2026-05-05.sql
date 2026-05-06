-- B-FEAT-1 / A-BIZ-7 — Door material flag for dunnage / Final Front (2026-05-05)
--
-- Adds the DoorMaterial enum and a nullable OrderItem.doorMaterial column
-- so production crews can stamp WOOD vs FIBERGLASS vs METAL on the build
-- sheet (drives strike type — currently uncaptured, frequent rework cause).
--
-- Idempotent — safe to apply on a populated DB. Additive only:
--   • New enum guarded with EXCEPTION WHEN duplicate_object.
--   • Column added with ADD COLUMN IF NOT EXISTS, NULL default.
--   • Index added with CREATE INDEX IF NOT EXISTS.
--
-- App-side validation (form layer) requires the field for dunnage /
-- Final Front items; the DB stays permissive so backfill isn't required.

-- ───────────────────────────────────────────────────────────────────
-- Enum
-- ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "DoorMaterial" AS ENUM ('WOOD', 'FIBERGLASS', 'METAL');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ───────────────────────────────────────────────────────────────────
-- OrderItem.doorMaterial
-- ───────────────────────────────────────────────────────────────────
ALTER TABLE "OrderItem"
  ADD COLUMN IF NOT EXISTS "doorMaterial" "DoorMaterial";

CREATE INDEX IF NOT EXISTS "idx_order_item_door_material"
  ON "OrderItem" ("doorMaterial")
  WHERE "doorMaterial" IS NOT NULL;
