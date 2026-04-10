# Boise Cascade / BlueLinx Supplier Pricing Integration

**Status**: ✅ Production Ready

## Quick Start

### 1. Upload a Price Sheet

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing \
  -H "x-staff-id: $(whoami)" \
  -H "x-staff-role: MANAGER" \
  -F "file=@price-sheet.csv"
```

### 2. Review the Results

Get an overview of pending updates, cost changes, and margin alerts:

```bash
curl http://localhost:3000/api/ops/integrations/supplier-pricing \
  -H "x-staff-id: $(whoami)" \
  -H "x-staff-role: MANAGER"
```

### 3. Review Pending Updates

See all pending updates with detailed cost/margin impact:

```bash
curl "http://localhost:3000/api/ops/integrations/supplier-pricing/apply?status=PENDING" \
  -H "x-staff-id: $(whoami)" \
  -H "x-staff-role: MANAGER"
```

### 4. Approve or Reject

Approve selected updates:

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing/apply \
  -H "x-staff-id: $(whoami)" \
  -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{"updateIds": ["id1", "id2"], "action": "approve"}'
```

Approve all at once:

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing/apply \
  -H "x-staff-id: $(whoami)" \
  -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve-all"}'
```

### 5. Review History

See past imports and analytics:

```bash
curl "http://localhost:3000/api/ops/integrations/supplier-pricing/history" \
  -H "x-staff-id: $(whoami)" \
  -H "x-staff-role: MANAGER"
```

## Files Created

### Core Integration Library
- **`src/lib/integrations/boise-cascade.ts`** (25 KB)
  - CSV parser with flexible column detection
  - SKU matching engine (exact → fuzzy → partial)
  - Price/margin calculator
  - Batch import and apply functions
  - Price alert generator
  - ~800 lines, fully documented

### API Routes
- **`src/app/api/ops/integrations/supplier-pricing/route.ts`** (10 KB)
  - GET: Overview, stats, alerts, history
  - POST: Upload and process CSV files

- **`src/app/api/ops/integrations/supplier-pricing/apply/route.ts`** (8 KB)
  - POST: Approve/reject/approve-all updates
  - GET: Fetch updates by status

- **`src/app/api/ops/integrations/supplier-pricing/history/route.ts`** (9 KB)
  - GET: Detailed import history and analytics

### Documentation
- **`src/lib/integrations/BOISE_CASCADE_SETUP.md`** (Full setup guide with examples)
- **`BOISE_CASCADE_INTEGRATION.md`** (This file)

## Database Schema

Automatically created table: **SupplierPriceUpdate**

```
id                TEXT PRIMARY KEY
supplier          TEXT              -- 'BOISE_CASCADE'
batchId           TEXT              -- Groups imports
productId         TEXT              -- Links to Product
supplierSku       TEXT              -- Item number
productName       TEXT              -- Product name
previousCost      NUMERIC(12,2)     -- Old cost
newCost           NUMERIC(12,2)     -- New cost
costChange        NUMERIC(12,2)     -- Delta
costChangePct     NUMERIC(8,4)      -- % change
currentPrice      NUMERIC(12,2)     -- Current basePrice
suggestedPrice    NUMERIC(12,2)     -- Recommended price
currentMarginPct  NUMERIC(8,4)      -- Current margin %
newMarginPct      NUMERIC(8,4)      -- New margin %
matchType         TEXT              -- exact|fuzzy|partial
matchConfidence   NUMERIC(5,4)      -- 0-1 score
status            TEXT              -- PENDING|APPROVED|REJECTED
appliedAt         TIMESTAMP         -- When applied
appliedById       TEXT              -- Staff member
createdAt         TIMESTAMP
updatedAt         TIMESTAMP
```

## Key Features

### ✅ CSV Parsing
- Flexible column detection (case-insensitive)
- Handles quoted fields, escaped quotes
- Auto-converts currency ($), commas
- Skips malformed rows gracefully

### ✅ SKU Matching (3-tier)
1. **Exact Match**: SKU = SKU (Confidence: 100%)
2. **Fuzzy Match**: PostgreSQL SIMILARITY() (Confidence: 40-95%)
3. **Partial Match**: First word in name (Confidence: 40%)
4. Report unmatched items for catalog maintenance

### ✅ Price Calculations
- Cost change: `newCost - previousCost`
- Change %: `(costChange / previousCost) * 100`
- Margin protection: Suggests price to maintain `Product.minMargin`
- Automatically flags items below margin threshold

### ✅ Audit Trail
- Staff member recorded for each approval/rejection
- Timestamp of decision
- SyncLog entry for compliance
- Batch-based grouping

### ✅ Batch Workflow
```
Upload CSV
    ↓
Parse & Match SKUs
    ↓
Calculate Changes
    ↓
Store as PENDING
    ↓
Review (with alerts)
    ↓
Approve / Reject
    ↓
Update Product.cost
    ↓
View History
```

## Configuration

No external configuration needed. System uses existing:
- `Product` table (SKU, name, cost, basePrice, minMargin)
- `Vendor` table (if needed)
- Staff auth headers (x-staff-id, x-staff-role)

## API Endpoints Reference

### GET `/api/ops/integrations/supplier-pricing`
Overview with pending counts, cost summary, alerts, recent imports.

**Query params**: None

**Response includes**:
- Pending updates count by supplier
- Cost change summary (avg, min, max, total impact)
- Price alerts (items below minMargin threshold)
- Recent sync history
- Batch history

---

### POST `/api/ops/integrations/supplier-pricing`
Upload and process CSV price sheet.

**Request**: Multipart form data with `file` field, or JSON with `csv` field

**Query params**:
- `supplier`: Supplier name (default: BOISE_CASCADE)

**Response includes**:
- batchId (for tracking)
- Summary stats (total rows, matched, unmatched)
- Matched updates with full detail
- Unmatched items with reasons

---

### GET `/api/ops/integrations/supplier-pricing/apply?status=PENDING`
Fetch updates by status.

**Query params**:
- `status`: PENDING | APPROVED | REJECTED (default: PENDING)
- `limit`: Max results (default: 100, max: 1000)

**Response includes**:
- Updates with cost/margin detail
- Stats (total, below min margin, avg cost change)

---

### POST `/api/ops/integrations/supplier-pricing/apply`
Approve, reject, or approve-all updates.

**Request body**:
```json
{
  "updateIds": ["id1", "id2"],  // Omit for approve-all
  "action": "approve" | "reject" | "approve-all"
}
```

**Response includes**:
- appliedCount
- rejectedCount
- errors (if any)

---

### GET `/api/ops/integrations/supplier-pricing/history?limit=50`
Detailed import history with analytics.

**Query params**:
- `limit`: Number of batches (default: 50, max: 500)
- `supplier`: Filter supplier (default: BOISE_CASCADE)
- `days`: Show last N days (optional)

**Response includes**:
- Overall statistics (total batches, updates, applied, rejected)
- Per-batch details (dates, costs, approval rates)
- Recent sync logs
- Product updates by category

## Security

- **Staff authentication required** on all endpoints (x-staff-id header)
- **Role-based access**: MANAGER+ required for operations
- **Audit trail**: All approvals logged with staff ID and timestamp
- **No sensitive data**: Price changes only, no supplier credentials stored

## Limitations & Notes

1. **Package Constraints**: Entire solution built without npm dependencies (no new packages)
2. **PostgreSQL-specific**: Uses `SIMILARITY()` for fuzzy matching (PostgreSQL extension required)
3. **Batch Size**: Tested with up to 500 items per import
4. **Unmatched Items**: Manual catalog review needed for items without SKU match

## Testing

### Test CSV (Boise Cascade format)

```csv
Item Number,Description,UOM,List Price,Net Price,Effective Date
234-56789,2x4x8 Framing Lumber,EA,45.99,34.50,2024-03-25
345-67890,3/4 Plywood Sheathing 4x8,SHT,89.99,62.50,2024-03-25
456-78901,1x6x8 Pine Trim,LF,2.99,1.89,2024-03-25
```

### Create sample product first

```sql
INSERT INTO "Product" (id, sku, name, category, cost, "basePrice", "minMargin", active)
VALUES (
  'test_prod_1',
  '234-56789',
  '2x4x8 Framing Lumber',
  'Lumber',
  32.50,
  89.99,
  0.25,
  true
);
```

Then upload the CSV to see the system in action.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| No products matching | Check CSV column names, verify Product SKUs exist |
| Wrong suggested prices | Verify Product.minMargin setting |
| Sync fails | Check SyncLog, ensure MANAGER+ role |
| SIMILARITY not found | Enable PostgreSQL `pg_trgm` extension |

## Future Roadmap

- [ ] EDI 832 support (for larger accounts)
- [ ] BlueLinx API integration
- [ ] Automatic daily sync schedule
- [ ] Price change notifications (Slack/email)
- [ ] Supplier comparison reports
- [ ] Price trending/forecasts
- [ ] Margin optimization AI

## Support & Questions

Refer to `src/lib/integrations/BOISE_CASCADE_SETUP.md` for detailed documentation, architecture, and advanced usage examples.
