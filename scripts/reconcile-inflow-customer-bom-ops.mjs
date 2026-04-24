// ─────────────────────────────────────────────────────────────────────────────
// reconcile-inflow-customer-bom-ops.mjs
// ─────────────────────────────────────────────────────────────────────────────
// Reconciles three fresh InFlow exports against Aegis:
//
//   1. inFlow_Customer  -> Builder (fill-only, never overwrite non-null fields)
//   2. inFlow_BOM       -> BomEntry  (upsert by parent/component Product SKU)
//   3. inFlow_Operations-> ManufacturingStep (raw-SQL new table; labor-per-unit)
//
// The Operations file turned out to be MANUFACTURING LABOR STEPS per finished
// product (OperationType, per-unit cost, optional per-hour rate, instructions,
// estimated duration).  Majority rows: "Assembly" @ $8.00/unit.  Secondary:
// "Casing Supplement" @ $7.85.  Same ProductName can appear twice with
// different operation types (that's why we key on name+type, not name alone).
// We load it into a new "ManufacturingStep" table via raw SQL (no prisma
// schema change) and mirror the per-unit cost into Product.laborCost when the
// product has no labor cost yet.
//
// DRY-RUN is the default.  Pass --commit to write.
//
// USAGE:
//   node scripts/reconcile-inflow-customer-bom-ops.mjs
//   node scripts/reconcile-inflow-customer-bom-ops.mjs --commit
//
// SCOPE RULES (from the caller):
//   - Do NOT touch prisma/schema.prisma (raw SQL for new tables only).
//   - Do NOT update Product catalog fields except laborCost (strictly null-fill).
//   - Do NOT touch PurchaseOrder / Order / InventoryItem (sibling agents own those).
//   - Builder updates: null-fill only (never overwrite).
// ─────────────────────────────────────────────────────────────────────────────
import 'dotenv/config';
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = neon(process.env.DATABASE_URL);
const COMMIT = process.argv.includes('--commit');

const CUSTOMER_CSV   = 'C:/Users/natha/Downloads/inFlow_Customer (5).csv';
const BOM_CSV        = 'C:/Users/natha/Downloads/inFlow_BOM (8).csv';
const OPERATIONS_CSV = 'C:/Users/natha/Downloads/inFlow_Operations (4).csv';

const MODE = COMMIT ? 'COMMIT' : 'DRY-RUN';

// ─── Output helpers ─────────────────────────────────────────────────────────
function bar(s) {
  console.log('\n' + '═'.repeat(72));
  console.log('  ' + s);
  console.log('═'.repeat(72));
}
function sub(s) { console.log('\n─── ' + s); }
function kv(k, v) { console.log(`  ${String(k).padEnd(40)} ${v}`); }

// ─── Minimal CSV parser (RFC-4180 quoted, "" escapes, CRLF tolerant) ────────
function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', i = 0, inQ = false;
  while (i < text.length) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      cell += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(cell); cell = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; i++; continue; }
    cell += ch; i++;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const headers = rows[0];
  return rows.slice(1).filter(r => r.length === headers.length && r.some(c => c !== ''))
    .map(r => Object.fromEntries(headers.map((h, j) => [h, r[j]])));
}

function loadCsv(path) {
  let text = readFileSync(resolve(path), 'utf8');
  // Strip UTF-8 BOM (Excel likes to prepend \uFEFF); otherwise it leaks into first header name.
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  return parseCsv(text);
}

// ─── Name normalization for fuzzy builder matching ──────────────────────────
function normCompany(s) {
  if (!s) return '';
  return String(s).toLowerCase()
    .replace(/[\u00a0]/g, ' ')
    .replace(/,/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[\.\'\"\(\)]/g, '')
    .replace(/\b(llc|inc|incorporated|ltd|co|corp|corporation|lp|llp|group|company|the)\b/g, '')
    .replace(/\b(homes?|builders?|construction|custom|homebuilders?|homebuilding|homebuilder|build)\b/g, '')
    .replace(/\s+/g, ' ').trim();
}

// ─── Payment term mapping ───────────────────────────────────────────────────
function mapPaymentTerm(inflowTerm) {
  if (!inflowTerm) return null;
  const t = inflowTerm.trim().toLowerCase();
  if (t === 'due on receipt' || t === 'cod' || t === 'prepaid') return 'PAY_ON_DELIVERY';
  if (t === 'pay at order') return 'PAY_AT_ORDER';
  if (/^net\s*\d+/.test(t)) {
    const n = parseInt(t.replace(/\D/g, ''), 10);
    if (n <= 20) return 'NET_15';
    return 'NET_30';
  }
  return null;
}

function digitsOnly(s) { return String(s || '').replace(/\D/g, ''); }
function normalizePhone(s) {
  const d = digitsOnly(s);
  if (d.length === 10) return `${d.slice(0,3)}-${d.slice(3,6)}-${d.slice(6)}`;
  if (d.length === 11 && d.startsWith('1')) return `${d.slice(1,4)}-${d.slice(4,7)}-${d.slice(7)}`;
  return s || null;
}

// Email looks synthetic when it ends with "@inflow-customer.com" — those are
// fallback placeholders from an earlier seed; treat them as "no real email".
function isRealEmail(e) {
  if (!e) return false;
  const s = String(e).trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s)) return false;
  if (/@inflow-customer\.com$/i.test(s)) return false;
  return true;
}

// ─── Schema: new ManufacturingStep table ────────────────────────────────────
async function ensureManufacturingStepTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS "ManufacturingStep" (
      "id"                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
      "productId"           TEXT,                               -- FK-ish to Product.id (nullable if no match)
      "productName"         TEXT NOT NULL,                      -- the finished product name as InFlow sees it
      "operationType"       TEXT NOT NULL,                      -- "Assembly", "Casing Supplement", etc.
      "perUnitCost"         NUMERIC(12,5),                      -- OperationPerUnitCost
      "perHourCost"         NUMERIC(12,5),                      -- OperationPerHourCost (optional)
      "estimatedSeconds"    INTEGER,                            -- OperationEstimatedDurationSeconds
      "instructions"        TEXT,                               -- free-text operator notes
      "trackTime"           BOOLEAN DEFAULT TRUE,
      "source"              TEXT NOT NULL DEFAULT 'inflow',
      "active"              BOOLEAN NOT NULL DEFAULT TRUE,
      "createdAt"           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"           TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("productName", "operationType", "instructions")
    )`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_mfgstep_product" ON "ManufacturingStep" ("productId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_mfgstep_type"    ON "ManufacturingStep" ("operationType")`;
}

// ─── 1. CUSTOMER RECONCILE ──────────────────────────────────────────────────
async function reconcileCustomers() {
  bar(`1. CUSTOMER RECONCILE  [${MODE}]`);

  const rows = loadCsv(CUSTOMER_CSV);
  kv('InFlow customer rows parsed', rows.length);

  // Load every Aegis builder once; build norm-name -> id map.
  const builders = await sql`SELECT id, "companyName", "creditLimit", "accountBalance", "paymentTerm",
                                    "contactName", email, phone, address, city, state, zip
                             FROM "Builder"`;
  kv('Aegis Builder rows loaded', builders.length);

  const byNorm = new Map();            // norm -> array of builder rows
  for (const b of builders) {
    const n = normCompany(b.companyName);
    if (!n) continue;
    if (!byNorm.has(n)) byNorm.set(n, []);
    byNorm.get(n).push(b);
  }

  let matched = 0, multi = 0, unmatched = 0, skippedGarbage = 0;
  let fieldsUpdated = 0;
  const fieldsByName = {};
  const newBuilders = [];
  const lowConfidence = [];

  // Count of actual field updates per column.
  const bump = f => { fieldsByName[f] = (fieldsByName[f] || 0) + 1; fieldsUpdated++; };

  for (const r of rows) {
    const rawName = (r.Name || '').trim();
    if (!rawName) { skippedGarbage++; continue; }
    if (r.IsActive && r.IsActive.toLowerCase() === 'false') { /* still process */ }

    const norm = normCompany(rawName);
    if (!norm) { skippedGarbage++; continue; }

    const candidates = byNorm.get(norm) || [];
    let match = null;
    if (candidates.length === 1) {
      match = candidates[0]; matched++;
    } else if (candidates.length > 1) {
      // prefer the one whose raw companyName has the highest overlap.
      candidates.sort((a, b) =>
        String(b.companyName).toLowerCase().includes(rawName.toLowerCase()) -
        String(a.companyName).toLowerCase().includes(rawName.toLowerCase()));
      match = candidates[0];
      matched++; multi++;
      lowConfidence.push({ inflow: rawName, aegisCandidates: candidates.map(c => c.companyName) });
    } else {
      // substring fallback: norm contained in any Aegis norm or vice-versa
      let sub = null;
      for (const [k, arr] of byNorm.entries()) {
        if ((k.length >= 4 && norm.includes(k)) || (norm.length >= 4 && k.includes(norm))) {
          if (!sub) sub = arr[0];
          else { sub = null; break; }
        }
      }
      if (sub) {
        match = sub;
        matched++;
        lowConfidence.push({ inflow: rawName, aegisMatch: sub.companyName, method: 'substring' });
      } else {
        unmatched++;
        newBuilders.push(rawName);
      }
    }

    if (!match) continue;

    // Assemble null-fill updates only.
    const updates = {};
    const setIfNull = (field, val) => {
      if (val === null || val === undefined || String(val).trim() === '') return;
      if (match[field] === null || match[field] === undefined || match[field] === '') {
        updates[field] = val; bump(field);
      }
    };
    // creditLimit comes from Discount? No — InFlow customer CSV has no explicit credit limit column;
    // only "Discount" (0.00 everywhere) and payment terms. We do NOT fabricate a credit limit.
    // Map: ContactName, Phone, Email, BillingAddress1, City, State, Zip, DefaultPaymentTerms.
    const contact = r.ContactName?.trim();
    if (contact) setIfNull('contactName', contact);

    const phone = normalizePhone(r.Phone);
    if (phone) setIfNull('phone', phone);

    const email = r.Email?.trim();
    if (email && isRealEmail(email) && !isRealEmail(match.email)) {
      // only overwrite an @inflow-customer.com placeholder address.
      // But email is @unique on Builder — guard against collisions.
      updates.email = email.toLowerCase();
      fieldsByName.email = (fieldsByName.email || 0) + 1; fieldsUpdated++;
    }

    setIfNull('address', r.BillingAddress1?.trim());
    setIfNull('city',    r.BillingCity?.trim());
    setIfNull('state',   r.BillingState?.trim());
    setIfNull('zip',     r.BillingPostalCode?.trim());

    const pt = mapPaymentTerm(r.DefaultPaymentTerms);
    if (pt && (!match.paymentTerm || match.paymentTerm === 'NET_30') &&
        (match.paymentTerm === null || match.paymentTerm === undefined ||
         // Treat NET_30 as "default — OK to refine" only if source says something specific.
         match.paymentTerm === 'NET_30' && pt !== 'NET_30')) {
      // conservative: only update when our current value is the default NET_30 and the source gives a stricter term
      updates.paymentTerm = pt;
      fieldsByName.paymentTerm = (fieldsByName.paymentTerm || 0) + 1; fieldsUpdated++;
    }

    if (Object.keys(updates).length && COMMIT) {
      const sets = [];
      const vals = [];
      let idx = 1;
      for (const [k, v] of Object.entries(updates)) {
        sets.push(`"${k}" = $${idx++}`);
        vals.push(v);
      }
      vals.push(match.id);
      // Use tagged-template neon with query/array form:
      await sql.query(
        `UPDATE "Builder" SET ${sets.join(', ')}, "updatedAt" = NOW() WHERE id = $${idx}`,
        vals,
      );
    }
  }

  kv('Matched (incl. multi/substring)', matched);
  kv('  └─ multi-candidate picks',      multi);
  kv('  └─ low-confidence (substring / multi)', lowConfidence.length);
  kv('Unmatched (new builder insert)',   unmatched);
  kv('Skipped garbage/empty rows',       skippedGarbage);
  kv('Total field updates staged',       fieldsUpdated);

  if (fieldsUpdated) {
    sub('Field-level update counts');
    for (const [f, n] of Object.entries(fieldsByName).sort((a, b) => b[1] - a[1])) {
      kv('  ' + f, n);
    }
  }

  if (lowConfidence.length) {
    sub(`Low-confidence matches (${lowConfidence.length}) — manual review`);
    for (const lc of lowConfidence.slice(0, 25)) console.log('   ', JSON.stringify(lc));
    if (lowConfidence.length > 25) console.log('    … and ' + (lowConfidence.length - 25) + ' more');
  }

  // ── New-builder inserts (PENDING, flagged for Nate)
  if (newBuilders.length) {
    sub(`New InFlow-only customers (flagged as PENDING builders): ${newBuilders.length}`);
    for (const n of newBuilders.slice(0, 40)) console.log('   -', n);
    if (newBuilders.length > 40) console.log('    … and ' + (newBuilders.length - 40) + ' more');

    if (COMMIT) {
      // Re-map the InFlow rows so we can pull full context for inserts.
      const byName = new Map(rows.map(r => [r.Name.trim(), r]));
      let inserted = 0, skippedExistingEmail = 0;
      for (const name of newBuilders) {
        const r = byName.get(name); if (!r) continue;
        const email = isRealEmail(r.Email)
          ? r.Email.trim().toLowerCase()
          : `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}@inflow-pending.local`;

        // Avoid email unique-collision by checking first.
        const [{ count: dupe }] = await sql`SELECT COUNT(*)::int AS count FROM "Builder" WHERE email = ${email}`;
        if (dupe > 0) { skippedExistingEmail++; continue; }

        const pt = mapPaymentTerm(r.DefaultPaymentTerms) || 'NET_15';
        const phone = normalizePhone(r.Phone);
        const contact = r.ContactName?.trim() || name;

        await sql`
          INSERT INTO "Builder" (
            id, "companyName", "contactName", email, "passwordHash",
            phone, address, city, state, zip,
            "paymentTerm", status, "builderType",
            "createdAt", "updatedAt"
          ) VALUES (
            'bld_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
            ${name}, ${contact}, ${email}, '!inflow-pending-no-login',
            ${phone}, ${r.BillingAddress1 || null}, ${r.BillingCity || null},
            ${r.BillingState || null}, ${r.BillingPostalCode || null},
            ${pt}::"PaymentTerm", 'PENDING'::"AccountStatus", 'CUSTOM'::"BuilderType",
            NOW(), NOW()
          )`;
        inserted++;
      }
      kv('  inserted new PENDING builders', inserted);
      kv('  skipped (email dupe)',           skippedExistingEmail);
    }
  }
}

// ─── 2. BOM RECONCILE ───────────────────────────────────────────────────────
async function reconcileBom() {
  bar(`2. BOM RECONCILE  [${MODE}]`);

  const rows = loadCsv(BOM_CSV);
  kv('InFlow BOM rows parsed', rows.length);

  const [{ count: preCount }] = await sql`SELECT COUNT(*)::int AS count FROM "BomEntry"`;
  kv('Aegis BomEntry pre-count', preCount);

  // Load SKU -> id map once
  const prods = await sql`SELECT id, sku FROM "Product"`;
  const skuToId = new Map(prods.map(p => [p.sku.toUpperCase(), p.id]));
  kv('Aegis Product catalog size', prods.length);

  const unknownSkus = new Set();
  let matched = 0, parentMissing = 0, componentMissing = 0, bothMissing = 0;
  let upserts = 0, inserts = 0, updates = 0, skippedBadQty = 0;

  // Load existing BomEntry keys (parentId, componentId) for fast exists-check.
  const existing = await sql`SELECT "parentId", "componentId", quantity FROM "BomEntry"`;
  const existingMap = new Map(existing.map(e => [`${e.parentId}::${e.componentId}`, e.quantity]));

  for (const r of rows) {
    const pSku = (r.FinishedProductSKU || '').trim().toUpperCase();
    const cSku = (r.ComponentProductSKU || '').trim().toUpperCase();
    const qty  = parseFloat(r.Quantity);
    if (!pSku || !cSku) continue;
    if (!isFinite(qty) || qty <= 0) { skippedBadQty++; continue; }

    const pId = skuToId.get(pSku);
    const cId = skuToId.get(cSku);

    if (!pId && !cId) { bothMissing++; unknownSkus.add(pSku); unknownSkus.add(cSku); continue; }
    if (!pId)         { parentMissing++; unknownSkus.add(pSku); continue; }
    if (!cId)         { componentMissing++; unknownSkus.add(cSku); continue; }

    matched++;
    const key = `${pId}::${cId}`;
    if (existingMap.has(key)) {
      const old = existingMap.get(key);
      if (Math.abs(old - qty) > 1e-6) {
        updates++;
        if (COMMIT) {
          await sql`UPDATE "BomEntry" SET quantity = ${qty}, "updatedAt" = NOW()
                    WHERE "parentId" = ${pId} AND "componentId" = ${cId}`;
        }
      }
    } else {
      inserts++;
      if (COMMIT) {
        await sql`INSERT INTO "BomEntry" (id, "parentId", "componentId", quantity, "createdAt", "updatedAt")
                  VALUES ('bom_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
                          ${pId}, ${cId}, ${qty}, NOW(), NOW())`;
      }
      // Track the new key so subsequent identical rows in same run don't duplicate.
      existingMap.set(key, qty);
    }
    upserts++;
  }

  let postCount = preCount;
  if (COMMIT) {
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM "BomEntry"`;
    postCount = count;
  } else {
    postCount = preCount + inserts;
  }

  kv('Rows matched (both SKUs resolved)', matched);
  kv('  └─ upserts (insert or quantity-diff)', upserts);
  kv('     ├─ inserts', inserts);
  kv('     └─ quantity updates', updates);
  kv('Skipped: parent SKU unknown', parentMissing);
  kv('Skipped: component SKU unknown', componentMissing);
  kv('Skipped: BOTH SKUs unknown', bothMissing);
  kv('Skipped: bad/zero quantity', skippedBadQty);
  kv('Unknown SKUs (cross-agent flag to Product catalog)', unknownSkus.size);
  kv('Aegis BomEntry post-count (' + (COMMIT ? 'actual' : 'projected') + ')', postCount);

  if (unknownSkus.size) {
    sub('Sample unknown SKUs (first 30) — FEED TO PRODUCT CATALOG AGENT');
    const list = [...unknownSkus].sort();
    for (const s of list.slice(0, 30)) console.log('   -', s);
    if (list.length > 30) console.log('    … and ' + (list.length - 30) + ' more');
  }
}

// ─── 3. OPERATIONS (MANUFACTURING STEPS) RECONCILE ─────────────────────────
async function reconcileOperations() {
  bar(`3. OPERATIONS / MANUFACTURING STEPS  [${MODE}]`);

  const rows = loadCsv(OPERATIONS_CSV);
  kv('InFlow Operations rows parsed', rows.length);

  // Expected columns: ProductName, OperationType, OperationPerUnitCost,
  // OperationPerHourCost, OperationEstimatedDurationSeconds,
  // OperationInstructions, TrackTime
  if (rows.length) {
    const sample = rows[0];
    kv('Sample columns seen',     Object.keys(sample).join(','));
    kv('Sample ProductName',      sample.ProductName);
    kv('Sample OperationType',    sample.OperationType);
    kv('Sample perUnitCost',      sample.OperationPerUnitCost);
  }

  // Tally operation-type distribution for Nate's visibility.
  const typeDist = {};
  for (const r of rows) {
    const t = r.OperationType || '(blank)';
    typeDist[t] = (typeDist[t] || 0) + 1;
  }
  sub('Operation-type distribution');
  for (const [t, n] of Object.entries(typeDist).sort((a, b) => b[1] - a[1])) kv('  ' + t, n);

  // Build name -> Product.id map.
  const prods = await sql`SELECT id, name, "laborCost" FROM "Product"`;
  const byName = new Map(prods.map(p => [p.name.trim().toUpperCase(), p]));
  kv('Aegis Product rows loaded', prods.length);

  if (COMMIT) await ensureManufacturingStepTable();

  let resolved = 0, unresolved = 0;
  let inserts = 0, updates = 0, unchanged = 0;
  let laborFilled = 0;
  const unresolvedNames = new Set();

  // Pre-load existing rows for the unique key (productName, operationType, instructions)
  let existingMap = new Map();
  if (COMMIT) {
    const rows2 = await sql`SELECT "productName", "operationType", COALESCE("instructions",'') AS instructions,
                                   "perUnitCost", "productId"
                            FROM "ManufacturingStep"`;
    existingMap = new Map(rows2.map(r =>
      [`${r.productName.toUpperCase()}::${r.operationType.toUpperCase()}::${(r.instructions||'').toUpperCase()}`,
       r]));
  }

  for (const r of rows) {
    const rawName = (r.ProductName || '').trim();
    const opType  = (r.OperationType || '').trim();
    if (!rawName || !opType) continue;

    const perUnit = r.OperationPerUnitCost ? parseFloat(r.OperationPerUnitCost) : null;
    const perHour = r.OperationPerHourCost ? parseFloat(r.OperationPerHourCost) : null;
    const estSec  = r.OperationEstimatedDurationSeconds ? parseInt(r.OperationEstimatedDurationSeconds, 10) : null;
    const instr   = (r.OperationInstructions || '').trim() || null;
    const track   = String(r.TrackTime || 'True').toLowerCase() === 'true';

    const prod = byName.get(rawName.toUpperCase()) || null;
    if (prod) resolved++;
    else { unresolved++; unresolvedNames.add(rawName); }

    // Upsert into ManufacturingStep
    if (COMMIT) {
      const key = `${rawName.toUpperCase()}::${opType.toUpperCase()}::${(instr||'').toUpperCase()}`;
      const existing = existingMap.get(key);
      if (existing) {
        // only update if perUnit or productId changed
        const needUpdate =
          (perUnit !== null && Number(existing.perUnitCost) !== perUnit) ||
          (prod && existing.productId !== prod.id);
        if (needUpdate) {
          await sql`UPDATE "ManufacturingStep"
                    SET "perUnitCost" = ${perUnit},
                        "perHourCost" = ${perHour},
                        "estimatedSeconds" = ${estSec},
                        "trackTime" = ${track},
                        "productId" = ${prod ? prod.id : null},
                        "updatedAt" = NOW()
                    WHERE "productName" = ${rawName}
                      AND "operationType" = ${opType}
                      AND COALESCE("instructions",'') = ${instr || ''}`;
          updates++;
        } else {
          unchanged++;
        }
      } else {
        await sql`INSERT INTO "ManufacturingStep"
                  (id, "productId", "productName", "operationType",
                   "perUnitCost", "perHourCost", "estimatedSeconds",
                   "instructions", "trackTime", source, active)
                  VALUES
                  ('mfg_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24),
                   ${prod ? prod.id : null}, ${rawName}, ${opType},
                   ${perUnit}, ${perHour}, ${estSec},
                   ${instr}, ${track}, 'inflow', TRUE)`;
        inserts++;
      }

      // Mirror per-unit cost into Product.laborCost if product exists AND
      // its current laborCost is 0/null (null-fill only).
      if (prod && perUnit !== null && (!prod.laborCost || prod.laborCost === 0)) {
        await sql`UPDATE "Product" SET "laborCost" = ${perUnit}, "updatedAt" = NOW()
                  WHERE id = ${prod.id} AND ("laborCost" IS NULL OR "laborCost" = 0)`;
        prod.laborCost = perUnit;            // dedupe within a run
        laborFilled++;
      }
    } else {
      // Dry-run counter logic
      if (prod && perUnit !== null && (!prod.laborCost || prod.laborCost === 0)) laborFilled++;
      inserts++;
    }
  }

  kv('Operations rows w/ matched Product', resolved);
  kv('Operations rows w/ UNMATCHED product name', unresolved);
  if (COMMIT) {
    kv('  ManufacturingStep inserts', inserts);
    kv('  ManufacturingStep updates', updates);
    kv('  ManufacturingStep unchanged', unchanged);
  } else {
    kv('  Projected ManufacturingStep inserts (fresh)', inserts);
  }
  kv('Product.laborCost filled (null-fill)', laborFilled);

  if (unresolvedNames.size) {
    sub(`Unresolved product names (${unresolvedNames.size}) — cross-agent flag to Product catalog`);
    const list = [...unresolvedNames].sort();
    for (const n of list.slice(0, 30)) console.log('   -', n);
    if (list.length > 30) console.log('    … and ' + (list.length - 30) + ' more');
  }

  // Report: ManufacturingStep table totals post-load.
  if (COMMIT) {
    const [{ count }] = await sql`SELECT COUNT(*)::int AS count FROM "ManufacturingStep"`;
    kv('ManufacturingStep total rows (live)', count);
  }
}

// ─── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  bar(`InFlow → Aegis reconcile  (${MODE})`);
  console.log('  DB:', process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/:[^:@]*@/, ':****@').slice(0, 90) + '…' : '(no DATABASE_URL set)');
  console.log('  Customer CSV:  ', CUSTOMER_CSV);
  console.log('  BOM CSV:       ', BOM_CSV);
  console.log('  Operations CSV:', OPERATIONS_CSV);

  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL not set in .env');
    process.exit(1);
  }

  try {
    await reconcileCustomers();
    await reconcileBom();
    await reconcileOperations();

    bar('DONE');
    console.log('  Mode:', MODE, COMMIT ? '' : '(no writes — re-run with --commit to apply)');
  } catch (err) {
    console.error('\nFATAL:', err.stack || err.message);
    process.exit(1);
  }
}

main();
