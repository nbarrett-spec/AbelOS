# Product Enrichment API - Usage Examples

Quick reference for common workflows.

---

## Quick Start

### Preview First 50 Products
```bash
curl -X GET "http://localhost:3000/api/ops/products/enrich"
```

### Dry-Run All Products (no changes)
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich?dryRun=true"
```

### Apply to All Products
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich"
```

---

## Workflow: Test Before Applying

### 1. Test with Attic Doors (49 products)
```bash
# Preview
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Attic%20Doors&dryRun=true"

# Apply if happy with results
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Attic%20Doors"
```

### 2. Test with Interior Hollow Core (542 products)
```bash
# Dry run first
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors&dryRun=true"

# Apply
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors"
```

### 3. Roll Out to All Categories
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich"
```

---

## Pagination & Sampling

### Preview 20 Products Starting at Offset 100
```bash
curl -X GET "http://localhost:3000/api/ops/products/enrich?limit=20&offset=100"
```

### Preview All Fiberglass Doors
```bash
curl -X GET "http://localhost:3000/api/ops/products/enrich?category=FIBERGLASS%20DOOR&limit=200"
```

---

## Expected Output Examples

### Example 1: Interior 6-Panel Hollow Core
**Input Name**: `ADT 2868 LH 6 PNL Primed H/C 4-5/8" A-Col 2-1/4""`

**Output**:
```json
{
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
    "hardwareFinish": "Black"
  }
}
```

### Example 2: Shaker Solid Core
**Input Name**: `ADT 3080 RH Shaker MDF Primed S/C 4-5/8" NO CASE BLK Hinges`

**Output**:
```json
{
  "displayName": "Shaker Solid Core Interior Door, 30×80, Right Hand, Primed MDF",
  "description": "Pre-hung Shaker style solid core interior door. 30\" × 80\" (2'6\" × 6'8\"). Right hand swing. Primed MDF ready for paint. 4-5/8\" jamb, no casing included. Black hinges. Manufactured and assembled by Abel Door & Trim.",
  "styleKey": "interior-shaker-sc-primed",
  "parsed": {
    "doorSize": "3080",
    "handing": "RH",
    "material": "PRIMED",
    "panelStyle": "Shaker",
    "coreType": "Solid Core",
    "jambSize": "4-5/8\"",
    "casing": "No Casing",
    "hardwareFinish": "Black"
  }
}
```

### Example 3: 1-Lite Clear Pine
**Input Name**: `ADT 2468 RH 1 Lite Clear 4-5/8" NO CASE Blk Hinge (BC/SS)`

**Output**:
```json
{
  "displayName": "1-Lite Hollow Core Interior Door, 24×68, Right Hand, Clear Pine",
  "description": "Pre-hung 1-lite hollow core interior door in clear pine. 24\" × 68\" (2'0\" × 5'8\"). Right hand swing. Unfinished — ready for stain or paint. 4-5/8\" jamb, no casing included. Black hinges. Manufactured and assembled by Abel Door & Trim.",
  "styleKey": "interior-1lite-hc-clear",
  "parsed": {
    "doorSize": "2468",
    "handing": "RH",
    "material": "CLEAR PINE",
    "panelStyle": "1-Lite",
    "coreType": "Hollow Core",
    "jambSize": "4-5/8\"",
    "casing": "No Casing",
    "hardwareFinish": "Black"
  }
}
```

### Example 4: Therma-Tru Exterior
**Input Name**: `Therma-Tru CCW906L 3068 LH Classic Craft Walnut`

**Output**:
```json
{
  "displayName": "Therma-Tru CCW906L Door",
  "description": "Therma-Tru fiberglass exterior door. Model CCW906L.",
  "styleKey": "thermatru-ccw906l",
  "parsed": {
    "isThermaRu": true,
    "thermaRuModel": "CCW906L",
    "doorSize": "3068",
    "handing": "LH"
  }
}
```

### Example 5: Fire-Rated Door
**Input Name**: `ADT 3068 RH 6 PNL Primed 20 MIN FIRE DOOR`

**Output**:
```json
{
  "displayName": "20-min Fire-Rated 6-Panel Door, 30×68, Right Hand",
  "description": "20-min fire-rated 6-panel door. 30\" × 68\" (2'6\" × 5'8\"). Right hand swing. Manufactured and assembled by Abel Door & Trim.",
  "styleKey": "fire-rated-20min",
  "parsed": {
    "isFireRated": true,
    "fireRating": "20-min",
    "panelStyle": "6-Panel",
    "doorSize": "3068",
    "handing": "RH"
  }
}
```

### Example 6: Double Door with Astragal
**Input Name**: `ADT 4068 LH Twin/T-AST 6 PNL Primed H/C 4-5/8" A-Col`

**Output**:
```json
{
  "displayName": "Double 6-Panel Hollow Core Interior Door, 40×68, Left Hand, Primed",
  "description": "Pre-hung double 6-panel hollow core interior door in primed finish. 40\" × 68\" (3'4\" × 5'8\"). Left hand swing. Primed finish ready for paint. 4-5/8\" jamb with A-Colonial casing included. Includes T-Astragal for double-door swing. Manufactured and assembled by Abel Door & Trim.",
  "styleKey": "interior-double-6panel-hc-primed",
  "parsed": {
    "isDoubleDoor": true,
    "astrType": "T-Astragal",
    "panelStyle": "6-Panel",
    "coreType": "Hollow Core",
    "material": "PRIMED"
  }
}
```

---

## Troubleshooting

### "Unexpected description for [product]"

Check what the parser extracted:
```bash
curl -X GET "http://localhost:3000/api/ops/products/enrich?limit=1" \
  | jq '.enrichments[0].parsed'
```

Look at the `parsed` object. If attributes are missing or wrong, the product name may not follow the standard format.

### "Some products have empty styleKey"

All products should have a styleKey. If empty, check the category — it may be TRIM or SERVICE which have minimal styling.

### "I need to re-enrich (apply different logic)"

The endpoint is idempotent on `description` only. Re-running POST will:
1. Re-parse all products
2. Re-generate descriptions (overwriting previous)
3. Update all descriptions again

No harm in running multiple times for testing.

---

## Verifying Results

### Check Descriptions Were Updated
```bash
# From psql or your DB tool
SELECT sku, name, description FROM "Product"
WHERE description IS NOT NULL
LIMIT 5;
```

### Count Updated Products
```bash
SELECT COUNT(*) as enriched FROM "Product"
WHERE description IS NOT NULL;
```

### Check by Category
```bash
SELECT category, COUNT(*) as count,
  COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as enriched
FROM "Product"
WHERE active = true
GROUP BY category
ORDER BY count DESC;
```

---

## Next Steps (After Enrichment)

Once descriptions are populated, the `styleKey` values can be used for:

### 1. Image Mapping
Group products by styleKey and assign image URLs:
```json
{
  "interior-6panel-hc-primed": "https://cdn.example.com/doors/6-panel-interior.jpg",
  "interior-shaker-sc-primed": "https://cdn.example.com/doors/shaker-interior.jpg",
  "interior-1lite-hc-clear": "https://cdn.example.com/doors/1-lite-clear.jpg",
  "exterior-6panel-fiberglass": "https://cdn.example.com/doors/6-panel-exterior.jpg",
  "thermatru-ccw906l": "https://thermatru.com/products/ccw906l.jpg",
  "fire-rated-20min": "https://cdn.example.com/doors/20min-fire-door.jpg"
}
```

### 2. Alt Text Generation
Use styleKey to generate accessibility alt text:
```
"interior-6panel-hc-primed" →
"Pre-hung 6-panel hollow core interior door in primed finish"
```

### 3. Product Catalog Display
Use displayName directly in customer-facing UI:
- E-commerce site product titles
- PDF catalogs
- Sales presentations

---

## Performance Notes

- **First run** (all 3,070): ~10-15 seconds
- **Subsequent runs** (re-enrichment): ~10-15 seconds (overwrites descriptions)
- **Category batch** (e.g., 542 interior HC): ~2-3 seconds
- Database connections pooled; no timeout issues expected

---

## Contact & Issues

If you encounter issues:
1. Check the response `message` and `error` fields
2. Review parsed attributes to understand why parsing failed
3. Verify product names follow expected format
4. Check database connectivity and Prisma client logs

For name format issues, add samples to parsing logic in `parseProductName()` function.
