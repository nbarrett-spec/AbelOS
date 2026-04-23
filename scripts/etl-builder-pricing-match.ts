/**
 * scripts/etl-builder-pricing-match.ts
 *
 * Resolves the 41 builder column names in Abel_Product_Catalog_LIVE.xlsx
 * → Aegis Builder rows (by companyName, fuzzy-matched). Prints the match
 * table for human review BEFORE the pivot ETL runs.
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as path from 'node:path'

const FILE = path.resolve(__dirname, '..', '..', 'Abel_Product_Catalog_LIVE.xlsx')

// Map XLSX header → canonical Aegis companyName. Add overrides here when
// fuzzy match is wrong. Left null means "no match / do not import".
const MANUAL_OVERRIDES: Record<string, string | null> = {
  // Millcreek is a developer whose only Aegis record is the Celina community.
  Millcreek: 'MILLCREEK AMAVI CELINA',
  // Created 2026-04-22 via scripts/etl-create-orphan-builders.ts — exact match
  // now succeeds, but listed here for documentation.
  Daniel: 'Daniel',
  'Hunt Homes': 'Hunt Homes',
  'JCLI Homes': 'JCLI Homes',
  McClintock: 'McClintock',
  'TX BUILT CONST': 'TX BUILT CONST',
}

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(homes|homebuilders|homebuild|construction|builders|builder|custom|design|homebuilder|development|developement|inc|llc|residential|corp)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function tokens(s: string): Set<string> {
  return new Set(normalize(s).split(' ').filter((t) => t.length > 1))
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const t of a) if (b.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

async function main() {
  const wb = XLSX.readFile(FILE)
  const ws = wb.Sheets['Builder Pricing']
  const headerRow = XLSX.utils.sheet_to_json<any>(ws, { header: 1, range: 0 })[0] as string[]
  const xlsxBuilders = headerRow.slice(3).filter((s) => s && String(s).trim()) // skip SKU/Name/Default

  const prisma = new PrismaClient()
  try {
    const aegisBuilders = await prisma.builder.findMany({
      select: { id: true, companyName: true, builderType: true, status: true },
      orderBy: { companyName: 'asc' },
    })
    console.log(`Aegis builders: ${aegisBuilders.length}`)
    console.log(`XLSX builder columns: ${xlsxBuilders.length}`)
    console.log()

    const matches: Array<{
      xlsx: string
      aegis: string | null
      aegisId: string | null
      score: number
      how: 'manual' | 'exact' | 'fuzzy' | 'none'
    }> = []

    for (const x of xlsxBuilders) {
      const xlsxName = String(x).trim()

      // Manual override
      if (xlsxName in MANUAL_OVERRIDES) {
        const target = MANUAL_OVERRIDES[xlsxName]
        if (target === null) {
          matches.push({ xlsx: xlsxName, aegis: null, aegisId: null, score: 0, how: 'none' })
          continue
        }
        const hit = aegisBuilders.find((a) => a.companyName === target)
        matches.push({ xlsx: xlsxName, aegis: hit?.companyName ?? null, aegisId: hit?.id ?? null, score: 1.0, how: 'manual' })
        continue
      }

      // Exact (case-insensitive)
      const exact = aegisBuilders.find((a) => a.companyName.toLowerCase() === xlsxName.toLowerCase())
      if (exact) {
        matches.push({ xlsx: xlsxName, aegis: exact.companyName, aegisId: exact.id, score: 1.0, how: 'exact' })
        continue
      }

      // Fuzzy
      const xtok = tokens(xlsxName)
      let best: { a: typeof aegisBuilders[number]; score: number } | null = null
      for (const a of aegisBuilders) {
        const atok = tokens(a.companyName)
        const s = jaccard(xtok, atok)
        if (!best || s > best.score) best = { a, score: s }
      }
      if (best && best.score >= 0.5) {
        matches.push({ xlsx: xlsxName, aegis: best.a.companyName, aegisId: best.a.id, score: best.score, how: 'fuzzy' })
      } else {
        matches.push({ xlsx: xlsxName, aegis: null, aegisId: null, score: best?.score ?? 0, how: 'none' })
      }
    }

    console.log('XLSX column                    → Aegis companyName                           | how       | score')
    console.log('-------------------------------|--------------------------------------------|-----------|------')
    for (const m of matches) {
      const l = m.xlsx.padEnd(30).slice(0, 30)
      const r = (m.aegis ?? '(no match)').padEnd(42).slice(0, 42)
      console.log(`${l} → ${r} | ${m.how.padEnd(9)} | ${m.score.toFixed(2)}`)
    }
    console.log()
    console.log(`Matched: ${matches.filter((m) => m.aegis).length} / ${matches.length}`)
    console.log(`Unmatched: ${matches.filter((m) => !m.aegis).map((m) => m.xlsx).join(', ') || '(none)'}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
