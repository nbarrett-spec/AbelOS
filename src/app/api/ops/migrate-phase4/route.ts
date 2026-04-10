export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/ops/migrate-phase4
 * Phase 4: Marketing & SEO Machine — creates SEOContent, SEOKeyword tables
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const results: { step: string; status: string; error?: string }[] = []

  async function runStep(name: string, sql: string) {
    try {
      await prisma.$executeRawUnsafe(sql)
      results.push({ step: name, status: 'OK' })
    } catch (e: any) {
      results.push({ step: name, status: 'ERROR', error: e.message?.slice(0, 200) })
    }
  }

  // ── 1. SEOContent ──
  await runStep('SEOContent', `
    CREATE TABLE IF NOT EXISTS "SEOContent" (
      "id" TEXT NOT NULL,
      "title" TEXT NOT NULL,
      "slug" TEXT NOT NULL UNIQUE,
      "contentType" TEXT NOT NULL DEFAULT 'BLOG',
      "targetKeywords" JSONB DEFAULT '[]',
      "content" TEXT NOT NULL DEFAULT '',
      "metaDescription" TEXT,
      "excerpt" TEXT,
      "author" TEXT DEFAULT 'Abel Lumber',
      "status" TEXT NOT NULL DEFAULT 'DRAFT',
      "publishedAt" TIMESTAMP(3),
      "lastUpdated" TIMESTAMP(3),
      "pageViews" INT NOT NULL DEFAULT 0,
      "avgTimeOnPage" DOUBLE PRECISION DEFAULT 0,
      "bounceRate" DOUBLE PRECISION DEFAULT 0,
      "conversions" INT NOT NULL DEFAULT 0,
      "featuredImage" TEXT,
      "tags" JSONB DEFAULT '[]',
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SEOContent_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('SEOContent_slug_idx', `
    CREATE INDEX IF NOT EXISTS "SEOContent_slug_idx" ON "SEOContent"("slug")
  `)

  await runStep('SEOContent_status_idx', `
    CREATE INDEX IF NOT EXISTS "SEOContent_status_idx" ON "SEOContent"("status")
  `)

  await runStep('SEOContent_type_idx', `
    CREATE INDEX IF NOT EXISTS "SEOContent_type_idx" ON "SEOContent"("contentType")
  `)

  // ── 2. SEOKeyword ──
  await runStep('SEOKeyword', `
    CREATE TABLE IF NOT EXISTS "SEOKeyword" (
      "id" TEXT NOT NULL,
      "keyword" TEXT NOT NULL,
      "searchVolume" INT DEFAULT 0,
      "difficulty" INT DEFAULT 50,
      "currentRank" INT,
      "previousRank" INT,
      "targetPage" TEXT,
      "contentId" TEXT,
      "category" TEXT,
      "intent" TEXT DEFAULT 'INFORMATIONAL',
      "lastChecked" TIMESTAMP(3),
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SEOKeyword_pkey" PRIMARY KEY ("id")
    )
  `)

  await runStep('SEOKeyword_keyword_idx', `
    CREATE UNIQUE INDEX IF NOT EXISTS "SEOKeyword_keyword_idx" ON "SEOKeyword"("keyword")
  `)

  await runStep('SEOKeyword_rank_idx', `
    CREATE INDEX IF NOT EXISTS "SEOKeyword_rank_idx" ON "SEOKeyword"("currentRank")
  `)

  // ── 3. Seed initial keywords ──
  const keywords = [
    { keyword: 'pre hung interior doors wholesale', volume: 1200, difficulty: 45, intent: 'COMMERCIAL' },
    { keyword: 'builder door packages texas', volume: 480, difficulty: 35, intent: 'COMMERCIAL' },
    { keyword: 'mdf vs solid wood trim', volume: 2400, difficulty: 55, intent: 'INFORMATIONAL' },
    { keyword: 'interior door installation guide', volume: 3600, difficulty: 60, intent: 'INFORMATIONAL' },
    { keyword: 'door and trim package cost calculator', volume: 880, difficulty: 40, intent: 'TRANSACTIONAL' },
    { keyword: 'building materials supplier near me', volume: 6600, difficulty: 70, intent: 'LOCAL' },
    { keyword: 'residential door package estimating', volume: 320, difficulty: 30, intent: 'COMMERCIAL' },
    { keyword: 'pre hung door vs slab door', volume: 2900, difficulty: 50, intent: 'INFORMATIONAL' },
    { keyword: 'bulk interior doors for builders', volume: 720, difficulty: 38, intent: 'COMMERCIAL' },
    { keyword: 'shaker interior doors wholesale', volume: 1600, difficulty: 42, intent: 'COMMERCIAL' },
    { keyword: 'door hardware packages bulk', volume: 590, difficulty: 35, intent: 'COMMERCIAL' },
    { keyword: 'trim and casing packages new construction', volume: 440, difficulty: 32, intent: 'COMMERCIAL' },
  ]

  for (const kw of keywords) {
    const kwId = `kw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await runStep(`Keyword_${kw.keyword.slice(0, 30)}`, `
      INSERT INTO "SEOKeyword" ("id", "keyword", "searchVolume", "difficulty", "intent", "createdAt", "updatedAt")
      VALUES ('${kwId}', '${kw.keyword}', ${kw.volume}, ${kw.difficulty}, '${kw.intent}', NOW(), NOW())
      ON CONFLICT ("keyword") DO NOTHING
    `)
  }

  const failed = results.filter(r => r.status === 'ERROR')

  return NextResponse.json({
    message: `Phase 4 migration complete: ${results.length - failed.length}/${results.length} steps OK`,
    results,
    hasErrors: failed.length > 0,
  })
}
