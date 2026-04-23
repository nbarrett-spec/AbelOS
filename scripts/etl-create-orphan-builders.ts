/**
 * scripts/etl-create-orphan-builders.ts
 *
 * Creates 5 Builder rows that exist as columns in the XLSX "Builder Pricing"
 * sheet but have no matching Aegis Builder record. Without these, 28 custom
 * prices get silently skipped by etl-builder-pricing.ts.
 *
 * Idempotent: checks by companyName (case-insensitive) before inserting.
 * Placeholder email/passwordHash so the rows satisfy schema NOT NULL / UNIQUE.
 * These are flagged via @placeholder.abellumber.com for later cleanup.
 *
 * Usage:
 *   npx tsx scripts/etl-create-orphan-builders.ts
 */

import { PrismaClient, BuilderType, AccountStatus, PaymentTerm } from '@prisma/client'

interface OrphanSpec {
  companyName: string
  contactName: string
}

// Exact companyName strings match the XLSX "Builder Pricing" header verbatim.
const ORPHANS: OrphanSpec[] = [
  { companyName: 'Daniel',          contactName: 'Daniel' }, // looks like a person
  { companyName: 'Hunt Homes',      contactName: '' },
  { companyName: 'JCLI Homes',      contactName: '' },
  { companyName: 'McClintock',      contactName: '' },
  { companyName: 'TX BUILT CONST',  contactName: '' },
]

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function main() {
  const prisma = new PrismaClient()
  try {
    const existing = await prisma.builder.findMany({
      select: { id: true, companyName: true, email: true },
    })
    const byNameLower = new Map(existing.map((b) => [b.companyName.toLowerCase(), b]))
    const byEmail = new Map(existing.map((b) => [b.email.toLowerCase(), b]))

    let created = 0
    let skipped = 0
    const results: Array<{ action: 'CREATED' | 'SKIPPED'; id: string; companyName: string; email: string }> = []

    for (const spec of ORPHANS) {
      const nameHit = byNameLower.get(spec.companyName.toLowerCase())
      if (nameHit) {
        skipped++
        results.push({ action: 'SKIPPED', id: nameHit.id, companyName: nameHit.companyName, email: nameHit.email })
        continue
      }

      const email = `${slug(spec.companyName)}@placeholder.abellumber.com`

      // Also defend against email collisions (different companyName, same slug)
      if (byEmail.has(email.toLowerCase())) {
        const hit = byEmail.get(email.toLowerCase())!
        skipped++
        results.push({ action: 'SKIPPED', id: hit.id, companyName: hit.companyName, email: hit.email })
        continue
      }

      const row = await prisma.builder.create({
        data: {
          companyName: spec.companyName,
          contactName: spec.contactName,
          email,
          passwordHash: '', // empty placeholder; these accounts are not login-capable yet
          builderType: BuilderType.CUSTOM,
          status: AccountStatus.ACTIVE,
          paymentTerm: PaymentTerm.NET_15,
        },
        select: { id: true, companyName: true, email: true },
      })
      created++
      results.push({ action: 'CREATED', id: row.id, companyName: row.companyName, email: row.email })
    }

    console.log('=== ORPHAN BUILDER CREATION ===')
    for (const r of results) {
      console.log(`  ${r.action.padEnd(7)}  ${r.id}  ${r.companyName.padEnd(18)}  ${r.email}`)
    }
    console.log()
    console.log(`Created: ${created}    Skipped (already exist): ${skipped}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
