export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/seo/keywords
 * Keyword tracking dashboard data.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const intent = sp.get('intent')
    const hasRank = sp.get('ranked') === 'true'

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (intent) { conditions.push(`"intent"::text = $${idx}`); params.push(intent); idx++ }
    if (hasRank) conditions.push(`"currentRank" IS NOT NULL`)

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const keywords: any[] = await prisma.$queryRawUnsafe(`
      SELECT k.*,
        sc."title" AS "linkedContentTitle",
        sc."status"::text AS "linkedContentStatus"
      FROM "SEOKeyword" k
      LEFT JOIN "SEOContent" sc ON sc."id" = k."contentId"
      ${where}
      ORDER BY k."searchVolume" DESC
      LIMIT 100
    `, ...params)

    // Summary
    const summary: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "totalKeywords",
        COUNT(CASE WHEN "currentRank" IS NOT NULL AND "currentRank" <= 10 THEN 1 END)::int AS "page1",
        COUNT(CASE WHEN "currentRank" IS NOT NULL AND "currentRank" BETWEEN 11 AND 20 THEN 1 END)::int AS "page2",
        COUNT(CASE WHEN "currentRank" IS NOT NULL AND "currentRank" > 20 THEN 1 END)::int AS "page3Plus",
        COUNT(CASE WHEN "currentRank" IS NULL THEN 1 END)::int AS "notRanking",
        COALESCE(SUM("searchVolume"), 0)::int AS "totalSearchVolume"
      FROM "SEOKeyword"
    `)

    // Movement (improved vs declined)
    const movement: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(CASE WHEN "currentRank" < "previousRank" THEN 1 END)::int AS "improved",
        COUNT(CASE WHEN "currentRank" > "previousRank" THEN 1 END)::int AS "declined",
        COUNT(CASE WHEN "currentRank" = "previousRank" THEN 1 END)::int AS "stable"
      FROM "SEOKeyword"
      WHERE "currentRank" IS NOT NULL AND "previousRank" IS NOT NULL
    `)

    return NextResponse.json({
      data: keywords.map(k => ({
        ...k,
        searchVolume: Number(k.searchVolume),
        difficulty: Number(k.difficulty),
        rankChange: k.previousRank && k.currentRank ? k.previousRank - k.currentRank : null,
      })),
      summary: summary[0] || {},
      movement: movement[0] || {},
    })
  } catch (error) {
    console.error('GET /api/agent-hub/seo/keywords error:', error)
    return NextResponse.json({ error: 'Failed to fetch keywords' }, { status: 500 })
  }
}

/**
 * POST /api/agent-hub/seo/keywords
 * Add or update keywords.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const keywords = Array.isArray(body) ? body : [body]
    const results: any[] = []

    for (const kw of keywords) {
      if (!kw.keyword) continue

      const id = `kw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

      await prisma.$executeRawUnsafe(`
        INSERT INTO "SEOKeyword" ("id", "keyword", "searchVolume", "difficulty", "intent", "category", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        ON CONFLICT ("keyword") DO UPDATE SET
          "searchVolume" = EXCLUDED."searchVolume",
          "difficulty" = EXCLUDED."difficulty",
          "updatedAt" = NOW()
      `, id, kw.keyword, kw.searchVolume || 0, kw.difficulty || 50, kw.intent || 'INFORMATIONAL', kw.category || null)

      results.push({ keyword: kw.keyword, status: 'upserted' })
    }

    return NextResponse.json({ results, count: results.length }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/seo/keywords error:', error)
    return NextResponse.json({ error: 'Failed to upsert keywords' }, { status: 500 })
  }
}
