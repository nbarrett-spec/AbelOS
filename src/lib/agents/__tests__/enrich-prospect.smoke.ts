/**
 * enrich-prospect smoke harness — runnable, NOT a Vitest test.
 *
 * Usage:
 *   npx tsx src/lib/agents/__tests__/enrich-prospect.smoke.ts <slug>
 *
 * Where <slug> matches a `BUILDERS_2026_04_29` fixture entry (e.g.
 * `garabedian-properties`, `goff-custom-homes`, `bailee-custom-homes`).
 *
 * Behavior:
 *   1. Load the fixture row by slug.
 *   2. Upsert a temporary Prospect row in the database (idempotent — uses a
 *      stable ID derived from slug so reruns overwrite, not append).
 *   3. Call enrichProspect({ caller: 'manual' }).
 *   4. Diff result.confidence + result.contactEmail against the fixture's
 *      expected values, print a structured human-readable report.
 *   5. Exit 0 if actual confidence >= expected confidence
 *      (CONFIRMED > LIKELY > UNVERIFIED), else exit 1.
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY env var (the agent talks to the Claude API)
 *   - Working DATABASE_URL pointing at prod-phase-1 or a local Postgres
 *   - .env at repo root (loaded via dotenv/config below)
 *
 * This harness is for human verification. Do not wire it into CI — it hits
 * the network, costs money, and is non-deterministic.
 */
import 'dotenv/config'

import { enrichProspect } from '../enrich-prospect'
import type { EnrichmentConfidence } from '../types'
import {
  BUILDERS_2026_04_29,
  type BuilderFixture,
} from './fixtures/builders-2026-04-29'

// Confidence ranking — higher number = stronger result.
const CONFIDENCE_RANK: Record<EnrichmentConfidence, number> = {
  UNVERIFIED: 0,
  LIKELY: 1,
  CONFIRMED: 2,
}

function fail(msg: string, code = 1): never {
  // eslint-disable-next-line no-console
  console.error(`[smoke] ${msg}`)
  process.exit(code)
}

function header(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`)
}

async function upsertProspectFromFixture(
  fixture: BuilderFixture,
): Promise<string> {
  // Lazy-import Prisma so users running --help / no DB don't hit it cold.
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient()
  try {
    // Stable derived ID so reruns overwrite the same row (no orphan sprawl).
    const id = `smoke-${fixture.slug}`
    // Use raw SQL upsert against the literal Prospect schema — same pattern
    // the production enrich-prospect.ts uses for forward compat with the
    // un-generated columns.
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Prospect" (
         "id", "companyName", "city", "state", "email", "status",
         "createdAt", "updatedAt"
       ) VALUES ($1, $2, $3, $4, $5, 'NEW', NOW(), NOW())
       ON CONFLICT ("id") DO UPDATE SET
         "companyName" = EXCLUDED."companyName",
         "city" = EXCLUDED."city",
         "state" = EXCLUDED."state",
         "email" = EXCLUDED."email",
         "updatedAt" = NOW()`,
      id,
      fixture.companyName,
      fixture.city,
      fixture.state,
      fixture.expectedEmail,
    )
    return id
  } finally {
    await prisma.$disconnect()
  }
}

async function main(): Promise<void> {
  const slug = process.argv[2]
  if (!slug) {
    fail(
      'missing <slug> arg.\n' +
        'usage: npx tsx src/lib/agents/__tests__/enrich-prospect.smoke.ts <slug>\n' +
        'try:   garabedian-properties | goff-custom-homes | bailee-custom-homes',
    )
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    fail('ANTHROPIC_API_KEY not set — load it from repo-root .env first.')
  }

  const fixture = BUILDERS_2026_04_29.find((b) => b.slug === slug)
  if (!fixture) {
    fail(
      `no fixture for slug "${slug}". valid slugs:\n  ` +
        BUILDERS_2026_04_29.map((b) => b.slug).join('\n  '),
    )
  }

  header('FIXTURE')
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(fixture, null, 2))

  header('UPSERT PROSPECT')
  const prospectId = await upsertProspectFromFixture(fixture)
  // eslint-disable-next-line no-console
  console.log(`prospectId = ${prospectId}`)

  header('ENRICH (live Claude API call — this costs money)')
  const startedAt = Date.now()
  const result = await enrichProspect({ prospectId, caller: 'manual' })
  const elapsedMs = Date.now() - startedAt

  header('RESULT')
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2))
  // eslint-disable-next-line no-console
  console.log(`elapsedMs = ${elapsedMs}`)

  header('DIFF vs FIXTURE')
  const expectedRank = CONFIDENCE_RANK[fixture.expectedConfidence]
  const actualRank = CONFIDENCE_RANK[result.confidence]
  const passConfidence = actualRank >= expectedRank

  const rows = [
    [
      'confidence',
      `${fixture.expectedConfidence} (rank ${expectedRank})`,
      `${result.confidence} (rank ${actualRank})`,
      passConfidence ? 'PASS' : 'REGRESSION',
    ],
    [
      'contactEmail',
      String(fixture.expectedEmail),
      String(result.contactEmail),
      result.contactEmail === fixture.expectedEmail ? 'EXACT' : 'DIFF',
    ],
    [
      'domain',
      String(fixture.expectedDomain),
      String(result.domain),
      result.domain === fixture.expectedDomain ? 'EXACT' : 'DIFF',
    ],
    [
      'founderName',
      String(fixture.expectedFounder),
      String(result.founderName),
      result.founderName === fixture.expectedFounder ? 'EXACT' : 'DIFF',
    ],
  ]
  for (const [field, expected, actual, status] of rows) {
    // eslint-disable-next-line no-console
    console.log(`  ${field.padEnd(14)} expected=${expected.padEnd(40)} actual=${actual.padEnd(40)} [${status}]`)
  }

  header('VERDICT')
  if (passConfidence) {
    // eslint-disable-next-line no-console
    console.log(`PASS — confidence >= expected for ${fixture.slug}`)
    process.exit(0)
  } else {
    // eslint-disable-next-line no-console
    console.log(`FAIL — confidence regressed for ${fixture.slug}`)
    process.exit(1)
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[smoke] uncaught:', err)
  process.exit(1)
})
