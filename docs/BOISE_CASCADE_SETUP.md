# Boise Cascade / BlueLinx Supplier Pricing Integration

## Overview

Complete supplier pricing feed integration for Boise Cascade lumber and building materials. Handles:

- CSV price sheet uploads (the most practical entry point)
- SKU matching against Abel's product catalog (exact, partial, fuzzy)
- Automatic margin impact calculation
- Batch review and approval workflow
- Cost update application with audit trail
- Import history and analytics

## Architecture

### Core Components

1. **`/src/lib/integrations/boise-cascade.ts`** — Core pricing library
   - CSV parser (handles Boise Cascade format variations)
   - SKU matching engine (3-tier: exact → fuzzy → partial)
   - Price calculator (cost change, margin impact, suggested prices)
   - Batch import/apply functions
   - Price alert generator (items below minMargin)

2. **`/src/app/api/ops/integrations/supplier-pricing/route.ts`** — Main API
   - `GET`: Overview and summary stats
   - `POST`: Upload and process CSV

3. **`/src/app/api/ops/integrations/supplier-pricing/apply/route.ts`** — Apply updates
   - `POST`: Approve/reject/approve-all updates
   - `GET`: Fetch pending/approved/rejected updates

4. **`/src/app/api/ops/integrations/supplier-pricing/history/route.ts`** — Import history
   - `GET`: Past imports with detailed stats

### Database Table

**SupplierPriceUpdate** (created automatically):

```sql
CREATE TABLE "SupplierPriceUpdate" (
  id TEXT PRIMARY KEY,
  supplier TEXT,              -- 'BOISE_CASCADE', etc.
  batchId TEXT,              -- Groups updates from single import
  productId TEXT,            -- Abel Product.id
  supplierSku TEXT,          -- Item number from Boise Cascade
  productName TEXT,          -- Abel product name
  previousCost NUMERIC,      -- Old cost before update
  newCost NUMERIC,           -- New cost from supplier
  costChange NUMERIC,        -- newCost - previousCost
  costChangePct NUMERIC,     -- (costChange / previousCost) * 100
  currentPrice NUMERIC,      -- Current basePrice in Abel
  suggestedPrice NUMERIC,    -- Recommended price to maintain margin
  currentMarginPct NUMERIC,  -- Margin % at currentPrice
  newMarginPct NUMERIC,      -- Margin % if newCost applied at currentPrice
  matchType TEXT,            -- 'exact' | 'fuzzy' | 'partial'
  matchConfidence NUMERIC,   -- 0-1 confidence score
  status TEXT,               -- 'PENDING' | 'APPROVED' | 'REJECTED'
  appliedAt TIMESTAMP,       -- When update was approved/rejected
  appliedById TEXT,          -- Staff who approved
  createdAt TIMESTAMP,       -- When imported
  updatedAt TIMESTAMP
);

CREATE INDEX idx_supplier_price_update_batch_id ON "SupplierPriceUpdate"("batchId");
CREATE INDEX idx_supplier_price_update_product_id ON "SupplierPriceUpdate"("productId");
CREATE INDEX idx_supplier_price_update_status ON "SupplierPriceUpdate"(status);
CREATE INDEX idx_supplier_price_update_supplier ON "SupplierPriceUpdate"(supplier);
```

## Usage Examples

### 1. Upload and Process CSV

**Request:**

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER" \
  -F "file=@boise-cascade-price-sheet.csv"
```

**CSV Format (Boise Cascade):**

```csv
Item Number,Description,UOM,List Price,Net Price,Effective Date
234-56789,2x4x8 Framing Lumber,EA,45.99,34.50,2024-03-25
345-67890,3/4 Plywood Sheathing 4x8,SHT,89.99,62.50,2024-03-25
456-78901,1x6x8 Pine Trim,LF,2.99,1.89,2024-03-25
```

Supported column name variations:
- SKU: `Item Number`, `Item #`, `SKU`, `item`, `product code`
- Description: `Description`, `Product Name`, `Product`
- Cost: `Net Price`, `Dealer Price`, `Our Price`, `Cost`
- Price: `List Price`, `MSRP`
- UOM: `UOM`, `Unit of Measure`

**Response:**

```json
{
  "success": true,
  "batchId": "BOISE_1711353661234_abc123def",
  "supplier": "BOISE_CASCADE",
  "summary": {
    "totalRows": 150,
    "matchedProducts": 142,
    "unmatchedRows": 8,
    "matchRate": 94.67
  },
  "matchedUpdates": [
    {
      "id": "update_123",
      "productId": "prod_456",
      "productName": "2x4x8 Framing Lumber",
      "supplierSku": "234-56789",
      "previousCost": 32.50,
      "newCost": 34.50,
      "costChange": 2.00,
      "costChangePct": 6.15,
      "currentPrice": 89.99,
      "suggestedPrice": 92.49,
      "currentMarginPct": 64.03,
      "newMarginPct": 62.84,
      "status": "PENDING",
      "matchType": "exact",
      "matchConfidence": 1.0
    }
  ],
  "unmatchedItems": [
    {
      "supplierSku": "999-99999",
      "supplierProductName": "Unknown product",
      "reason": "No matching product found in catalog"
    }
  ]
}
```

### 2. Get Overview and Alerts

**Request:**

```bash
curl http://localhost:3000/api/ops/integrations/supplier-pricing \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER"
```

**Response:**

```json
{
  "overview": {
    "totalPendingUpdates": 142,
    "lastImportTime": "2024-03-25T13:01:00Z",
    "suppliers": [
      {
        "name": "BOISE_CASCADE",
        "pendingUpdates": 142,
        "costIncreases": 85
      }
    ]
  },
  "changeSummary": {
    "totalUpdates": 142,
    "costIncreases": 85,
    "costDecreases": 42,
    "noChange": 15,
    "avgCostChangePct": 4.23,
    "minCostChangePct": -8.5,
    "maxCostChangePct": 12.3,
    "totalCostImpact": 2450.75
  },
  "priceAlerts": {
    "count": 7,
    "items": [
      {
        "batchId": "BOISE_1711353661234_abc123def",
        "productId": "prod_789",
        "productName": "Engineered Joist",
        "newCost": 145.00,
        "suggestedPrice": 193.33,
        "currentPrice": 175.00,
        "marginPct": 17.14,
        "minMargin": 25,
        "status": "PENDING"
      }
    ]
  },
  "syncHistory": [...],
  "batchHistory": [...]
}
```

### 3. Review Pending Updates

**Request:**

```bash
curl "http://localhost:3000/api/ops/integrations/supplier-pricing/apply?status=PENDING&limit=50" \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER"
```

**Response:**

```json
{
  "status": "PENDING",
  "count": 142,
  "stats": {
    "totalCount": 142,
    "belowMinMarginCount": 7,
    "avgCostChange": 4.23,
    "totalImpact": 2450.75
  },
  "updates": [
    {
      "id": "update_789",
      "productId": "prod_789",
      "productName": "Engineered Joist",
      "supplierSku": "567-89012",
      "previousCost": 130.00,
      "newCost": 145.00,
      "costChange": 15.00,
      "costChangePct": 11.54,
      "currentPrice": 175.00,
      "suggestedPrice": 193.33,
      "currentMarginPct": 25.71,
      "newMarginPct": 17.14,
      "minMargin": 25,
      "marginBelowThreshold": true,
      "status": "PENDING",
      "matchType": "exact",
      "matchConfidence": 1.0,
      "batchId": "BOISE_1711353661234_abc123def"
    }
  ]
}
```

### 4. Approve Updates

**Request — Approve Selected:**

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing/apply \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{
    "updateIds": ["update_123", "update_456"],
    "action": "approve"
  }'
```

**Request — Approve All:**

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing/apply \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approve-all"
  }'
```

**Request — Reject Updates:**

```bash
curl -X POST http://localhost:3000/api/ops/integrations/supplier-pricing/apply \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{
    "updateIds": ["update_789"],
    "action": "reject"
  }'
```

**Response:**

```json
{
  "success": true,
  "action": "approve",
  "appliedCount": 2,
  "rejectedCount": 0,
  "errors": [],
  "message": "2 updates approved, 0 rejected"
}
```

### 5. Get Import History

**Request:**

```bash
curl "http://localhost:3000/api/ops/integrations/supplier-pricing/history?limit=10&supplier=BOISE_CASCADE" \
  -H "x-staff-id: staff_123" \
  -H "x-staff-role: MANAGER"
```

**Response:**

```json
{
  "supplier": "BOISE_CASCADE",
  "overallStats": {
    "totalBatches": 12,
    "totalUpdates": 1842,
    "totalApplied": 1756,
    "totalRejected": 86,
    "avgAppliedCostChange": 3.45
  },
  "batchHistory": [
    {
      "batchId": "BOISE_1711353661234_abc123def",
      "supplier": "BOISE_CASCADE",
      "importDate": "2024-03-25T13:01:00Z",
      "lastAppliedDate": "2024-03-25T14:15:00Z",
      "totalItems": 150,
      "pending": 0,
      "approved": 142,
      "rejected": 8,
      "stats": {
        "avgCostChangePct": 4.23,
        "minCostChangePct": -8.5,
        "maxCostChangePct": 12.3,
        "totalCostImpact": 2450.75,
        "appliedByCount": 1
      }
    }
  ],
  "syncLogs": [...],
  "productUpdates": [
    {
      "category": "Lumber",
      "subcategory": "Framing",
      "updateCount": 45,
      "approvedCount": 42,
      "approvalRate": "93.3"
    }
  ]
}
```

## SKU Matching Strategy

The system uses a 3-tier matching approach for maximum flexibility:

### Tier 1: Exact Match (Confidence: 1.0)

Matches on Abel SKU = Supplier SKU (case-insensitive).

```typescript
SELECT id FROM "Product"
WHERE LOWER(sku) = LOWER('234-56789')
```

### Tier 2: Fuzzy Match (Confidence: 0.4-0.95)

Uses PostgreSQL's `SIMILARITY()` function to match product names. Requires >50% similarity.

```typescript
SELECT id FROM "Product"
WHERE SIMILARITY(LOWER(name), LOWER('2x4x8 Framing Lumber')) > 0.5
ORDER BY SIMILARITY DESC LIMIT 1
```

### Tier 3: Partial Match (Confidence: 0.4)

Matches on first significant word in product name (>3 chars).

```typescript
SELECT id FROM "Product"
WHERE LOWER(name) LIKE '%framing%'
LIMIT 1
```

### No Match

Items that don't match any tier are reported in `unmatchedItems`. Manual catalog maintenance may be needed.

## Margin Safety Features

### Automatic Price Adjustment

When a new cost would push margin below `minMargin`:

```typescript
const suggestedPrice = newCost / (1 - minMargin)
```

Example:
- Product: Doors (minMargin = 25%)
- Current: cost=$150, price=$200 (33% margin)
- New cost: $180
- Suggested price: $240 (to maintain 25% margin)

### Price Alerts

Items flagged with `marginBelowThreshold: true` if:

```
newMarginPct < (Product.minMargin * 100)
```

These should be reviewed before approval. Either:
1. Approve and update suggested price
2. Reject the cost increase
3. Negotiate with supplier

## Implementation Notes

### CSV Parsing

- Handles quoted fields and escaped quotes
- Converts currency ($) and numbers (commas) automatically
- Skips empty rows
- Flexible column name detection (case-insensitive, partial matches)

### Cost Calculation

- `newCost` = `cost` or `netPrice` from CSV (whichever is provided)
- `costChange` = `newCost - previousCost`
- `costChangePct` = `(costChange / previousCost) * 100`
- `newMarginPct` = `((suggestedPrice - newCost) / suggestedPrice) * 100`

### Audit Trail

All approvals/rejections logged to `SyncLog`:
- `appliedById`: Staff member who made the decision
- `appliedAt`: Timestamp of decision
- `status`: PENDING → APPROVED/REJECTED

### Error Handling

- Invalid CSV format → Returns detailed error with row numbers
- SKU mismatch → Item reported in `unmatchedItems`
- Cost invalid → Item skipped with reason
- Database errors → Logged, operation continues

## Workflow

```
1. Upload CSV File
   ↓
2. Parse & Match SKUs
   ↓
3. Calculate Price Changes
   ↓
4. Store as PENDING updates
   ↓
5. Review (get alerts for low margins)
   ↓
6. Approve Selected / Reject / Approve All
   ↓
7. Update Product.cost in Abel
   ↓
8. Log to SyncLog for audit
   ↓
9. View History & Analytics
```

## Future Enhancements

- EDI 832 (Price/Sales Catalog) support for larger Boise Cascade accounts
- BlueLinx distribution portal API integration
- Automatic daily/weekly price sync schedule
- Price change notifications (Slack/email alerts)
- Supplier comparison (Boise vs other vendors)
- Price forecast/trending analysis
- Margin optimization recommendations

## Troubleshooting

### No products matching in import

1. Check CSV column names — must include Item Number / SKU and Description
2. Verify Abel has products in the catalog with matching SKUs
3. Review fuzzy match results in response

### Suggested prices seem wrong

1. Check `Product.minMargin` setting
2. Verify cost/price calculations manually
3. Report edge cases

### Sync failures

1. Check database connection
2. Review `SyncLog` for error messages
3. Ensure staff has MANAGER+ role for operations

## Support

For integration questions or updates:
- Check batch history for patterns
- Review price alerts before approving
- Always audit high-cost-change items (>10%)
