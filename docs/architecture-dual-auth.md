# Architecture: Dual-Path Staff Authentication

**Last Updated:** 2026-04-16 | **Status:** Production  
**Applies to:** All `/api/admin/*` and `/api/ops/*` routes

---

## Context

Abel OS runs on Vercel with Next.js 14.2. Vercel's Edge Middleware runs in the Edge Runtime, which cannot import Node.js-only dependencies like Prisma. This creates a constraint: middleware can verify JWTs (using `jose`, which is Edge-compatible) and inject headers, but route handlers that need database access must run in the Node.js runtime.

The platform has two protected API namespaces that need staff authentication:

- `/api/ops/*` — Operational tools (staff portal backend)
- `/api/admin/*` — Admin/observability endpoints (dashboards, alerts, crons)

## Design Decision

We use a **dual-path authentication pattern** — middleware sets headers as the primary path, and route handlers have a cookie fallback as a secondary path. This provides defense-in-depth: if middleware fails to inject headers (misconfiguration, deployment gap, Edge Runtime issues), the route handler can still authenticate by reading the JWT cookie directly.

## How It Works

```
Browser Request
  │
  ├─ Cookie: abel_staff_session=<JWT>
  │
  ▼
┌──────────────────────────────────────────────┐
│  Edge Middleware (src/middleware.ts)          │
│                                              │
│  1. Read abel_staff_session cookie           │
│  2. Verify JWT with jose (HS256)             │
│  3. If valid → inject x-staff-* headers:     │
│     • x-staff-id                             │
│     • x-staff-role                           │
│     • x-staff-roles (comma-separated)        │
│     • x-staff-department                     │
│     • x-staff-email                          │
│     • x-staff-firstname                      │
│     • x-staff-lastname                       │
│  4. If invalid → return 401 JSON             │
│  5. Forward request with headers             │
└──────────────────────────────────────────────┘
  │
  ▼
┌──────────────────────────────────────────────┐
│  Route Handler (Node.js Runtime)             │
│                                              │
│  /api/ops/* uses checkStaffAuth():           │
│    → Reads x-staff-* headers ONLY            │
│    → No headers = 401                        │
│    → Wrong role = 403                        │
│                                              │
│  /api/admin/* uses checkStaffAuthWithFallback(): │
│    → Try 1: Read x-staff-* headers           │
│    → Try 2: Read cookie directly via         │
│       cookies() + verifyStaffToken()         │
│    → Both fail = 401                         │
│    → Wrong role = 403                        │
└──────────────────────────────────────────────┘
```

## Key Files

| File | Purpose |
|------|---------|
| `src/middleware.ts` | Edge Middleware — JWT verification + header injection for `/api/ops/*` and `/api/admin/*` |
| `src/lib/api-auth.ts` | `checkStaffAuth()` (header-only) and `checkStaffAuthWithFallback()` (header + cookie) |
| `src/lib/staff-auth.ts` | JWT creation/verification, cookie management, password hashing |

## Auth Function Reference

### `checkStaffAuth(request, options?)`

- **Used by:** `/api/ops/*` routes
- **Path:** Header-only (reads `x-staff-id`, `x-staff-role`, `x-staff-roles`)
- **Role check:** If `allowedRoles` option provided, checks if ANY of the staff's roles match. ADMIN always passes.
- **Returns:** `NextResponse` (401 or 403) on failure, `null` on success
- **Security logging:** Logs `no_session` or `insufficient_permissions` events

### `checkStaffAuthWithFallback(request, options?)`

- **Used by:** `/api/admin/*` routes (all 22 endpoints)
- **Path 1:** Same as `checkStaffAuth` — read headers
- **Path 2 (fallback):** Calls `getStaffSession()` from `staff-auth.ts`, which reads the `abel_staff_session` cookie directly using `cookies()` from `next/headers` and verifies the JWT
- **Returns:** Same as `checkStaffAuth`
- **Security logging:** Adds `_cookie_fallback` suffix to reason codes when fallback path is used

## JWT Token Structure

The `abel_staff_session` cookie contains a JWT (HS256) with this payload:

```typescript
interface StaffSessionPayload {
  staffId: string       // UUID
  email: string         // e.g., "nate@abellumber.com"
  firstName: string
  lastName: string
  role: string          // Primary role (backward compat)
  roles: string         // Comma-separated list of ALL roles
  department: string    // Department enum value
  title: string | null
}
```

**Token lifetime:** 12 hours (`TOKEN_EXPIRY = '12h'`)  
**Cookie config:** httpOnly, secure in production, sameSite strict in production, path `/`

## Role-Based Access Control

The system supports multi-role assignment. A staff member can hold multiple roles (stored comma-separated in the JWT `roles` field). Access checks use OR logic — if ANY of the staff's roles appears in the route's `allowedRoles`, access is granted. The `ADMIN` role bypasses all role checks.

```
Staff roles: "OPS_MANAGER,SALES_REP"
Route requires: ["OPS_MANAGER", "ADMIN"]
→ Access granted (OPS_MANAGER matches)
```

## Why Both Paths Exist

| Scenario | Header Path | Cookie Fallback |
|----------|-------------|-----------------|
| Normal request through Vercel | Works | Works (redundant) |
| Middleware misconfiguration | Fails | Catches it |
| Direct API call (no middleware) | Fails | Catches it |
| Development (local next dev) | Works if middleware runs | Catches cold-start gaps |
| Edge Runtime issue on Vercel | Fails | Catches it |

The cookie fallback adds ~1ms of overhead (JWT verification) but provides resilience against an entire class of deployment and configuration failures.

## Common Failure Modes

### All endpoints return 401

**Cause:** Staff session expired (12h TTL). Both paths fail because the cookie is gone.  
**Fix:** Log in at `/ops/login`. See the runbook for the full triage checklist.

### Admin endpoints work, ops endpoints don't

**Cause:** Middleware isn't injecting headers for `/api/ops/*` but admin routes survive via cookie fallback.  
**Fix:** Check middleware.ts for the `/api/ops/*` auth block.

### Ops endpoints work, admin endpoints don't

**Cause:** Middleware header injection works but the cookie fallback is broken (unlikely — would require a bug in `getStaffSession()`).  
**Fix:** Check `staff-auth.ts` for cookie parsing issues.

## Security Considerations

- The JWT is signed with `JWT_SECRET` (HS256). In production, this must be a strong random value — the app throws on startup if it's missing.
- The cookie is `httpOnly` (no JS access) and `secure` in production (HTTPS only).
- `sameSite: 'strict'` in production prevents CSRF via cross-site requests.
- All auth failures are logged as `SecurityEvent` records with source IP, user agent, and reason codes.
- Failed auth attempts are visible on the `/admin/security-events` dashboard.
