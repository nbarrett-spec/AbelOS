#!/usr/bin/env bash
# Abel Lumber — Full Brain Wiring Orchestrator
# Run this from the abel-builder-platform directory:
#   bash scripts/run-all-brain.sh
#
# It will:
#   1. Seed staff + import builders/products/vendors/customers  (run-all-imports.mjs)
#   2. Import historical purchase orders + line items
#   3. Import current stock levels
#   4. Import bills of materials
#   5. Import per-builder pricing
#
# All steps are idempotent — safe to re-run.
set -e

cd "$(dirname "$0")/.."
echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ABEL LUMBER — FULL BRAIN WIRING"
echo "  Starting at: $(date)"
echo "════════════════════════════════════════════════════════════"

echo ""
echo "▶ STEP 1/5  Seed staff + builders + products + vendors"
node scripts/run-all-imports.mjs

echo ""
echo "▶ STEP 2/5  Historical purchase orders"
node scripts/import-purchase-orders.mjs

echo ""
echo "▶ STEP 3/5  Current stock levels"
node scripts/import-stock-levels.mjs

echo ""
echo "▶ STEP 4/5  Bills of materials"
node scripts/import-bom.mjs

echo ""
echo "▶ STEP 5/5  Per-builder pricing"
node scripts/import-builder-pricing.mjs

echo ""
echo "════════════════════════════════════════════════════════════"
echo "  ✅ BRAIN WIRING COMPLETE"
echo "  Finished at: $(date)"
echo "════════════════════════════════════════════════════════════"
