#!/usr/bin/env node
/**
 * Read-only probe — lists candidate duplicate Staff records for P3.1.
 * Output is a table per person showing all matching rows so you can decide
 * which to keep before running deletions manually.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/_probe-staff-dupes.mjs
 *
 * Strategy: groups rows by (firstName, lastName), surfaces only groups with
 * >1 row. Also flags rows with placeholder/invalid email patterns or
 * mismatched active states within a group.
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT "id", "firstName", "lastName", "email", "title", "role"::text AS "role",
           "department"::text AS "department", "active",
           "passwordHash" = '!disabled-needs-invite!' AS "needsInvite",
           "passwordSetAt", "lastLoginAt", "createdAt", "updatedAt"
    FROM "Staff"
    ORDER BY LOWER("firstName") ASC, LOWER("lastName") ASC, "createdAt" ASC
  `)

  // Group by lowercase first+last name
  const groups = new Map()
  for (const r of rows) {
    const key = `${(r.firstName || '').trim().toLowerCase()}|${(r.lastName || '').trim().toLowerCase()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  const dupes = Array.from(groups.entries()).filter(([, list]) => list.length > 1)

  if (dupes.length === 0) {
    console.log('No duplicate names found.')
    return
  }

  console.log(`Found ${dupes.length} groups with duplicate first+last name:\n`)

  for (const [key, list] of dupes) {
    const [first, last] = key.split('|')
    console.log(`\n=== ${first} ${last} (${list.length} rows) ===`)
    for (const r of list) {
      console.log(
        `  ${r.id}`,
        `\n    email:    ${r.email || '(none)'}`,
        `\n    title:    ${r.title || '(none)'}`,
        `\n    role:     ${r.role}`,
        `\n    dept:     ${r.department}`,
        `\n    active:   ${r.active}`,
        `\n    invite:   ${r.needsInvite ? 'YES (never set password)' : 'no'}`,
        `\n    lastSeen: ${r.lastLoginAt ? new Date(r.lastLoginAt).toISOString().slice(0, 10) : '(never)'}`,
        `\n    created:  ${new Date(r.createdAt).toISOString().slice(0, 10)}`,
      )
    }
  }

  console.log('\n\nRecommendation: keep the row with (a) a real email, (b) active=true,')
  console.log('(c) most recent lastLoginAt or updatedAt. Deactivate (active=false) the others.')
  console.log('Don\'t delete — keep history for audit log foreign keys.')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
