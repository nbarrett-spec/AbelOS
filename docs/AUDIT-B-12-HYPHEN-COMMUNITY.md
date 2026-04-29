# AUDIT-B-12 — Hyphen Integration + Community/Lot/Plan Modeling
**Scope:** Hyphen (Brookfield's PM portal) integration depth
**Date:** 2026-04-28

## Status: 0/80 BWP jobs linked — solvable in 2-3 hours

## Root cause (definitive)

Three compounding issues, all P0:

### 1. IntegrationConfig row missing
- `provider='HYPHEN'` row absent from prod DB
- Cron `src/app/api/cron/hyphen-sync/route.ts:31-47` detects missing → silently skips with `status='SUCCESS'` (false positive)
- All three syncs (schedule_updates, payments, orders) blocked at the doorway

### 2. Community name mismatch
- Brookfield's community in Aegis: "Eagle Mountain"
- Hyphen sends: "The Grove Frisco 40s"
- Sync queries do exact name match: `WHERE "community" = $2 AND "lotBlock" = $3`
- Strings don't match → POs and schedules silently drop into HyphenOrder/HyphenOrderEvent with `jobId=NULL`

### 3. No HyphenSubdivisionMap model
- `HyphenBuilderAlias` exists ✓
- `HyphenProductAlias` exists ✓
- `HyphenSubdivisionMap` — **does not exist**
- This is the missing link

## P0 — Minimum viable Hyphen launch (2-3 hours)

### Step 1 — Insert IntegrationConfig row (15 min)
- Admin UI: enter Hyphen API key + base URL + supplier ID
- Test connection
- Existing handler `getConfig()` reads it correctly

### Step 2 — Create HyphenSubdivisionMap model (45 min)
```prisma
model HyphenSubdivisionMap {
  id          String   @id @default(cuid())
  hyphenName  String   @unique // "The Grove Frisco 40s"
  communityId String
  community   Community @relation(fields: [communityId], references: [id], onDelete: Cascade)
  notes       String?
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  @@index([communityId])
}
```
- Migration script (idempotent CREATE TABLE IF NOT EXISTS)

### Step 3 — Update sync queries to use the map (30 min)
- `src/lib/integrations/hyphen.ts:77-80` (schedule updates)
- `src/lib/integrations/hyphen.ts:427-429` (orders)
- LEFT JOIN HyphenSubdivisionMap; if mapped, resolve to communityId; else fall through to exact-match (existing behavior)

### Step 4 — Seed one row (1 min)
- "The Grove Frisco 40s" → Eagle Mountain Community.id

### Step 5 — Trigger sync (auto next hour, or manual)
- 0/80 → 80/80 linkage resolves

## P1 — Hardening

### 6. PO orphan-Job fallback
- Current behavior: `if (job.length > 0) { create Order } else { failed++ }`
- No fallback — POs arriving before matching Job are silently dropped
- **Fix:** Create placeholder Job (status=CREATED, scheduledDate=null) if no match. Effort: 30 min.

### 7. Brookfield Rev 4 plan code names
- 20 plans with codes (FNSBUILT, FNSHTRM, FNSRSTRM, etc.)
- Currently discarded during ingest
- **Fix:** Add `HyphenPlanAlias` model + seed 20 rows. Effort: 1 hour.

### 8. Cron lying about SUCCESS
- `result.skipped=true` should render as SKIPPED status, not SUCCESS, on `/admin/crons`
- **Fix:** UI tweak. Effort: 30 min.

## P2 — Admin UI

### 9. HyphenSubdivisionMap CRUD UI
- Staff need to add new mappings as Brookfield expands communities
- **Fix:** Add `/admin/hyphen-subdivisions` page. Effort: 2 hours.

## What works ✅

- `parseDollar` Toll Brothers fix is wired correctly into `src/app/api/ops/import-hyphen/route.ts:5` ✓
- Schedule update flow is correct
- HyphenBuilderAlias and HyphenProductAlias models work
- Community + CommunityFloorPlan schema is sufficient for Brookfield's scope
- Job model has hyphenJobId/hyphenScheduleId for back-references

## Recommendations

**For Monday launch:**
- **2-3 hour fix unblocks Brookfield's entire Hyphen integration**
- Steps 1-5 are surgical, low-risk, single-PR
- After step 5, monitor HyphenOrderEvent for 24h to verify linkage resolution

**Post-launch:**
- Steps 6-9 as time permits

## Launch readiness: **30% → 95% with 3 hours of work**
