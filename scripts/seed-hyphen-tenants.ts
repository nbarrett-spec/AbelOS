/**
 * Seed HyphenTenant rows for Brookfield, Toll Brothers, Shaddock.
 *
 * Idempotent: upsert keyed on builderName. Safe to re-run as creds rotate.
 *
 * Usage:
 *   npx tsx scripts/seed-hyphen-tenants.ts
 *
 * Env vars required (set on Vercel + .env locally):
 *   HYPHEN_BROOKFIELD_USERNAME / HYPHEN_BROOKFIELD_PASSWORD
 *   HYPHEN_TOLL_USERNAME       / HYPHEN_TOLL_PASSWORD
 *   HYPHEN_SHADDOCK_USERNAME   / HYPHEN_SHADDOCK_PASSWORD
 *   HYPHEN_BROOKFIELD_BASE_URL / HYPHEN_TOLL_BASE_URL / HYPHEN_SHADDOCK_BASE_URL
 *     (all default to https://www.bldrconnect.com)
 *
 * Missing credentials for a tenant → row is created with syncEnabled=false
 * and a clear lastSyncError, so the cron skips it cleanly until creds land.
 */

import { PrismaClient } from '@prisma/client'

const DEFAULT_BASE_URL = 'https://www.bldrconnect.com'

interface TenantSpec {
  builderName: string
  usernameEnv: string
  passwordEnv: string
  baseUrlEnv: string
}

const TENANTS: TenantSpec[] = [
  {
    builderName: 'Brookfield',
    usernameEnv: 'HYPHEN_BROOKFIELD_USERNAME',
    passwordEnv: 'HYPHEN_BROOKFIELD_PASSWORD',
    baseUrlEnv: 'HYPHEN_BROOKFIELD_BASE_URL',
  },
  {
    builderName: 'Toll Brothers',
    usernameEnv: 'HYPHEN_TOLL_USERNAME',
    passwordEnv: 'HYPHEN_TOLL_PASSWORD',
    baseUrlEnv: 'HYPHEN_TOLL_BASE_URL',
  },
  {
    builderName: 'Shaddock Homes',
    usernameEnv: 'HYPHEN_SHADDOCK_USERNAME',
    passwordEnv: 'HYPHEN_SHADDOCK_PASSWORD',
    baseUrlEnv: 'HYPHEN_SHADDOCK_BASE_URL',
  },
]

async function findBuilderId(prisma: PrismaClient, builderName: string): Promise<string | null> {
  try {
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Builder"
       WHERE LOWER("companyName") LIKE $1
       LIMIT 1`,
      `%${builderName.toLowerCase()}%`,
    )
    return rows[0]?.id || null
  } catch {
    return null
  }
}

async function upsertTenant(prisma: PrismaClient, spec: TenantSpec): Promise<{ created: boolean; id: string; missing: string[] }> {
  const username = process.env[spec.usernameEnv] || ''
  const password = process.env[spec.passwordEnv] || ''
  const baseUrl = process.env[spec.baseUrlEnv] || DEFAULT_BASE_URL

  const missing: string[] = []
  if (!username) missing.push(spec.usernameEnv)
  if (!password) missing.push(spec.passwordEnv)

  const syncEnabled = missing.length === 0
  const lastSyncError = missing.length > 0
    ? `Missing env vars: ${missing.join(', ')}`
    : null

  const builderId = await findBuilderId(prisma, spec.builderName)

  // Look for existing row by builderName.
  const existing: any[] = await prisma.$queryRawUnsafe(
    `SELECT "id" FROM "HyphenTenant" WHERE "builderName" = $1 LIMIT 1`,
    spec.builderName,
  )

  if (existing.length > 0) {
    const id = existing[0].id
    await prisma.$executeRawUnsafe(
      `UPDATE "HyphenTenant"
       SET "builderId" = $1,
           "baseUrl" = $2,
           "username" = $3,
           "password" = $4,
           "syncEnabled" = $5,
           "lastSyncError" = $6,
           "updatedAt" = NOW()
       WHERE "id" = $7`,
      builderId, baseUrl, username || null, password || null,
      syncEnabled, lastSyncError, id,
    )
    return { created: false, id, missing }
  }

  // Generate a cuid-ish id (we don't need to import cuid here — use crypto).
  const id = `htn_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "HyphenTenant"
       ("id", "builderId", "builderName", "baseUrl", "username", "password",
        "syncEnabled", "lastSyncError", "syncIntervalMinutes", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 60, NOW(), NOW())`,
    id, builderId, spec.builderName, baseUrl, username || null, password || null,
    syncEnabled, lastSyncError,
  )
  return { created: true, id, missing }
}

async function main() {
  const prisma = new PrismaClient()
  const summary: Array<{ builder: string; action: string; id: string; status: string; missing: string[] }> = []

  try {
    for (const spec of TENANTS) {
      try {
        const { created, id, missing } = await upsertTenant(prisma, spec)
        summary.push({
          builder: spec.builderName,
          action: created ? 'CREATED' : 'UPDATED',
          id,
          status: missing.length === 0 ? 'ENABLED' : 'DISABLED (missing creds)',
          missing,
        })
      } catch (err: any) {
        summary.push({
          builder: spec.builderName,
          action: 'ERROR',
          id: '',
          status: err?.message || String(err),
          missing: [],
        })
      }
    }

    console.log('\n────────────────────────────────────────')
    console.log('HyphenTenant seed result')
    console.log('────────────────────────────────────────')
    for (const row of summary) {
      console.log(`  ${row.builder.padEnd(20)} ${row.action.padEnd(8)} ${row.status}`)
      if (row.id) console.log(`    id: ${row.id}`)
      if (row.missing.length > 0) console.log(`    missing: ${row.missing.join(', ')}`)
    }

    const allMissing = new Set<string>()
    for (const row of summary) for (const m of row.missing) allMissing.add(m)

    console.log('\n────────────────────────────────────────')
    console.log('Vercel env vars to set')
    console.log('────────────────────────────────────────')
    if (allMissing.size === 0) {
      console.log('  (none — all credentials present)')
    } else {
      for (const v of Array.from(allMissing).sort()) console.log(`  ${v}`)
    }
    console.log('\nOptional baseUrl overrides (default https://www.bldrconnect.com):')
    console.log('  HYPHEN_BROOKFIELD_BASE_URL')
    console.log('  HYPHEN_TOLL_BASE_URL')
    console.log('  HYPHEN_SHADDOCK_BASE_URL')
    console.log('')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
