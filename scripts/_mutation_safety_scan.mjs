// Mutation-safety scanner (Audit Agent A — full sweep).
// READ-ONLY. Walks every route.ts, classifies each HTTP handler against
// the rubric (AUTH, AUDIT, VALIDATION, TRY/CATCH, IDEMPOTENCY).
// Output: scripts/_mutation_safety_scan.json
import fs from 'node:fs';
import path from 'node:path';

const ROOT = 'src/app/api';
const routes = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name === 'route.ts') routes.push(full);
  }
}
walk(ROOT);

// ──────────────────────────────────────────────────────────────────────
// Pattern matchers
// ──────────────────────────────────────────────────────────────────────

// AUTH recognisers (middleware-level handled separately via path)
const AUTH_PATTERNS = [
  /\brequireStaffAuth\s*\(/,
  /\bcheckStaffAuth\s*\(/,
  /\bcheckStaffAuthWithFallback\s*\(/,
  /\bverifyEngineToken\s*\(/,
  /\bverifyAgentToken\s*\(/,
  /\bverifyAgentApiKey\s*\(/,
  /\bverifySession\s*\(/,
  /\bgetSession\s*\(/,
  /\bverifyToken\s*\(/,                // builder-cookie JWT verify
  /\bgetBuilderFromSession\s*\(/,
  /\brequireBuilderAuth\s*\(/,
  /\brequireAuth\s*\(/,
  /\brequireAdmin\s*\(/,
  /\bauthorize\s*\(/,
  /\bcheckAuth\s*\(/,
  // Bearer token / API key inline checks
  /process\.env\.AEGIS_API_KEY/,
  /process\.env\.AGENT_HUB_API_KEY/,
  /process\.env\.CRON_SECRET/,
  /process\.env\.INTERNAL_LOG_SECRET/,
  /process\.env\.ENGINE_API_KEY/,
  /x-api-key/i,
  /headers\.get\(['"]authorization['"]\)/i,
  /Bearer\s+/,
  // Cookie-inspection auth (builder portal)
  /request\.cookies\.get\(['"]abel_session['"]\)/,
  /cookies\.get\(['"]abel_session['"]\)/,
  // Token-based homeowner/signed-URL auth
  /publicFormLimiter/,
  /accessToken/,
];

// AUDIT log callers
const AUDIT_IMPORT = /from\s+['"]@\/lib\/audit['"]|from\s+['"](?:\.\.\/)+lib\/audit['"]/;
const AUDIT_CALL = /\b(audit|logAudit|auditBuilder)\s*\(/;
// Direct raw AuditLog SQL (agent-hub/actions/log pattern)
const AUDIT_RAW_SQL = /INSERT\s+INTO\s+["']?AuditLog["']?/i;

// VALIDATION patterns
const VALIDATION_PATTERNS = [
  /\.parse\s*\(/,           // zod .parse / .safeParse
  /\.safeParse\s*\(/,
  /z\.object\s*\(/,          // zod schema definition in-file
  /zod/,
  /typeof\s+\w+\s*[!=]==\s*['"]string['"]/, // typeof x === 'string'
  /typeof\s+\w+\s*[!=]==\s*['"]number['"]/,
  /typeof\s+\w+\s*[!=]==\s*['"]boolean['"]/,
  /Array\.isArray\s*\(/,
  /!body\./,                  // if (!body.field)
  /\brequired\s*[\[:]/,
  /isNaN\s*\(/,
  /\.trim\s*\(\s*\)\s*===\s*['"]/,
  /\.length\s*[<>=]/,         // length bounds
];

// TRY/CATCH
const TRY_CATCH = /\btry\s*\{[\s\S]*?\bcatch\s*\(/;

// IDEMPOTENCY
const IDEMPOTENCY_PATTERNS = [
  /\bensureIdempotent\s*\(/,
  /processedEvents/i,
  /\bWebhookEvent\b/,
  /eventId/,
  /idempotencyKey/i,
  /idempotency_key/i,
  /request.?id/i,                     // findUnique by requestId
  /x-idempotency-key/i,
  /stripe-signature/i,                // stripe uses its own dedup
  /X-Hub-Signature/i,
  /\.stripe\.webhooks\.constructEvent\s*\(/,
];

// HTTP handlers
const HANDLER_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PATCH|PUT|DELETE|OPTIONS|HEAD)\s*\(/g;

// ──────────────────────────────────────────────────────────────────────
// Domain classifier (by path)
// ──────────────────────────────────────────────────────────────────────
function domainOf(relPath) {
  // relPath like "src/app/api/ops/orders/route.ts"
  const after = relPath.replace(/\\/g, '/').replace(/^src\/app\/api\//, '');
  const first = after.split('/')[0];
  if (first === 'ops' || first === 'admin') {
    const second = after.split('/')[1] ?? '';
    return `${first}/${second}`;
  }
  return first;
}

// ──────────────────────────────────────────────────────────────────────
// Middleware coverage — routes that are protected by middleware
// ──────────────────────────────────────────────────────────────────────
function middlewareAuth(relPath) {
  const p = relPath.replace(/\\/g, '/').replace(/^src\/app\//, '/');
  // Builder auth endpoints — mint the session, can't require pre-auth; need rate-limit + body validation.
  if (p.startsWith('/api/auth/')) return 'PUBLIC_AUTH_ENDPOINT';
  // /api/ops/* → staff cookie, except /api/ops/auth/* (public) and a few Bearer carve-outs
  if (p.startsWith('/api/ops/auth/')) return 'PUBLIC_AUTH_ENDPOINT'; // same category
  if (p === '/api/ops/handbook') return 'PUBLIC';
  if (p === '/api/ops/communication-logs/gmail-sync') return 'API_KEY'; // x-api-key OR cookie
  if (p === '/api/ops/hyphen/ingest') return 'BEARER'; // Bearer OR cookie
  if (p.startsWith('/api/ops/')) return 'COOKIE_STAFF';
  // /api/admin/* → staff cookie + ADMIN role
  if (p.startsWith('/api/admin/')) return 'COOKIE_STAFF_ADMIN';
  // /api/agent-hub/* → Bearer API key OR staff cookie
  if (p.startsWith('/api/agent-hub/')) return 'BEARER_OR_COOKIE';
  // /api/webhooks/* → PUBLIC (must verify signature)
  if (p.startsWith('/api/webhooks/')) return 'PUBLIC';
  // /api/internal/* → PUBLIC but CSRF skipped (handler must verify secret)
  if (p.startsWith('/api/internal/')) return 'PUBLIC_CSRF_SKIPPED';
  // /api/v1/engine/* → Bearer
  if (p.startsWith('/api/v1/engine/')) return 'BEARER';
  // /api/cron/* → CRON_SECRET (handler must verify)
  if (p.startsWith('/api/cron/')) return 'PUBLIC_CRON';
  // Everything else (/api/auth/*, /api/builders/*, /api/builder/*, etc.)
  // has NO middleware auth — handler must check.
  return 'NONE';
}

// ──────────────────────────────────────────────────────────────────────
// Classifier per handler
// ──────────────────────────────────────────────────────────────────────
function classifyHandler(content, method, mwAuth, relPath) {
  const isMutation = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);
  if (!isMutation) {
    return { method, isMutation: false };
  }

  // AUTH
  const hasInlineAuth = AUTH_PATTERNS.some((r) => r.test(content));
  let authStatus;
  if (mwAuth === 'COOKIE_STAFF' || mwAuth === 'COOKIE_STAFF_ADMIN' || mwAuth === 'BEARER_OR_COOKIE') {
    authStatus = 'PASS'; // middleware enforces
  } else if (mwAuth === 'BEARER' || mwAuth === 'API_KEY') {
    authStatus = hasInlineAuth ? 'PASS' : 'WARN'; // middleware allows, handler should still verify
  } else if (mwAuth === 'PUBLIC_CRON') {
    // cron handler must check CRON_SECRET
    authStatus = /CRON_SECRET|isInternalCronRequest|requireCronAuth/.test(content) ? 'PASS' : 'FAIL';
  } else if (mwAuth === 'PUBLIC_CSRF_SKIPPED') {
    authStatus = /process\.env\./.test(content) ? 'PASS' : 'WARN';
  } else if (mwAuth === 'PUBLIC_AUTH_ENDPOINT') {
    // Endpoint that mints the session — must have rate limit AND body validation.
    const hasRateLimit = /checkRateLimit|authLimiter|publicFormLimiter|apiLimiter|oauthLimiter/.test(content);
    const hasValidation = VALIDATION_PATTERNS.some((r) => r.test(content));
    if (hasRateLimit && hasValidation) authStatus = 'PASS';
    else if (hasRateLimit || hasValidation) authStatus = 'WARN';
    else authStatus = 'FAIL';
  } else if (mwAuth === 'PUBLIC') {
    // webhooks must verify signature; auth handlers must validate body
    authStatus = hasInlineAuth || /verify.*Signature|constructEvent|verifyWebhook|hmac/i.test(content) ? 'PASS' : 'FAIL';
  } else {
    // mwAuth === 'NONE'
    authStatus = hasInlineAuth ? 'PASS' : 'FAIL';
  }

  // AUDIT
  const hasAuditImport = AUDIT_IMPORT.test(content);
  const hasAuditCall = AUDIT_CALL.test(content);
  const hasRawAudit = AUDIT_RAW_SQL.test(content);
  // scope audit check to this method only when possible (crude: if the file has
  // multiple mutation methods, we flag the file as a whole)
  let auditStatus;
  if (hasAuditImport && hasAuditCall) auditStatus = 'PASS';
  else if (hasRawAudit) auditStatus = 'WARN'; // bypasses helper
  else auditStatus = 'FAIL';

  // VALIDATION
  const valHits = VALIDATION_PATTERNS.filter((r) => r.test(content)).length;
  let validationStatus;
  if (valHits >= 2) validationStatus = 'PASS';
  else if (valHits === 1) validationStatus = 'WARN';
  else validationStatus = 'FAIL';

  // TRY/CATCH
  const hasTryCatch = TRY_CATCH.test(content);
  const tryStatus = hasTryCatch ? 'PASS' : 'FAIL';

  // IDEMPOTENCY (only matters for webhooks + external-retry routes)
  const isWebhook = /\/api\/webhooks\//.test(relPath.replace(/\\/g, '/'));
  const isExternalRetry = /\/api\/(cron|hyphen|inflow|gmail|stripe)\//.test(relPath.replace(/\\/g, '/'));
  let idempotencyStatus;
  if (isWebhook || isExternalRetry) {
    idempotencyStatus = IDEMPOTENCY_PATTERNS.some((r) => r.test(content)) ? 'PASS' : 'FAIL';
  } else {
    idempotencyStatus = 'N/A';
  }

  // CSRF — handled by middleware for all /api/* except carve-outs
  // Bearer / API-key paths legitimately bypass CSRF; classify:
  let csrfStatus;
  const p = relPath.replace(/\\/g, '/');
  if (p.includes('/api/webhooks/') || p.includes('/api/internal/')) {
    csrfStatus = 'N/A'; // external, signature-verified
  } else if (mwAuth === 'BEARER' || mwAuth === 'API_KEY') {
    csrfStatus = 'PASS'; // legit bypass
  } else if (p.includes('/api/')) {
    csrfStatus = 'PASS'; // middleware enforces origin check
  } else {
    csrfStatus = 'N/A';
  }

  return {
    method,
    isMutation: true,
    authStatus,
    auditStatus,
    validationStatus,
    tryStatus,
    idempotencyStatus,
    csrfStatus,
    hasInlineAuth,
    hasAuditImport,
    hasAuditCall,
    hasRawAudit,
    mwAuth,
  };
}

const results = [];

for (const f of routes) {
  const content = fs.readFileSync(f, 'utf8');
  const rel = f.replaceAll('\\', '/');
  const mwAuth = middlewareAuth(rel);
  const domain = domainOf(rel);

  // Find every exported HTTP handler
  const handlers = new Set();
  let m;
  const re = new RegExp(HANDLER_RE.source, 'g');
  while ((m = re.exec(content)) !== null) handlers.add(m[1]);

  const perHandler = [];
  for (const h of handlers) {
    perHandler.push(classifyHandler(content, h, mwAuth, rel));
  }

  results.push({
    file: rel,
    domain,
    mwAuth,
    handlers: perHandler,
    lineCount: content.split('\n').length,
  });
}

fs.writeFileSync('scripts/_mutation_safety_scan.json', JSON.stringify(results, null, 2));

// ────────────────────────────────────────────────────────────────────
// Summary
// ────────────────────────────────────────────────────────────────────
let mutationRoutes = 0;
let authFails = 0;
let auditFails = 0;
let validationFails = 0;
let tryFails = 0;
let idempFails = 0;

const domainRoll = new Map();
const fileRoll = [];

for (const r of results) {
  const muts = r.handlers.filter((h) => h.isMutation);
  if (muts.length === 0) continue;
  mutationRoutes++;

  let anyAuthFail = false;
  let anyAuditFail = false;
  let anyValFail = false;
  let anyTryFail = false;
  let anyIdempFail = false;
  let allPass = true;

  for (const h of muts) {
    if (h.authStatus === 'FAIL') { anyAuthFail = true; allPass = false; }
    if (h.auditStatus === 'FAIL') { anyAuditFail = true; allPass = false; }
    if (h.validationStatus === 'FAIL') { anyValFail = true; allPass = false; }
    if (h.tryStatus === 'FAIL') { anyTryFail = true; allPass = false; }
    if (h.idempotencyStatus === 'FAIL') { anyIdempFail = true; allPass = false; }
  }

  if (anyAuthFail) authFails++;
  if (anyAuditFail) auditFails++;
  if (anyValFail) validationFails++;
  if (anyTryFail) tryFails++;
  if (anyIdempFail) idempFails++;

  const stats = domainRoll.get(r.domain) ?? {
    total: 0, auth: 0, audit: 0, val: 0, tryc: 0, idemp: 0, pass: 0,
  };
  stats.total++;
  if (!anyAuthFail) stats.auth++;
  if (!anyAuditFail) stats.audit++;
  if (!anyValFail) stats.val++;
  if (!anyTryFail) stats.tryc++;
  if (!anyIdempFail) stats.idemp++;
  if (allPass) stats.pass++;
  domainRoll.set(r.domain, stats);

  fileRoll.push({
    file: r.file,
    domain: r.domain,
    methods: muts.map((h) => h.method).join(','),
    anyAuthFail, anyAuditFail, anyValFail, anyTryFail, anyIdempFail,
    handlers: muts,
    mwAuth: r.mwAuth,
  });
}

console.log('Total route.ts:', results.length);
console.log('Mutation routes:', mutationRoutes);
console.log('AUTH fails:', authFails);
console.log('AUDIT fails:', auditFails);
console.log('VALIDATION fails:', validationFails);
console.log('TRY/CATCH fails:', tryFails);
console.log('IDEMPOTENCY fails:', idempFails);
console.log('\nDomain breakdown (total / pass-rate each check):');
const sorted = Array.from(domainRoll.entries()).sort((a, b) => b[1].total - a[1].total);
for (const [d, s] of sorted) {
  const pct = (n) => `${((n / s.total) * 100).toFixed(0)}%`;
  console.log(`  ${d.padEnd(24)} total=${s.total.toString().padStart(3)} auth=${pct(s.auth)} audit=${pct(s.audit)} val=${pct(s.val)} try=${pct(s.tryc)} allpass=${pct(s.pass)}`);
}

fs.writeFileSync('scripts/_mutation_safety_domains.json', JSON.stringify(Array.from(domainRoll.entries()), null, 2));
fs.writeFileSync('scripts/_mutation_safety_fileroll.json', JSON.stringify(fileRoll, null, 2));
