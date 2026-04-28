#!/usr/bin/env node
/**
 * Data cleanup script — bundles the safe DB-write fixes from
 * CLAUDE-CODE-FIXES.md (P0.1, P0.2, P3.3, P4.2).
 *
 * Idempotent: each step checks current state before writing. Safe to re-run.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/_data-cleanup-claude-code-fixes.mjs           # dry run, prints what would change
 *   DATABASE_URL=... node scripts/_data-cleanup-claude-code-fixes.mjs --apply   # writes
 *
 * Notes on spec deviations:
 *  • P0.1 (MG Financial): spec says DELETE rows but rule #5 ("Deactivation is
 *    not deletion") is the conflicting policy from the same doc. We deactivate
 *    (active=false). Run a separate manual DELETE if Nate prefers full removal.
 *  • P0.2 (testxyz): spec uses status='DEACTIVATED' but Staff has no status
 *    enum — only `active Boolean`. We flip active=false.
 *  • P4.2 (Chad Zeh): inserts a real Staff row. CLAUDE.md confirms Chad as PM.
 *    Email is best-guess (chad.zeh@abellumber.com); update if wrong.
 *
 * Skipped from this script (still needed):
 *  • P3.1 dedup — needs per-person decisions; see _probe-staff-dupes.mjs
 *  • P3.2 Michael TBD — needs Nate to provide actual last name
 *  • P3.4 stale orders — destructive; see _probe-stale-orders.mjs
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

function log(label, payload) {
  console.log(`[${APPLY ? 'APPLY' : 'DRY-RUN'}] ${label}`, payload ?? '')
}

async function p01_deactivateMgFinancial() {
  console.log('\n── P0.1 MG Financial staff deactivation ──')
  const targets = [
    'jarreola@mgfinancialpartners.com',
    'jgladue@mgfinancialpartners.com',
  ]
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "email", "firstName", "lastName", "active"
     FROM "Staff" WHERE "email" = ANY($1)`,
    targets,
  )
  if (rows.length === 0) {
    log('no MG Financial rows found — nothing to do')
    return
  }
  for (const r of rows) {
    if (r.active === false) {
      log('already deactivated', r.email)
      continue
    }
    log('would deactivate', `${r.firstName} ${r.lastName} <${r.email}> (id=${r.id})`)
    if (APPLY) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET "active" = false, "updatedAt" = NOW() WHERE "id" = $1`,
        r.id,
      )
    }
  }
}

async function p02_deactivateTestUser() {
  console.log('\n── P0.2 testxyz@test.com deactivation ──')
  const rows = await prisma.$queryRawUnsafe(
    `SELECT "id", "email", "active" FROM "Staff" WHERE "email" = $1`,
    'testxyz@test.com',
  )
  if (rows.length === 0) {
    log('testxyz@test.com not found')
    return
  }
  const r = rows[0]
  if (r.active === false) {
    log('already deactivated')
    return
  }
  log('would deactivate', r.email)
  if (APPLY) {
    await prisma.$executeRawUnsafe(
      `UPDATE "Staff" SET "active" = false, "updatedAt" = NOW() WHERE "id" = $1`,
      r.id,
    )
  }
}

async function p33_cleanTitles() {
  console.log('\n── P3.3 staff title cleanup ──')
  const updates = [
    { firstName: 'Brady', lastName: 'Bounds', newTitle: 'Driver' },
    { firstName: 'Jon', lastName: 'Garner', newTitle: 'Driver' },
    // Cody Loudermilk's actual role unknown — left for manual decision.
  ]
  for (const u of updates) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT "id", "title", "firstName", "lastName" FROM "Staff"
       WHERE "firstName" = $1 AND "lastName" = $2`,
      u.firstName, u.lastName,
    )
    if (rows.length === 0) {
      log('not found', `${u.firstName} ${u.lastName}`)
      continue
    }
    for (const r of rows) {
      if (r.title === u.newTitle) {
        log('already correct', `${r.firstName} ${r.lastName} → ${r.title}`)
        continue
      }
      log('would update', `${r.firstName} ${r.lastName}: "${r.title}" → "${u.newTitle}"`)
      if (APPLY) {
        await prisma.$executeRawUnsafe(
          `UPDATE "Staff" SET "title" = $1, "updatedAt" = NOW() WHERE "id" = $2`,
          u.newTitle, r.id,
        )
      }
    }
  }
  console.log('  (Cody Loudermilk skipped — no canonical role known)')
}

async function p42_addChadZeh() {
  console.log('\n── P4.2 Add Chad Zeh ──')
  const existing = await prisma.$queryRawUnsafe(
    `SELECT "id", "email", "active" FROM "Staff"
     WHERE "firstName" = 'Chad' AND "lastName" = 'Zeh'`,
  )
  if (existing.length > 0) {
    log('Chad Zeh already exists', `id=${existing[0].id}, active=${existing[0].active}`)
    if (existing[0].active === false && APPLY) {
      log('reactivating', existing[0].email)
      await prisma.$executeRawUnsafe(
        `UPDATE "Staff" SET "active" = true, "updatedAt" = NOW() WHERE "id" = $1`,
        existing[0].id,
      )
    }
    return
  }
  const id = `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  // Email is best-guess from naming convention. Update via a follow-up
  // UPDATE if the canonical email differs.
  const email = 'chad.zeh@abellumber.com'
  log('would insert', `Chad Zeh, role=PROJECT_MANAGER, email=${email}`)
  if (APPLY) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Staff"
        ("id", "firstName", "lastName", "email", "passwordHash",
         "role", "department", "active", "createdAt", "updatedAt")
       VALUES
        ($1, 'Chad', 'Zeh', $2, '!disabled-needs-invite!',
         'PROJECT_MANAGER'::"StaffRole", 'OPERATIONS'::"Department",
         true, NOW(), NOW())`,
      id, email,
    )
    console.log('  → inserted with placeholder password. Run /api/ops/staff/fix-passwords or send invite to set a real one.')
  }
}

async function main() {
  if (!APPLY) {
    console.log('═══ DRY RUN — no writes will occur ═══')
    console.log('Re-run with --apply to commit changes.\n')
  } else {
    console.log('═══ APPLY MODE — writing to DATABASE_URL ═══\n')
  }

  await p01_deactivateMgFinancial()
  await p02_deactivateTestUser()
  await p33_cleanTitles()
  await p42_addChadZeh()

  console.log('\n═══ Done ═══')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
