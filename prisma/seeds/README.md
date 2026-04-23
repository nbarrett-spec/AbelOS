# Abel OS Seed System

Populate Aegis (Abel OS) with master data from the NUC brain export. One-time import that runs once at setup, then live ops take over.

## What It Does

Seeds 9 tables across builders, products, inventory, vendors, staff, and financial baseline:

| Step | Table(s) | Records | Source |
|------|----------|---------|--------|
| 1 | Builder | ~100 | `customers.jsonl` |
| 2 | Product | ~3,093 | `products.jsonl` |
| 3 | Vendor | ~64 | `vendors.jsonl` |
| 4 | Staff + Crew + CrewMember | 44 + 3 crews + members | Team intel + `system_learnings_*.jsonl` |
| 5 | InventoryItem | ~2,110 | `products_inventory.jsonl` (depends on step 2) |
| 6 | VendorProduct | ~1,400 | `products.jsonl` cross-ref (depends on steps 2, 3) |
| 7 | BuilderPricing | ~8,000 | `products.jsonl` builder prices (depends on steps 1, 2) |
| 8 | Deal | ~10 | `opportunities.jsonl` (depends on step 4) |
| 9 | FinancialSnapshot + CollectionRule | 1 + 4 | Manual baseline rules |

## Prerequisites

1. **DATABASE_URL set:**
   ```bash
   export DATABASE_URL="postgresql://..."
   ```

2. **Brain export files** in `prisma/brain_export/`:
   - `customers.jsonl`
   - `products.jsonl`
   - `products_inventory.jsonl`
   - `vendors.jsonl`
   - `system_learnings_bolt.jsonl`
   - `system_learnings_team.jsonl`
   - `opportunities.jsonl` (optional, for deals)
   - `all_findings_financial.jsonl` (optional, for financial snapshot)

3. **ts-node** installed (dev dependency via `package.json`)

## How to Run

### Run all seeds in order:
```bash
npx ts-node prisma/seeds/run-all-seeds.ts
```

### Run a single step (e.g., step 1 only):
```bash
npx ts-node prisma/seeds/run-all-seeds.ts --step 1
```

Useful for re-running a failed step without reseeding everything.

### Dry run (see what would execute):
```bash
npx ts-node prisma/seeds/run-all-seeds.ts --dry-run
```

### Get help:
```bash
npx ts-node prisma/seeds/run-all-seeds.ts --help
```

## Dependency Order

The runner enforces this order and skips dependent steps if their dependencies fail:

```
1. Builders (no deps)
2. Products (no deps)
3. Vendors (no deps)
4. Staff + Crews (no deps)
   ↓
5. Inventory (needs Products from step 2)
6. Vendor Products (needs Products + Vendors from steps 2, 3)
7. Builder Pricing (needs Builders + Products from steps 1, 2)
8. Deals (needs Staff from step 4)
9. Financial Snapshot (no deps, but should run last)
```

## Verify It Worked

After a successful run, spot-check these queries:

```sql
-- Check builders seeded
SELECT COUNT(*), builderType FROM public."Builder" GROUP BY builderType;
-- Expected: ~70 CUSTOM, ~30 PRODUCTION

-- Check products
SELECT COUNT(*) FROM public."Product";
-- Expected: ~3,093

-- Check inventory linked
SELECT COUNT(*) FROM public."InventoryItem" WHERE "productId" IS NOT NULL;
-- Expected: ~2,110

-- Check staff and reporting
SELECT COUNT(*) FROM public."Staff";
-- Expected: 44+

-- Check builder pricing
SELECT COUNT(*) FROM public."BuilderPricing";
-- Expected: ~8,000

-- Check crews
SELECT name, "crewType", COUNT(cm."id") as members
FROM public."Crew" c
LEFT JOIN public."CrewMember" cm ON cm."crewId" = c.id
GROUP BY c.id, c.name, c."crewType";
-- Expected: 2-3 delivery crews, 1 production crew
```

## If a Seed Fails

**Error during a full run:**
1. Read the error message (runner prints it).
2. Fix the issue (missing file, DB connection, data format).
3. Re-run just that step:
   ```bash
   npx ts-node prisma/seeds/run-all-seeds.ts --step 5
   ```

**Common issues:**
- `DATABASE_URL not set` → Export it: `export DATABASE_URL="..."`
- `File not found` → Check `prisma/brain_export/` directory exists with JSONL files.
- `Product not found for SKU` (inventory step) → Products step didn't seed, re-run step 2 first.
- `Builder not found` (pricing step) → Builders step didn't seed, re-run step 1 first.

**If Prisma client fails:**
```bash
# Regenerate Prisma client
npx prisma generate
# Then re-run
npx ts-node prisma/seeds/run-all-seeds.ts --step N
```

## Output

The runner prints:
- Step-by-step progress (which step is running, how long)
- Warnings for skipped records (product not found, etc.)
- Final summary table with success/failure status and timing

Example:
```
═══════════════════════════════════════════════════════════════
                  Abel OS Seed Runner
═══════════════════════════════════════════════════════════════
Database: postgresql://...
Dry run:  NO
Steps:    All (1-9)
───────────────────────────────────────────────────────────────

Step 1/9: Builders...
  Processing 100 customer records...
  Processed 25/100 records...
  Processed 50/100 records...
  Processed 75/100 records...
  Seeded 100 builders (70 production, 30 custom)

Step 2/9: Products...
  ... [output] ...

╔════════════════════════════════════════════════════════════════╗
║                      SEED RUN SUMMARY                          ║
╠════════════════════════════════════════════════════════════════╣
║ Step │ Status   │ Name                          │ Duration    ║
║  1   │ ✓ success│ Builders                      │ 2.30s       ║
║  2   │ ✓ success│ Products                      │ 4.12s       ║
...
║ Total: 9 success, 0 failed, 0 skipped            20.45s      ║
╚════════════════════════════════════════════════════════════════╝
```

## What Happens After Seeding?

1. **Live ops take over:** New orders, jobs, POs, etc. created in the app go straight to the DB.
2. **No more brain imports:** These seed files are run once. Daily brain scans feed into the NUC engine, not back into Aegis.
3. **Updates via Aegis UI or API:** Builders, products, pricing changes go through the app, not via script.

## Customization

Each seed file is independent. To modify:

1. Edit the seed file (e.g., `seed-builders.ts`)
2. Re-run just that step:
   ```bash
   npx ts-node prisma/seeds/run-all-seeds.ts --step 1
   ```

See individual seed file for field mapping and parsing logic.
