# Product Enrichment API Endpoint

## Overview

This endpoint (`/api/ops/products/enrich`) enriches Abel Door & Trim product data by:

1. **Parsing internal product names** into structured attributes (size, handing, material, style, etc.)
2. **Generating clean customer-facing display names** (e.g., "6-Panel Hollow Core Interior Door, 28×68, Left Hand, Primed")
3. **Creating detailed descriptions** with full product specifications
4. **Assigning style keys** for grouping products and mapping to supplier images

It processes all ~3,070 products in the database and updates their `description` field.

---

## API Endpoints

### GET /api/ops/products/enrich

**Purpose**: Dry-run preview of all enrichments without applying changes.

**Query Parameters**:
- `limit` (optional, default: 50): Number of products to preview
- `offset` (optional, default: 0): Pagination offset
- `category` (optional): Filter by product category (e.g., "ADT H/C Interior Doors")

**Example**:
```bash
GET /api/ops/products/enrich?limit=100&offset=0
GET /api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors&limit=20
```

**Response**:
```json
{
  "mode": "dry-run",
  "totalProducts": 3070,
  "enrichments": [
    {
      "productId": "id-123",
      "sku": "ADT2868LH6PNLPRIMED",
      "name": "ADT 2868 LH 6 PNL Primed H/C 4-5/8\" A-Col 2-1/4\"",
      "displayName": "6-Panel Hollow Core Interior Door, 28×68, Left Hand, Primed",
      "description": "Pre-hung 6-panel hollow core interior door in primed finish. 28\" × 68\" (2'4\" × 5'8\"). Left hand swing. Primed finish ready for paint. 4-5/8\" jamb with A-Colonial 2-1/4\" casing included. Black hinges. Manufactured and assembled by Abel Door & Trim.",
      "styleKey": "interior-6panel-hc-primed",
      "parsed": {
        "doorSize": "2868",
        "sizeWidth": "28\"",
        "sizeHeight": "68\"",
        "handing": "LH",
        "material": "PRIMED",
        "panelStyle": "6-Panel",
        "coreType": "Hollow Core",
        "jambSize": "4-5/8\"",
        "casing": "A-Colonial 2-1/4\"",
        "hardwareFinish": "Black",
        "isDoubleDoor": false,
        "isPreHung": true,
        "isSlab": false,
        "isExterior": false,
        "isBifold": false,
        "isAtticDoor": false,
        "isBarnDoor": false,
        "isServiceDoor": false,
        "isFireRated": false,
        "isThreshold": false,
        "isTrim": false,
        "isTollBrothers": false,
        "isThermaRu": false
      },
      "category": "ADT H/C Interior Doors",
      "subcategory": "Pre-Hung"
    }
  ],
  "pagination": {
    "offset": 0,
    "limit": 50,
    "total": 3070,
    "hasMore": true
  }
}
```

---

### POST /api/ops/products/enrich

**Purpose**: Apply enrichments to all products in the database (with optional dry-run preview).

**Query Parameters**:
- `category` (optional): Enrich only products in a specific category
- `dryRun` (optional, default: false): Set to "true" for preview without applying changes

**Example - Dry Run (preview)**:
```bash
POST /api/ops/products/enrich?dryRun=true
POST /api/ops/products/enrich?category=ADT%20S%2FC%20Interior%20Doors&dryRun=true
```

**Example - Apply Changes**:
```bash
POST /api/ops/products/enrich
POST /api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors
```

**Response**:
```json
{
  "mode": "applied",
  "totalProcessed": 3070,
  "totalUpdated": 3070,
  "byCategory": {
    "ADT H/C Interior Doors": 542,
    "ADT S/C Interior Doors": 369,
    "SLAB ONLY": 337,
    "ADT Exterior Doors": 161,
    "ADT Garage to House Doors": 112,
    "1 Lite": 70,
    "EXTERIOR DOOR": 66,
    "SERVICE": 64,
    "FIBERGLASS DOOR": 51,
    "ADT Attic Doors": 49,
    "ADT Dunnage Doors": 48,
    "TRIM": 44,
    "TOLL BROTHERS INTERIOR DOORS": 43,
    "20 MIN FIRE DOOR": 43
  },
  "samples": [
    {
      "productId": "id-123",
      "sku": "ADT2868LH6PNLPRIMED",
      "name": "ADT 2868 LH 6 PNL Primed H/C 4-5/8\" A-Col 2-1/4\"",
      "displayName": "6-Panel Hollow Core Interior Door, 28×68, Left Hand, Primed",
      "description": "Pre-hung 6-panel hollow core interior door in primed finish...",
      "styleKey": "interior-6panel-hc-primed",
      "parsed": { /* ... */ },
      "category": "ADT H/C Interior Doors"
    }
  ],
  "message": "Successfully enriched and updated 3070 products with descriptions and style mappings."
}
```

---

## Parsing Rules

The endpoint intelligently parses ADT product names using these patterns:

### Size Codes
Extracts dimensions like `2468`, `2868`, `3068`, `2480`, `3080`, `4068`, etc.
- First two digits = width (24" = 2'0", 28" = 2'4", 30" = 2'6", 40" = 3'4")
- Last two digits = height (68" = 5'8", 80" = 6'8")

### Handing
- `LH` → Left Hand
- `RH` → Right Hand
- `LHIS` → Left Hand Inswing
- `RHIS` → Right Hand Inswing

### Materials
Recognizes: Pine, MDF, Primed, Clear Pine, Knotty Alder, Hemlock, Oak, Mahogany, Fiberglass, Steel, Walnut

### Styles (Panel/Glass Doors)
- `6 PNL`, `2 PNL` → 6-Panel, 2-Panel doors
- `1 LITE`, `10 LITE`, `15 LITE` → 1-Lite, 10-Lite, 15-Lite glass doors
- `SHAKER`, `FLUSH`, `FLAT` → Panel styles
- `LOUVER`, `BIFOLD`, `BARN`, `FRENCH` → Special styles

### Core Type
- `H/C` → Hollow Core
- `S/C` → Solid Core

### Jamb Size
- `4-5/8"`, `4 5/8"` → 4-5/8" jamb
- `6-5/8"`, `6 5/8"` → 6-5/8" jamb

### Casing
- `A-COL`, `A-COL 2-1/4"` → A-Colonial or A-Colonial 2-1/4"
- `C-322` → Colonial 322
- `NO CASE` → No Casing

### Hardware Finish
- `BLK`, `BLACK` → Black
- `SN` → Satin Nickel
- `ORB` → Oil Rubbed Bronze

### Product Types
- **Interior Doors**: Category contains "ADT" or "Interior"
- **Exterior Doors**: Category contains "Exterior" or name contains "Exterior"
- **Slabs**: Category contains "SLAB"
- **Fire-Rated**: Category contains "FIRE" or name contains fire rating (20 MIN, 45 MIN, 90 MIN)
- **Therma-Tru**: Name contains "Therma-Tru" (extracts model codes like CCW906L, S100)
- **Attic Doors**: Category contains "ATTIC"
- **Barn Doors**: Category contains "BARN"
- **Service Doors**: Category contains "SERVICE"
- **Thresholds**: Category contains "THRESHOLD"
- **Trim**: Category contains "TRIM"
- **Bifold**: Name contains "BIFOLD"
- **Double/Twin Doors**: Detected with variations (TWIN/T-AST, TWIN/BC)

---

## Display Name Generation

Display names follow a consistent format, from most specific to least:

**Interior Doors**:
```
[Double?] [Style] [CoreType] Interior Door, [Size], [Handing], [Material]
```
Examples:
- "6-Panel Hollow Core Interior Door, 28×68, Left Hand, Primed"
- "Shaker Solid Core Interior Door, 30×80, Right Hand, Primed MDF"
- "1-Lite Hollow Core Interior Door, 28×68, Right Hand, Clear Pine"

**Exterior Doors**:
```
[Style] [Material] Exterior Door, [Size], [Handing]
```
Examples:
- "6-Panel Pine Exterior Door, 36×80, Left Hand"
- "Therma-Tru CCW906L Door"

**Specialty**:
- Fire-Rated: "20-min Fire-Rated 6-Panel Door"
- Attic: "Attic Door"
- Barn: "Barn Door"
- Service: "Service Door"
- Threshold: "Threshold"
- Trim: "Trim"

---

## Description Generation

Descriptions provide comprehensive product details in prose format:

**Example 1 (Interior Door)**:
```
Pre-hung 6-panel hollow core interior door in primed finish. 28" × 68"
(2'4" × 5'8"). Left hand swing. Primed finish ready for paint. 4-5/8" jamb
with A-Colonial 2-1/4" casing included. Black hinges. Manufactured and
assembled by Abel Door & Trim.
```

**Example 2 (Solid Core Door)**:
```
Pre-hung Shaker style solid core interior door. 30" × 80" (2'6" × 6'8").
Right hand swing. Primed MDF ready for paint. 4-5/8" jamb, no casing included.
Black hinges. Manufactured and assembled by Abel Door & Trim.
```

**Example 3 (Fire-Rated)**:
```
20-min fire-rated 6-panel door. Hollow core construction for lightweight handling.
```

---

## Style Keys

Style keys are generated for image grouping and supplier mapping. Format:
```
[type]-[style]-[core]-[material]-[finish]
```

**Examples**:
- `interior-6panel-hc-primed` → 6-Panel HC interior, Primed
- `interior-shaker-sc-mdf` → Shaker SC interior, MDF
- `interior-1lite-hc-clear` → 1-Lite HC interior, Clear Pine
- `exterior-6panel-fiberglass` → 6-Panel exterior, Fiberglass
- `fire-rated-20min` → Fire-rated doors (20-min)
- `thermatru-ccw906l` → Therma-Tru model CCW906L
- `bifold-wood` → Bifold doors
- `attic-door` → Attic doors
- `barn-door` → Barn doors

---

## Workflow

### Step 1: Preview with DRY RUN
```bash
# Check all enrichments for the first 100 products
curl -X GET "http://localhost:3000/api/ops/products/enrich?limit=100"

# Or POST with dryRun
curl -X POST "http://localhost:3000/api/ops/products/enrich?dryRun=true"

# Filter by category to test
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors&dryRun=true"
```

### Step 2: Review Samples
- Inspect the `samples` array in the response
- Check display names and descriptions for accuracy
- Verify parsed attributes match the product

### Step 3: Apply Full Enrichment
Once satisfied with dry-run results:
```bash
# Apply to entire database
curl -X POST "http://localhost:3000/api/ops/products/enrich"

# Or enrich specific category only
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Exterior%20Doors"
```

### Step 4: Next Steps
After descriptions are populated, the style keys can be used to:
1. Group products visually by type
2. Map to supplier image URLs (Therma-Tru, generic door images, etc.)
3. Auto-assign imageUrl and imageAlt fields in a follow-up operation

---

## Performance

- **Dry-run GET**: ~200-500ms for previewing up to 50 products
- **POST (all products)**: ~5-15 seconds for 3,070 products
  - Uses batch updates (100 at a time) to avoid overwhelming the database
  - Parsing is CPU-bound; updates are I/O-bound

---

## Fields Updated

The endpoint only modifies the `description` field on Product records:
- `name` (SKU reference) — **NOT changed** (preserve internal reference)
- `description` — **Updated** with clean customer-facing text
- `imageUrl`, `thumbnailUrl`, `imageAlt` — Not modified (can be populated in separate image-mapping step)

---

## Error Handling

**Common Issues**:

1. **No updates applied**
   - Check database connection
   - Verify products exist in database
   - Ensure `active: true` for products you want to enrich

2. **Unexpected descriptions**
   - Product names may not match expected format
   - Parser handles many variations, but unusual names may not parse correctly
   - Check parsed attributes in response for debugging

3. **Performance issues**
   - Run on less critical products first (smaller categories)
   - Use `category` filter to process in batches
   - Check database load/query performance

---

## Testing

Test with a small, representative category first:

```bash
# Test with single category
POST /api/ops/products/enrich?category=ADT%20Attic%20Doors&dryRun=true

# If satisfied, apply
POST /api/ops/products/enrich?category=ADT%20Attic%20Doors

# Then move to larger categories
POST /api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors&dryRun=true
POST /api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors
```

---

## Notes

- The parser is **case-insensitive** for all attribute detection
- **Whitespace/punctuation variations** in product names are handled gracefully
- **Multiple matches** (e.g., both Pine and Primed in name) — parser uses first match in priority order
- **Unknown attributes** are ignored; the endpoint gracefully handles edge cases
- **No data loss** — descriptions are only added, existing data is never deleted
