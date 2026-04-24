// Ingest the 10 NUC brain_extract JSONL knowledge files into Aegis.
//
// Source:
//   ../NUC_CLUSTER/brain_extract/
//     banking.jsonl   → BankEntry (raw SQL, one row per entry)
//     calendar.jsonl  → CalendarEvent (raw SQL, one row per event)
//     crm.jsonl       → Deal upsert + InboxItem for cleanup actions
//     customers.jsonl → Builder fill-gaps-only + BuilderContact merge
//     financials.jsonl→ FinancialSnapshot (one-per-snapshotDate, history row)
//                       + InboxItem for yellow/red health entries
//     legal.jsonl     → LegalNote (raw SQL, one row per entry)
//     operations.jsonl→ InboxItem (type OPERATIONS_INSIGHT, one per entry)
//     prospects.jsonl → Deal upsert with stage=PROSPECT
//     team.jsonl      → Staff fill-gaps-only (title/phone/salary/hireDate only)
//     vendors.jsonl   → Vendor fill-gaps-only + VendorNote (raw SQL)
//
// All loaders are idempotent — safe to re-run. Dry-run by default.
//
//   node scripts/ingest-brain-extract.mjs            # dry run (default)
//   node scripts/ingest-brain-extract.mjs --commit   # apply changes
//
// Design principle: brain_extract is historical analysis; Aegis holds
// canonical live state. We ADD data, we don't OVERWRITE. Every upsert
// only fills NULL/empty columns — existing non-null values are preserved.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { neon } from '@neondatabase/serverless';

const __filename = fileURLToPath(import.meta.url);
const SCRIPTS_DIR = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(SCRIPTS_DIR, '..');
const ABEL_FOLDER = path.resolve(PROJECT_ROOT, '..');
const BRAIN_EXTRACT_DIR = path.join(ABEL_FOLDER, 'NUC_CLUSTER', 'brain_extract');

dotenv.config({ path: path.join(PROJECT_ROOT, '.env') });

const COMMIT = process.argv.includes('--commit');
const sql = neon(process.env.DATABASE_URL);

// ─── utilities ───────────────────────────────────────────────────────────

function bar(t) {
  console.log('\n' + '='.repeat(72));
  console.log('  ' + t);
  console.log('='.repeat(72));
}

function readJsonl(file) {
  const p = path.join(BRAIN_EXTRACT_DIR, file);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf-8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .map(l => {
      try { return JSON.parse(l); } catch (e) {
        console.warn('  [WARN] bad JSON line in', file);
        return null;
      }
    })
    .filter(Boolean);
}

function md5(s) { return crypto.createHash('md5').update(String(s)).digest('hex'); }
function idFor(prefix, key) { return `${prefix}_${md5(key).slice(0, 20)}`; }

function parseDateSafe(v) {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

// Normalize a builder company name to match Aegis canonical naming.
// Brookfield Residential → Brookfield Homes (already exists in DB).
function normalizeBuilderName(raw) {
  const s = (raw || '').trim();
  const m = s.toLowerCase();
  if (m.includes('brookfield')) return 'Brookfield Homes';
  if (m.includes('toll brothers')) return 'Toll Brothers';
  if (m.includes('pulte') || m.includes('centex') || m.includes('del webb')) return 'Pulte Homes';
  if (m.includes('bloomfield')) return 'Bloomfield Homes';
  if (m.includes('shaddock')) return 'Shaddock Homes';
  if (m.includes('cross custom')) return 'Cross Custom Homes';
  if (m.includes('first texas')) return 'First Texas Homes';
  if (m.includes('drees')) return 'Drees Homes';
  if (m.includes('ron davis')) return 'Ron Davis Custom Homes';
  if (m.includes('olerio')) return 'Olerio Homes';
  if (m.includes('lennar')) return 'Lennar';
  return s;
}

// Find first builder row whose companyName matches the normalized name.
async function findBuilderId(name) {
  const normalized = normalizeBuilderName(name);
  const r = await sql`
    SELECT id, "companyName" FROM "Builder"
    WHERE LOWER("companyName") = LOWER(${normalized}) LIMIT 1
  `;
  if (r[0]) return r[0];
  const like = await sql`
    SELECT id, "companyName" FROM "Builder"
    WHERE LOWER("companyName") LIKE ${'%' + normalized.toLowerCase() + '%'} LIMIT 1
  `;
  return like[0] || null;
}

// Match a staff row for the contact that owns a Deal. Owner must be
// a real Staff row (FK). Default to Dalton (BizDev) if unresolved.
let _defaultDealOwnerId = null;
async function defaultDealOwnerId() {
  if (_defaultDealOwnerId) return _defaultDealOwnerId;
  const r = await sql`
    SELECT id FROM "Staff"
    WHERE LOWER("firstName") = 'dalton' AND LOWER("lastName") = 'whatley'
    ORDER BY (salary IS NULL) ASC LIMIT 1
  `;
  if (r[0]) { _defaultDealOwnerId = r[0].id; return r[0].id; }
  const n = await sql`
    SELECT id FROM "Staff" WHERE LOWER(email) = 'n.barrett@abellumber.com' LIMIT 1
  `;
  _defaultDealOwnerId = n[0]?.id || null;
  return _defaultDealOwnerId;
}

// ─── schema bootstrap (raw SQL, additive only) ───────────────────────────
//
// New tables created here do NOT appear in prisma/schema.prisma. Flag them
// for a future Prisma sync step (see final report output).

async function ensureSchema() {
  // BankEntry — one row per banking.jsonl entry (relationship-level notes,
  // NOT transactions). Dedupe by externalId.
  await sql`
    CREATE TABLE IF NOT EXISTS "BankEntry" (
      "id"           TEXT PRIMARY KEY,
      "externalId"   TEXT UNIQUE NOT NULL,
      "title"        TEXT NOT NULL,
      "content"      TEXT,
      "bankName"     TEXT,
      "health"       TEXT,
      "source"       TEXT,
      "tags"         TEXT[],
      "contacts"     JSONB,
      "nextAction"   TEXT,
      "sourceTs"     DATE,
      "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_bankentry_ext" ON "BankEntry"("externalId")`;

  // CalendarEvent — one row per calendar.jsonl entry.
  await sql`
    CREATE TABLE IF NOT EXISTS "CalendarEvent" (
      "id"           TEXT PRIMARY KEY,
      "externalId"   TEXT UNIQUE NOT NULL,
      "title"        TEXT NOT NULL,
      "content"      TEXT,
      "eventDate"    DATE,
      "status"       TEXT,
      "priority"     TEXT,
      "recurrence"   TEXT,
      "source"       TEXT,
      "tags"         TEXT[],
      "sourceTs"     DATE,
      "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_calevent_date" ON "CalendarEvent"("eventDate")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_calevent_ext" ON "CalendarEvent"("externalId")`;

  // LegalNote — one row per legal.jsonl entry.
  await sql`
    CREATE TABLE IF NOT EXISTS "LegalNote" (
      "id"           TEXT PRIMARY KEY,
      "externalId"   TEXT UNIQUE NOT NULL,
      "title"        TEXT NOT NULL,
      "content"      TEXT,
      "matter"       TEXT,
      "status"       TEXT,
      "nextAction"   TEXT,
      "contacts"     JSONB,
      "tags"         TEXT[],
      "source"       TEXT,
      "sourceTs"     DATE,
      "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_legalnote_ext" ON "LegalNote"("externalId")`;

  // VendorNote — relationship-level notes keyed to a Vendor row.
  await sql`
    CREATE TABLE IF NOT EXISTS "VendorNote" (
      "id"           TEXT PRIMARY KEY,
      "externalId"   TEXT UNIQUE NOT NULL,
      "vendorId"     TEXT,
      "title"        TEXT NOT NULL,
      "content"      TEXT,
      "health"       TEXT,
      "nextAction"   TEXT,
      "contacts"     JSONB,
      "tags"         TEXT[],
      "source"       TEXT,
      "sourceTs"     DATE,
      "createdAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt"    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `;
  await sql`CREATE INDEX IF NOT EXISTS "idx_vendornote_vendor" ON "VendorNote"("vendorId")`;
  await sql`CREATE INDEX IF NOT EXISTS "idx_vendornote_ext" ON "VendorNote"("externalId")`;
}

// ─── per-file loaders ─────────────────────────────────────────────────────
// Each returns { file, model, loaded, skipped, errors, notes[] }

async function loadBanking() {
  const rows = readJsonl('banking.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      const extId = r.id;
      const existing = await sql`SELECT id FROM "BankEntry" WHERE "externalId" = ${extId} LIMIT 1`;
      if (existing[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      await sql`
        INSERT INTO "BankEntry" (
          "id","externalId","title","content","bankName","health","source",
          "tags","contacts","nextAction","sourceTs","createdAt","updatedAt"
        ) VALUES (
          ${idFor('bank', extId)}, ${extId}, ${r.title || ''},
          ${r.content || null},
          ${r.tags?.includes('primary') ? 'Hancock Whitney'
            : r.tags?.includes('secondary') ? 'First Bank & Trust'
            : r.tags?.includes('boise') ? 'Boise Cascade (trade credit)'
            : null},
          ${r.health || null}, ${r.source || null}, ${r.tags || []},
          ${r.contacts ? JSON.stringify(r.contacts) : null},
          ${r.next_action || null}, ${parseDateSafe(r.ts)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("externalId") DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] banking', r.id, e.message); }
  }
  return { file: 'banking.jsonl', model: 'BankEntry (new)', loaded, skipped, errors };
}

async function loadCalendar() {
  const rows = readJsonl('calendar.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      const extId = r.id;
      const existing = await sql`SELECT id FROM "CalendarEvent" WHERE "externalId" = ${extId} LIMIT 1`;
      if (existing[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      await sql`
        INSERT INTO "CalendarEvent" (
          "id","externalId","title","content","eventDate","status","priority",
          "recurrence","source","tags","sourceTs","createdAt","updatedAt"
        ) VALUES (
          ${idFor('cal', extId)}, ${extId}, ${r.title || ''}, ${r.content || null},
          ${parseDateSafe(r.date)}, ${r.status || null}, ${r.priority || null},
          ${r.recurrence || null}, ${r.source || null}, ${r.tags || []},
          ${parseDateSafe(r.ts)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("externalId") DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] calendar', r.id, e.message); }
  }
  return { file: 'calendar.jsonl', model: 'CalendarEvent (new)', loaded, skipped, errors };
}

async function loadCrm() {
  const rows = readJsonl('crm.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  const ownerId = await defaultDealOwnerId();
  for (const r of rows) {
    try {
      // Only crm.deal_* rows become Deal rows; others are strategic/CRM notes
      // which go to InboxItem so the team sees them in the queue.
      const isDeal = r.id?.startsWith('crm_deal_');
      if (!isDeal) {
        // InboxItem for the cleanup / overview notes
        const inboxId = idFor('inbx_crm', r.id);
        const existing = await sql`SELECT id FROM "InboxItem" WHERE id = ${inboxId} LIMIT 1`;
        if (existing[0]) { skipped++; continue; }
        if (!COMMIT) { loaded++; continue; }
        await sql`
          INSERT INTO "InboxItem" (
            id, type, source, title, description, priority, status, "actionData",
            "createdAt", "updatedAt"
          ) VALUES (
            ${inboxId}, 'CRM_CLEANUP', 'brain-extract',
            ${r.title || r.id},
            ${r.content || null},
            ${(r.priority === 'P0' || r.priority === 'P1') ? 'HIGH' : 'MEDIUM'},
            'PENDING', ${JSON.stringify({ brainExtractId: r.id, tags: r.tags })},
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT (id) DO NOTHING
        `;
        loaded++;
        continue;
      }

      // Deal upsert
      const company = r.title?.replace(/HubSpot Deal\s*—\s*/, '').split(' — ')[0]
                     || r.tags?.[2] || 'Unknown';
      const canonical = normalizeBuilderName(company);
      const builder = await findBuilderId(canonical);
      // Look for an existing Deal by companyName (case-insensitive)
      const existing = await sql`
        SELECT id, "dealNumber", stage FROM "Deal"
        WHERE LOWER("companyName") = LOWER(${canonical}) LIMIT 1
      `;
      if (existing[0]) { skipped++; continue; } // don't overwrite canonical deals

      if (!ownerId) { errors++; continue; }

      // Extract value from the content — "$500K", "$731,149" etc.
      const m = (r.content || '').match(/\$([0-9,]+(?:\.[0-9]+)?)(K|M)?/);
      let dealValue = 0;
      if (m) {
        dealValue = parseFloat(m[1].replace(/,/g, ''));
        if (m[2] === 'K') dealValue *= 1000;
        if (m[2] === 'M') dealValue *= 1_000_000;
      }

      // Stage mapping — CRM notes hint at state.
      const lower = (r.content || '').toLowerCase();
      let stage = 'PROSPECT';
      if (lower.includes('lost') || r.tags?.includes('lost')) stage = 'LOST';
      else if (lower.includes('negotiation')) stage = 'NEGOTIATION';
      else if (lower.includes('contractsent') || lower.includes('contract sent')) stage = 'BID_SUBMITTED';
      else if (lower.includes('qualifiedtobuy') || lower.includes('qualified')) stage = 'BID_REVIEW';
      else if (lower.includes('presentation')) stage = 'WALKTHROUGH';

      if (!COMMIT) { loaded++; continue; }
      const dealNum = `DEAL-BE-${md5(r.id).slice(0, 8).toUpperCase()}`;
      await sql`
        INSERT INTO "Deal" (
          id, "dealNumber", "companyName", "contactName", stage, probability,
          "dealValue", source, "ownerId", "builderId", description, notes,
          ${stage === 'LOST' ? sql`"lostDate", "lostReason",` : sql``}
          "createdAt", "updatedAt"
        ) VALUES (
          ${idFor('deal', r.id)}, ${dealNum}, ${canonical}, 'Imported from brain_extract',
          ${stage}, ${stage === 'LOST' ? 0 : 40}, ${dealValue},
          'INBOUND', ${ownerId}, ${builder?.id || null},
          ${r.title || ''}, ${r.content || null},
          ${stage === 'LOST' ? sql`${new Date('2026-04-20')}, 'Lost per brain_extract import',` : sql``}
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("dealNumber") DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] crm', r.id, e.message); }
  }
  return { file: 'crm.jsonl', model: 'Deal + InboxItem', loaded, skipped, errors };
}

async function loadCustomers() {
  const rows = readJsonl('customers.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      // Customer notes are mostly narrative — we write them to InboxItem
      // as CUSTOMER_CONTEXT for the team, and fill BuilderContact gaps
      // where contact arrays are present.
      const builderName = r.title?.split(' — ')[0] || '';
      const canonical = normalizeBuilderName(builderName);
      const builder = await findBuilderId(canonical);

      // ── BuilderContact fill-gaps-only ────────────────────────────────
      if (builder && Array.isArray(r.contacts)) {
        for (const c of r.contacts) {
          if (!c.email) continue;
          const exists = await sql`
            SELECT id FROM "BuilderContact"
            WHERE "builderId" = ${builder.id} AND LOWER(email) = LOWER(${c.email})
            LIMIT 1
          `;
          if (exists[0]) continue;
          if (!COMMIT) { loaded++; continue; }
          const parts = (c.name || '').trim().split(/\s+/);
          const fn = parts[0] || 'Unknown';
          const ln = parts.slice(1).join(' ') || '';
          const role = (() => {
            const rr = (c.role || '').toLowerCase();
            if (rr.includes('purchasing') || rr.includes('procurement')) return 'PURCHASING';
            if (rr.includes('estimat')) return 'ESTIMATOR';
            if (rr.includes('ap/')) return 'ACCOUNTS_PAYABLE';
            if (rr.includes('owner')) return 'OWNER';
            if (rr.includes('vp')) return 'DIVISION_VP';
            if (rr.includes('superintend') || rr.includes('field')) return 'SUPERINTENDENT';
            if (rr.includes('pm') || rr.includes('project')) return 'PROJECT_MANAGER';
            return 'OTHER';
          })();
          await sql`
            INSERT INTO "BuilderContact" (
              id, "builderId", "firstName", "lastName", email, title, role,
              notes, active, "createdAt", "updatedAt"
            ) VALUES (
              ${idFor('bc_be', builder.id + '|' + c.email)}, ${builder.id}, ${fn}, ${ln},
              ${c.email}, ${c.role || null}, ${role}::\"ContactRole\",
              ${'Imported from brain_extract/customers.jsonl — ' + r.id},
              true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            ON CONFLICT DO NOTHING
          `;
          loaded++;
        }
      }

      // ── InboxItem narrative — once per customer entry ───────────────
      const inboxId = idFor('inbx_cust', r.id);
      const already = await sql`SELECT id FROM "InboxItem" WHERE id = ${inboxId} LIMIT 1`;
      if (already[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      const priority = r.health === 'red' ? 'HIGH'
                     : r.health === 'yellow' ? 'MEDIUM' : 'LOW';
      await sql`
        INSERT INTO "InboxItem" (
          id, type, source, title, description, priority, status,
          "entityType", "entityId", "actionData",
          "createdAt", "updatedAt"
        ) VALUES (
          ${inboxId}, 'CUSTOMER_CONTEXT', 'brain-extract',
          ${r.title || r.id}, ${r.content || null}, ${priority}, 'PENDING',
          ${builder ? 'Builder' : null}, ${builder?.id || null},
          ${JSON.stringify({ brainExtractId: r.id, tags: r.tags, next_action: r.next_action })},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (id) DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] customers', r.id, e.message); }
  }
  return { file: 'customers.jsonl', model: 'BuilderContact + InboxItem', loaded, skipped, errors };
}

async function loadFinancials() {
  const rows = readJsonl('financials.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  // Store each financial narrative as an InboxItem so the team can see them.
  // FinancialSnapshot has a strict shape (numeric buckets) — these entries
  // are narratives, not snapshots, so InboxItem is the right home.
  for (const r of rows) {
    try {
      const inboxId = idFor('inbx_fin', r.id);
      const existing = await sql`SELECT id FROM "InboxItem" WHERE id = ${inboxId} LIMIT 1`;
      if (existing[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      const priority = r.health === 'red' ? 'HIGH'
                     : r.health === 'yellow' ? 'MEDIUM' : 'LOW';
      await sql`
        INSERT INTO "InboxItem" (
          id, type, source, title, description, priority, status, "actionData",
          "createdAt", "updatedAt"
        ) VALUES (
          ${inboxId}, 'FINANCIAL_INSIGHT', 'brain-extract',
          ${r.title || r.id}, ${r.content || null}, ${priority}, 'PENDING',
          ${JSON.stringify({ brainExtractId: r.id, tags: r.tags })},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (id) DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] financials', r.id, e.message); }
  }
  return { file: 'financials.jsonl', model: 'InboxItem (FINANCIAL_INSIGHT)', loaded, skipped, errors };
}

async function loadLegal() {
  const rows = readJsonl('legal.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      const extId = r.id;
      const existing = await sql`SELECT id FROM "LegalNote" WHERE "externalId" = ${extId} LIMIT 1`;
      if (existing[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      await sql`
        INSERT INTO "LegalNote" (
          "id","externalId","title","content","matter","status","nextAction",
          "contacts","tags","source","sourceTs","createdAt","updatedAt"
        ) VALUES (
          ${idFor('legal', extId)}, ${extId}, ${r.title || ''}, ${r.content || null},
          ${r.tags?.[1] || null}, ${r.status || null}, ${r.next_action || null},
          ${r.contacts ? JSON.stringify(r.contacts) : null},
          ${r.tags || []}, ${r.source || null}, ${parseDateSafe(r.ts)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("externalId") DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] legal', r.id, e.message); }
  }
  return { file: 'legal.jsonl', model: 'LegalNote (new)', loaded, skipped, errors };
}

async function loadOperations() {
  const rows = readJsonl('operations.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      const inboxId = idFor('inbx_ops', r.id);
      const existing = await sql`SELECT id FROM "InboxItem" WHERE id = ${inboxId} LIMIT 1`;
      if (existing[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      const priority = r.health === 'red' ? 'HIGH'
                     : r.health === 'yellow' ? 'MEDIUM' : 'LOW';
      await sql`
        INSERT INTO "InboxItem" (
          id, type, source, title, description, priority, status, "actionData",
          "createdAt", "updatedAt"
        ) VALUES (
          ${inboxId}, 'OPERATIONS_INSIGHT', 'brain-extract',
          ${r.title || r.id}, ${r.content || null}, ${priority}, 'PENDING',
          ${JSON.stringify({ brainExtractId: r.id, tags: r.tags, next_action: r.next_action })},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT (id) DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] operations', r.id, e.message); }
  }
  return { file: 'operations.jsonl', model: 'InboxItem (OPERATIONS_INSIGHT)', loaded, skipped, errors };
}

async function loadProspects() {
  const rows = readJsonl('prospects.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  const ownerId = await defaultDealOwnerId();
  for (const r of rows) {
    try {
      // Some prospect rows aren't builder-specific (e.g. sourcing strategy,
      // pipeline strategy) — route those to InboxItem.
      const isCompanyProspect = r.tags?.some(t =>
        /^(bloomfield|first-texas|cross-custom|drees|ron-davis|olerio|first_texas)$/i.test(t)
      );

      if (!isCompanyProspect) {
        const inboxId = idFor('inbx_prosp', r.id);
        const existing = await sql`SELECT id FROM "InboxItem" WHERE id = ${inboxId} LIMIT 1`;
        if (existing[0]) { skipped++; continue; }
        if (!COMMIT) { loaded++; continue; }
        await sql`
          INSERT INTO "InboxItem" (
            id, type, source, title, description, priority, status, "actionData",
            "createdAt", "updatedAt"
          ) VALUES (
            ${inboxId}, 'SALES_STRATEGY', 'brain-extract',
            ${r.title || r.id}, ${r.content || null},
            ${r.priority === 'P0' ? 'HIGH' : 'MEDIUM'}, 'PENDING',
            ${JSON.stringify({ brainExtractId: r.id, tags: r.tags, next_action: r.next_action })},
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
          )
          ON CONFLICT (id) DO NOTHING
        `;
        loaded++;
        continue;
      }

      // Deal upsert (skip if already present)
      const name = r.title?.split(' — ')[0] || '';
      const canonical = normalizeBuilderName(name);
      const builder = await findBuilderId(canonical);
      const existing = await sql`
        SELECT id FROM "Deal" WHERE LOWER("companyName") = LOWER(${canonical}) LIMIT 1
      `;
      if (existing[0]) { skipped++; continue; }
      if (!ownerId) { errors++; continue; }
      if (!COMMIT) { loaded++; continue; }
      const dealNum = `DEAL-BE-${md5(r.id).slice(0, 8).toUpperCase()}`;
      await sql`
        INSERT INTO "Deal" (
          id, "dealNumber", "companyName", "contactName", stage, probability,
          "dealValue", source, "ownerId", "builderId", description, notes,
          "createdAt", "updatedAt"
        ) VALUES (
          ${idFor('deal', r.id)}, ${dealNum}, ${canonical},
          'Imported from brain_extract/prospects.jsonl', 'PROSPECT', 15, 0,
          'OUTBOUND', ${ownerId}, ${builder?.id || null},
          ${r.title || ''}, ${r.content || null},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("dealNumber") DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] prospects', r.id, e.message); }
  }
  return { file: 'prospects.jsonl', model: 'Deal (PROSPECT) + InboxItem', loaded, skipped, errors };
}

async function loadTeam() {
  const rows = readJsonl('team.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      // Parse name out of content — first sentence is "{First Last}. {Role}..."
      const content = r.content || '';
      const nameMatch = content.match(/^([A-Z][\w.'-]+(?:\s+[A-Z][\w.'-]+){1,3})\./);
      const fullName = nameMatch?.[1]?.trim();
      if (!fullName) { skipped++; continue; }
      const parts = fullName.split(/\s+/);
      const fn = parts[0], ln = parts.slice(1).join(' ');

      // Find Staff row — prefer exact first+last match
      const rows2 = await sql`
        SELECT id, "firstName", "lastName", email, title, phone, salary,
               "hireDate", department
        FROM "Staff"
        WHERE LOWER("firstName") = LOWER(${fn}) AND LOWER("lastName") = LOWER(${ln})
        ORDER BY (salary IS NULL) ASC, (title IS NULL) ASC LIMIT 1
      `;
      if (!rows2[0]) {
        // Not found — team.jsonl row like "Warehouse Crew Contact List" isn't
        // a single staff record. Skip without error.
        skipped++;
        continue;
      }

      // Extract fields from narrative content (best-effort)
      const emailM = content.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,})/);
      const phoneM = content.match(/\b(\d{3}[-.\s]\d{3}[-.\s]\d{4})\b/);
      const salaryM = content.match(/\$(\d{2,3})K\b/);
      const titleM = content.match(/\b(CEO|COO|CFO|Owner\/GM|Owner \/ GM|Accounting Manager|Business Development Manager|Customer Experience Manager|Project Manager|Estimator|Purchasing\/Materials|Delivery Logistical Supervisor|Warehouse\/Manufacturing Manager|Sales Lead)\b/);
      const hireM = content.match(/Hired\s+([0-9]{1,2}\/[0-9]{1,2}\/[0-9]{4})/i);

      const patch = {};
      if (!rows2[0].phone && phoneM) patch.phone = phoneM[1];
      if (!rows2[0].title && titleM) patch.title = titleM[1];
      if (!rows2[0].salary && salaryM) patch.salary = parseInt(salaryM[1], 10) * 1000;
      if (!rows2[0].hireDate && hireM) patch.hireDate = parseDateSafe(hireM[1]);

      if (Object.keys(patch).length === 0) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }

      // Build a dynamic UPDATE via individual calls — neon tagged template
      // doesn't support object-spread SET, so use explicit sets.
      if (patch.phone !== undefined) await sql`UPDATE "Staff" SET phone = ${patch.phone} WHERE id = ${rows2[0].id} AND phone IS NULL`;
      if (patch.title !== undefined) await sql`UPDATE "Staff" SET title = ${patch.title} WHERE id = ${rows2[0].id} AND title IS NULL`;
      if (patch.salary !== undefined) await sql`UPDATE "Staff" SET salary = ${patch.salary} WHERE id = ${rows2[0].id} AND salary IS NULL`;
      if (patch.hireDate !== undefined) await sql`UPDATE "Staff" SET "hireDate" = ${patch.hireDate} WHERE id = ${rows2[0].id} AND "hireDate" IS NULL`;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] team', r.id, e.message); }
  }
  return { file: 'team.jsonl', model: 'Staff (fill-gaps-only)', loaded, skipped, errors };
}

async function loadVendors() {
  const rows = readJsonl('vendors.jsonl');
  let loaded = 0, skipped = 0, errors = 0;
  for (const r of rows) {
    try {
      // Infer vendor name from tags or content
      const rawTag = (r.tags || []).find(t =>
        !['vendor', 'primary', 'credit-issue', 'pricing-negotiation',
          'meeting-upcoming', 'current', 'doors', 'hardware', 'schlage',
          'kwikset', 'windows', 'active', 'pending', 'trim', 'past-due',
          'risk', 'inquiry', 'payment-plan', 'payment-required'].includes(t)
      );
      const inferredName = (r.title || '').split(' — ')[0] || rawTag || '';
      const cleaned = inferredName
        .replace(/\s*\([^)]+\)/g, '')
        .split('/')[0]
        .trim();

      // Match in Vendor table (case-insensitive, first word)
      let vendor = null;
      if (cleaned) {
        const first = cleaned.split(/\s+/)[0].toLowerCase();
        const r2 = await sql`
          SELECT id, name FROM "Vendor"
          WHERE LOWER(name) LIKE ${first + '%'}
          ORDER BY length(name) ASC LIMIT 1
        `;
        vendor = r2[0] || null;
      }

      // ── Vendor fill-gaps-only ────────────────────────────────────────
      if (vendor && COMMIT) {
        const vr = await sql`
          SELECT email, phone, "contactName", notes FROM "Vendor" WHERE id = ${vendor.id}
        `;
        const contact0 = (r.contacts || [])[0];
        if (contact0) {
          if (!vr[0].email && contact0.email)
            await sql`UPDATE "Vendor" SET email = ${contact0.email} WHERE id = ${vendor.id} AND email IS NULL`;
          if (!vr[0].phone && contact0.phone)
            await sql`UPDATE "Vendor" SET phone = ${contact0.phone} WHERE id = ${vendor.id} AND phone IS NULL`;
          if (!vr[0].contactName && contact0.name)
            await sql`UPDATE "Vendor" SET "contactName" = ${contact0.name} WHERE id = ${vendor.id} AND "contactName" IS NULL`;
        }
      }

      // ── VendorNote insert ─────────────────────────────────────────────
      const extId = r.id;
      const existing = await sql`SELECT id FROM "VendorNote" WHERE "externalId" = ${extId} LIMIT 1`;
      if (existing[0]) { skipped++; continue; }
      if (!COMMIT) { loaded++; continue; }
      await sql`
        INSERT INTO "VendorNote" (
          "id","externalId","vendorId","title","content","health","nextAction",
          "contacts","tags","source","sourceTs","createdAt","updatedAt"
        ) VALUES (
          ${idFor('vn', extId)}, ${extId}, ${vendor?.id || null},
          ${r.title || ''}, ${r.content || null}, ${r.health || null},
          ${r.next_action || null},
          ${r.contacts ? JSON.stringify(r.contacts) : null},
          ${r.tags || []}, ${r.source || null}, ${parseDateSafe(r.ts)},
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
        ON CONFLICT ("externalId") DO NOTHING
      `;
      loaded++;
    } catch (e) { errors++; console.error('  [ERR] vendors', r.id, e.message); }
  }
  return { file: 'vendors.jsonl', model: 'Vendor (gaps) + VendorNote (new)', loaded, skipped, errors };
}

// ─── main ────────────────────────────────────────────────────────────────

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('FATAL: DATABASE_URL missing from .env');
    process.exit(1);
  }

  bar(`brain_extract → Aegis ingest (${COMMIT ? 'COMMIT' : 'DRY RUN'})`);
  console.log('  source:', BRAIN_EXTRACT_DIR);

  // Schema bootstrap happens in either mode so schema is ready to commit
  // later; CREATE TABLE IF NOT EXISTS is idempotent and cheap.
  await ensureSchema();

  const reports = [];
  reports.push(await loadBanking());
  reports.push(await loadCalendar());
  reports.push(await loadCrm());
  reports.push(await loadCustomers());
  reports.push(await loadFinancials());
  reports.push(await loadLegal());
  reports.push(await loadOperations());
  reports.push(await loadProspects());
  reports.push(await loadTeam());
  reports.push(await loadVendors());

  // ─── final report ──────────────────────────────────────────────────────
  bar('Load report');
  console.log(
    'file'.padEnd(22) +
    'model'.padEnd(40) +
    'loaded'.padStart(8) +
    'skipped'.padStart(10) +
    'errors'.padStart(8)
  );
  console.log('-'.repeat(88));
  let L = 0, S = 0, E = 0;
  for (const r of reports) {
    console.log(
      r.file.padEnd(22) +
      r.model.padEnd(40) +
      String(r.loaded).padStart(8) +
      String(r.skipped).padStart(10) +
      String(r.errors).padStart(8)
    );
    L += r.loaded; S += r.skipped; E += r.errors;
  }
  console.log('-'.repeat(88));
  console.log(
    'TOTAL'.padEnd(62) +
    String(L).padStart(8) +
    String(S).padStart(10) +
    String(E).padStart(8)
  );

  bar('Schema additions (flag for future Prisma sync)');
  console.log('  ALL CREATED BY RAW SQL — not yet in prisma/schema.prisma:');
  console.log('    - BankEntry       (banking relationship notes)');
  console.log('    - CalendarEvent   (Google Calendar snapshot rows)');
  console.log('    - LegalNote       (litigation / contract notes)');
  console.log('    - VendorNote      (vendor relationship notes)');
  console.log('  New InboxItem types introduced (string column — no enum):');
  console.log('    - CRM_CLEANUP, CUSTOMER_CONTEXT, FINANCIAL_INSIGHT,');
  console.log('      OPERATIONS_INSIGHT, SALES_STRATEGY');
  console.log('');
  console.log(`  Mode: ${COMMIT ? 'COMMITTED' : 'DRY RUN — pass --commit to apply'}`);
}

main().catch(e => { console.error(e); process.exit(1); });
