// Throwaway audit coverage scanner (A5). Reads only; writes JSON to /tmp.
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

const results = [];
const mutRe = /export\s+(?:async\s+)?function\s+(POST|PATCH|PUT|DELETE)\b/g;
const getRe = /export\s+(?:async\s+)?function\s+GET\b/;
const auditImportRe =
  /from\s+['"]@\/lib\/audit['"]|from\s+['"](?:\.\.\/)+lib\/audit['"]/;
// Call of audit/logAudit/auditBuilder as a function
const auditCallRe = /\b(audit|logAudit|auditBuilder)\s*\(/;

for (const f of routes) {
  const content = fs.readFileSync(f, 'utf8');
  const methods = new Set();
  let m;
  const mutClone = new RegExp(mutRe.source, 'g');
  while ((m = mutClone.exec(content)) !== null) methods.add(m[1]);
  const hasGet = getRe.test(content);
  const hasAuditImport = auditImportRe.test(content);
  const hasAuditCall = auditCallRe.test(content);
  results.push({
    file: f.replaceAll('\\', '/'),
    mutations: Array.from(methods).sort(),
    hasGet,
    hasAuditImport,
    hasAuditCall,
  });
}

fs.writeFileSync('scripts/_audit_scan.json', JSON.stringify(results, null, 2));

const mutRoutes = results.filter((r) => r.mutations.length > 0);
const readOnly = results.filter((r) => r.mutations.length === 0);
const covered = mutRoutes.filter((r) => r.hasAuditImport && r.hasAuditCall);
const notCovered = mutRoutes.filter((r) => !(r.hasAuditImport && r.hasAuditCall));

console.log('Total route.ts:', results.length);
console.log('Mutation routes:', mutRoutes.length);
console.log('Covered (import + call):', covered.length);
console.log('Not covered:', notCovered.length);
console.log('Read-only / skip:', readOnly.length);
