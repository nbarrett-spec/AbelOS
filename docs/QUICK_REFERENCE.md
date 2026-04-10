# Product Enrichment API - Quick Reference Card

## Endpoints at a Glance

| Method | URL | Purpose | Query Params |
|--------|-----|---------|--------------|
| GET | `/api/ops/products/enrich` | Preview enrichments | `limit`, `offset`, `category` |
| POST | `/api/ops/products/enrich` | Apply enrichments | `category`, `dryRun` |

---

## Common Commands

### Preview First 50 Products
```bash
curl -X GET "http://localhost:3000/api/ops/products/enrich"
```
**Returns**: First 50 products with enrichments (no DB changes)

### Preview Specific Category
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20H%2FC%20Interior%20Doors&dryRun=true"
```
**Returns**: All products in category with enrichments (no DB changes)

### Apply to All Products
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich"
```
**Returns**: Summary of applied updates + samples

### Apply to Specific Category
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Exterior%20Doors"
```
**Returns**: Summary of applied updates to that category

---

## What Gets Generated

For each product, the endpoint creates:

| Field | Example | Usage |
|-------|---------|-------|
| `displayName` | "6-Panel Hollow Core Interior Door, 28×68, Left Hand, Primed" | Customer-facing product title |
| `description` | "Pre-hung 6-panel hollow core interior door..." | Full product description for listings |
| `styleKey` | "interior-6panel-hc-primed" | Group products for image mapping |

---

## Product Name Parsing

Recognized patterns in internal product names:

### Size Codes
| Code | Dimensions |
|------|------------|
| 2468 | 24" × 68" (2'0" × 5'8") |
| 2868 | 28" × 68" (2'4" × 5'8") |
| 3068 | 30" × 68" (2'6" × 5'8") |
| 2480 | 24" × 80" (2'0" × 6'8") |
| 3080 | 30" × 80" (2'6" × 6'8") |
| 4068 | 40" × 68" (3'4" × 5'8") - Double/Twin |

### Handing
| Code | Meaning |
|------|---------|
| LH | Left Hand (swings left) |
| RH | Right Hand (swings right) |
| LHIS | Left Hand Inswing |
| RHIS | Right Hand Inswing |

### Styles
| Pattern | Recognizes |
|---------|------------|
| "6 PNL", "6PNL" | 6-Panel door |
| "2 PNL", "2PNL" | 2-Panel door |
| "1 LITE", "1LITE" | 1-Lite (single glass) door |
| "SHAKER" | Shaker style |
| "FLUSH", "FLAT" | Flat/Flush door |
| "LOUVER" | Louvered door |

### Materials
| Pattern | Recognizes |
|---------|------------|
| "PINE" | Pine wood |
| "CLEAR PINE" | Clear (knot-free) pine |
| "MDF" | Medium-density fiberboard |
| "PRIMED" | Pre-primed for paint |
| "WALNUT" | Walnut wood |
| "FIBERGLASS" | Fiberglass exterior |

### Core Type
| Pattern | Recognizes |
|---------|------------|
| "H/C" | Hollow Core |
| "S/C" | Solid Core |

### Hardware
| Pattern | Recognizes |
|---------|------------|
| "BLK", "BLACK" | Black finish |
| "SN" | Satin Nickel |
| "ORB" | Oil Rubbed Bronze |

### Casing
| Pattern | Recognizes |
|---------|------------|
| "A-COL", "A-COL 2-1/4"" | A-Colonial casing |
| "C-322" | Colonial 322 casing |
| "NO CASE" | No casing included |

### Jamb
| Pattern | Recognizes |
|---------|------------|
| "4-5/8"", "4 5/8"" | 4-5/8" jamb depth |
| "6-5/8"", "6 5/8"" | 6-5/8" jamb depth |

---

## Typical Flow: Testing Before Full Rollout

### 1. Preview (GET)
```bash
curl -X GET "http://localhost:3000/api/ops/products/enrich?limit=100"
jq '.enrichments[0:2]'  # See first 2 examples
```
Expected: JSON with displayName, description, styleKey

### 2. Dry-Run Category (POST)
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Attic%20Doors&dryRun=true"
jq '.samples[]'  # See samples
```
Expected: No database changes, JSON with sample enrichments

### 3. Apply to Category (POST)
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Attic%20Doors"
```
Expected: Descriptions updated in database

### 4. Verify in Database
```bash
# From psql/DB tool:
SELECT sku, name, description FROM Product
WHERE category = 'ADT Attic Doors' LIMIT 2;
```
Expected: description field now populated

### 5. Roll Out to All (POST)
```bash
curl -X POST "http://localhost:3000/api/ops/products/enrich"
```
Expected: All products enriched

---

## Troubleshooting

### "Description is incomplete or odd"

Check the `parsed` field in response:
```json
{
  "parsed": {
    "doorSize": "2868",
    "handing": "LH",
    "panelStyle": "6-Panel",
    "material": "PRIMED",
    "coreType": "Hollow Core"
  }
}
```

If attributes are `null` or wrong, the product name doesn't follow standard format.

### "Dry-run succeeds but POST fails"

Check logs:
```bash
# Terminal where app is running should show error message
# Or check database connectivity
```

### "Descriptions not updating"

1. Verify products are in database: `SELECT COUNT(*) FROM Product WHERE active = true`
2. Check response `totalUpdated` matches `totalProcessed`
3. Verify database permissions (user can UPDATE Product)

---

## Response Examples

### Successful DRY-RUN
```json
{
  "mode": "dry-run",
  "totalProducts": 3070,
  "enrichments": [ ... ],
  "pagination": {
    "offset": 0,
    "limit": 50,
    "total": 3070,
    "hasMore": true
  }
}
```

### Successful APPLY
```json
{
  "mode": "applied",
  "totalProcessed": 3070,
  "totalUpdated": 3070,
  "byCategory": {
    "ADT H/C Interior Doors": 542,
    "ADT S/C Interior Doors": 369,
    "SLAB ONLY": 337,
    ...
  },
  "samples": [ ... ],
  "message": "Successfully enriched and updated 3070 products..."
}
```

### Error
```json
{
  "error": "Internal server error",
  "details": "Error message from server"
}
```

---

## Category Reference

Top categories by product count:

| Category | Count | Type |
|----------|-------|------|
| ADT H/C Interior Doors | 542 | Pre-hung hollow core interior |
| ADT S/C Interior Doors | 369 | Pre-hung solid core interior |
| SLAB ONLY | 337 | Door slabs (no frame) |
| ADT Exterior Doors | 161 | Pre-hung exterior |
| ADT Garage to House | 112 | Specialty interior |
| 1 Lite | 70 | Single glass lite doors |
| EXTERIOR DOOR | 66 | Non-ADT exterior |
| SERVICE | 64 | Service/pass-through doors |
| FIBERGLASS DOOR | 51 | Fiberglass exterior |
| ADT Attic Doors | 49 | Attic access doors |
| ADT Dunnage Doors | 48 | Specialty/temporary doors |
| TRIM | 44 | Trim components |
| TOLL BROTHERS | 43 | Toll Brothers brand doors |
| 20 MIN FIRE DOOR | 43 | Fire-rated doors |

---

## Key Fields in Response

### EnrichmentResult Object

```typescript
{
  productId: string          // Database ID
  sku: string               // Internal product code
  name: string              // Raw internal name (unchanged)
  displayName: string       // ← Customer-facing title (NEW)
  description: string       // ← Full description (NEW)
  styleKey: string          // ← For image grouping (NEW)
  parsed: ParsedProduct     // Debug: what was extracted
  category: string          // Product category
  subcategory?: string      // Product subcategory
}
```

---

## Performance Notes

- **GET (50 products)**: ~200-500ms
- **POST dry-run (all 3070)**: ~5-10s
- **POST apply (all 3070)**: ~10-15s
- Safe to run during business hours
- Database connection pooled (no connection exhaustion)

---

## Next Steps After Enrichment

Once descriptions are populated:

1. **Map Images**: Use `styleKey` to assign `imageUrl` values
2. **Set Alt Text**: Populate `imageAlt` field for accessibility
3. **Verify in UI**: Check product listings show new descriptions
4. **Update SEO**: Descriptions improve search indexing
5. **Catalog Exports**: Descriptions now available for printing/PDF

---

## Support

**Endpoint logs**: Check Next.js server console for errors
**Database check**: Verify descriptions in Product table
**Dry-run first**: Always test with dry-run before applying to production
**Category by category**: Apply to small categories first (Attic, Service) then larger ones

---

## Quick Copy-Paste Commands

```bash
# Test preview
curl "http://localhost:3000/api/ops/products/enrich?limit=10"

# Dry-run all
curl -X POST "http://localhost:3000/api/ops/products/enrich?dryRun=true"

# Apply all
curl -X POST "http://localhost:3000/api/ops/products/enrich"

# Test one category dry-run
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Attic%20Doors&dryRun=true"

# Apply to one category
curl -X POST "http://localhost:3000/api/ops/products/enrich?category=ADT%20Attic%20Doors"
```

---

*Last Updated: March 2026 | Endpoint: /api/ops/products/enrich | Version: 1.0*
