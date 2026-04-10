# Boise Cascade Integration — API Schema & Database

## Database Schema

### SupplierPriceUpdate Table

Auto-created on first API call. Stores supplier price changes pending review/approval.

```sql
CREATE TABLE "SupplierPriceUpdate" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,

  -- Identification & Linking
  supplier TEXT NOT NULL,                    -- 'BOISE_CASCADE'
  "batchId" TEXT NOT NULL,                   -- Groups imports from single upload
  "productId" TEXT NOT NULL,                 -- Foreign key to Product(id)
  "supplierSku" TEXT NOT NULL,               -- Supplier's item number
  "productName" TEXT NOT NULL,               -- Abel product name (snapshot)

  -- Cost Data
  "previousCost" NUMERIC(12, 2) NOT NULL,    -- Cost before this update
  "newCost" NUMERIC(12, 2) NOT NULL,         -- New cost from supplier
  "costChange" NUMERIC(12, 2) NOT NULL,      -- newCost - previousCost
  "costChangePct" NUMERIC(8, 4) NOT NULL,    -- (costChange / previousCost) * 100

  -- Price Data
  "currentPrice" NUMERIC(12, 2) NOT NULL,    -- Product.basePrice (snapshot)
  "suggestedPrice" NUMERIC(12, 2),           -- Recommended price (to maintain margin)
  "currentMarginPct" NUMERIC(8, 4),          -- Margin % at currentPrice/previousCost
  "newMarginPct" NUMERIC(8, 4),              -- Margin % at suggestedPrice/newCost

  -- Match Quality
  "matchType" TEXT,                          -- 'exact' | 'fuzzy' | 'partial'
  "matchConfidence" NUMERIC(5, 4),           -- 0-1 score

  -- Status & Audit
  status TEXT NOT NULL DEFAULT 'PENDING',    -- 'PENDING' | 'APPROVED' | 'REJECTED'
  "appliedAt" TIMESTAMP WITH TIME ZONE,      -- When approved/rejected
  "appliedById" TEXT,                        -- Staff member who approved

  -- Timestamps
  "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX "idx_supplier_price_update_batch_id" ON "SupplierPriceUpdate"("batchId");
CREATE INDEX "idx_supplier_price_update_product_id" ON "SupplierPriceUpdate"("productId");
CREATE INDEX "idx_supplier_price_update_status" ON "SupplierPriceUpdate"(status);
CREATE INDEX "idx_supplier_price_update_supplier" ON "SupplierPriceUpdate"(supplier);
```

## API Contract

### Authentication

All endpoints require staff authentication via headers:

```
x-staff-id: <staff_member_id>
x-staff-role: MANAGER|ADMIN|VIEWER
```

Role requirements:
- **GET**: VIEWER+
- **POST/PATCH/DELETE**: MANAGER+

### Common Response Format

All responses use `safeJson()` which safely serializes BigInt values from PostgreSQL.

**Success Response:**
```json
{
  "success": true,
  "data": { ... }
}
```

**Error Response:**
```json
{
  "error": "Error message",
  "status": 400|401|403|500
}
```

---

## Endpoint Reference

### 1. GET /api/ops/integrations/supplier-pricing

**Purpose**: Get overview of pending updates and recent imports

**Query Parameters**: None

**Request**:
```bash
curl -H "x-staff-id: user123" -H "x-staff-role: MANAGER" \
  http://localhost:3000/api/ops/integrations/supplier-pricing
```

**Response (200 OK)**:
```json
{
  "overview": {
    "totalPendingUpdates": 142,
    "lastImportTime": "2024-03-25T13:01:00.000Z",
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
        "productId": "prod_123",
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
  "syncHistory": [
    {
      "provider": "BOISE_CASCADE",
      "syncType": "PRICE_IMPORT",
      "status": "SUCCESS",
      "recordsProcessed": 150,
      "recordsCreated": 142,
      "recordsUpdated": 0,
      "recordsSkipped": 8,
      "recordsFailed": 0,
      "startedAt": "2024-03-25T13:01:00.000Z",
      "completedAt": "2024-03-25T13:01:05.000Z",
      "durationMs": 5000
    }
  ],
  "batchHistory": [
    {
      "batchId": "BOISE_1711353661234_abc123def",
      "total": 150,
      "pending": 0,
      "approved": 142,
      "rejected": 8,
      "avg_cost_change_pct": "4.23",
      "created_at": "2024-03-25T13:01:00.000Z"
    }
  ]
}
```

**Errors**:
- 401: Not authenticated
- 403: Insufficient permissions
- 500: Internal error

---

### 2. POST /api/ops/integrations/supplier-pricing

**Purpose**: Upload CSV and create price update records

**Query Parameters**:
- `supplier` (optional): Supplier name, default: `BOISE_CASCADE`

**Content-Type**:
- `multipart/form-data` with file field, OR
- `application/json` with csv field, OR
- `text/plain` raw CSV content

**Request Examples**:

Multipart file upload:
```bash
curl -X POST \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER" \
  -F "file=@price-sheet.csv" \
  http://localhost:3000/api/ops/integrations/supplier-pricing
```

JSON body:
```bash
curl -X POST \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{"csv": "Item Number,Description,Net Price\n234-56789,Product,50.00"}' \
  http://localhost:3000/api/ops/integrations/supplier-pricing
```

**Response (200 OK)**:
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

**Errors**:
- 400: No CSV provided, or invalid CSV
- 401: Not authenticated
- 403: Insufficient permissions
- 500: Database error

---

### 3. GET /api/ops/integrations/supplier-pricing/apply

**Purpose**: Fetch updates by status (pending, approved, or rejected)

**Query Parameters**:
- `status` (optional): `PENDING` | `APPROVED` | `REJECTED`, default: `PENDING`
- `limit` (optional): Max results 1-1000, default: 100

**Request**:
```bash
curl "http://localhost:3000/api/ops/integrations/supplier-pricing/apply?status=PENDING&limit=50" \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER"
```

**Response (200 OK)**:
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
      "batchId": "BOISE_1711353661234_abc123def",
      "createdAt": "2024-03-25T13:01:00.000Z"
    }
  ]
}
```

---

### 4. POST /api/ops/integrations/supplier-pricing/apply

**Purpose**: Approve, reject, or apply all pending price updates

**Request Body**:
```json
{
  "updateIds": ["update_123", "update_456"],
  "action": "approve" | "reject" | "approve-all"
}
```

Note: `updateIds` is optional when `action` is `approve-all`.

**Requests**:

Approve specific updates:
```bash
curl -X POST \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{"updateIds": ["update_123", "update_456"], "action": "approve"}' \
  http://localhost:3000/api/ops/integrations/supplier-pricing/apply
```

Approve all pending:
```bash
curl -X POST \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{"action": "approve-all"}' \
  http://localhost:3000/api/ops/integrations/supplier-pricing/apply
```

Reject specific updates:
```bash
curl -X POST \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER" \
  -H "Content-Type: application/json" \
  -d '{"updateIds": ["update_789"], "action": "reject"}' \
  http://localhost:3000/api/ops/integrations/supplier-pricing/apply
```

**Response (200 OK)**:
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

**Response (400 Bad Request)**:
```json
{
  "error": "action must be 'approve', 'reject', or 'approve-all'"
}
```

---

### 5. GET /api/ops/integrations/supplier-pricing/history

**Purpose**: Get detailed import history with analytics

**Query Parameters**:
- `limit` (optional): Number of batches, default: 50, max: 500
- `supplier` (optional): Filter by supplier, default: `BOISE_CASCADE`
- `days` (optional): Only show last N days

**Request**:
```bash
curl "http://localhost:3000/api/ops/integrations/supplier-pricing/history?limit=10&supplier=BOISE_CASCADE" \
  -H "x-staff-id: user123" -H "x-staff-role: MANAGER"
```

**Response (200 OK)**:
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
      "importDate": "2024-03-25T13:01:00.000Z",
      "lastAppliedDate": "2024-03-25T14:15:00.000Z",
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
  "syncLogs": [
    {
      "provider": "BOISE_CASCADE",
      "syncType": "PRICE_IMPORT",
      "status": "SUCCESS",
      "recordsProcessed": 150,
      "recordsCreated": 142,
      "recordsUpdated": 0,
      "recordsSkipped": 8,
      "recordsFailed": 0,
      "startedAt": "2024-03-25T13:01:00.000Z",
      "completedAt": "2024-03-25T13:01:05.000Z",
      "durationMs": 5000
    }
  ],
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

---

## Data Types & Ranges

| Field | Type | Range | Notes |
|-------|------|-------|-------|
| cost | NUMERIC(12,2) | 0.01-9999999.99 | Product cost in USD |
| price | NUMERIC(12,2) | 0.01-9999999.99 | Product price in USD |
| margin% | NUMERIC(8,4) | 0-100 | Percentage (0-1 in DB, 0-100 in API) |
| confidence | NUMERIC(5,4) | 0.0-1.0 | SKU match confidence |
| batchId | TEXT | | Format: `SUPPLIER_TIMESTAMP_RANDOMHEX` |

## CSV Column Name Detection

The CSV parser flexibly detects these column names (case-insensitive):

**SKU Column**: `Item Number`, `Item #`, `Item`, `SKU`, `Product Code`

**Description Column**: `Description`, `Product Name`, `Product`, `Name`

**Cost Column**: `Net Price`, `Dealer Price`, `Our Price`, `Cost`, `Your Cost`, `Wholesale`

**Price Column**: `List Price`, `MSRP`

**UOM Column**: `UOM`, `Unit of Measure`, `Unit`, `Measure`

Example:
```csv
Item #,Product,Our Price
234-56789,2x4x8 Lumber,34.50
```

This will be correctly parsed as:
- `supplierSku`: 234-56789
- `description`: 2x4x8 Lumber
- `cost`: 34.50

## Error Codes & Messages

| Code | Message | Action |
|------|---------|--------|
| 400 | No CSV content provided | Provide CSV file or content |
| 400 | Invalid action | Use 'approve', 'reject', or 'approve-all' |
| 401 | Not authenticated | Add x-staff-id and x-staff-role headers |
| 403 | Access denied | Ensure MANAGER+ role |
| 404 | Update not found | Check updateId exists |
| 500 | Internal server error | Check database connection |

## Workflow State Transitions

```
PENDING ──[approve]──> APPROVED ──[logged to SyncLog]──> Product.cost updated
   ↓
   └──[reject]──> REJECTED ──[logged to SyncLog]──> No change to Product
```

Once `status` is APPROVED or REJECTED, it is immutable.
