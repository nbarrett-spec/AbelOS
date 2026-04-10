export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/seo/local-listing
 * Generate/update Google Business Profile content.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { postType } = body // 'UPDATE', 'OFFER', 'EVENT', 'PRODUCT'

    // Get recent company stats for contextual content
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        (SELECT COUNT(*)::int FROM "Order" WHERE "createdAt" >= NOW() - INTERVAL '30 days') AS "recentOrders",
        (SELECT COUNT(*)::int FROM "Builder" WHERE "status"::text = 'ACTIVE') AS "activeBuilders",
        (SELECT COUNT(DISTINCT "category") FROM "Product" WHERE "active" = true) AS "productCategories"
    `)

    const s = stats[0] || {}

    // Generate post content based on type
    const posts: any[] = []
    const type = postType || 'UPDATE'

    if (type === 'UPDATE' || type === 'ALL') {
      posts.push({
        type: 'UPDATE',
        title: 'Your Trusted Door & Trim Partner',
        content: `Abel Lumber serves over ${s.activeBuilders || 100} active builders with complete pre-hung door and trim packages. From takeoff to installation, we handle it all. Contact us for a quote on your next project!`,
        callToAction: 'LEARN_MORE',
      })
    }

    if (type === 'OFFER' || type === 'ALL') {
      posts.push({
        type: 'OFFER',
        title: 'New Builder Partner Discount',
        content: `New to Abel? Get 10% off your first door and trim package. We pre-hang everything in-house for faster installation and better quality. Ask about our builder loyalty program!`,
        callToAction: 'GET_OFFER',
      })
    }

    if (type === 'PRODUCT' || type === 'ALL') {
      posts.push({
        type: 'PRODUCT',
        title: 'Complete Door & Hardware Packages',
        content: `Interior doors, trim, casing, and hardware — all from one source. Shaker, 2-panel, 6-panel, and custom options available. Hollow core and solid core. We deliver and install.`,
        callToAction: 'CALL',
      })
    }

    // NAP consistency check
    const napData = {
      name: 'Abel Lumber',
      address: 'Austin, TX area', // Update with actual address
      phone: '(512) XXX-XXXX', // Update with actual phone
      website: 'https://abellumber.com',
      hours: 'Mon-Fri 7:00 AM - 4:30 PM',
      categories: ['Building Materials Supplier', 'Door Supplier', 'Lumber Store'],
    }

    return NextResponse.json({
      posts,
      napData,
      suggestions: [
        'Update Google Business hours if they change seasonally',
        'Respond to all Google reviews within 24 hours',
        'Post at least 1 update per week for better local ranking',
        'Add photos of completed projects (with builder permission)',
      ],
    })
  } catch (error) {
    console.error('POST /api/agent-hub/seo/local-listing error:', error)
    return NextResponse.json({ error: 'Failed to generate listing content' }, { status: 500 })
  }
}
