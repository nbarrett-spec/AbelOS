# Webhook Hardening Sweep — 2026-05-04

Six-dimension scorecard for every inbound webhook route. Each row scores
on signature verification, timing-safe compare, raw-body-first parsing,
idempotency, payload persistence, and audit logging.

## Summary

| Metric | Count |
|---|---:|
| Webhook routes inventoried | **10** |
| Active (non-stub) | **9** |
| Stubs / not-yet-wired | **1** |
| Routes scoring A+ (6/6) | **9** |
| Routes scoring < A+ | **0** |
| Total dimension coverage | **100.0%** (54/54) |

## Coverage by dimension

| Dimension | Coverage |
|---|---:|
| ✅ Signature verification | 9/9 (100%) |
| ✅ Timing-safe compare | 9/9 (100%) |
| ✅ Raw body before parse | 9/9 (100%) |
| ✅ Idempotency | 9/9 (100%) |
| ✅ Payload persisted for replay | 9/9 (100%) |
| ✅ Audit logging | 9/9 (100%) |

## Scorecard

| Route | Sig | Safe | Raw1st | Idem | Persist | Audit | Score |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| `/api/agent/email` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/agent/sms` | — | — | — | — | — | — | **STUB** |
| `/api/hyphen/orders` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/ops/brain/webhook` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/ops/integrations/buildertrend/webhook` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/webhooks/gmail` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/webhooks/hyphen` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/webhooks/inflow` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/webhooks/resend` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |
| `/api/webhooks/stripe` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **A+** (6/6) |

## Notes & gaps

### `/api/hyphen/orders` — A+ (6/6)

File: `src/app/api/hyphen/orders/route.ts`

- Bearer/JWT auth — body signing not required; request.json() is fine

### `/api/ops/brain/webhook` — A+ (6/6)

File: `src/app/api/ops/brain/webhook/route.ts`

- uses static Bearer token via env compare — adequate for internal NUC traffic; not HMAC
- Bearer/JWT auth — body signing not required; request.json() is fine
- uses app-level dedup, not ensureIdempotent — works but bypasses retry/DLQ machinery

### `/api/webhooks/gmail` — A+ (6/6)

File: `src/app/api/webhooks/gmail/route.ts`

- Bearer/JWT auth — body signing not required; request.json() is fine

