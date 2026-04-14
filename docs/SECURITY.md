# Abel OS — Security Policy

**Effective:** April 13, 2026 (Go-Live)  
**Last Audit:** April 13, 2026  
**Next Review:** July 13, 2026 (90 days)

---

## Threat Model

### Assets at Risk
1. **Builder credentials** (email, password) — 200+ builder accounts
2. **Order data** (projects, quotes, line items) — Revenue visibility
3. **Payment information** (Stripe tokens, invoices) — PCI scope
4. **Admin credentials** (ops staff) — Full system access
5. **Integration secrets** (QB, InFlow, Anthropic API) — Third-party account compromise

### Attack Vectors
| Vector | Mitigation | Status |
|--------|-----------|--------|
| Brute-force login | Rate limiting (Upstash: 5 attempts/5 min), account lockout (planned) | Implemented |
| Session hijacking | httpOnly cookies, sameSite=strict, HTTPS only | Implemented |
| CSRF attacks | CSRF token validation, SameSite cookie policy | Implemented (middleware) |
| XSS injection | Content-Security-Policy headers, Zod input validation, React escaping | Implemented |
| SQL injection | Prisma ORM (parameterized queries), no raw SQL | Implemented |
| API key leaks | Env vars only (never in code), Sentry redaction | Implemented |
| Insecure password reset | Token expiry (24h), one-time-use, signed JWTs | Implemented |
| Privilege escalation | Role-based access checks on every protected route | Implemented |
| Man-in-the-middle | HTTPS everywhere, HSTS header, TLS 1.2+ | Implemented |
| Supply chain (deps) | Pin versions, audit npm/Prisma deps, GitHub dependabot | In progress |

### Risk Levels
- **Critical:** Auth bypass, data loss, payment compromise
- **High:** Unauthorized data access, XSS leading to credential theft
- **Medium:** Information disclosure (error messages), DoS
- **Low:** UI/UX security issues, logging inconsistencies

---

## Authentication & Session Management

### Auth Flow

```
User → /login (POST with email + password)
  ↓
SHA256(password) → bcrypt.compare(hash) → JWT(payload + 7d expiry)
  ↓
Set httpOnly cookie (sameSite=strict, secure=true in prod)
  ↓
Redirect to /dashboard
  ↓
Middleware validates JWT on every protected route
  ↓
If invalid/expired → redirect to /login with ?next=originalPath
```

### JWT Details
- **Algorithm:** HS256 (HMAC-SHA256)
- **Secret:** `JWT_SECRET` env var (64+ chars, rotatable)
- **Expiry:** 7 days (or 30 days if "Remember me" checked during login)
- **Payload:** `{ builderId, email, companyName, iat, exp }`
- **Issued at:** `Math.floor(Date.now() / 1000)`

### Password Security
- **Hash:** bcryptjs with rounds=12 (OWASP recommendation)
- **Min length:** 8 characters (enforced frontend + backend)
- **Strength meter:** Live password strength feedback (frontend only)
- **Reset tokens:** JWT with 24-hour expiry, one-time use
- **Reset email:** Contains signed link: `/reset-password?token=JWT`

### Cookie Security
```javascript
// src/lib/auth.ts
cookieStore.set(COOKIE_NAME, token, {
  httpOnly: true,                         // No JS access
  secure: NODE_ENV === 'production',      // HTTPS only in prod
  sameSite: NODE_ENV === 'production' ? 'strict' : 'lax',
  maxAge: rememberMe ? 30*24*60*60 : 7*24*60*60,  // 30d or 7d
  path: '/',
})
```

**Security properties:**
- **httpOnly:** Prevents XSS from reading session cookie
- **sameSite=strict:** Prevents CSRF (no cross-site requests can send cookie)
- **secure:** Only sent over HTTPS (prevents MITM)
- **7-day default:** Short expiry reduces window if token compromised

### Session Termination
- **Logout:** Clear `abel_session` cookie + redirect to `/login`
- **Expiry:** JWT auto-expires after 7 days; stale cookies rejected
- **Security revocation:** Rotate `JWT_SECRET` to invalidate all sessions instantly

---

## Rate Limiting

### Strategy
- **Backend:** Upstash Redis (distributed across serverless instances)
- **Fallback:** In-memory Map when Upstash unavailable (dev only)
- **Identity:** IP address (via `x-forwarded-for` header from Vercel)

### Current Limits

| Endpoint | Rate | Window | Purpose |
|----------|------|--------|---------|
| `/api/auth/login` | 5 attempts | 5 minutes | Prevent brute-force |
| `/api/auth/signup` | 3 per IP | 1 hour | Prevent account spam |
| `/api/auth/forgot-password` | 3 per email | 1 hour | Prevent email spam |
| `/api/builder/*` | 30 reqs | 1 minute | General API rate limit |
| `/api/ops/*` | 50 reqs | 1 minute | Higher limit for staff |
| `/api/webhooks/*` | No limit | — | Webhooks bypass (secured via signature) |

### Bypasses
- Webhooks (Stripe, QB) are not rate-limited; instead secured via HMAC signature verification
- Cron jobs are not rate-limited; secured via `CRON_SECRET`
- Internal service-to-service calls (Agent Hub) use API key auth, not rate limiting

---

## Input Validation & Output Encoding

### Server-Side Validation

All API endpoints validate inputs using **Zod schemas** (see `src/lib/validations.ts`):

```typescript
// Example: Create Order
const CreateOrderSchema = z.object({
  projectId: z.string().cuid(),
  lineItems: z.array(z.object({
    productId: z.string().cuid(),
    quantity: z.number().int().positive(),
    // ... more fields
  })).min(1),
})

export async function POST(req: Request) {
  const body = await req.json()
  const result = CreateOrderSchema.safeParse(body)
  if (!result.success) {
    return NextResponse.json({ error: 'Invalid input' }, { status: 400 })
  }
  // Process result.data (guaranteed to match schema)
}
```

### Output Encoding
- **JSON responses:** Automatically escaped by `NextResponse.json()`
- **HTML templates:** React auto-escapes by default
- **Logging:** Sentry redacts sensitive fields (passwords, tokens, email in errors)

### SQL Injection Prevention
- **No raw SQL:** Prisma ORM uses parameterized queries
- **If raw SQL needed:** Use `prisma.$queryRaw\`...${param}...\`` syntax (parameterized)
- **Never:** Concatenate user input into SQL strings

---

## Secrets & Credentials Management

### Environment Variables (Secure)
Never committed to git:
- `DATABASE_URL` — Postgres connection
- `JWT_SECRET` — Session signing key
- `RESEND_API_KEY` — Email API key
- `STRIPE_SECRET_KEY` — Stripe secret (not publishable key)
- `STRIPE_WEBHOOK_SECRET` — Webhook signature
- `ANTHROPIC_API_KEY` — Claude API key
- `SENTRY_DSN` & `SENTRY_AUTH_TOKEN` — Error monitoring
- `UPSTASH_REDIS_REST_URL` & `UPSTASH_REDIS_REST_TOKEN` — Rate limiter
- `CRON_SECRET` — Vercel cron job auth

### Storage
- **Development:** `.env` (gitignored, never shared)
- **Production:** Vercel dashboard → Settings → Environment Variables
- **Rotation:** Update in Vercel, redeploy within 2 min

### Access Control
- **Who can view:** Only developers with Vercel admin access
- **Audit trail:** Vercel logs all env var changes (check dashboard)
- **Rotation schedule:** Every 90 days (JWT_SECRET, API keys)

### Exposed Secret Response
If a secret is leaked:
1. **Immediately rotate** in Vercel dashboard
2. **Verify scope:** Is the secret read-only or write-capable?
3. **Monitor:** Check service logs for unauthorized access (Sentry, Stripe, QB)
4. **Communicate:** Tell affected service (e.g., contact Stripe support)
5. **Root cause:** Update RBAC, add IP allowlisting, enable 2FA

---

## Dependency Management

### Pinning & Auditing
- **Lock file:** `package-lock.json` committed (reproducible builds)
- **Audit:** `npm audit` before each deploy
- **Policy:** Pin major versions; update patch/minor regularly

```bash
# Check for vulnerabilities
npm audit

# Fix low/moderate issues automatically
npm audit fix

# Review high/critical (manual fix needed)
npm audit --audit-level=high
```

### Dependency Updates
| Priority | Example | Cadence | Action |
|----------|---------|---------|--------|
| Critical (RCE) | OpenSSL, Node.js | ASAP (within hours) | Patch release, redeploy |
| High | Crypto bypass, auth bug | Within 1 week | Patch release, test, deploy |
| Medium | DoS, info disclosure | Within 2 weeks | Update, test, deploy |
| Low | Minor issue | Monthly | Batch with other updates |

### Pinned Versions (as of April 13, 2026)

```json
{
  "next": "^14.2.0",
  "prisma": "^5.14.0",
  "@prisma/client": "^5.14.0",
  "react": "^18.3.0",
  "zod": "^3.23.0",
  "jose": "^5.3.0",
  "bcryptjs": "^2.4.3",
  "@upstash/ratelimit": "^2.0.8",
  "@sentry/nextjs": "^10.47.0"
}
```

Upgrade cadence: Monthly (staggered, not all at once).

---

## API Security

### Authentication
- **Public routes:** `/login`, `/signup`, `/forgot-password`, `/reset-password`, `/api/health`
- **Protected routes:** Require valid JWT in cookie + role check
- **Admin routes:** Require `ADMIN` role (checked in route handler)
- **Webhook routes:** Secured via HMAC signature (not JWT)

### Authorization
See `src/lib/permissions.ts` for role-based access control:

```typescript
// Example: Can builder view this order?
async function canBuilderViewOrder(builderId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId } })
  return order?.builderId === builderId
}
```

- **Builder role:** Can view own orders, projects, quotes
- **Crew role:** Can view jobs assigned to them
- **Ops/Admin role:** Can view all builders, orders, system admin
- **Public role:** Can access public docs, status page

### CORS & Cross-Origin
- **Default:** No CORS headers (same-origin only)
- **If API needed from external domain:** Add to `next.config.js` headers
- **Stripe webhooks:** Cross-origin allowed (signature-verified)

### Error Responses
- **API errors:** Return JSON with `error` field (no stack traces in production)
- **400 Bad Request:** Invalid input, Zod error details
- **401 Unauthorized:** Missing/invalid JWT
- **403 Forbidden:** Valid auth but insufficient permissions
- **500 Internal Error:** Sentry digest included, but no internal details

Example:
```json
{
  "error": "Unauthorized",
  "digest": "sentry-event-abc123xyz"
}
```

Users can share the digest with support to investigate.

---

## HTTPS & Transport Security

### TLS Configuration
- **Minimum version:** TLS 1.2 (enforced by Vercel edge)
- **Ciphers:** Modern (ECDHE preferred; SHA-1 and RC4 disabled)
- **Certificate:** Auto-issued by Let's Encrypt (renewed automatically)

### Headers (set in `next.config.js`)

| Header | Value | Purpose |
|--------|-------|---------|
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Force HTTPS for 1 year |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-sniffing |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS protection |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable dangerous APIs |

### CSP (Content-Security-Policy)
Strict policy to prevent inline script injection:

```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval'
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
img-src 'self' data: blob: https:
font-src 'self' data: https://fonts.gstatic.com
connect-src 'self' https://neon.tech
frame-src 'self'
frame-ancestors 'none'
base-uri 'self'
form-action 'self'
```

**Note:** `unsafe-inline` on scripts is temporary (Tailwind limitation). Plan to remove in Phase 2.

---

## Recent Audit Findings (April 2026)

### Fixed
- **XSS in AICopilot component** — Raw HTML rendering removed; switched to React SafeHTML (FIXED)
- **Weak password reset tokens** — Updated to signed JWTs with expiry (FIXED)
- **Auth cookies not httpOnly** — Set httpOnly=true in auth.ts (FIXED)
- **Missing Zod validation on routes** — Comprehensive schemas added (FIXED)

### Open
- **CSP too permissive** — `unsafe-inline` on scripts needed for Tailwind; plan to remove post-Phase-1
- **No account lockout** — Manual lock only; auto-lockout after N failed attempts planned for Phase 2
- **Rate limit bypass via IPv6** — Current implementation uses IPv4; IPv6 requests may bypass; monitoring

### Planned (Phase 2)
- [ ] Add MFA (TOTP) for ops staff
- [ ] Implement Web Authentication (WebAuthn) for passwordless login
- [ ] Add IP allowlisting for ops staff
- [ ] Enable automatic dependency updates (Dependabot)
- [ ] Penetration testing (external vendor)
- [ ] SOC 2 compliance audit

---

## Incident Response

### Security Incident Severity

| Severity | Example | Response |
|----------|---------|----------|
| **CRITICAL** | RCE, data breach, auth bypass | Page on-call + Nate immediately; declare incident |
| **HIGH** | XSS, privilege escalation, leaked secret | Page on-call within 1 hour |
| **MEDIUM** | Unauthorized data access, DoS | Triage next business day |
| **LOW** | Minor info disclosure, lint warning | Backlog |

### Responsible Disclosure

**If you find a security issue:**

1. **Do NOT open a public issue on GitHub**
2. **Email:** Nate Barrett (n.barrett@abellumber.com) with:
   - Title: "Security Issue: {brief description}"
   - Reproduction steps
   - Impact assessment
   - Proof-of-concept (if safe to share)
3. **Expect response:** Within 24 hours
4. **Embargo:** Do not disclose publicly for 90 days (standard industry practice)

### Incident Checklist
1. [ ] Assess severity and scope
2. [ ] Notify security team (Nate + on-call engineer)
3. [ ] Isolate affected system (if needed)
4. [ ] Begin investigation (logs, database, code review)
5. [ ] Develop fix (code change + tests)
6. [ ] Deploy fix to production
7. [ ] Monitor for side effects
8. [ ] Write postmortem within 48 hours
9. [ ] Communicate timeline to affected users (if applicable)

---

## Compliance & Standards

### Standards Followed
- **OWASP Top 10:** Addressed in design (XSS, CSRF, injection, auth, etc.)
- **NIST Cybersecurity Framework:** Core functions (Identify, Protect, Detect, Respond, Recover)
- **CWE Top 25:** Most critical weaknesses mitigated

### Planned Compliance
- **SOC 2 Type II** — Planned for 2026 Q3
- **GDPR** — Data retention policy, right to deletion (planned)
- **PCI DSS** — Stripe handles card data; we store tokens only (compliant via Stripe)

---

## Security Contacts

**Report vulnerability:** n.barrett@abellumber.com  
**On-call engineer:** Check Slack / calendar  
**Escalation:** Nate Barrett (CEO)

---

## Reference Documents

- OWASP Top 10: https://owasp.org/www-project-top-ten/
- NIST Cybersecurity Framework: https://www.nist.gov/cyberframework/
- SANS Top 25: https://www.sans.org/top25-software-errors/
- Stripe Security: https://stripe.com/docs/security/general
- Vercel Security: https://vercel.com/docs/security

---

**Last Updated:** April 13, 2026  
**Next Review:** July 13, 2026
