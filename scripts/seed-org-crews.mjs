#!/usr/bin/env node
/**
 * seed-org-crews.mjs
 *
 * Create organizational Crew rows (Production Line, Project Management,
 * Estimating, Logistics Coordination, Sales + Business Development,
 * Accounting, Leadership) and link the matching Staff rows via CrewMember.
 *
 * Why:
 *   Crew today only has 17 rows, all individual delivery drivers / install
 *   subcontractors. 50+ internal staff (production crew, PMs, estimators,
 *   exec, accounting) have no Crew. Jordyn's Staff Directory surfaces
 *   "unassigned" for all of them. This seed fills in the org chart side.
 *
 * Schema constraints (from prisma/schema.prisma):
 *   - CrewType enum has only DELIVERY | INSTALLATION | DELIVERY_AND_INSTALL.
 *     There is no PRODUCTION or OTHER. We use DELIVERY_AND_INSTALL as the
 *     "internal org crew" bucket (neutral — these teams touch both flows),
 *     DELIVERY for the Logistics Coordination crew (drivers + Jordyn),
 *     and INSTALLATION for Production Line (closest flow analog).
 *   - CrewMember.role is a free-form String. We use "Lead" / "Member" /
 *     "Driver" (mixed case — matches the pattern on that column).
 *   - Unique index: CrewMember (crewId, staffId). We ON CONFLICT DO NOTHING.
 *
 * Idempotent:
 *   - Crews are upserted by exact name match (SELECT then INSERT).
 *   - Staff are looked up by email (primary) with a full-name fallback.
 *     If a staff row is missing (parallel seed still running), we log and
 *     skip — a re-run will pick it up.
 *
 * Usage:
 *   node scripts/seed-org-crews.mjs
 */

import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

// ---------- env loader ----------
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

// ---------- org crew definitions ----------
// Each member: { email? | firstName+lastName, role: 'Lead'|'Member'|'Driver' }
// Email is preferred. Name fallback uses case-insensitive first+last match.
const ORG_CREWS = [
  {
    name: 'Production Line',
    crewType: 'INSTALLATION',
    members: [
      { firstName: 'Gunner',   lastName: 'Hacker',  email: 'g.hacker@abellumber.com',   role: 'Lead' },
      { firstName: 'Tiffany',  lastName: 'Brooks',  email: 'tiffany.b@abellumber.com',  role: 'Member' },
      { firstName: 'Julio',    lastName: 'Castro',  email: 'julio.c@abellumber.com',    role: 'Member' },
      { firstName: 'Marcus',   lastName: 'Trevino', email: 'marcus.t@abellumber.com',   role: 'Member' },
      { firstName: 'Virginia', lastName: 'Cox',     email: 'virginia.c@abellumber.com', role: 'Member' },
      { firstName: 'Cody',     lastName: 'Prichard', role: 'Member' }, // parallel seed may be adding
      { firstName: 'Wyatt',    lastName: 'Tanner',   role: 'Member' }, // parallel seed may be adding
      { firstName: 'Michael',  lastName: '',         role: 'Member' }, // single name, lookup tolerant
    ],
  },
  {
    name: 'Project Management',
    crewType: 'DELIVERY_AND_INSTALL',
    members: [
      { firstName: 'Clint',    lastName: 'Vinson',  email: 'c.vinson@abellumber.com',         role: 'Lead' },
      { firstName: 'Chad',     lastName: 'Zeh',     email: 'chad.zeh@abellumber.com',         role: 'Member' },
      { firstName: 'Brittney', lastName: 'Werner',  email: 'brittney.werner@abellumber.com',  role: 'Member' },
      { firstName: 'Thomas',   lastName: 'Robinson', email: 'thomas@abellumber.com',          role: 'Member' },
      { firstName: 'Ben',      lastName: 'Wilson',   email: 'ben.wilson@abellumber.com',      role: 'Member' },
    ],
  },
  {
    name: 'Estimating',
    crewType: 'DELIVERY_AND_INSTALL',
    members: [
      { firstName: 'Lisa', lastName: 'Adams', email: 'lisa@abellumber.com', role: 'Lead' },
    ],
  },
  {
    name: 'Logistics Coordination',
    crewType: 'DELIVERY',
    members: [
      { firstName: 'Jordyn', lastName: 'Steider',   email: 'jordyn.steider@abellumber.com',  role: 'Lead' },
      { firstName: 'Austin', lastName: 'Collett',   email: 'austin.collett@abellumber.com',  role: 'Driver' },
      { firstName: 'Aaron',  lastName: 'Treadaway', email: 'aaron.treadaway@abellumber.com', role: 'Driver' },
      { firstName: 'Jack',   lastName: 'Zenker',    email: 'jack.z@abellumber.com',          role: 'Driver' },
      { firstName: 'Noah',   lastName: 'Ridge',     email: 'n.ridge@abellumber.com',         role: 'Driver' },
    ],
  },
  {
    name: 'Sales + Business Development',
    crewType: 'DELIVERY_AND_INSTALL',
    members: [
      // Dalton leads. Josh (post-buyout transitional) and Sean (CX Manager) on the crew.
      { firstName: 'Dalton', lastName: 'Whatley',  email: 'dalton@abellumber.com',   role: 'Lead' },
      { firstName: 'Josh',   lastName: 'Barrett',  email: 'j.barrett@abellumber.com', role: 'Member' },
      { firstName: 'Sean',   lastName: 'Phillips', email: 'sean@abellumber.com',     role: 'Member' },
    ],
  },
  {
    name: 'Accounting',
    crewType: 'DELIVERY_AND_INSTALL',
    members: [
      { firstName: 'Dawn', lastName: 'Meehan', email: 'dawn.meehan@abellumber.com', role: 'Lead' },
    ],
  },
  {
    name: 'Leadership',
    crewType: 'DELIVERY_AND_INSTALL',
    members: [
      { firstName: 'Nathaniel', lastName: 'Barrett', email: 'n.barrett@abellumber.com', role: 'Lead' },
      { firstName: 'Clint',     lastName: 'Vinson',  email: 'c.vinson@abellumber.com',  role: 'Member' },
    ],
  },
];

// ---------- helpers ----------
async function getOrCreateCrew({ name, crewType }) {
  const existing = await sql/*sql*/`
    SELECT id, name, "crewType"::text AS "crewType", active, "isSubcontractor"
    FROM "Crew"
    WHERE name = ${name}
    LIMIT 1
  `;
  if (existing[0]) {
    return { row: existing[0], created: false };
  }
  const id = randomUUID();
  const inserted = await sql/*sql*/`
    INSERT INTO "Crew" ("id", "name", "crewType", "active", "isSubcontractor", "createdAt", "updatedAt")
    VALUES (${id}, ${name}, ${crewType}::"CrewType", true, false, NOW(), NOW())
    RETURNING id, name, "crewType"::text AS "crewType", active, "isSubcontractor"
  `;
  return { row: inserted[0], created: true };
}

async function findStaff({ email, firstName, lastName }) {
  if (email) {
    const byEmail = await sql/*sql*/`
      SELECT id, "firstName", "lastName", email, active
      FROM "Staff"
      WHERE LOWER(email) = LOWER(${email}) AND active = true
      LIMIT 1
    `;
    if (byEmail[0]) return byEmail[0];
  }
  if (firstName && lastName) {
    const byName = await sql/*sql*/`
      SELECT id, "firstName", "lastName", email, active
      FROM "Staff"
      WHERE LOWER("firstName") = LOWER(${firstName})
        AND LOWER("lastName") = LOWER(${lastName})
        AND active = true
      ORDER BY "createdAt" ASC
      LIMIT 1
    `;
    if (byName[0]) return byName[0];
  }
  if (firstName && !lastName) {
    // Single-name fallback (e.g. "Michael"). Only accept if unambiguous.
    const byFirst = await sql/*sql*/`
      SELECT id, "firstName", "lastName", email, active
      FROM "Staff"
      WHERE LOWER("firstName") = LOWER(${firstName}) AND active = true
    `;
    if (byFirst.length === 1) return byFirst[0];
  }
  return null;
}

async function upsertCrewMember({ crewId, staffId, role }) {
  const id = randomUUID();
  const result = await sql/*sql*/`
    INSERT INTO "CrewMember" ("id", "crewId", "staffId", "role", "createdAt", "updatedAt")
    VALUES (${id}, ${crewId}, ${staffId}, ${role}, NOW(), NOW())
    ON CONFLICT ("crewId", "staffId") DO NOTHING
    RETURNING id
  `;
  return result[0] ?? null;
}

// ---------- main ----------
async function main() {
  const before = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM "CrewMember"`;
  console.log(`CrewMember rows before: ${before[0].n}`);

  const results = {
    crewsCreated: 0,
    crewsExisting: 0,
    membersInserted: 0,
    membersExisting: 0,
    staffMissing: [],
  };

  for (const def of ORG_CREWS) {
    const { row: crew, created } = await getOrCreateCrew({
      name: def.name,
      crewType: def.crewType,
    });
    if (created) {
      results.crewsCreated++;
      console.log(`+ Crew created: ${crew.name} [${crew.crewType}] (${crew.id})`);
    } else {
      results.crewsExisting++;
      console.log(`= Crew exists:  ${crew.name} [${crew.crewType}] (${crew.id})`);
    }

    for (const m of def.members) {
      const staff = await findStaff({
        email: m.email,
        firstName: m.firstName,
        lastName: m.lastName,
      });
      if (!staff) {
        const label = m.email ?? `${m.firstName} ${m.lastName}`.trim();
        console.log(`    ? staff not found: ${label} — skipping (re-run after parallel seed)`);
        results.staffMissing.push({ crew: def.name, ...m });
        continue;
      }
      const inserted = await upsertCrewMember({
        crewId: crew.id,
        staffId: staff.id,
        role: m.role,
      });
      if (inserted) {
        results.membersInserted++;
        console.log(`    + ${m.role.padEnd(6)} ${staff.firstName} ${staff.lastName} <${staff.email}>`);
      } else {
        results.membersExisting++;
        console.log(`    = ${m.role.padEnd(6)} ${staff.firstName} ${staff.lastName} already on crew`);
      }
    }
  }

  const after = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM "CrewMember"`;
  const crewCount = await sql/*sql*/`SELECT COUNT(*)::int AS n FROM "Crew"`;

  console.log('\n────────────── Summary ──────────────');
  console.log(`Crews created:          ${results.crewsCreated}`);
  console.log(`Crews already present:  ${results.crewsExisting}`);
  console.log(`CrewMembers inserted:   ${results.membersInserted}`);
  console.log(`CrewMembers existing:   ${results.membersExisting}`);
  console.log(`Staff lookups missing:  ${results.staffMissing.length}`);
  if (results.staffMissing.length) {
    for (const s of results.staffMissing) {
      const label = s.email ?? `${s.firstName} ${s.lastName}`.trim();
      console.log(`   - ${s.crew}: ${label} (role=${s.role})`);
    }
  }
  console.log(`Total Crew rows now:        ${crewCount[0].n}`);
  console.log(`Total CrewMember rows now:  ${after[0].n}  (was ${before[0].n})`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  });
