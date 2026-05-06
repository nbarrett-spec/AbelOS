-- A-DATA-13 — DB-level safeguard: keep Order.subtotal + Order.total in sync
-- with sum(OrderItem.lineTotal). Prevents drift at the source instead of
-- relying on the recompute-order-totals cron to fix it after the fact.
--
-- Invariant enforced (mirrors logic in scripts/_recompute-order-totals.mjs
-- and /api/cron/recompute-order-totals):
--   Order.subtotal = SUM(OrderItem.lineTotal) WHERE orderId = O.id
--   Order.total    = subtotal + Order.taxAmount + Order.shippingCost
--
-- The trigger only touches subtotal + total. taxAmount and shippingCost
-- are app-set at order create time and don't drift the same way; leaving
-- them alone keeps the trigger narrow and predictable.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP TRIGGER IF EXISTS. Safe
-- to apply on prod-main multiple times.
--
-- ⚠ Bulk loads: this fires per-row. For seed scripts, InFlow imports, or
-- any path that bulk-inserts OrderItems, wrap the bulk operation in:
--   ALTER TABLE "OrderItem" DISABLE TRIGGER recompute_order_total_trg;
--   -- ...bulk insert/update/delete...
--   ALTER TABLE "OrderItem" ENABLE TRIGGER recompute_order_total_trg;
--   -- then run scripts/_recompute-order-totals.mjs --apply once at end
-- See scripts/_recompute-order-totals.mjs for the bulk reconciler.
--
-- Note: the existing recompute-order-totals cron is left in place as a
-- belt-and-suspenders check. With the trigger active it should report
-- `drifted: 0` on every run.

-- ───────────────────────────────────────────────────────────────────
-- Core recompute function. Single source of truth for the invariant.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION recompute_order_total(p_order_id text)
RETURNS void AS $$
BEGIN
  UPDATE "Order"
     SET "subtotal" = COALESCE((
           SELECT SUM("lineTotal")
             FROM "OrderItem"
            WHERE "orderId" = p_order_id
         ), 0),
         "total" = COALESCE((
           SELECT SUM("lineTotal")
             FROM "OrderItem"
            WHERE "orderId" = p_order_id
         ), 0) + COALESCE("taxAmount", 0) + COALESCE("shippingCost", 0)
   WHERE "id" = p_order_id;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────
-- Trigger function. Handles INSERT, UPDATE (incl. orderId reassignment),
-- and DELETE. Recomputes both old and new parent on a cross-order move.
-- ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION trigger_recompute_order_total()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recompute_order_total(OLD."orderId");
    RETURN OLD;
  ELSE
    PERFORM recompute_order_total(NEW."orderId");
    IF TG_OP = 'UPDATE' AND OLD."orderId" <> NEW."orderId" THEN
      PERFORM recompute_order_total(OLD."orderId");
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ───────────────────────────────────────────────────────────────────
-- Wire it up. AFTER row-level so the SUM sees the post-change state.
-- ───────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS recompute_order_total_trg ON "OrderItem";
CREATE TRIGGER recompute_order_total_trg
AFTER INSERT OR UPDATE OR DELETE ON "OrderItem"
FOR EACH ROW EXECUTE FUNCTION trigger_recompute_order_total();
