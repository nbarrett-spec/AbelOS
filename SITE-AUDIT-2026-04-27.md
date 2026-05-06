# Aegis Full Site Audit — 2026-04-27

**Tester:** Claude (via Chrome, logged in as Nate Barrett / ADMIN)
**URL:** app.abellumber.com
**Method:** Page-by-page visual + functional review
**Status:** COMPLETE

---

## Executive Summary

| Category | Count |
|----------|-------|
| Pages audited | 40+ |
| 404 pages (nav links to unbuilt pages) | 16 |
| Critical bugs | 8 |
| Data issues | 12 |
| Staff data problems | 15+ |
| Working pages with real data | ~20 |

**Top 3 things to fix immediately:**
1. Deactivate `testxyz@test.com` — active test account in production
2. Remove MG Financial employees (Arreola, Gladue) from staff records — litigation counterparty
3. Fix negative lead time calculation (Supply Chain) — systematic bug showing -230 to -455 days

---

## 1. Dashboard (`/ops`)

### Data Health
| Metric | Value | Status |
|--------|-------|--------|
| Builder Accounts | 170 (3,462 products) | OK |
| Sales Orders | 4,574 (267 active / 4,287 fulfilled) | OK |
| Order Revenue | $6,526,xxx ($6,063,719 collected) | OK — number truncated in card |
| Purchase Orders | 3,827 ($4,841,468 spend) | OK |

### System Alerts
| Alert | Count | Severity |
|-------|-------|----------|
| Cron Failures (24h) | 45 | RED — 8 crons failing regularly |
| Auth Failures (24h) | 419 | RED — possible brute force or misconfigured service |
| Slow Queries (1h) | 186 | YELLOW |
| Overdue AR | 77 | YELLOW |
| Low Inventory | 9 | GREEN |
| Stale Crons | 1 | YELLOW |
| SLO Error Rate | 0 | OK |

### Order Pipeline
| Status | Count | Revenue |
|--------|-------|---------|
| Received | 246 | $492,296 |
| Confirmed | 8 | $20,707 |
| Production | 13 | $20,181 |
| Ready | 0 | — |
| Shipped | 0 | — |
| Delivered | 3,405 | $5,993,717 |
| Complete | 882 | $0 |

**Issues:**
- 246 orders stuck in RECEIVED — never confirmed. Stale?
- Ready and Shipped both 0 — pipeline gap or no active logistics
- Complete shows $0 revenue — revenue not attributed at completion

### Payment Status
| Status | Count | Amount |
|--------|-------|--------|
| Paid | 4,184 | $6,063,719 |
| Invoiced | 84 | $59,335 |
| Pending | 283 | $668,730 |
| Overdue | 23 | $38,652 |

### Today's Actions
- 27 urgent items
- Oldest: "Confirm order SO-0024..." — **228 days old**
- Multiple Pulte, Fig Tree, Toll Brothers, RDR orders 80-97 days old

### AI Recommendations
- DSO 142 days, CCC 186 days — flagged MEDIUM but should be HIGH

### Visual Issues
- Revenue card truncates number with "..." — needs wider card or smaller font

---

## 2. My Day (`/ops/my-day`)

**Issues:**
- Wrong greeting: "Good morning, Nate" at 7:32 PM — should use time-of-day logic
- Date shows "Sunday, April 26" when it was Monday, April 27 — off by one day
- Not personalized to the logged-in user's actual tasks/priorities

---

## 3. Inbox (`/ops/inbox`)

- 2,705 pending items
- 1,527 MRP SHORTAGE alerts all marked CRITICAL — alert fatigue
- Functional: filters, search, mark-as-read work

---

## 4. Executive Section

### CEO Dashboard (`/ops/executive/ceo-dashboard`)
- NUC status: OFFLINE (expected — not deployed yet)
- KPI cards truncated — numbers cut off
- Negative gross margin showing in financial summary
- Otherwise data-rich and functional

### KPIs (`/ops/executive/kpis`)
- **BROKEN** — "Failed to load KPI data. Please try again."

### Reports & Analytics (`/ops/executive/reports`)
- Loads. Not deeply tested.

### Shipping Forecast (`/ops/executive/shipping-forecast`)
- **404**

### Operations (`/ops/executive/operations`)
- **404**

### Financial (`/ops/executive/financial`)
- **404** (different from `/ops/finance` which works)

### Executive Suite (`/ops/executive/executive-suite`)
- **404**

---

## 5. Jobs & Projects

### Job Pipeline (`/ops/jobs/pipeline`)
- Shows jobs with statuses, builders, PMs
- **ALL job addresses are empty ("Address: —")** — `jobAddress` field never populated
- This is the core bug that the address-based naming system will fix

### PM Command Center (`/ops/jobs/pm-command-center`)
- **404**

---

## 6. Sales Pipeline

### Sales Dashboard (`/ops/sales`)
- **"Closes in -2057d"** bug on bid items — negative days-to-close calculation
- Otherwise shows bid pipeline with builders, values, stages

---

## 7. Accounts & Orders

### Builder Accounts (`/ops/accounts`)
- Placeholder emails visible (e.g., `placeholder@example.com` patterns)
- Person names used as company names in some records
- Otherwise functional list with search/filter

### Orders (`/ops/orders`)
- 4,335 total orders, 43 awaiting confirm, $48,411 pipeline value
- Multiple $0.00 orders visible for Brookfield/Toll Brothers
- Table functional with pagination, filters

---

## 8. Warranty

### Warranty Claims (`/ops/warranty`)
- 3 open claims, all dated 3/23/2026 — seed data
- Total Cost shows $0 (wrong if claims are active)
- None assigned to anyone
- Contact email uses dev domain (tom@rdr-dev.com)
- Claim detail modal works — shows description, product, resolution fields

### Warranty Policies (`/ops/warranty/policies`)
- 6 policies across 3 categories (Product Defect, Material, Installation)
- Clean layout, Deactivate buttons work
- **OK**

---

## 9. Manufacturing

### Manufacturing Dashboard (`/ops/manufacturing`)
- 11 jobs in production
- All pick statuses: 0
- QC Pass Rate: 0%
- Production Queue shows 5 jobs — all from January 2026 (3+ months stale)

### Build Sheet (`/ops/manufacturing/build-sheet`)
- Functional — shows job queue with builder, community, address, scheduled date, status
- Good data, proper table layout
- Pick % column shows dashes/blank — metric not populated

### Bill of Materials (`/ops/manufacturing/bom`)
- Not tested (sub-page)

### Pick Lists (`/ops/manufacturing/pick-lists`)
- Not tested (sub-page)

### Quality Control (`/ops/manufacturing/quality-control`)
- **404**

### Staging (`/ops/manufacturing/staging`)
- Not tested (sub-page)

### Labor & Overhead (`/ops/manufacturing/labor-overhead`)
- Not tested (sub-page)

---

## 10. Warehouse & NFC (`/ops/warehouse`)

- **404** — entire section unbuilt

---

## 11. Supply Chain (`/ops/supply-chain`)

### Supply Chain Command Center
- Data-rich dashboard — $448.3K open PO value, 72 active vendors
- **Avg Lead Time: -230.9 days** — BUG: negative calculation (systematic across all vendors)
- Boise Cascade at 41.7% concentration (1,194 POs) — matches known dependency
- 22 sub-pages in nav

### Vendor Scorecard (bottom of Supply Chain page)
- **ALL lead times negative** (-286.6 to -455.6 days) — systematic calculation bug
- **On-Time % shows "—" for every vendor** — metric not implemented
- **Every vendor graded "A"** — scoring not differentiating; meaningless

### Procurement Pipeline
- 24 DRAFT ($39.9K), 1 APPROVED ($0.4K), 29 PARTIAL RX ($164.1K)

### Sub-pages (22 total, not all tested):
- Inventory, Inventory Intelligence, Allocations, Material Calendar, Purchase Orders, SmartPO Queue, Purchasing Optimizer, AI Procurement Brain, MRP — Forward Demand, Vendors, Vendor Scorecard, Receiving, Returns, Delivery Center, Today's Routes, Print Manifest, Route Optimizer, Delivery Analytics, Curri (3rd Party), Fleet & Logistics Hub, Live Jobsite Map, Auto-PO Generation

---

## 12. Finance

### Financial Dashboard (`/ops/finance`)
- Revenue YTD: $1.11M | COGS YTD: $1.23M — **COGS exceeds revenue**
- Gross Profit YTD: **-$118K** (-10.7% margin)
- Net Income YTD: **-$118K**
- April: -137.7% gross margin ($362K COGS vs $152K revenue)
- Total AR Outstanding: $75,736
- Total AP Open: $448,326
- Net Cash Position: **-$372,589**
- DSO: 142 days | DPO: 31 days | Cash Cycle: 186 days | Current Ratio: 6.3x
- Revenue/COGS/GP chart functional
- AI Cash Flow Intelligence section with recommendations

### Sub-pages:
- Cash Command Center — not tested
- $1M Scenario Modeler — not tested
- **Accounts Receivable** — **404**
- **Accounts Payable** — not tested
- Company Health — not tested
- Bank & Credit Lines — not tested
- Financial Optimizer — not tested
- **Collections Center** — **404**
- AI Cash Flow Brain — not tested

---

## 13. Communication (`/ops/communication`)

- **404** — entire section unbuilt

---

## 14. AI Operations Brain (`/ops/ai-operations`)

- **404** — entire section unbuilt

---

## 15. Customer Value (`/ops/customer-value`)

- **404** — entire section unbuilt

---

## 16. Integrations (`/ops/integrations`)

### Integration Hub — LIVE and critical
- 38 crons monitored: **30 GREEN, 0 YELLOW, 8 RED, 0 ZOMBIES**

### RED Crons (all failing):
| Cron | Consec. Fails | Error | Last Sync |
|------|--------------|-------|-----------|
| Aegis → Brain | 53 | "1 errors; sent 0/29" | 43m ago |
| Brain Synthesize | 3 | "Brain trigger stages failed" | 18h ago |
| BWP Ingest | 150 | Prisma findUnique() error | 6d ago |
| ECI Bolt | 150 | "Cron disabled 2026-04-23" (expected — migrating off) | 6d ago |
| Financial Snapshot | 6 | Prisma $executeRawUnsafe() error | 18h ago |
| NUC Alerts | 2 | Prisma $queryRawUnsafe() error | 43m ago |
| NUC Brain (staff) | 14 | "1 errors during sync" | 43m ago |
| NUC Brain Sync | 14 | "2 errors during sync" | 43m ago |

### GREEN Crons (healthy):
Agent Opportunities, Allocation Integrity, Automation Runner, BuilderTrend (12 successes/24h), Collections Cycle, Cron Watchdog (143/24h), Cross-Dock Scan, Cycle-Count Scheduler, Daily Digest, Data Quality, Data Quality Watchdog, Demand Forecast, Gmail, and more.

### Sub-pages:
- Sync Health — not tested
- BuilderTrend — not tested
- Supplier Pricing — not tested
- Routing Audit — not tested
- Data Imports — not tested

---

## 17. Department Portals (`/ops/department-portals`)

- Not tested — nav section exists but likely 404

---

## 18. Resources (`/ops/resources`)

- Not tested — nav section exists but likely 404

---

## 19. Admin

### System Health (`/ops/admin/system-health`)
- Not tested

### Staff Management (`/ops/staff`) — CRITICAL FINDINGS

**Overview:** 78 employees total: 3 Active, 51 Needs Setup, 24 Deactivated

#### Active Accounts (3):
| Name | Email | Role | Issue |
|------|-------|------|-------|
| Nate Barrett | n.barrett@abellumber.com | Administrator | OK |
| Brittney Werner | brittney.werner@abellumber.com | Project Manager | OK — 2 custom perms |
| **Test User** | **testxyz@test.com** | **Viewer** | **REMOVE — test account in production** |

#### Invited (not yet Active, 4):
| Name | Email | Role | Custom Perms |
|------|-------|------|-------------|
| Clint Vinson | c.vinson@abellumber.com | Administrator / COO | default |
| Dawn Meehan | dawn.meehan@abellumber.com | Accounting | 40 custom |
| Thomas Robinson | thomas.robinson@abellumber.com | Project Manager | 9 custom |
| Ben Wilson | ben.wilson@abellumber.com | Project Manager | 4 custom |
| Jordyn Steider | jordyn.steider@abellumber.com | Manager / Logistics | 3 custom |
| Sarah Knighton | sarah.k@abellumber.com | Manager / Executive | default |

#### Security Concerns:
| Issue | Details | Severity |
|-------|---------|----------|
| Test account active | `testxyz@test.com` has Active status in production | RED |
| MG Financial employees | Juan Arreola (`jarreola@mgfinancialpartners.com`) + James Gladue (`jgladue@mgfinancialpartners.com`, "Outside CFO") — litigation counterparty in staff DB | RED |
| Personal Gmail | Jonathan Ashlock uses `ashlockjonathan102@gmail.com` | YELLOW |

#### Duplicate Staff Records (same person, multiple entries):
| Person | # Records | Variants |
|--------|-----------|----------|
| Josh Barrett | 2 | Sales (Transitional) + Business Development |
| Dakota Dyer | 3 | Driver (x2) + Install Crew |
| Chris/Christopher Poppert | 3 | Warehouse Manager + Viewer + Delivery Driver |
| Scott Johnson | 2 | General Manager + GM |
| Darlene Haag | 2 | PM (Deactivated) + PM (Needs Setup) |
| Gunner Hacker | 2 | Manufacturing Tech + Production Line Lead |
| Sean Phillips | 2 | Install Lead + Customer Experience Manager |
| Noah Ridge | 2 | Delivery Driver + Warehouse Associate |
| Braden Sadler | 2 | Manufacturing Associate + Driver |
| Dalton Whatley | 2 | Business Dev Manager (Sales Rep) + Operations (PM) |
| Jacob Brown | 2 | Driver + Door Line Tech |

#### AI System Accounts (6 total — all "Needs Setup"):
| Name | Email | Role |
|------|-------|------|
| Abel Coordinator | coordinator@abellumber.com | Administrator |
| Abel Intel AI | intel.agent@abellumber.com | Administrator |
| Abel Marketing AI | marketing.agent@abellumber.com | Manager |
| Abel Ops AI | ops.agent@abellumber.com | Manager |
| Abel Sales AI | sales.agent@abellumber.com | Sales Rep |
| Abel Success AI | success.agent@abellumber.com | Project Manager |

Also: **System Gmail Sync** (`system-gmail-sync@abellumber.com`) — Administrator, Deactivated

#### Data Quality Issues:
- "Michael TBD" — last name is literally "TBD"
- Brady Bounds subtitle: "Driver - Brady Bounds #" (trailing hash)
- Cody Loudermilk subtitle: "Cody Loudermilk" (name repeated as title)
- Jon Garner subtitle: "Driver - Jon Garner" (name repeated)
- Jordan Sena — "System Implementation Coordinator" with 18 custom perms, Deactivated (contractor?)

### Locations (`/ops/admin/locations`)
- Not tested

### Workload Delegation (`/ops/admin/workload-delegation`)
- Not tested

### Automations (`/ops/admin/automations`)
- Not tested

### Audit Log (`/ops/admin/audit-log`)
- **404**

### Settings (`/ops/admin/settings`)
- **404**

### My Profile (`/ops/admin/my-profile`)
- Not tested

---

## Additional Sub-Page Audit (Round 2)

### Supply Chain Sub-Pages — ALL 404
- `/ops/supply-chain/inventory` — 404
- `/ops/supply-chain/purchase-orders` — 404
- `/ops/supply-chain/vendors` — 404
- `/ops/supply-chain/delivery-center` — 404
- `/ops/supply-chain/todays-routes` — 404
- `/ops/supply-chain/smart-po` — 404

### Finance Sub-Pages — ALL 404
- `/ops/finance/cash-command` — 404
- `/ops/finance/scenario-modeler` — 404
- `/ops/finance/accounts-payable` — 404
- `/ops/finance/company-health` — 404
- `/ops/finance/bank-credit-lines` — 404

### Growth Engine
- `/ops/growth-engine` — 404
- `/ops/growth` — WORKS but shows "Error Loading Opportunities: API error", 0 opportunities

### Other Sections
- `/ops/department-portals` — 404
- `/ops/resources` — 404

### Admin Remaining
- `/ops/admin/system-health` — **WORKS** (health dashboard, DB integrity, ATP shortage forecast, alerts)
- `/ops/admin/locations` — 404
- `/ops/admin/workload-delegation` — 404
- `/ops/admin/automations` — 404

**Sub-page audit result:** 15 of 18 additional pages are 404. Only System Health works fully. Growth loads but API errors.

---

## 404 Pages — Complete List

All nav links that return "Nothing here" (31+ total, including sub-pages):

| # | Section | Page | Route |
|---|---------|------|-------|
| 1 | Executive | Shipping Forecast | `/ops/executive/shipping-forecast` |
| 2 | Executive | Operations | `/ops/executive/operations` |
| 3 | Executive | Financial | `/ops/executive/financial` |
| 4 | Executive | Executive Suite | `/ops/executive/executive-suite` |
| 5 | Executive | KPIs | `/ops/executive/kpis` (loads but broken) |
| 6 | Jobs | PM Command Center | `/ops/jobs/pm-command-center` |
| 7 | Manufacturing | Quality Control | `/ops/manufacturing/quality-control` |
| 8 | Warehouse | Entire section | `/ops/warehouse` |
| 9 | Finance | Accounts Receivable | `/ops/finance/accounts-receivable` |
| 10 | Finance | Collections Center | `/ops/finance/collections` |
| 11 | Communication | Entire section | `/ops/communication` |
| 12 | AI Ops Brain | Entire section | `/ops/ai-operations` |
| 13 | Customer Value | Entire section | `/ops/customer-value` |
| 14 | Admin | Audit Log | `/ops/admin/audit-log` |
| 15 | Admin | Settings | `/ops/admin/settings` |
| 16 | Admin | Staff Management | `/ops/admin/staff` (wrong route — real page is `/ops/staff`) |

**Recommendation:** Either build these pages or remove them from the nav. Dead nav links undermine confidence in the platform.

---

## Critical Bugs — Priority Fix List

| # | Bug | Location | Severity | Fix |
|---|-----|----------|----------|-----|
| 1 | Test account active in prod | Staff Management | RED | Deactivate `testxyz@test.com` |
| 2 | MG Financial employees in DB | Staff Management | RED | Remove Arreola + Gladue records |
| 3 | Negative lead times | Supply Chain | RED | Fix date calculation (likely `deliveredAt - orderedAt` reversed) |
| 4 | KPIs page broken | Executive > KPIs | RED | Fix API endpoint |
| 5 | 419 auth failures/24h | Dashboard alerts | RED | Investigate — brute force or misconfigured service |
| 6 | All job addresses empty | Job Pipeline | YELLOW | Implement address-based naming (Phase 5 in AUTOMATIONS-HANDOFF) |
| 7 | "Closes in -2057d" | Sales Dashboard | YELLOW | Fix bid close date calculation |
| 8 | Wrong time-of-day greeting | My Day | YELLOW | Use actual time, not hardcoded |
| 9 | Date off by one day | My Day | YELLOW | Fix timezone handling |
| 10 | Revenue card truncation | Dashboard | LOW | Widen card or shrink font |
| 11 | All vendors graded "A" | Supply Chain scorecard | YELLOW | Fix scoring differentiation |
| 12 | On-Time % blank for all | Supply Chain scorecard | YELLOW | Implement metric |
| 13 | 246 orders stuck in RECEIVED | Order pipeline | YELLOW | Stale order cleanup or auto-confirm logic |
| 14 | 11 staff duplicates | Staff Management | YELLOW | Deduplicate records |
| 15 | "Michael TBD" last name | Staff Management | LOW | Update to real last name |
| 16 | 8 crons failing | Integrations | RED | Fix Prisma errors in Financial Snapshot, NUC crons, BWP Ingest |

---

## Staff Roster — Actual vs. System

### Who SHOULD be active (from CLAUDE.md people list):
| Name | Role | System Status | Issue |
|------|------|---------------|-------|
| Nate Barrett | Owner/GM | Active | OK |
| Clint Vinson | COO | Invited | Should be Active |
| Dawn Meehan | Accounting Mgr | Invited | Should be Active |
| Dalton Whatley | Business Dev Mgr | Needs Setup (x2) | Duplicate, should be Active |
| Sean Phillips | Customer Experience Mgr | Needs Setup (x2) | Duplicate, should be Active |
| Chad Zeh | PM | Not found | MISSING from system |
| Brittney Werner | PM | Active | OK |
| Thomas Robinson | PM | Invited | Should be Active |
| Ben Wilson | PM | Invited | Should be Active |
| Jordyn Steider | Delivery Supervisor | Invited | Should be Active |
| Lisa Adams | Estimator | Needs Setup | Should be Active |

### Who should NOT be in the system:
- Test User (`testxyz@test.com`) — deactivate
- Juan Arreola (`jarreola@mgfinancialpartners.com`) — MG Financial, remove
- James Gladue (`jgladue@mgfinancialpartners.com`) — MG Financial, remove
- Jordan Sena — contractor, verify if still needed

---

## Integration Health Summary

| Status | Count | % |
|--------|-------|---|
| GREEN | 30 | 79% |
| YELLOW | 0 | 0% |
| RED | 8 | 21% |
| ZOMBIE | 0 | 0% |

The 8 RED crons include 5 NUC-related (expected — NUC not deployed), 1 disabled (ECI Bolt migration), and 2 Prisma errors (Financial Snapshot, BWP Ingest) that need code fixes.

---

## Financial Health (from dashboard data)

| Metric | Value | Assessment |
|--------|-------|------------|
| Revenue YTD | $1.11M | — |
| COGS YTD | $1.23M | COGS exceeds revenue |
| Gross Profit YTD | -$118K | Negative margin |
| DSO | 142 days | Very high (target <45) |
| Cash Cycle | 186 days | Extremely long |
| Net Cash Position | -$372,589 | AR < AP |
| Overdue AR | $38,652 | 23 invoices overdue |

---

*Audit completed 2026-04-27 ~7:50 PM CT*
*Next steps: Fix critical bugs (items 1-5), deduplicate staff, remove 404 nav links or build pages*
