/**
 * Seed the Prospect table with the 32-builder gold fixture from the
 * 2026-04-29 v2 push (src/lib/agents/__tests__/fixtures/builders-2026-04-29.ts).
 *
 * This is OPT-IN — it is intentionally NOT registered in package.json's
 * `db:seed` script and the main prisma/seed.ts entrypoint. Local devs and
 * the smoke harnesses can call seedBuildersFixture() directly when they
 * want a deterministic Prospect set to work against; nothing else triggers
 * it automatically.
 *
 * Usage (one-off from a tsx script or repl):
 *   import { seedBuildersFixture } from './prisma/seed/builders-fixture'
 *   const r = await seedBuildersFixture()
 *   console.log(r) // { inserted: N, skipped: M }
 *
 * Idempotency: prospect IDs are derived from the fixture slug (`smoke-<slug>`)
 * so reruns update existing rows instead of multiplying them. `skipped` counts
 * rows that already had identical content; `inserted` counts new + updated.
 */
import { PrismaClient } from '@prisma/client'

import {
  BUILDERS_2026_04_29,
  type BuilderFixture,
} from '../../src/lib/agents/__tests__/fixtures/builders-2026-04-29'

export interface SeedBuildersFixtureResult {
  inserted: number
  skipped: number
}

/**
 * Upserts every fixture entry into Prospect. Returns counts for caller
 * scripts that want to log progress.
 */
export async function seedBuildersFixture(): Promise<SeedBuildersFixtureResult> {
  const prisma = new PrismaClient()
  let inserted = 0
  let skipped = 0
  try {
    for (const fixture of BUILDERS_2026_04_29) {
      const id = `smoke-${fixture.slug}`
      const written = await upsertOne(prisma, id, fixture)
      if (written) inserted += 1
      else skipped += 1
    }
    return { inserted, skipped }
  } finally {
    await prisma.$disconnect()
  }
}

/**
 * Returns true if the row was actually written (insert or content-changed
 * update); false if the existing row already matched the fixture verbatim.
 *
 * Uses raw SQL for the same reason production enrich-prospect.ts does — the
 * enrichment columns (domain, founderName, enrichmentConfidence, …) live in
 * the schema but aren't always reflected in the generated Prisma client on
 * fresh branches.
 */
async function upsertOne(
  prisma: PrismaClient,
  id: string,
  fixture: BuilderFixture,
): Promise<boolean> {
  const existingRows = await prisma.$queryRawUnsafe<
    Array<{
      companyName: string
      city: string | null
      state: string | null
      email: string | null
      domain: string | null
      founderName: string | null
      enrichmentConfidence: string | null
    }>
  >(
    `SELECT "companyName", "city", "state", "email", "domain",
            "founderName", "enrichmentConfidence"
       FROM "Prospect" WHERE "id" = $1`,
    id,
  )

  const existing = existingRows[0]
  if (
    existing &&
    existing.companyName === fixture.companyName &&
    existing.city === fixture.city &&
    existing.state === fixture.state &&
    existing.email === fixture.expectedEmail &&
    existing.domain === fixture.expectedDomain &&
    existing.founderName === fixture.expectedFounder &&
    existing.enrichmentConfidence === fixture.expectedConfidence
  ) {
    return false
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Prospect" (
       "id", "companyName", "city", "state", "email",
       "domain", "founderName", "enrichmentConfidence",
       "source", "status", "createdAt", "updatedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8,
       'FIXTURE', 'NEW', NOW(), NOW()
     )
     ON CONFLICT ("id") DO UPDATE SET
       "companyName"          = EXCLUDED."companyName",
       "city"                 = EXCLUDED."city",
       "state"                = EXCLUDED."state",
       "email"                = EXCLUDED."email",
       "domain"               = EXCLUDED."domain",
       "founderName"          = EXCLUDED."founderName",
       "enrichmentConfidence" = EXCLUDED."enrichmentConfidence",
       "updatedAt"            = NOW()`,
    id,
    fixture.companyName,
    fixture.city,
    fixture.state,
    fixture.expectedEmail,
    fixture.expectedDomain,
    fixture.expectedFounder,
    fixture.expectedConfidence,
  )
  return true
}
