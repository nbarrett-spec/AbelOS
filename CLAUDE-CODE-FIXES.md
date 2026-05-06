# Aegis Platform — Comprehensive Fix List for Claude Code
**Date:** 2026-04-27  
**Based on:** SITE-AUDIT-2026-04-27.md + codebase analysis  
**Target branch:** main (direct-to-main OK per CLAUDE.md)  
**Total fixes:** 19 tasks across 4 priority levels

---

## CRITICAL RULES FOR EXECUTION
1. **Type check after each fix:** Run `npx tsc --noEmit` to verify zero type errors
2. **Test after code changes:** Spin up the app locally and verify the specific page/feature works
3. **Commit after each section** with the provided commit message
4. **Database changes:** Always verify the SQL against Prisma first. If $executeRawUnsafe or $queryRawUnsafe fails, check the error log
5. **Deactivation is not deletion:** Use status = 'DEACTIVATED' for staff records; do NOT delete rows
6. **Do NOT break cascades:** Every existing order/delivery automation must still work after changes

---

# PRIORITY P0 — SECURITY (Execute first)

## Fix P0.1: Delete MG Financial staff records
**What's wrong:**  
Juan Arreola (jarreola@mgfinancialpartners.com) and James Gladue (jgladue@mgfinancialpartners.com) are MG Financial employees and should not be in Abel's staff database. MG Financial is currently a litigation counterparty. These records expose confidential internal relationships.

**Where to find it:**  
`src/app/ops/staff` page — visible in staff list. Database: `Staff` table where email contains `mgfinancialpartners.com`.

**Fix instructions:**
```bash
# Use Prisma Studio to find the exact record IDs:
npx prisma studio
# Search Staff table for email = "jarreola@mgfinancialpartners.com" and "jgladue@mgfinancialpartners.com"
# Note their IDs (e.g., "st_001", "st_002")
```

Then run this SQL via `npx prisma studio` or in a migration:
```sql
DELETE FROM "Staff" WHERE "email" = 'jarreola@mgfinancialpartners.com';
DELETE FROM "Staff" WHERE "email" = 'jgladue@mgfinancialpartners.com';
```

**How to verify:**
1. Go to `/ops/staff` (or `/ops/admin/staff`)
2. Search for "mgfinancial" — should return 0 results
3. Search for "Juan Arreola" and "James Gladue" — should return 0 results

**Commit message:**
```
fix(security): remove MG Financial employees from staff records

Delete Juan Arreola and James Gladue (MG Financial) from Staff table.
MG Financial is a litigation counterparty and should not have records
in Abel's employee database.
```

---

## Fix P0.2: Deactivate test user
**What's wrong:**  
`testxyz@test.com` is an active test account in production. Should be deactivated immediately.

**Where to find it:**  
`src/app/ops/staff` page — listed in Active Accounts section. Database: `Staff` table where email = "testxyz@test.com".

**Fix instructions:**
Find the test user record and update it:
```sql
UPDATE "Staff" SET "status" = 'DEACTIVATED' WHERE "email" = 'testxyz@test.com';
```

**How to verify:**
1. Go to `/ops/staff`
2. Search for "testxyz@test.com"
3. Verify status shows "Deactivated" (not "Active")
4. Try to log in as testxyz@test.com — should fail or show deactivated message

**Commit message:**
```
fix(security): deactivate test user account

Set testxyz@test.com status to DEACTIVATED. This test account should
not be active in production.
```

---

## Fix P0.3: Investigate 419 auth failures
**What's wrong:**  
Dashboard shows 419 auth failures in the last 24 hours. This is either a brute force attempt or a misconfigured service account hitting protected routes.

**Where to find it:**  
Check these files for auth logging:
- `src/lib/api-auth.ts` — main auth middleware
- `src/app/api/cron/*/route.ts` — cron endpoints may be misconfigured
- Sentry dashboard at sentry.io — look for 419 error spike in last 24h
- Server logs (Vercel or local) — search for "419" or "Unauthorized"

**Fix instructions:**
1. Open `src/lib/api-auth.ts` and verify that `checkStaffAuthWithFallback()` is:
   - Requiring valid JWT for protected routes
   - Logging failed attempts to error log / Sentry
   - Not accepting expired tokens

2. Check all cron routes in `src/app/api/cron/*/route.ts`:
   - Verify `CRON_SECRET` environment variable is set and non-empty
   - Ensure each cron handler checks the secret before executing
   - Look for any cron that may be running in a loop or retry logic causing 419 pile-up

3. Search for `419` in the codebase:
   ```bash
   grep -r "419" src/ --include="*.ts" --include="*.tsx"
   ```

4. Check Sentry for patterns:
   - IP addresses of failing requests (if IP is external and repetitive → brute force)
   - Which routes are getting hit (if cron routes → cron secret issue)
   - Time pattern (random vs. clustered → attack vs. service misconfiguration)

5. If it's a service account (NUC Brain sync, MCP sync, etc.):
   - Verify the service has a valid, non-expired JWT
   - Check that the secret being used matches what's deployed
   - Look for token rotation issues in the sync code

**How to verify:**
1. Clear the Sentry cache and wait 1 hour for fresh data
2. Check `/ops` dashboard System Alerts — should show 0 auth failures (or <5)
3. Run tail on server logs and watch for 419 errors for 5 minutes — should be quiet

**Commit message:**
```
debug(auth): investigate 419 auth failures

Add diagnostic logging to auth middleware. Check:
- Cron secret configuration
- Expired JWTs
- Brute force pattern (IP analysis)
- Service account misconfigurations

No code changes in this commit — diagnosis only. Results in next commit.
```

---

# PRIORITY P1 — BROKEN FEATURES (Critical path)

## Fix P1.1: Fix KPIs page ("Failed to load KPI data")
**What's wrong:**  
`/ops/executive/kpis` returns "Failed to load KPI data. Please try again." The API endpoint is either missing or throwing an error.

**Where to find it:**  
- Frontend: `src/app/ops/executive/kpis/page.tsx` (the page component)
- API: `src/app/api/ops/executive/kpis/route.ts` (the endpoint it calls)

**Fix instructions:**
1. Check if the API route exists:
   ```bash
   ls -la src/app/api/ops/executive/kpis/route.ts
   ```

2. If it doesn't exist, search for any KPI endpoint:
   ```bash
   find src/app/api -name "*kpi*" -type f
   ```

3. Once found, open the API route and look for:
   - Prisma query errors (`.catch(e => ...)` without proper error logging)
   - Missing table references (VendorScorecardSnapshot, FinancialSnapshot, etc.)
   - NULL responses not being handled

4. If the endpoint doesn't exist at all, create it or update the frontend to point to the correct endpoint

5. Test the endpoint directly:
   ```bash
   curl -H "Authorization: Bearer <valid-jwt>" http://localhost:3000/api/ops/executive/kpis
   ```
   You should get JSON, not an error

**How to verify:**
1. Go to `/ops/executive/kpis`
2. Wait 2-3 seconds for load
3. Should see KPI cards (not error message)
4. Each card should have a number (e.g., "Revenue YTD: $1.11M")

**Commit message:**
```
fix(kpis): restore KPI data loading

Fix API endpoint /api/ops/executive/kpis to return proper KPI data.
Verify all required snapshot tables exist and queries execute successfully.
```

---

## Fix P1.2: Fix negative lead time calculation
**What's wrong:**  
Supply Chain dashboard shows all vendors with negative lead times (-230 to -455 days). This is a date subtraction bug — likely `orderedAt - receivedAt` instead of `receivedAt - orderedAt`.

**Where to find it:**  
`src/app/api/cron/vendor-scorecard-daily/route.ts` around lines 122-123. Look for this:
```sql
AVG(EXTRACT(EPOCH FROM (wp."receivedAt" - wp."orderedAt")) / 86400.0)
```

**Fix instructions:**
Open `src/app/api/cron/vendor-scorecard-daily/route.ts`.

Around line 122, verify the calculation reads:
```sql
-- CORRECT:
AVG(EXTRACT(EPOCH FROM (wp."receivedAt" - wp."orderedAt")) / 86400.0)
  FILTER (WHERE wp."receivedAt" IS NOT NULL AND wp."orderedAt" IS NOT NULL) AS avg_lead_days
```

This should be: `receivedAt - orderedAt` (positive = days it took). If it says `orderedAt - receivedAt`, that's the bug.

If the calculation is already correct, check the frontend display logic:
- `src/app/ops/supply-chain/page.tsx` — how lead time is displayed
- `src/app/api/ops/vendors/scorecard/route.ts` — how the scorecard data is fetched

If the data coming from the database is negative, it means the cron calculation is storing it wrong. Fix the cron query to use `receivedAt - orderedAt` explicitly.

**How to verify:**
1. Go to `/ops/supply-chain`
2. Scroll to "Vendor Scorecard" section
3. Look at any vendor row
4. "Avg Lead Days" should be positive (e.g., 14.5, 21.3) not negative
5. Cross-check with one known vendor (Boise Cascade) — if you know they typically take 10 days, the number should be ~10

**Commit message:**
```
fix(supply-chain): correct lead time calculation sign

Fix vendor scorecard cron to compute lead days as (receivedAt - orderedAt)
instead of (orderedAt - receivedAt). Negative lead times indicate reversed
date subtraction.
```

---

## Fix P1.3: Fix vendor scorecard (On-Time % blank, all grades "A")
**What's wrong:**  
1. On-Time % column shows "—" for every vendor (metric not calculated)
2. Every vendor gets grade "A" (scoring not differentiating)

The cron writes the data but the display or calculation is broken.

**Where to find it:**  
- Cron calculation: `src/app/api/cron/vendor-scorecard-daily/route.ts` lines 140-142 (on-time rate calculation)
- Frontend display: `src/app/ops/supply-chain/page.tsx` (scorecard table rendering)
- API endpoint: `src/app/api/ops/vendors/scorecard/route.ts` (data fetching)

**Fix instructions:**

1. **Fix the On-Time % blank issue:**
   
   Open `src/app/api/cron/vendor-scorecard-daily/route.ts` and find lines 140-142:
   ```sql
   CASE WHEN m.received_w_expected > 0
        THEN ROUND((m.on_time_count::numeric / m.received_w_expected::numeric) * 100, 2)::float
        ELSE NULL END AS "onTimeRate",
   ```
   
   Verify:
   - `received_w_expected` is counting POs with both `receivedAt` AND `expectedDate` (around line 116-117)
   - `on_time_count` is counting only those where `receivedAt <= expectedDate` (lines 118-121)
   - The division is NOT division-by-zero (it's wrapped in CASE WHEN)
   
   If the calculation looks correct, check the frontend display in `src/app/ops/supply-chain/page.tsx`:
   ```tsx
   {vendor.onTimeRate ? `${vendor.onTimeRate}%` : '—'}
   ```
   
   The display logic is correct. The problem is likely that `onTimeRate` is NULL in the database. This means either:
   - No POs have been received with an expectedDate (data quality issue)
   - The cron hasn't run yet, or it's failing silently
   
   **Verify the cron ran successfully:**
   ```bash
   # Check the last cron run in Integrations page
   # Look for vendor-scorecard-daily — should show GREEN status
   # If RED, click it to see the error
   ```

2. **Fix the "all A grades" issue:**

   The `gradeFor()` function (lines 73-79) is correct:
   ```typescript
   function gradeFor(onTimeRate: number | null): 'A' | 'B' | 'C' | 'D' | null {
     if (onTimeRate === null || onTimeRate === undefined) return null
     if (onTimeRate >= 95) return 'A'
     if (onTimeRate >= 85) return 'B'
     if (onTimeRate >= 70) return 'C'
     return 'D'
   }
   ```
   
   But if all vendors are returning onTimeRate = NULL (from above issue), then the grade will be NULL, which then displays as something (need to check frontend).
   
   Alternatively, if the cron is not actually writing the grade to the database, check the upsert around line 160-180:
   ```typescript
   reliabilityGrade: grade, // should be here
   ```

3. **Run the cron manually to generate new data:**
   ```bash
   curl -X GET "http://localhost:3000/api/cron/vendor-scorecard-daily?secret=YOUR_CRON_SECRET"
   ```
   
   Check the response for errors. Then go back to `/ops/supply-chain` and refresh.

**How to verify:**
1. Go to `/ops/supply-chain` and scroll to "Vendor Scorecard"
2. Pick any vendor (e.g., Boise Cascade)
3. "On-Time %" should show a number (e.g., "92.5%") not "—"
4. "Grade" should vary by vendor (e.g., Boise = "A", slower vendor = "C")
5. Cross-check: if a vendor is at exactly 85% on-time, grade should be "B" not "A"

**Commit message:**
```
fix(vendor-scorecard): fix on-time % calculation and grading logic

Ensure onTimeRate is calculated and written to VendorScorecardSnapshot.
Verify gradeFor() function is called and grade is stored. Fix any
NULL handling in frontend display.
```

---

## Fix P1.4: Fix "Closes in -2057d" bug on Sales Dashboard
**What's wrong:**  
Sales Dashboard shows negative days-to-close (e.g., "Closes in -2057d"). This is a date calculation bug similar to lead time — likely `expectedCloseDate - today` is reversed or using wrong fields.

**Where to find it:**  
- Frontend: `src/app/ops/sales/page.tsx` (display logic)
- API: `src/app/api/ops/sales/dashboard/route.ts` or similar (data calculation)
- Look for "Closes in" or "closesIn" text in search:
  ```bash
  grep -r "Closes in\|closesIn\|days.*close" src/app/ops/sales --include="*.ts" --include="*.tsx"
  ```

**Fix instructions:**

1. Find the calculation. Look for a line like:
   ```typescript
   const daysUntilClose = someDate - otherDate
   // or
   const closesInDays = (bid.expectedCloseDate - new Date()) / (1000 * 60 * 60 * 24)
   ```

2. The formula should be:
   ```typescript
   // CORRECT:
   const daysUntilClose = Math.floor(
     (bid.expectedCloseDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
   )
   
   // This will be:
   // - Positive if expectedCloseDate is in the future
   // - Negative if expectedCloseDate is in the past
   // - Display as: "Closes in 23d" or "Closed 5d ago"
   ```

3. If the display shows "Closes in -2057d", it means:
   - Either expectedCloseDate is way in the past (data quality — bids never updated)
   - Or the calculation is subtracting today from expectedCloseDate instead of vice versa

4. Check the data: Query the database for old bids:
   ```bash
   # In Prisma Studio or DB client:
   SELECT id, orderNumber, expectedCloseDate, createdAt 
   FROM "Deal" 
   WHERE expectedCloseDate < CURRENT_DATE - INTERVAL '100 days'
   LIMIT 5
   ```
   
   If you see dates from 2024 or early 2025, those bids are stale and need cleanup or the calculation is broken.

**How to verify:**
1. Go to `/ops/sales` (Sales Dashboard)
2. Look at bid items — each should show "Closes in Xd" where X is positive if in future, or display differently if past
3. No item should show "Closes in -2057d"
4. A bid created today with expectedCloseDate 30 days from now should show "Closes in 30d"
5. A bid with expectedCloseDate in the past should show something like "Closed 15d ago" or "Overdue"

**Commit message:**
```
fix(sales): correct bid close date calculation

Fix days-to-close calculation to use (expectedCloseDate - today) not
(today - expectedCloseDate). Ensure negative values display as "Closed Xd ago"
instead of "Closes in -Xd".
```

---

## Fix P1.5: Fix My Day greeting and date
**What's wrong:**  
Two bugs on `/ops/my-day`:
1. Wrong greeting: says "Good morning, Nate" at 7:32 PM (should be "Good evening")
2. Date off by one day: shows "Sunday, April 26" when it's Monday, April 27

**Where to find it:**  
`src/app/api/ops/my-day/route.ts` lines 29-44 (greeting and date logic)

**Fix instructions:**

Open `src/app/api/ops/my-day/route.ts`:

1. **Fix the greeting (lines 29-34):**
   
   Current code (correct):
   ```typescript
   function getTimeOfDayGreeting(): string {
     const hour = new Date().getHours()
     if (hour < 12) return 'Good morning'
     if (hour < 18) return 'Good afternoon'
     return 'Good evening'
   }
   ```
   
   This is correct. The bug must be in the *timezone*. If the server is in UTC and the user is in CT (UTC-5), then server time 12:32 AM UTC = 7:32 PM CT user time. The `new Date()` at line 30 is using SERVER time, not USER time.
   
   **Fix:** Use the user's timezone (from their browser or profile):
   ```typescript
   function getTimeOfDayGreeting(): string {
     // Get user's local hour (not server UTC hour)
     const userHour = new Date().toLocaleString('en-US', { 
       hour: 'numeric',
       hour12: false,
       timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
     })
     const hour = parseInt(userHour)
     
     if (hour < 12) return 'Good morning'
     if (hour < 18) return 'Good afternoon'
     return 'Good evening'
   }
   ```
   
   Or simpler: ask the frontend to pass the user's timezone and compute there instead.

2. **Fix the date off-by-one (lines 36-44):**
   
   Current code:
   ```typescript
   function getFormattedDate(): string {
     const options: Intl.DateTimeFormatOptions = {
       weekday: 'long',
       year: 'numeric',
       month: 'long',
       day: 'numeric',
     }
     return new Date().toLocaleDateString('en-US', options)
   }
   ```
   
   This looks correct too. Same issue: `new Date()` is UTC, not user local time. The `toLocaleDateString()` is supposed to convert it, but if the browser is not passing the right timezone, it may be off.
   
   **Fix:** Same as above — ensure the date is computed in the user's timezone:
   ```typescript
   function getFormattedDate(): string {
     const options: Intl.DateTimeFormatOptions = {
       weekday: 'long',
       year: 'numeric',
       month: 'long',
       day: 'numeric',
       timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
     }
     return new Date().toLocaleDateString('en-US', options)
   }
   ```
   
   The key is adding `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` to use the browser's/system's timezone instead of defaulting to UTC.

3. **Verify the fix:** After the change, `new Date().toLocaleDateString()` should use the system timezone (not UTC).

**How to verify:**
1. Set your system clock to 7:30 PM on April 27, 2026
2. Go to `/ops/my-day`
3. Should see: "Good evening, Nate" (not "Good morning")
4. Should see: "Monday, April 27, 2026" (not April 26)
5. Change system time to 9:30 AM same day
6. Should see: "Good morning, Nate" and same date

**Commit message:**
```
fix(my-day): fix timezone handling for greeting and date

Ensure getTimeOfDayGreeting() and getFormattedDate() use user's
local timezone, not server UTC. Add timeZone parameter to
toLocaleDateString() and compute hour from localized time.
```

---

## Fix P1.6: Fix Financial Snapshot cron (Prisma $executeRawUnsafe error)
**What's wrong:**  
Cron "Financial Snapshot" is failing with Prisma `$executeRawUnsafe()` error. Integration page shows 6 consecutive failures. The cron likely tries to execute raw SQL that has a syntax error or missing table.

**Where to find it:**  
`src/app/api/cron/financial-snapshot/route.ts` (check if it exists)

**Fix instructions:**

1. Find the cron:
   ```bash
   find src/app/api/cron -name "*financial*" -type f
   ```

2. Open the file and look for `$executeRawUnsafe()` calls. For each one:
   ```typescript
   await prisma.$executeRawUnsafe(`SQL HERE`)
   ```

3. Check the SQL syntax:
   - Missing semicolons?
   - Typos in table/column names?
   - Using Postgres-specific syntax on wrong database?
   - Variables not being interpolated correctly?

4. Check if the table exists:
   ```bash
   # In Prisma Studio:
   # Look for tables related to FinancialSnapshot, FinancialMetric, etc.
   # If missing, check schema.prisma for the definition
   ```

5. If the table doesn't exist in Neon (production), you may need to create it via migration:
   ```bash
   npx prisma migrate dev --name create_financial_snapshot
   ```

6. Test the cron manually:
   ```bash
   curl -X GET "http://localhost:3000/api/cron/financial-snapshot?secret=YOUR_CRON_SECRET"
   ```
   
   Check the response for the exact error message.

7. Once you know the error, fix the SQL:
   - Correct typos
   - Add missing columns
   - Use proper Postgres syntax
   - Escape column names with double quotes: `"columnName"`

**How to verify:**
1. Go to `/ops/integrations` (Integration Hub)
2. Find "Financial Snapshot" cron in the list
3. Status should be GREEN (not RED)
4. Click it to see last run time (should be recent, not 6+ days ago)
5. Run the cron manually and watch for success message

**Commit message:**
```
fix(cron): repair financial snapshot SQL syntax

Fix Prisma $executeRawUnsafe() call in financial-snapshot cron.
Correct table/column names, add missing syntax, ensure table exists.
```

---

## Fix P1.7: Fix BWP Ingest cron (Prisma findUnique error, 150 failures)
**What's wrong:**  
Cron "BWP Ingest" has 150 consecutive failures (hasn't run in 6+ days). Error is Prisma `findUnique()` — likely trying to find a record with a non-unique field or incorrect ID format.

**Where to find it:**  
`src/app/api/cron/bwp-ingest/route.ts`

**Fix instructions:**

1. Open `src/app/api/cron/bwp-ingest/route.ts` and search for `findUnique()` calls:
   ```bash
   grep -n "findUnique" src/app/api/cron/bwp-ingest/route.ts
   ```

2. For each `findUnique()`, check:
   ```typescript
   const builder = await prisma.builder.findUnique({
     where: { id: builderId }  // ← Must be a UNIQUE field!
   })
   ```
   
   The `where` clause must use a unique field (primary key or field marked `@unique` in schema.prisma).

3. Common causes of findUnique failures:
   - Using a non-unique field (e.g., `{ name: "Pulte" }` if there are 2 Pulte records)
   - Passing NULL as the ID (e.g., `{ id: null }`)
   - Using the wrong model (e.g., `prisma.company` instead of `prisma.builder`)
   - Field doesn't exist in the schema

4. If you're trying to find a record by non-unique field, use `findFirst()` instead:
   ```typescript
   // WRONG:
   const builder = await prisma.builder.findUnique({
     where: { name: builderName }  // ← name is not unique!
   })
   
   // CORRECT:
   const builder = await prisma.builder.findFirst({
     where: { name: builderName }
   })
   ```

5. Test the cron manually:
   ```bash
   curl -X GET "http://localhost:3000/api/cron/bwp-ingest?secret=YOUR_CRON_SECRET"
   ```

**How to verify:**
1. Go to `/ops/integrations`
2. Find "BWP Ingest" — status should be GREEN
3. Last run should be recent (not 6+ days)
4. Check if Brookfield (BWP) data is being updated (go to `/ops/accounts` and look for Brookfield orders)

**Commit message:**
```
fix(cron): repair BWP ingest findUnique errors

Replace findUnique() calls with incorrect where clauses. Use
findFirst() for non-unique field lookups. Verify all model
references and field names exist in schema.
```

---

## Fix P1.8: Fix NUC Alert cron (Prisma $queryRawUnsafe error)
**What's wrong:**  
Cron "NUC Alerts" is failing with Prisma `$queryRawUnsafe()` error. Similar to Financial Snapshot — SQL syntax or table missing.

**Where to find it:**  
`src/app/api/cron/nuc-alerts/route.ts` or similar

**Fix instructions:**

Same as Fix P1.6 (Financial Snapshot):
1. Find the cron and locate `$queryRawUnsafe()` calls
2. Check SQL syntax
3. Verify tables exist
4. Test manually
5. Fix the SQL

**How to verify:**
1. Go to `/ops/integrations`
2. Find "NUC Alerts" — status should be GREEN
3. Last run should be recent

**Commit message:**
```
fix(cron): repair NUC alerts SQL query

Fix Prisma $queryRawUnsafe() call in NUC alerts cron. Correct
table/column names and ensure proper Postgres syntax.
```

---

# PRIORITY P2 — NAVIGATION CLEANUP

## Fix P2.1: Remove or hide 404 nav links
**What's wrong:**  
16 nav links point to unbuilt pages (404 errors). This erodes user confidence and clutters the navigation.

**Where to find it:**  
Nav configuration — likely in one of these files:
- `src/app/ops/layout.tsx` (main ops layout with sidebar nav)
- `src/components/nav/sidebar.tsx` or similar
- `src/lib/nav-config.ts` or `src/lib/routes.ts` (if centralized)

**Full list of 404 pages to remove:**
```
/ops/executive/shipping-forecast
/ops/executive/operations
/ops/executive/financial
/ops/executive/executive-suite
/ops/jobs/pm-command-center
/ops/manufacturing/quality-control
/ops/warehouse (entire section)
/ops/finance/accounts-receivable
/ops/finance/collections
/ops/communication (entire section)
/ops/ai-operations (entire section)
/ops/customer-value (entire section)
/ops/admin/audit-log
/ops/admin/settings
```

**Fix instructions:**

1. Find the nav config file:
   ```bash
   grep -r "shipping-forecast\|executive-suite" src/ --include="*.ts" --include="*.tsx" | head -5
   ```

2. Once found, open the file and look for an array of nav items:
   ```typescript
   const navItems = [
     { label: 'Dashboard', href: '/ops', ... },
     { label: 'Shipping Forecast', href: '/ops/executive/shipping-forecast', ... },  // ← REMOVE THIS
     { label: 'Operations', href: '/ops/executive/operations', ... },  // ← REMOVE THIS
     ...
   ]
   ```

3. **Option A (Recommended): Comment out or remove the entire items:**
   ```typescript
   // { label: 'Shipping Forecast', href: '/ops/executive/shipping-forecast', ... },
   ```

4. **Option B (If pages may be built later): Add a `disabled: true` flag:**
   ```typescript
   { 
     label: 'Shipping Forecast', 
     href: '/ops/executive/shipping-forecast',
     disabled: true, // ← Hides from nav, can be re-enabled later
     ... 
   }
   ```

5. For sections entirely 404 (Warehouse, Communication, AI Operations, Customer Value):
   - Remove the section header and all its children, OR
   - Mark the section as `disabled: true`

6. Test the nav after changes:
   - Sidebar should no longer show these items
   - If you accidentally navigate to one (e.g., type `/ops/warehouse` in URL), you should get 404, but nav won't link to it anymore

**How to verify:**
1. Go to `/ops` (Ops Dashboard)
2. Look at the sidebar navigation
3. Verify none of these items appear:
   - "Shipping Forecast"
   - "Operations" (executive)
   - "Financial" (executive)
   - "Executive Suite"
   - "PM Command Center"
   - "Quality Control"
   - "Warehouse" section
   - "Accounts Receivable"
   - "Collections Center"
   - "Communication" section
   - "AI Operations" section
   - "Customer Value" section
   - "Audit Log"
   - "Settings"
4. Existing nav items (Dashboard, My Day, Sales, etc.) should still appear and work

**Commit message:**
```
fix(nav): remove 404 links from sidebar

Comment out 16 unbuilt page links from navigation. These pages
returned 404 and eroded confidence in the platform. Can be
re-enabled once pages are implemented.

Removed sections:
- Executive: Shipping Forecast, Operations, Financial, Executive Suite
- Jobs: PM Command Center
- Manufacturing: Quality Control
- Warehouse: entire section
- Finance: Accounts Receivable, Collections
- Communication: entire section
- AI Operations: entire section
- Customer Value: entire section
- Admin: Audit Log, Settings
```

---

# PRIORITY P3 — DATA CLEANUP

## Fix P3.1: Deduplicate staff records
**What's wrong:**  
11 staff members have 2-3 duplicate records (same person, different entries). This causes confusion, broken automations, and incorrect report counts.

**Duplicates to merge:**
```
Josh Barrett (2 records) — Sales (Transitional) + Business Development
Dakota Dyer (3 records) — Driver (x2) + Install Crew
Chris/Christopher Poppert (3 records) — Warehouse Manager + Viewer + Delivery Driver
Scott Johnson (2 records) — General Manager + GM
Darlene Haag (2 records) — PM (Deactivated) + PM (Needs Setup)
Gunner Hacker (2 records) — Manufacturing Tech + Production Line Lead
Sean Phillips (2 records) — Install Lead + Customer Experience Manager
Noah Ridge (2 records) — Delivery Driver + Warehouse Associate
Braden Sadler (2 records) — Manufacturing Associate + Driver
Dalton Whatley (2 records) — Business Dev Manager (Sales Rep) + Operations (PM)
Jacob Brown (2 records) — Driver + Door Line Tech
```

**Where to find it:**  
`src/app/ops/staff` page (visual list) or Prisma Studio (data view)

**Fix instructions:**

1. For each person, find all duplicate records by email:
   ```bash
   # In Prisma Studio, search Staff table for:
   # email = "sean.phillips@abellumber.com" (or similar)
   # You'll see 2 records with different IDs
   ```

2. For each duplicate set:
   - **Keep the MOST COMPLETE record** (has all fields filled, not "Needs Setup", is Active)
   - **Delete the incomplete/outdated one**

3. Example for Sean Phillips:
   ```sql
   -- Assume ID "st_001" is the keeper (Customer Experience Manager, Active)
   -- ID "st_002" is the duplicate (Install Lead, Needs Setup)
   
   DELETE FROM "Staff" WHERE "id" = 'st_002';
   ```

4. For records where both are similar (e.g., both "Needs Setup" or both "Deactivated"):
   - Keep the one with an email
   - Delete the one with placeholder info (if any)
   - If both have emails, keep the one with the most recent `updatedAt`

**How to verify:**
1. Go to `/ops/staff`
2. Search for "Sean Phillips" — should return 1 record (not 2)
3. Search for "Josh Barrett" — should return 1 record
4. Repeat for all 11 people in the list above
5. Each person should appear exactly once

**Commit message:**
```
fix(staff): deduplicate 11 staff records

Merge duplicate records for Josh Barrett, Dakota Dyer, Chris Poppert,
Scott Johnson, Darlene Haag, Gunner Hacker, Sean Phillips, Noah Ridge,
Braden Sadler, Dalton Whatley, Jacob Brown. Keep the most complete
record for each person; delete incomplete/outdated duplicates.
```

---

## Fix P3.2: Fix "Michael TBD" last name
**What's wrong:**  
One staff member has last name literally "TBD" (to be determined). Should have a real last name.

**Where to find it:**  
Staff table in Prisma Studio — search for "Michael" where last name = "TBD"

**Fix instructions:**

1. Find Michael's record and his full name:
   ```bash
   # In Prisma Studio:
   # Search Staff for email containing "michael"
   # You'll find a record with firstName = "Michael", lastName = "TBD"
   ```

2. Check `memory/people/abel-team.md` in the workspace for Michael's actual last name
3. Update the record:
   ```sql
   UPDATE "Staff" SET "lastName" = 'ACTUAL_LAST_NAME' 
   WHERE "firstName" = 'Michael' AND "lastName" = 'TBD';
   ```

4. If his name is not in memory files, ask Nate for the real last name before proceeding

**How to verify:**
1. Go to `/ops/staff`
2. Search for "Michael"
3. Should see full name (e.g., "Michael Smith") not "Michael TBD"

**Commit message:**
```
fix(staff): update Michael's last name from TBD

Replace placeholder "TBD" with actual last name [LAST_NAME].
```

---

## Fix P3.3: Fix staff title fields that duplicate the person's name
**What's wrong:**  
Some staff have titles that duplicate their name instead of showing the actual role:
```
Brady Bounds — title: "Driver - Brady Bounds #"
Cody Loudermilk — title: "Cody Loudermilk"
Jon Garner — title: "Driver - Jon Garner"
```

Should be just the role (e.g., "Driver", "Project Manager").

**Where to find it:**  
Staff table — look for records where `subtitle` or `title` field contains the person's name

**Fix instructions:**

1. Find these records:
   ```bash
   # In Prisma Studio:
   # Search for Brady, Cody, Jon
   # Look at their title/subtitle field
   ```

2. For each, extract the actual role:
   - "Driver - Brady Bounds #" → "Driver"
   - "Cody Loudermilk" → (what's the actual role? Check against memory files)
   - "Driver - Jon Garner" → "Driver"

3. Update:
   ```sql
   UPDATE "Staff" SET "title" = 'Driver' WHERE "firstName" = 'Brady' AND "lastName" = 'Bounds';
   UPDATE "Staff" SET "title" = 'ACTUAL_ROLE' WHERE "firstName" = 'Cody' AND "lastName" = 'Loudermilk';
   UPDATE "Staff" SET "title" = 'Driver' WHERE "firstName" = 'Jon' AND "lastName" = 'Garner';
   ```

4. Check `memory/people/abel-team.md` for actual roles if unclear

**How to verify:**
1. Go to `/ops/staff`
2. Search for "Brady Bounds" — title should show "Driver" (or actual role), not "Driver - Brady Bounds #"
3. Repeat for Cody and Jon

**Commit message:**
```
fix(staff): clean up title fields

Remove duplicate name references from title fields. Replace
"Driver - Brady Bounds #" with "Driver", etc.
```

---

## Fix P3.4: Clean up 246 stale RECEIVED orders
**What's wrong:**  
246 orders stuck in RECEIVED status (never confirmed). Oldest is 228 days old. These are either:
- Legitimate orders waiting for confirmation (PM needs to action them)
- Stale/test orders that should be cancelled

**Where to find it:**  
`/ops/orders` page — filter by status = "RECEIVED"

**Fix instructions:**

1. **Investigate the backlog:**
   ```bash
   # Query the database:
   SELECT id, orderNumber, builderId, createdAt, status 
   FROM "Order" 
   WHERE status = 'RECEIVED'
   ORDER BY createdAt ASC
   LIMIT 20
   ```
   
   Check if these are:
   - Real orders from known builders (Pulte, Brookfield, etc.) waiting for internal approval
   - Test/junk orders with placeholder data
   - Old orders from before the system went live

2. **Option A: Bulk cancel old orders (>180 days):**
   ```sql
   UPDATE "Order" 
   SET status = 'CANCELLED'
   WHERE status = 'RECEIVED' 
     AND createdAt < NOW() - INTERVAL '180 days'
   ```
   
   This keeps recent RECEIVED orders (which might be legit) but clears ancient ones.

3. **Option B: Move them to CONFIRMED if they're valid:**
   ```sql
   -- Confirm orders that are valid and old
   UPDATE "Order" 
   SET status = 'CONFIRMED', confirmedAt = NOW()
   WHERE status = 'RECEIVED' 
     AND createdAt < NOW() - INTERVAL '180 days'
     AND builderId IN (SELECT id FROM "Builder" WHERE status = 'ACTIVE')
   ```

4. **Recommended approach:**
   - Do Option A (cancel very old ones 180+ days)
   - Manual review of the remaining ones by PM
   - Create a task in `/ops/my-day` to review stuck RECEIVED orders

**How to verify:**
1. Go to `/ops/orders`
2. Filter by status = "RECEIVED"
3. If after bulk action, count should drop significantly (e.g., from 246 to 20)
4. Oldest should be <180 days old

**Commit message:**
```
fix(orders): clean up 246 stale RECEIVED orders

Cancel orders stuck in RECEIVED status for 180+ days. These orders
are no longer actionable and clutter the pipeline. Manual review
of remaining <180d orders recommended.
```

---

# PRIORITY P4 — DASHBOARD & UX

## Fix P4.1: Fix revenue card truncation
**What's wrong:**  
Revenue number on `/ops` dashboard shows "..." — card is too narrow for the number.

**Where to find it:**  
`src/app/ops/page.tsx` or dashboard component — look for a card showing "Order Revenue" or "Total Revenue"

**Fix instructions:**

1. Find the component that displays revenue:
   ```bash
   grep -r "Order Revenue\|Total Revenue" src/app/ops --include="*.tsx" | head -5
   ```

2. Open the card component and look for styling:
   ```tsx
   <div className="...text-3xl...">
     {revenue.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
   </div>
   ```

3. If truncated, widen the card or shrink the font:
   ```tsx
   // Option 1: Make card wider
   <div className="col-span-2">  {/* was col-span-1 */}
   
   // Option 2: Shrink font
   <div className="text-2xl">  {/* was text-3xl */}
   
   // Option 3: Allow text wrapping
   <div className="break-words">
   ```

4. Test on mobile to ensure it still fits

**How to verify:**
1. Go to `/ops` dashboard
2. Look at revenue card (usually top-right area)
3. Should see full number (e.g., "$6,526,234") not "..."

**Commit message:**
```
fix(dashboard): expand revenue card to prevent truncation

Widen revenue card or reduce font size to display full number
without ellipsis.
```

---

## Fix P4.2: Add missing Chad Zeh to staff records
**What's wrong:**  
Chad Zeh (Project Manager) is not in the staff database but is listed in `memory/people/abel-team.md`. He's missing from the system entirely.

**Where to find it:**  
He's NOT in the Staff table. Check `memory/people/abel-team.md` for details.

**Fix instructions:**

1. Open `memory/people/abel-team.md` and find Chad's details:
   ```
   Chad Zeh — Project Manager — hired [DATE] — email [EMAIL]
   ```

2. Create a new Staff record in Prisma Studio or via SQL:
   ```sql
   INSERT INTO "Staff" (
     "id", "firstName", "lastName", "email", "role", "status", "createdAt"
   ) VALUES (
     'st_xxx',  -- generate unique ID
     'Chad',
     'Zeh',
     'chad.zeh@abellumber.com',  -- or correct email from memory
     'PROJECT_MANAGER',
     'ACTIVE',
     NOW()
   )
   ```

3. Get Chad's email from the memory file and use the correct one

**How to verify:**
1. Go to `/ops/staff`
2. Search for "Chad Zeh"
3. Should return 1 result (not 0)
4. Role should be "Project Manager"
5. Status should be "Active"

**Commit message:**
```
fix(staff): add Chad Zeh to employee records

Chad Zeh (Project Manager) was missing from the staff database.
Create record with correct role and active status.
```

---

## Fix P4.3: Fix revenue attribution — "Complete" orders show $0 revenue
**What's wrong:**  
Orders with status = "COMPLETE" show $0 revenue instead of their actual value. This breaks financial reports.

**Where to find it:**  
- Dashboard: `/ops` shows "Complete" orders with $0 in pipeline
- Reports: `/ops/executive/reports` or similar financial reports
- Data: `Order` table where status = 'COMPLETE' but revenue should be non-zero

**Fix instructions:**

1. **Understand the issue:**
   - When an order moves to COMPLETE, its revenue should be attributed (recorded in financial tables)
   - If revenue stays $0, the attribution logic failed or was skipped

2. **Check the automation:**
   Open `src/lib/cascades/order-lifecycle.ts` and find the COMPLETE status handler:
   ```typescript
   case 'COMPLETE':
     // Should ensure invoice exists
     // Should mark order as revenue-recognized or set revenue field
     break
   ```

3. **The likely problem:**
   When order → COMPLETE, the code creates or links an Invoice but doesn't set `order.revenue` or `order.recognizedRevenueAt`.

4. **Fix:**
   Ensure the COMPLETE handler does this:
   ```typescript
   case 'COMPLETE':
     // Ensure invoice exists
     const invoice = await ensureInvoiceExists(order)
     
     // Mark revenue as recognized
     await prisma.order.update({
       where: { id: order.id },
       data: {
         recognizedRevenueAt: new Date(),
         // If revenue field exists, populate it from invoice
       }
     })
     break
   ```

5. **For already-COMPLETE orders, backfill:**
   ```sql
   -- Set revenue for completed orders that have invoices
   UPDATE "Order" o
   SET "recognizedRevenueAt" = i."createdAt"
   FROM "Invoice" i
   WHERE o."id" = i."orderId"
     AND o."status" = 'COMPLETE'
     AND o."recognizedRevenueAt" IS NULL
   ```

6. **If there's an `orderRevenue` field:**
   ```sql
   -- Backfill revenue amount from invoice total
   UPDATE "Order" o
   SET "revenue" = i."total"
   FROM "Invoice" i
   WHERE o."id" = i."orderId"
     AND o."status" = 'COMPLETE'
     AND (o."revenue" IS NULL OR o."revenue" = 0)
   ```

**How to verify:**
1. Go to `/ops` dashboard
2. Look at Order Pipeline section
3. Find the "Complete" row
4. Revenue should be non-zero (e.g., "$5,993,717") not $0
5. Or: go to any specific COMPLETE order and verify its revenue displays

**Commit message:**
```
fix(revenue): recognize revenue for completed orders

Ensure order.recognizedRevenueAt is set when order → COMPLETE.
Backfill existing COMPLETE orders to recognize revenue from
linked invoices.
```

---

# EXECUTION CHECKLIST

Once all fixes are complete, verify:

```
[ ] P0.1 — MG Financial records deleted
[ ] P0.2 — testxyz@test.com deactivated
[ ] P0.3 — 419 auth failures investigated and diagnosis documented
[ ] P1.1 — KPIs page loads successfully
[ ] P1.2 — Lead times are positive (not negative)
[ ] P1.3 — Vendor scorecard shows on-time % and varied grades
[ ] P1.4 — Sales Dashboard shows positive "Closes in" days
[ ] P1.5 — My Day shows correct greeting and date
[ ] P1.6 — Financial Snapshot cron GREEN
[ ] P1.7 — BWP Ingest cron GREEN
[ ] P1.8 — NUC Alerts cron GREEN
[ ] P2.1 — 404 nav links removed from sidebar
[ ] P3.1 — 11 staff duplicates merged
[ ] P3.2 — Michael's last name updated from TBD
[ ] P3.3 — Brady, Cody, Jon titles cleaned up
[ ] P3.4 — 246 stale RECEIVED orders cleaned
[ ] P4.1 — Revenue card no longer truncated
[ ] P4.2 — Chad Zeh added to staff
[ ] P4.3 — COMPLETE orders show correct revenue

Final checks:
[ ] npx tsc --noEmit passes (zero type errors)
[ ] All 19 commits pushed to main
[ ] /ops dashboard loads without errors
[ ] No crons in RED status on /ops/integrations
[ ] Staff count matches memory files
```

---

**End of document**
