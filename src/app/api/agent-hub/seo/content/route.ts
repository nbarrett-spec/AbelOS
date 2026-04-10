export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * GET /api/agent-hub/seo/content
 * List SEO content pieces with filtering.
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const sp = request.nextUrl.searchParams
    const status = sp.get('status')
    const contentType = sp.get('contentType')
    const limit = parseInt(sp.get('limit') || '50', 10)

    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status) { conditions.push(`"status"::text = $${idx}`); params.push(status); idx++ }
    if (contentType) { conditions.push(`"contentType"::text = $${idx}`); params.push(contentType); idx++ }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const content: any[] = await prisma.$queryRawUnsafe(`
      SELECT "id", "title", "slug", "contentType", "targetKeywords",
             "metaDescription", "excerpt", "author", "status",
             "publishedAt", "pageViews", "avgTimeOnPage", "bounceRate",
             "conversions", "tags", "createdAt"
      FROM "SEOContent"
      ${where}
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `, ...params)

    // Stats
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int AS "total",
        COUNT(CASE WHEN "status" = 'PUBLISHED' THEN 1 END)::int AS "published",
        COUNT(CASE WHEN "status" = 'DRAFT' THEN 1 END)::int AS "drafts",
        COUNT(CASE WHEN "status" = 'REVIEW' THEN 1 END)::int AS "inReview",
        COALESCE(SUM("pageViews"), 0)::int AS "totalPageViews",
        COALESCE(SUM("conversions"), 0)::int AS "totalConversions"
      FROM "SEOContent"
    `)

    return NextResponse.json({
      data: content.map(c => ({
        ...c,
        pageViews: Number(c.pageViews),
        avgTimeOnPage: Number(c.avgTimeOnPage),
        bounceRate: Number(c.bounceRate),
        conversions: Number(c.conversions),
      })),
      stats: stats[0] || {},
    })
  } catch (error) {
    console.error('GET /api/agent-hub/seo/content error:', error)
    return NextResponse.json({ error: 'Failed to fetch content' }, { status: 500 })
  }
}

/**
 * POST /api/agent-hub/seo/content
 * Create a new SEO content piece.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { title, slug, contentType, targetKeywords, content, metaDescription, excerpt, tags, status } = body

    if (!title || !content) {
      return NextResponse.json({ error: 'Missing title and content' }, { status: 400 })
    }

    const id = `seo_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')

    await prisma.$executeRawUnsafe(`
      INSERT INTO "SEOContent" (
        "id", "title", "slug", "contentType", "targetKeywords",
        "content", "metaDescription", "excerpt", "tags", "status",
        "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9::jsonb, $10, NOW(), NOW())
    `,
      id, title, finalSlug,
      contentType || 'BLOG',
      JSON.stringify(targetKeywords || []),
      content,
      metaDescription || null,
      excerpt || null,
      JSON.stringify(tags || []),
      status || 'DRAFT'
    )

    // Create review task if status is REVIEW
    if (status === 'REVIEW' || !status) {
      const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
      try {
        await prisma.$executeRawUnsafe(`
          INSERT INTO "AgentTask" (
            "id", "agentRole", "taskType", "title", "description",
            "priority", "status", "payload", "requiresApproval",
            "createdBy", "createdAt", "updatedAt"
          ) VALUES (
            $1, 'MARKETING', 'GENERATE_CONTENT', $2, $3,
            'NORMAL', 'PENDING', $4::jsonb, true,
            'agent:MARKETING', NOW(), NOW()
          )
        `,
          taskId,
          `Review: ${title}`,
          `New ${contentType || 'blog'} content needs review before publishing: "${title}"`,
          JSON.stringify({ contentId: id, title, slug: finalSlug, contentType })
        )
      } catch (e) {
        console.error('Failed to create content review task:', e)
      }
    }

    return NextResponse.json({ id, title, slug: finalSlug, status: status || 'DRAFT' }, { status: 201 })
  } catch (error) {
    console.error('POST /api/agent-hub/seo/content error:', error)
    return NextResponse.json({ error: 'Failed to create content' }, { status: 500 })
  }
}
