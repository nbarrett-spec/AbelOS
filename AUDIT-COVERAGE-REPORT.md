# Audit Coverage Sweep — 2026-05-03

## Summary

| Metric | Count |
|---|---:|
| Total route.ts files | **815** |
| Routes with state-changing verbs | **494** |
| State-changing routes WITH audit() | **494** |
| State-changing routes MISSING audit() | **0** |
| **Coverage** | **100.0%** |

## Gap by risk tier

| Risk | Missing | Why it matters |
|---|---:|---|
| 🔴 CRITICAL | **0** | Money, auth, identity, deletion — SOC/legal/insurance demand these |
| 🟠 HIGH | **0** | Orders/POs/jobs/integrations — ops daily-truth |
| 🟡 MED | **0** | Automations, dashboards, agents |
| ⚪ LOW | **0** | Misc — internal tooling |

## Coverage by top-level folder

| /api/<folder> | total state-changing | audited | missing | coverage |
|---|---:|---:|---:|---:|
| ✅ `/admin` | 17 | 17 | 0 | 100% |
| ✅ `/agent` | 4 | 4 | 0 | 100% |
| ✅ `/agent-hub` | 24 | 24 | 0 | 100% |
| ✅ `/auth` | 9 | 9 | 0 | 100% |
| ✅ `/blueprints` | 4 | 4 | 0 | 100% |
| ✅ `/builder` | 11 | 11 | 0 | 100% |
| ✅ `/builder-portal` | 1 | 1 | 0 | 100% |
| ✅ `/builders` | 4 | 4 | 0 | 100% |
| ✅ `/bulk-order` | 1 | 1 | 0 | 100% |
| ✅ `/catalog` | 1 | 1 | 0 | 100% |
| ✅ `/client-errors` | 1 | 1 | 0 | 100% |
| ✅ `/crew` | 2 | 2 | 0 | 100% |
| ✅ `/cron` | 24 | 24 | 0 | 100% |
| ✅ `/dashboard` | 1 | 1 | 0 | 100% |
| ✅ `/deliveries` | 1 | 1 | 0 | 100% |
| ✅ `/door` | 1 | 1 | 0 | 100% |
| ✅ `/homeowner` | 4 | 4 | 0 | 100% |
| ✅ `/hyphen` | 3 | 3 | 0 | 100% |
| ✅ `/integrations` | 2 | 2 | 0 | 100% |
| ✅ `/internal` | 1 | 1 | 0 | 100% |
| ✅ `/invoices` | 1 | 1 | 0 | 100% |
| ✅ `/messages` | 1 | 1 | 0 | 100% |
| ✅ `/notifications` | 1 | 1 | 0 | 100% |
| ✅ `/ops` | 345 | 345 | 0 | 100% |
| ✅ `/orders` | 2 | 2 | 0 | 100% |
| ✅ `/payments` | 1 | 1 | 0 | 100% |
| ✅ `/presence` | 1 | 1 | 0 | 100% |
| ✅ `/projects` | 3 | 3 | 0 | 100% |
| ✅ `/quote-request` | 1 | 1 | 0 | 100% |
| ✅ `/quotes` | 3 | 3 | 0 | 100% |
| ✅ `/takeoff` | 1 | 1 | 0 | 100% |
| ✅ `/upload` | 1 | 1 | 0 | 100% |
| ✅ `/v1` | 12 | 12 | 0 | 100% |
| ✅ `/webhooks` | 5 | 5 | 0 | 100% |

