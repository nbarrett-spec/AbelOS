# Data Quality Watchdog

A nightly automated system that finds and fixes data integrity issues before they cause operational problems.

## Overview

The Watchdog runs at 2am UTC daily, evaluates 10+ default quality rules, and creates actionable issue records for violations. It automatically closes issues when the underlying problem is resolved.

## Architecture

### 1. Prisma Models
**Location:** `prisma/schema.prisma` (end of file)

Two core models:
- **DataQualityRule** — Configurable rules with SQL queries, severity levels, and fix URLs
- **DataQualityIssue** — Individual violations detected by a rule, with status tracking (OPEN → ACKNOWLEDGED → FIXED/IGNORED)

### 2. Cron Handler
**Location:** `src/app/api/cron/data-quality/route.ts`

Runs nightly (0 2 * * * = 2am UTC). Features:
- Seeds 10 default rules on first run
- Executes each active rule's SQL query
- Creates new DataQualityIssue for violations not yet tracked
- Auto-closes issues for violations that are now fixed
- Returns summary: rulesEvaluated, newIssues, autoFixed, totalOpen
- Integrated with cron observability (CronRun tracking)

### 3. Dashboard API
**Location:** `src/app/api/ops/admin/data-quality/route.ts`

- **GET** — Returns dashboard data: summary stats, rules with issue counts, paginated recent issues
  - Optional `?entity=` filter (Job, Product, Builder, Invoice, PurchaseOrder, etc.)
  - Auth: ADMIN only
- **POST** — Create custom rules dynamically
  - Body: `{ name, description, entity, severity, query, fixUrl }`
  - Audit logged
- **PATCH** — Update issue status (ACKNOWLEDGED, FIXED, IGNORED)
  - Body: `{ issueId, status, notes? }`
  - Audit logged, stores fixedBy staff ID

### 4. Dashboard UI
**Location:** `src/app/ops/admin/data-quality/page.tsx`

React component (`use client`) with:
- **Summary cards** — Total rules, critical/warning/info counts, auto-fixed (7d), health score
- **Health score** — 0-100: 100 - (critical×10 + warning×3 + info×1), capped at 0
  - Green (>80), Amber (50-80), Red (<50)
- **Rules table** — Expandable rows showing each rule, severity badge, issue count, last run status
  - Click to expand and see violating entities with fix links
- **Recent issues feed** — Paginated, filterable by entity type
  - Shows entity link, severity, age, status
  - "Fix" button navigates to entity using rule's fixUrl pattern
- **Run Now button** — Trigger cron manually for testing
- Tailwind styling with Abel colors: walnut (#3E2A1E), amber (#C9822B), green (#27AE60)

## Default Rules

| Rule | Entity | Severity | Description |
|------|--------|----------|-------------|
| Jobs missing scheduled date | Job | CRITICAL | Active jobs without delivery/install date |
| Jobs missing builder assignment | Job | WARNING | Active jobs not assigned to PM |
| Products missing preferred vendor | Product | WARNING | Active products without preferred vendor |
| Products missing lead time | Product | WARNING | Active products without lead time on vendor |
| Builders missing credit terms | Builder | WARNING | Active builders without payment terms |
| Builders missing contact email | Builder | CRITICAL | Active builders without email |
| Invoices overdue 90+ days | Invoice | CRITICAL | Unpaid invoices 90+ days past due |
| POs stuck in DRAFT >7 days | PurchaseOrder | INFO | Purchase orders in draft >7 days |
| Open jobs with no recent activity | Job | WARNING | Active jobs not updated in 30+ days |
| Products with zero cost | Product | WARNING | Active products without cost set |

## Usage

### Daily Operation
1. Cron runs at 2am UTC
2. Issues appear on dashboard at `/ops/admin/data-quality`
3. Staff can:
   - Click "Fix" link to navigate to entity and resolve
   - Mark issue as ACKNOWLEDGED while waiting for fix
   - Mark as FIXED or IGNORED to close

### Manual Testing
1. Click "Run Now" button on dashboard
2. System immediately evaluates all rules
3. New issues created, fixed issues auto-closed
4. Dashboard refreshes with updated counts

### Create Custom Rules
POST to `/api/ops/admin/data-quality`:
```json
{
  "name": "Orders missing tracking number",
  "entity": "Order",
  "severity": "WARNING",
  "query": "SELECT id, \"orderNumber\" FROM \"Order\" WHERE status = 'SHIPPED' AND \"trackingNumber\" IS NULL",
  "fixUrl": "/ops/orders/{id}"
}
```

## Implementation Details

### Health Score Calculation
```
health = MAX(0, 100 - (critical × 10 + warning × 3 + info × 1))
```

### SQL Query Execution
- Queries must return at least `id` column
- Optional columns: `jobNumber`, `name`, `companyName`, `invoiceNumber`, `poNumber` (for display labels)
- Use parameterized queries when possible (though these are admin-only)

### Auto-Fix Logic
1. Execute rule query → get list of violating IDs
2. Compare to existing DataQualityIssue rows for that rule
3. New violations → create OPEN issue
4. Previously open issues not in new results → mark FIXED, set fixedAt timestamp

### Audit Trail
- All rule creates logged to AuditLog as CREATE/DataQualityRule
- All issue status updates logged as UPDATE/DataQualityIssue
- Staff ID and name captured for accountability

## Integration with Cron Observability

The watchdog registers in the cron system:
- Cron name: `data-quality`
- Schedule: `0 2 * * *` (2am UTC)
- Visible on `/ops/admin/crons` page
- Last run, status, duration, and error tracking

## Future Enhancements

1. **Webhook alerts** — Notify via Slack when critical issues appear
2. **Severity-based auto-actions** — Auto-pause builder account if >5 CRITICAL issues
3. **Machine learning detection** — Learn patterns from historical violations
4. **Scheduled auto-fixes** — Execute remediation SQL for certain rule types
5. **Rule templates** — Pre-built rules for common integrations (InFlow, Bolt, Hyphen)
6. **Trend dashboard** — Weekly/monthly data quality trends, improvement tracking

## Testing

```bash
# Manual cron trigger (requires CRON_SECRET)
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://app.abellumber.com/api/cron/data-quality

# View latest results
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  https://app.abellumber.com/api/ops/admin/data-quality

# Create test rule
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test","entity":"Job","severity":"INFO","query":"SELECT id FROM \"Job\" LIMIT 1"}' \
  https://app.abellumber.com/api/ops/admin/data-quality
```

## Files Modified/Created

**Schema:**
- `prisma/schema.prisma` — Added DataQualityRule + DataQualityIssue models

**Cron:**
- `src/app/api/cron/data-quality/route.ts` — Nightly watchdog job
- `src/lib/cron.ts` — Registered cron in REGISTERED_CRONS

**API:**
- `src/app/api/ops/admin/data-quality/route.ts` — Dashboard backend (GET/POST/PATCH)

**UI:**
- `src/app/ops/admin/data-quality/page.tsx` — React dashboard component

## Questions?

Contact ops@abellumber.com or reference CLAUDE.md for broader Abel OS context.
