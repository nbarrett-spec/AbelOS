#!/usr/bin/env node
/**
 * seed-crew-members.mjs
 *
 * Link existing Staff rows to existing Crew rows via CrewMember. Idempotent.
 *
 * Strategy:
 *   - Pulls all Crew rows.
 *   - For each Crew, tries to match its `name` to one or more Staff rows
 *     (Crew.name looks like "Aaron Treadaway" or "Warranty - Sean").
 *   - Role mapping per spec:
 *       DRIVER  -> any DELIVERY-crew driver we match by name
 *       LEAD    -> the named person on their own INSTALLATION/DELIVERY_AND_INSTALL crew
 *       MEMBER  -> fallback for additional matched staff on a crew
 *   - Falls back to the CLAUDE.md production-crew, PM, logistics, and estimator
 *     rosters where an existing Crew matches by type (there is none for
 *     "Production" or "PMs" today, so those are logged as "no crew exists").
 *   - Upserts via `ON CONFLICT (crewId, staffId) DO NOTHING` on the unique index
 *     `CrewMember_crewId_staffId_key`.
 *
 * Usage:
 *   node scripts/seed-crew-members.mjs
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------- env loader (don't need dotenv) ----------
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, '..', '.env');
try {
  const envText = readFileSync(envPath, 'utf8');
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    if (process.env[key]) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
} catch (e) {
  console.error(`Failed to read ${envPath}: ${e.message}`);
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing from .env');
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);

// ---------- roster from CLAUDE.md (fallback, used only to sanity-log) ----------
// brain_export/system_learnings_bolt.jsonl does not exist under the workspace,
// so we rely on CLAUDE.md for the roster.
const ROSTER = {
  productionCrew: [
    'Tiffany Brooks', 'Gunner Hacker', 'Julio Castro', 'Marcus Trevino',
    'Cody Prichard', 'Wyatt Tanner', 'Michael',
  ],
  drivers: ['Austin Collett', 'Aaron Treadaway', 'Jack Zenker', 'Noah Ridge'],
  pms: ['Chad Zeh', 'Brittney Werner', 'Thomas Robinson', 'Ben Wilson'],
  logistics: ['Jordyn Steider'],
  estimator: ['Lisa Adams'],
  coo: ['Clint Vinson'],
};

// ---------- helpers ----------
/** Build a case-insensitive index of Staff by "firstName lastName" (active only). */
async function buildStaffIndex() {
  const rows = await sql/*sql*/`
    SELECT id, "firstName", "lastName", role::text AS role, active
    FROM "Staff"
    WHERE active = true
  `;
  /** @type {Map<string, { id: string; firstName: string; lastName: string; role: string }[]>} */
  const byFullNameLower = new Map();
  /** @type {Map<string, { id: string; firstName: string; lastName: string; role: string }[]>} */
  const byFirstNameLower = new Map();
  for (const r of rows) {
    const full = `${r.firstName} ${r.lastName}`.trim().toLowerCase();
    const first = r.firstName.trim().toLowerCase();
    if (!byFullNameLower.has(full)) byFullNameLower.set(full, []);
    byFullNameLower.get(full).push(r);
    if (!byFirstNameLower.has(first)) byFirstNameLower.set(first, []);
    byFirstNameLower.get(first).push(r);
  }
  return { rows, byFullNameLower, byFirstNameLower };
}

/** Try to extract one or more full names from a Crew.name. */
function candidateNamesFromCrew(name) {
  // Strip decorations like " - Marco/Francisco" or "Warranty - Sean".
  const parts = name.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  const out = new Set();
  for (const p of parts) {
    // "Marco/Francisco" -> ["Marco", "Francisco"]
    for (const sub of p.split(/\//).map((s) => s.trim()).filter(Boolean)) {
      out.add(sub);
    }
    out.add(p);
  }
  return [...out];
}

/** Role for a crew member given crewType + whether this is a named-for-crew match. */
function computeRole(crewType, isNamedForCrew) {
  if (crewType === 'DELIVERY') return 'DRIVER';
  if (isNamedForCrew) return 'LEAD';
  return 'MEMBER';
}

/** Insert a CrewMember row idempotently. */
async function upsertCrewMember({ crewId, staffId, role }) {
  const id = randomUUID();
  const result = await sql/*sql*/`
    INSERT INTO "CrewMember" ("id", "crewId", "staffId", "role", "createdAt", "updatedAt")
    VALUES (${id}, ${crewId}, ${staffId}, ${role}, NOW(), NOW())
    ON CONFLICT ("crewId", "staffId") DO NOTHING
    RETURNING "id", "crewId", "staffId", "role";
  `;
  return result[0] ?? null;
}

// ---------- main ----------
async function main() {
  console.log('Loading Staff + Crew data from Neon...');
  const staffIndex = await buildStaffIndex();
  const crews = await sql/*sql*/`
    SELECT id, name, "crewType"::text AS "crewType", active, "isSubcontractor"
    FROM "Crew"
    ORDER BY name
  `;
  console.log(`Staff (active): ${staffIndex.rows.length}`);
  console.log(`Crews: ${crews.length}`);

  /** @type {{ crewId: string; crewName: string; staffId: string; staffName: string; role: string; skipped?: string }[]} */
  const plan = [];
  const unmatchedCrews = [];

  // Skip overhead crews that are not real people.
  const OVERHEAD = new Set([
    'Billing',
    'Customer Pick Up',
    'Unassigned',
  ]);

  for (const crew of crews) {
    if (OVERHEAD.has(crew.name)) continue;
    if (crew.isSubcontractor) {
      // Subcontractor crews (Metroplex Doors, Stair Solutions, Texas Innovation...)
      // are companies, not individual Abel staff. Skip unless the name maps
      // directly to an internal staff member.
      const full = crew.name.toLowerCase();
      const hits = staffIndex.byFullNameLower.get(full);
      if (!hits || hits.length === 0) continue;
    }

    const candidates = candidateNamesFromCrew(crew.name);
    /** @type {{ staff: any; isNamedForCrew: boolean }[]} */
    const matched = [];
    for (const cand of candidates) {
      const full = cand.toLowerCase();
      const fullHits = staffIndex.byFullNameLower.get(full);
      if (fullHits && fullHits.length > 0) {
        for (const s of fullHits) matched.push({ staff: s, isNamedForCrew: true });
        continue;
      }
      // Single-word candidate (e.g. "Sean" in "Warranty - Sean")
      if (!cand.includes(' ')) {
        const firstHits = staffIndex.byFirstNameLower.get(full);
        if (firstHits && firstHits.length === 1) {
          matched.push({ staff: firstHits[0], isNamedForCrew: true });
        } else if (firstHits && firstHits.length > 1) {
          // Ambiguous by first name only — accept if they all share the same last name
          // (e.g. Sean Phillips has two Staff rows: MANAGER + INSTALLER)
          const uniqueLastNames = new Set(firstHits.map((r) => r.lastName.toLowerCase()));
          if (uniqueLastNames.size === 1) {
            for (const s of firstHits) matched.push({ staff: s, isNamedForCrew: true });
          }
        }
      }
    }

    if (matched.length === 0) {
      unmatchedCrews.push(crew.name);
      continue;
    }

    for (const { staff, isNamedForCrew } of matched) {
      const role = computeRole(crew.crewType, isNamedForCrew);
      plan.push({
        crewId: crew.id,
        crewName: crew.name,
        staffId: staff.id,
        staffName: `${staff.firstName} ${staff.lastName}`,
        role,
      });
    }
  }

  // Fallback: attach CLAUDE.md roster to relevant existing crews where clearly
  // implied by crew type. Today there is no "Production" or "PM" Crew row,
  // so these stay as "no-crew" log entries — not inserted.
  const rosterNeedsCrewButNone = [
    ...ROSTER.productionCrew.map((n) => ({ name: n, crewType: 'PRODUCTION (no crew exists)' })),
    ...ROSTER.pms.map((n) => ({ name: n, crewType: 'PM (no crew exists)' })),
    ...ROSTER.logistics.map((n) => ({ name: n, crewType: 'LOGISTICS (no crew exists)' })),
    ...ROSTER.estimator.map((n) => ({ name: n, crewType: 'ESTIMATING (no crew exists)' })),
    ...ROSTER.coo.map((n) => ({ name: n, crewType: 'EXEC (no crew exists)' })),
  ];

  console.log(`\nPlanned CrewMember rows: ${plan.length}`);
  console.log(`Unmatched crews (no internal Staff match): ${unmatchedCrews.length}`);
  if (unmatchedCrews.length) {
    for (const n of unmatchedCrews) console.log(`   - ${n}`);
  }

  // Execute inserts
  let created = 0;
  let alreadyPresent = 0;
  for (const p of plan) {
    const inserted = await upsertCrewMember({
      crewId: p.crewId,
      staffId: p.staffId,
      role: p.role,
    });
    if (inserted) created++;
    else alreadyPresent++;
  }

  console.log(`\nInserted: ${created}`);
  console.log(`Already present (skipped on conflict): ${alreadyPresent}`);

  // Roster gaps — informational
  console.log('\nRoster entries with no matching Crew row (info only):');
  for (const item of rosterNeedsCrewButNone) {
    const first = item.name.split(' ')[0]?.toLowerCase();
    const last = item.name.split(' ').slice(1).join(' ').toLowerCase();
    const hit = staffIndex.rows.find((r) => r.firstName.toLowerCase() === first && r.lastName.toLowerCase() === last);
    if (hit) {
      console.log(`   - ${item.name} [Staff found: ${hit.id}] — ${item.crewType}`);
    } else {
      console.log(`   - ${item.name} [NO Staff row] — ${item.crewType}`);
    }
  }

  // Final sample
  const sample = await sql/*sql*/`
    SELECT cm."id", cm."role",
           c."name" AS crew_name, c."crewType"::text AS crew_type,
           s."firstName" || ' ' || s."lastName" AS staff_name
    FROM "CrewMember" cm
    JOIN "Crew" c ON c."id" = cm."crewId"
    JOIN "Staff" s ON s."id" = cm."staffId"
    ORDER BY cm."createdAt" DESC
    LIMIT 5;
  `;
  console.log('\nSample CrewMember rows (most recent 5):');
  console.table(sample);

  const totalNow = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM "CrewMember"`;
  console.log(`\nTotal CrewMember rows now: ${totalNow[0].n}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
