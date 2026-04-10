# Abel Lumber Data Import API Guide

## Overview

Two comprehensive data import endpoints have been created to populate the Abel Lumber platform with real employee and InFlow product/vendor data.

### Endpoints

1. **`POST /api/ops/seed-employees`** - Seeds 16 real Abel Lumber employees
2. **`POST /api/ops/import-inflow`** - Imports InFlow data (products, vendors, customers, stock, BOMs)

---

## Endpoint 1: Seed Real Employees

### URL
```
POST /api/ops/seed-employees
```

### Description
Seeds ALL 16 real Abel Lumber employees into the Staff table. This endpoint is idempotent - it's safe to run multiple times.

### Request
```bash
curl -X POST http://localhost:3000/api/ops/seed-employees
```

### Response
```json
{
  "success": true,
  "message": "Employee seeding completed",
  "deleted": 0,
  "created": 16,
  "updated": 0,
  "total": 16
}
```

### What It Does
- **Deletes test staff**: Removes any staff with emails ending in `@abel-ops.com` or `@example.com`
- **Seeds employees**: Upserts all 16 employees using their email as the unique identifier
- **Default password**: All employees get password hash for `abel2026`
- **Hire date**: Set to today's date

### Employees Seeded
1. Josh Barrett - CEO - EXECUTIVE/ADMIN
2. Clint Vinson - COO - EXECUTIVE/ADMIN
3. Nathaniel Barrett - CFO - EXECUTIVE/ADMIN
4. Scott Johnson - GM - OPERATIONS/MANAGER
5. Sean Phillips - Customer Experience Manager - SALES/MANAGER
6. Karen Johnson - Director of Project Management - OPERATIONS/MANAGER
7. Darlene Haag - Project Manager - OPERATIONS/PROJECT_MANAGER
8. Jessica Rodriguez - Project Manager - OPERATIONS/PROJECT_MANAGER
9. Robin Howell - Project Manager - OPERATIONS/PROJECT_MANAGER
10. Dalton Whatley - Sales Consultant - SALES/SALES_REP
11. Jordan Sena - System Implementation Coordinator - OPERATIONS/ADMIN
12. Chris Poppert - Warehouse Manager - WAREHOUSE/WAREHOUSE_LEAD
13. Dakota Dyer - Driver Lead/Receiving - DELIVERY/DRIVER
14. Juan Arreola - Staff Accountant - ACCOUNTING/ACCOUNTING
15. James Gladue - Outside CFO - ACCOUNTING/ACCOUNTING
16. Bob Doebener - Purchasing - PURCHASING/PURCHASING

---

## Endpoint 2: InFlow Data Import

### URL
```
POST /api/ops/import-inflow
```

### Description
Imports data from InFlow CSV exports. Supports importing individual data types or all at once. All imports are idempotent.

### Request Format
```bash
curl -X POST http://localhost:3000/api/ops/import-inflow \
  -H "Content-Type: application/json" \
  -d '{"importType": "all"}'
```

### Import Types
| Type | Source File | Description |
|------|-------------|-------------|
| `products` | `inFlow_ProductDetails (10).csv` | Product catalog (skips Services) |
| `vendors` | `inFlow_Vendor (4).csv` | Vendor/supplier accounts |
| `customers` | `inFlow_Customer (4).csv` | Builder/customer accounts |
| `stock` | `inFlow_StockLevels (8).csv` | Inventory levels by location |
| `vendor-products` | `inFlow_VendorProductDetails.csv` | Vendor-specific SKUs & pricing |
| `bom` | `inFlow_BOM (7).csv` | Bill of Materials entries |
| `all` | All files | Imports everything (default) |

### Response
```json
{
  "success": true,
  "message": "InFlow data import completed",
  "timestamp": "2026-03-21T12:00:00.000Z",
  "importType": "all",
  "products": {
    "imported": 2847,
    "skipped": 5,
    "errors": []
  },
  "vendors": {
    "imported": 42,
    "skipped": 0,
    "errors": []
  },
  "customers": {
    "imported": 95,
    "skipped": 0,
    "errors": []
  },
  "stock": {
    "imported": 1523,
    "skipped": 12,
    "errors": []
  },
  "vendorProducts": {
    "imported": 3421,
    "skipped": 150,
    "errors": []
  },
  "bom": {
    "imported": 7416,
    "skipped": 0,
    "errors": []
  }
}
```

### Import Details

#### Products (`inFlow_ProductDetails (10).csv`)
- **Source columns**: ProductName, SKU, Category, ItemType, Description, DefaultUnitPrice
- **Behavior**:
  - Skips items where `ItemType === "Service"`
  - Maps Category to clean category name
  - Parses product name for door attributes (size, handing, core, panel, hardware finish, material, fire rating)
  - Upserts by SKU (idempotent)
- **Output**: Product records with parsed attributes

#### Vendors (`inFlow_Vendor (4).csv`)
- **Source columns**: Name, ContactName, Phone, Fax, Email, Website, Address1, Discount, PaymentTerms
- **Behavior**:
  - Generates vendor code from first 2-4 characters of name (uppercase)
  - Upserts by code (idempotent)
  - Stores contact info and address
- **Output**: Vendor records ready for purchase orders

#### Customers (`inFlow_Customer (4).csv`)
- **Source columns**: Name, ContactName, Phone, Fax, Email, PaymentTerms, etc.
- **Behavior**:
  - Maps to Builder table
  - Upserts by email (idempotent)
  - Translates PaymentTerms field (Net 15, Net 30, Pay at Order, etc.)
  - Stores company name and contact info
- **Output**: Builder/customer accounts with default password hash

#### Stock Levels (`inFlow_StockLevels (8).csv`)
- **Source columns**: ProductName, SKU, Location, Sublocation, Quantity
- **Behavior**:
  - Finds Product by SKU
  - Upserts InventoryItem by productId (idempotent)
  - Sets onHand quantity
- **Output**: Inventory records with stock levels

#### Vendor Products (`inFlow_VendorProductDetails.csv`)
- **Source columns**: Product, SKU, VendorProductCode, VendorPrice, LeadTimeDays
- **Behavior**:
  - Maps products to vendors
  - Upserts by (vendorId, productId) pair (idempotent)
  - Stores vendor SKU, cost, and lead time
- **Output**: VendorProduct cross-reference records

#### BOM (`inFlow_BOM (7).csv`)
- **Source columns**: Parent product name, Component product name, Quantity, ComponentType
- **Behavior**:
  - Groups entries by parent product
  - Matches components by product name
  - Creates BomEntry records linking parent to component
  - Skips entries where parent or component not found
- **Output**: BOM entries for assemblies/kits

### CSV File Handling
- **BOM Handling**: The CSV reader properly handles Byte Order Marks (BOM) at the start of files
- **Quoted Fields**: Supports CSV fields quoted with double quotes, including escaped quotes
- **File Path**: All CSV files must be located at:
  ```
  /sessions/jolly-happy-carson/mnt/Abel Lumber/In Flow Exports/
  ```

### Product Attribute Parsing

The import engine automatically extracts product attributes from product names using regex patterns:

| Attribute | Pattern Examples | Extracted As |
|-----------|------------------|--------------|
| Door Size | 2068, 2868, 3068 | doorSize |
| Handing | LH, RH, LHIS, RHIS | handing |
| Core Type | "HOLLOW CORE", "SOLID CORE" | coreType |
| Panel Style | 2-PANEL, 6-PANEL, SHAKER, FLAT | panelStyle |
| Hardware Finish | SN (Satin Nickel), BLK (Black), ORB (Oil Rubbed Bronze) | hardwareFinish |
| Material | PINE, MDF, PRIMED | material |
| Fire Rating | 20MIN, 45MIN, 90MIN | fireRating |

---

## Usage Examples

### Import Everything
```bash
curl -X POST http://localhost:3000/api/ops/import-inflow \
  -H "Content-Type: application/json" \
  -d '{"importType": "all"}'
```

### Import Just Products
```bash
curl -X POST http://localhost:3000/api/ops/import-inflow \
  -H "Content-Type: application/json" \
  -d '{"importType": "products"}'
```

### Import Vendors and Customers
```bash
curl -X POST http://localhost:3000/api/ops/import-inflow \
  -H "Content-Type: application/json" \
  -d '{"importType": "vendors"}'
# Then run again with:
curl -X POST http://localhost:3000/api/ops/import-inflow \
  -H "Content-Type: application/json" \
  -d '{"importType": "customers"}'
```

### Import in Specific Order (Recommended)
For a clean import, run in this order:

1. **Products first** (creates product records needed by other imports)
   ```bash
   curl -X POST ... -d '{"importType": "products"}'
   ```

2. **Vendors** (creates vendor records)
   ```bash
   curl -X POST ... -d '{"importType": "vendors"}'
   ```

3. **Customers** (creates builder accounts)
   ```bash
   curl -X POST ... -d '{"importType": "customers"}'
   ```

4. **Stock Levels** (needs products to exist)
   ```bash
   curl -X POST ... -d '{"importType": "stock"}'
   ```

5. **Vendor Products** (needs products & vendors)
   ```bash
   curl -X POST ... -d '{"importType": "vendor-products"}'
   ```

6. **BOM** (needs products to exist)
   ```bash
   curl -X POST ... -d '{"importType": "bom"}'
   ```

---

## Implementation Details

### Technologies
- **Framework**: Next.js 14 with App Router
- **Database**: Prisma ORM with PostgreSQL
- **Authentication**: bcryptjs for password hashing
- **CSV Parsing**: Custom line-by-line parser (no external dependencies)

### Key Features
- ✅ **Idempotent**: Safe to run multiple times without duplicates
- ✅ **Transactional integrity**: Uses Prisma upsert operations
- ✅ **BOM handling**: Properly strips byte order marks
- ✅ **Quoted field support**: Handles CSV quoted strings and escaped quotes
- ✅ **Error reporting**: Returns detailed error messages for each failed row
- ✅ **Flexible import**: Import all data at once or individual data types
- ✅ **Attribute extraction**: Automatically parses product names for specifications
- ✅ **Payment term mapping**: Translates vendor terms to app enums

### Error Handling
Both endpoints return detailed error information:

```json
{
  "success": true,
  "products": {
    "imported": 2840,
    "skipped": 12,
    "errors": [
      "Row 145: Duplicate SKU: BC001234",
      "Row 267: Invalid price format: 'N/A'"
    ]
  }
}
```

---

## Notes

### Data Cleanup
Before full import, the seed-employees endpoint cleans up test data:
- Deletes any staff with `@abel-ops.com` email addresses
- Deletes any staff with `@example.com` email addresses

### Password Reset
After initial seeding, recommend:
1. Have all employees set their own passwords via password reset flow
2. Or update via admin panel to temporary passwords with forced change on first login

### Vendor Code Generation
Vendor codes are automatically generated from vendor names:
- Takes first 2-4 alphanumeric characters
- Converts to uppercase
- Ensures uniqueness by appending numbers if needed

### CSV File Encoding
CSV files are read as UTF-8. The parser automatically handles:
- Byte Order Marks (BOM) in the first line
- Quoted fields with escaped quotes
- Empty fields and NULL values

---

## Testing

### Test the seed-employees endpoint:
```bash
# Check endpoint info
curl http://localhost:3000/api/ops/seed-employees

# Seed employees
curl -X POST http://localhost:3000/api/ops/seed-employees

# Verify in database
npx prisma studio  # Browse to Staff table
```

### Test the import-inflow endpoint:
```bash
# Check endpoint info
curl http://localhost:3000/api/ops/import-inflow

# Import all data
curl -X POST http://localhost:3000/api/ops/import-inflow \
  -H "Content-Type: application/json" \
  -d '{"importType": "all"}'

# Verify in database
npx prisma studio  # Browse Product, Vendor, Builder tables
```

---

## Files Created

```
/src/app/api/ops/seed-employees/route.ts     - Employee seeding endpoint
/src/app/api/ops/import-inflow/route.ts      - InFlow data import endpoint
```

## Prisma Schema Support

Both endpoints use the existing Prisma models:
- Staff (with StaffRole and Department enums)
- Product (with parsed attributes)
- Vendor
- VendorProduct
- Builder
- InventoryItem
- BomEntry

No schema changes required - fully compatible with current schema.prisma.
