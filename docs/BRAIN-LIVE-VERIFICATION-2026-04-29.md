# Brain Wiring — Live Verification Report
**Date:** 2026-04-29 ~16:00 CT
**Verified by:** Cowork session (live SSH + curl probes against `brain.abellumber.com`)

## TL;DR
Brain is **online + healthy**. Auth works. Aegis code is **already correct** (sends array body + dual-sends `X-API-Key` and `Bearer`). Only blocker: `BRAIN_API_KEY` is not set in Vercel production env.

A test event posted from this sandbox with the real key returned `{"status":"queued","count":1}` HTTP 200.

## Endpoint contract (confirmed)
- URL: `https://brain.abellumber.com/brain/ingest/batch`
- Method: POST
- Body: **plain JSON array** of `IngestPayload` (NOT `{events:[...]}`)
- Required field on each: `title`
- Auth: `X-API-Key: <key>` OR `Authorization: Bearer <key>` — both accepted
- Health endpoint `/brain/health` is unauth-gated; everything else requires the key

## Brain runtime state at verification time
- Status: `online`, `overall_health: green`
- Total entities: 154
- Total connections: 18
- Pending action recommendations: **3,048** (was 2,966 minutes earlier — climbing)
- Data gaps flagged: 234
- Agents online: 5/5
- Events ingested today: 84
- Events ingested last hour: 0 ← the symptom of the broken auth

## Intelligence backlog (sample of what Brain has been thinking)

### Top 10 pending action recommendations
| Priority | Title |
|---|---|
| P0 | Escalate BC Credit Dispute |
| P0 | Complete PO wind-down and CRM cleanup |
| P0 | Execute InFlow reconciliation analysis |
| P1 | Expedite 88 pending PO releases |
| P1 | Resolve Credit Hold Impact |
| P1 | Document insurance relationship |
| P2 | Clarify role and relationship scope |
| P2 | Establish AP monitoring dashboard |
| P3 | Retain for competitive quotes |
| P3 | Document legal service scope |

### Top 10 data gaps
| # | Gap | Entity |
|---|---|---|
| 1 | next_action: Ensure P-Card current; prepare for annual review follow-up | bank_hancock_whitney |
| 2 | cost_breakdown: Fixed costs estimated at $2.2M but detailed breakdown not provided | fin_breakeven |
| 3 | order_entity: Canceled PO 3648 mentioned but not tracked as entity | team_thomas |
| 4 | technical_details: Integration diagnostic shows 0/80 linked - need technical resolution plan | cal_hyphen_handoff_407 |
| 5 | contact_details: Phone number missing for Chad Zeh | team_chad |
| 6 | payment_terms: Payment terms not specified for vendor with past-due issues | vend_woodgrain_novo |
| 7 | hubspot_company: Missing HubSpot company record | cust_cross_custom |
| 8 | hubspot_integration: Cross Custom Homes not yet in HubSpot CRM system | cust_cross_custom |
| 9 | payment_terms: Payment terms and credit limits not specified despite payment discussions | vend_dw_distribution |
| 10 | candidate_details: Top 10 candidates mentioned but no details provided | ops_hiring |

### Tracked entities (sample of 15 of 154)
Bloomfield Homes · Thrive PEO · DOL Garnishment Notice · Billy Van Hooser · Woodgrain / Novo · Dawn Meehan · Insurance · ECI/Paya Contract Termination · Pulte / PulteGroup / Centex / Del Webb · Payroll · AR Aging & Collections · Cross Custom Homes · Ken Blanton Insurance · Brittney Werner · Sean Phillips

## Aegis-side code review (no changes needed)
- `scripts/aegis-to-brain-sync.ts:89-92` already dual-sends both auth headers gated on `if (brainKey)` (env-var check)
- `scripts/aegis-to-brain-sync.ts:303` sends `JSON.stringify(events)` — plain array, matches Brain spec exactly
- All 9 brain-aware files (engine-auth, nuc-bridge, 4 cron routes, 2 v1 routes, ops/brain/proxy) already correct per SCAN-D-NUC-BRAIN-DIAGNOSTIC

## Action required (Nate, ~5 min)
1. `vercel env add BRAIN_API_KEY production` — paste the key from the chat
2. (Optional) `vercel env add ABEL_MCP_API_KEY production` — same value, fixes nuc-bridge `NUC_OFFLINE` returns
3. `vercel --prod` to redeploy

## Verification after deploy
- `GET /api/admin/brain-health` should return `brainAuth: ok`
- Next aegis-brain-sync cron run logs `events_ingested_last_hour > 0` (currently 0)
- `InboxItem.brainAcknowledgedAt` starts populating
- `/brain/health` `events_ingested_last_hour` counter starts incrementing

## Where the key lives on the NUC
`/home/abel/abel-brain/.env` → `AUTH_API_KEY=...`
SSH: `ssh abel@100.84.113.47`

## Safety note
The auth key was extracted from the NUC's local .env file via SSH and used in this session for verification. **Per workspace secrets policy, the key value is NOT committed to this file or any other workspace file.** It lives only in Cowork chat history (acceptable per CLAUDE.md "internal Cowork/Claude-Code chat is fine — that's how the user provisions them") and on the NUC and (after Nate's action) in Vercel env.
