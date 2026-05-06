#!/bin/bash
# ─── ABEL DATA LOADER ────────────────────────────────────────────────────
# One-shot script to load ALL InFlow data into Aegis.
# Run this locally with the dev server running.
#
# What it does (in dependency order):
#   1. Vendors (~100)
#   2. Customers/Builders (~90 from CSV → fills the 550-builder gap)
#   3. Products (~3,461 SKUs)
#   4. Stock Levels (~452 records)
#   5. Vendor Products (cost linkage)
#   6. BOM entries
#   7. Purchase Orders (~17,503)
#   8. Sales Orders (~60,787)
#
# Auto-detects the latest CSV version (highest number in parens).
#
# Usage:
#   1. Start dev server:  npm run dev
#   2. Run this script:   bash scripts/load-inflow-data.sh
#
# Options:
#   BASE_DIR=/path/to/csvs bash scripts/load-inflow-data.sh
#   PORT=3001 bash scripts/load-inflow-data.sh
# ──────────────────────────────────────────────────────────────────────────

set -euo pipefail

PORT="${PORT:-3000}"
BASE_URL="http://localhost:${PORT}"
API_URL="${BASE_URL}/api/ops/import-inflow"

# Default: look in Downloads first (latest exports), fall back to parent dir
if [ -z "${BASE_DIR:-}" ]; then
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
  PARENT_DIR="$(dirname "$PROJECT_DIR")"

  # Check common locations for inFlow CSVs
  for candidate in \
    "${PARENT_DIR}/Downloads" \
    "${PARENT_DIR}" \
    "${PARENT_DIR}/In Flow Exports"; do
    if [ -d "$candidate" ] && ls "$candidate"/inFlow_*.csv 1>/dev/null 2>&1; then
      BASE_DIR="$candidate"
      break
    fi
  done

  if [ -z "${BASE_DIR:-}" ]; then
    echo "ERROR: No inFlow CSV files found. Set BASE_DIR=/path/to/csvs"
    exit 1
  fi
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ABEL DATA LOADER — InFlow → Aegis"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  API:      ${API_URL}"
echo "  CSV Dir:  ${BASE_DIR}"
echo ""

# Pre-flight: check dev server is running
if ! curl -s "${BASE_URL}" > /dev/null 2>&1; then
  echo "ERROR: Dev server not running at ${BASE_URL}"
  echo "Start it first:  npm run dev"
  exit 1
fi

# Count available CSVs
CSV_COUNT=$(ls "${BASE_DIR}"/inFlow_*.csv 2>/dev/null | wc -l)
echo "  Found ${CSV_COUNT} inFlow CSV files"
echo ""

# Show what will be loaded
echo "  Loading order: Vendors → Customers → Products → Stock"
echo "                 → Vendor Products → BOM → POs → SOs"
echo ""
echo "  This will take 2-10 minutes depending on data volume."
echo "  The 60K sales orders are the slowest step."
echo ""
read -p "  Press Enter to start (Ctrl+C to cancel)... "
echo ""

# Run the full import
echo "▶ Starting full import..."
echo ""

RESULT=$(curl -s -X POST "${API_URL}" \
  -H "Content-Type: application/json" \
  -H "x-staff-role: ADMIN" \
  -H "x-staff-id: system-import" \
  -w "\n%{http_code}" \
  -d "{
    \"importType\": \"all\",
    \"baseDir\": \"${BASE_DIR}\"
  }")

# Split response body and status code
HTTP_CODE=$(echo "$RESULT" | tail -1)
BODY=$(echo "$RESULT" | sed '$d')

if [ "$HTTP_CODE" = "200" ]; then
  echo "✅ Import completed successfully!"
  echo ""
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
else
  echo "❌ Import failed (HTTP ${HTTP_CODE})"
  echo ""
  echo "$BODY" | python3 -m json.tool 2>/dev/null || echo "$BODY"
  exit 1
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  NEXT STEPS"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  1. Run cleanup to deduplicate vendors:"
echo "     curl -X PATCH ${API_URL} -H 'x-staff-role: ADMIN' -H 'x-staff-id: system-import'"
echo ""
echo "  2. Verify counts in Aegis:"
echo "     Open app.abellumber.com → Ops → check builder/order/product counts"
echo ""
echo "  3. Replay seed batches (optional — for Jan 2026 subset with richer data):"
echo "     After builders are loaded, the so_batch_*.json files will now succeed"
echo ""
