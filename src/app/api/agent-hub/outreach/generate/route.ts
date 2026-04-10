export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

/**
 * POST /api/agent-hub/outreach/generate
 * Given a builder/deal/permit, generate personalized outreach content.
 * The Sales Agent calls this to draft messages; human reviews before send.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { targetType, targetId, channel, context } = body

    if (!targetType || !targetId) {
      return NextResponse.json({ error: 'Missing targetType and targetId' }, { status: 400 })
    }

    // Gather context based on target type
    let targetInfo: any = {}
    let intel: any = null

    if (targetType === 'DEAL') {
      const deals: any[] = await prisma.$queryRawUnsafe(`
        SELECT d.*, s."firstName" || ' ' || s."lastName" AS "ownerName"
        FROM "Deal" d
        LEFT JOIN "Staff" s ON s."id" = d."ownerId"
        WHERE d."id" = $1
      `, targetId)
      targetInfo = deals[0] || {}

      if (targetInfo.builderId) {
        const profiles: any[] = await prisma.$queryRawUnsafe(`
          SELECT * FROM "BuilderIntelligence" WHERE "builderId" = $1
        `, targetInfo.builderId)
        intel = profiles[0] || null
      }
    } else if (targetType === 'PERMIT') {
      const permits: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "PermitLead" WHERE "id" = $1
      `, targetId)
      targetInfo = permits[0] || {}

      if (targetInfo.matchedBuilderId) {
        const profiles: any[] = await prisma.$queryRawUnsafe(`
          SELECT * FROM "BuilderIntelligence" WHERE "builderId" = $1
        `, targetInfo.matchedBuilderId)
        intel = profiles[0] || null
      }
    } else if (targetType === 'BUILDER') {
      const builders: any[] = await prisma.$queryRawUnsafe(`
        SELECT "id", "companyName", "contactName", "email", "phone"
        FROM "Builder" WHERE "id" = $1
      `, targetId)
      targetInfo = builders[0] || {}

      const profiles: any[] = await prisma.$queryRawUnsafe(`
        SELECT * FROM "BuilderIntelligence" WHERE "builderId" = $1
      `, targetId)
      intel = profiles[0] || null
    }

    // Build personalization context
    const personalization = {
      companyName: targetInfo.companyName || targetInfo.builderName || 'Builder',
      contactName: targetInfo.contactName || 'there',
      projectAddress: targetInfo.address || targetInfo.jobAddress || '',
      estimatedValue: Number(targetInfo.estimatedValue || targetInfo.dealValue || 0),
      projectType: targetInfo.projectType || '',
      permitNumber: targetInfo.permitNumber || '',
      // Intelligence-driven
      topCategories: intel?.topProductCategories || [],
      healthScore: intel ? Number(intel.healthScore) : null,
      orderTrend: intel?.orderTrend || null,
      ltv: intel ? Number(intel.totalLifetimeValue) : null,
      lastOrderDate: intel?.lastOrderDate || null,
    }

    // Generate email templates based on context
    const templates = generateOutreachTemplates(targetType, personalization, channel || 'EMAIL', context)

    return NextResponse.json({
      targetType,
      targetId,
      personalization,
      hasIntelligence: !!intel,
      templates,
    })
  } catch (error) {
    console.error('POST /api/agent-hub/outreach/generate error:', error)
    return NextResponse.json({ error: 'Failed to generate outreach' }, { status: 500 })
  }
}

function generateOutreachTemplates(targetType: string, p: any, channel: string, context?: string) {
  const templates: any[] = []

  if (targetType === 'PERMIT') {
    templates.push({
      name: 'Permit Introduction',
      subject: `Abel Lumber — Door & Trim Packages for ${p.projectAddress || 'Your New Project'}`,
      body: `Hi ${p.contactName},\n\nI noticed your new ${p.projectType?.toLowerCase() || ''} project ${p.permitNumber ? `(Permit #${p.permitNumber}) ` : ''}at ${p.projectAddress || 'your new location'}. Congratulations on getting started!\n\nAbel Lumber specializes in pre-hung interior door and trim packages for builders in the area. We handle everything from takeoff to installation, and our builders typically save 15-20% versus sourcing materials individually.\n\nWould you have 15 minutes this week to discuss your door and trim needs for this project?\n\nBest,\nAbel Lumber Team`,
      tone: 'WARM_INTRO',
      delay: 0,
    })
    templates.push({
      name: 'Follow-Up #1',
      subject: `Quick follow-up — door & trim for ${p.projectAddress || 'your project'}`,
      body: `Hi ${p.contactName},\n\nJust following up on my note about your project${p.projectAddress ? ` at ${p.projectAddress}` : ''}. I know things get busy!\n\nA few things that set Abel apart:\n• Complete door packages with hardware — one PO, one delivery\n• We pre-hang everything in-house for faster install\n• Dedicated project manager for your job\n\nHappy to put together a quick estimate if you can share your plans. No commitment needed.\n\nBest,\nAbel Lumber Team`,
      tone: 'HELPFUL',
      delay: 3,
    })
    templates.push({
      name: 'Follow-Up #2',
      subject: `Last check-in — ${p.companyName || 'your project'}`,
      body: `Hi ${p.contactName},\n\nI don't want to be a nuisance, so this will be my last note. If Abel Lumber can ever help with doors, trim, or hardware packages, we're here.\n\nWe work with over 100 builders in the area and pride ourselves on on-time delivery and quality pre-hung packages.\n\nFeel free to reach out anytime.\n\nBest,\nAbel Lumber Team`,
      tone: 'RESPECTFUL_CLOSE',
      delay: 7,
    })
  } else if (targetType === 'BUILDER' && p.orderTrend === 'DECLINING') {
    // Reactivation templates
    templates.push({
      name: 'Win-Back Offer',
      subject: `We miss working with ${p.companyName}!`,
      body: `Hi ${p.contactName},\n\nIt's been a while since your last order with Abel, and I wanted to reach out personally. We value the relationship we've built with ${p.companyName}${p.ltv ? ` — over $${Math.round(p.ltv).toLocaleString()} in business together` : ''}.\n\nI'd love to hear how things are going and whether there's anything we can do better. If you have any upcoming projects, I'd like to offer you preferred pricing on your next order as a thank-you for your loyalty.\n\nWould you be open to a quick call this week?\n\nBest,\nAbel Lumber Team`,
      tone: 'PERSONAL',
      delay: 0,
    })
  } else {
    // General deal outreach
    templates.push({
      name: 'Initial Outreach',
      subject: `Abel Lumber — ${p.companyName ? `Working with ${p.companyName}` : 'Builder Materials Partnership'}`,
      body: `Hi ${p.contactName},\n\nI'm reaching out from Abel Lumber. We provide complete door, trim, and hardware packages for residential builders in the area.\n\n${p.estimatedValue > 0 ? `For a project of this size, we typically see material costs in the $${Math.round(p.estimatedValue * 0.15).toLocaleString()} range for doors and trim. ` : ''}Our team handles everything from takeoff to installation.\n\nWould you be interested in a quick conversation about how we could support your projects?\n\nBest,\nAbel Lumber Team`,
      tone: 'PROFESSIONAL',
      delay: 0,
    })
  }

  return templates
}
