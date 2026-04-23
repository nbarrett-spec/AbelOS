export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { auditBuilder } from '@/lib/audit'

interface OnboardingStep {
  id: string
  name: string
  description: string
  completed: boolean
  optional: boolean
  ctaText: string
  href: string
}

interface OnboardingResponse {
  steps: OnboardingStep[]
  completedCount: number
  totalCount: number
  percentComplete: number
}

export async function GET(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const builderId = session.builderId

    // Get builder info
    const builder = await prisma.$queryRawUnsafe<Array<{
      id: string
      phone: string | null
      address: string | null
      city: string | null
      state: string | null
      zip: string | null
      companyName: string
    }>>(
      `SELECT id, phone, address, city, state, zip, "companyName" FROM "Builder" WHERE id = $1`,
      builderId
    )

    if (!builder || builder.length === 0) {
      return NextResponse.json(
        { error: 'Builder not found' },
        { status: 404 }
      )
    }

    const builderData = builder[0]

    // 1. Profile completed (has phone, company, address)
    const profileCompleted = !!(
      builderData.phone &&
      builderData.companyName &&
      builderData.address &&
      builderData.city &&
      builderData.state
    )

    // 2. First project created
    const projects = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Project" WHERE "builderId" = $1 LIMIT 1`,
      builderId
    )
    const projectCompleted = projects.length > 0

    // 3. First quote requested
    const quotes = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT q.id FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p.id
      WHERE p."builderId" = $1 LIMIT 1
      `,
      builderId
    )
    const quoteCompleted = quotes.length > 0

    // 4. First order placed
    const orders = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Order" WHERE "builderId" = $1 LIMIT 1`,
      builderId
    )
    const orderCompleted = orders.length > 0

    // 5. Payment method set up (check for payment history on any of this builder's invoices)
    // Payment has no builderId — it's linked via Invoice.builderId.
    const payments = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT p.id FROM "Payment" p
       JOIN "Invoice" i ON p."invoiceId" = i.id
       WHERE i."builderId" = $1 LIMIT 1`,
      builderId
    )
    const paymentCompleted = payments.length > 0

    // 6. Team members invited (future feature - always show as optional)
    // BuilderTeamMember is a future-planned table not yet in schema.prisma.
    // Tolerate its absence so the endpoint doesn't 500 before launch.
    let teamCompleted = false
    try {
      const teamMembers = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "BuilderTeamMember" WHERE "builderId" = $1 AND "invitedAt" IS NOT NULL LIMIT 1`,
        builderId
      )
      teamCompleted = teamMembers.length > 0
    } catch {
      // Table doesn't exist yet — step remains incomplete (and is marked optional).
    }

    // 7. Blueprint uploaded
    const blueprints = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT b.id FROM "Blueprint" b
      JOIN "Project" p ON b."projectId" = p.id
      WHERE p."builderId" = $1 LIMIT 1
      `,
      builderId
    )
    const blueprintCompleted = blueprints.length > 0

    // 8. Catalog browsed (check for activity or product views)
    const catalogActivity = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `
      SELECT id FROM "Activity" WHERE "builderId" = $1 AND "activityType"::text IN ('PRODUCT_VIEW', 'CATALOG_BROWSE')
      LIMIT 1
      `,
      builderId
    )
    const catalogCompleted = catalogActivity.length > 0

    // Define all steps
    const steps: OnboardingStep[] = [
      {
        id: 'profile',
        name: 'Complete your profile',
        description: 'Add phone, address, and company details to your account',
        completed: profileCompleted,
        optional: false,
        ctaText: 'Complete',
        href: '/dashboard/settings'
      },
      {
        id: 'project',
        name: 'Create your first project',
        description: 'Start by creating a new project to organize your work',
        completed: projectCompleted,
        optional: false,
        ctaText: 'Create',
        href: '/projects/new'
      },
      {
        id: 'blueprint',
        name: 'Upload blueprints',
        description: 'Upload floor plans and specifications for your project',
        completed: blueprintCompleted,
        optional: false,
        ctaText: 'Upload',
        href: projectCompleted ? `/projects/${projects[0]?.id}/upload-plans` : '/projects'
      },
      {
        id: 'catalog',
        name: 'Browse the catalog',
        description: 'Explore our products and pricing options',
        completed: catalogCompleted,
        optional: false,
        ctaText: 'Browse',
        href: '/catalog'
      },
      {
        id: 'quote',
        name: 'Request a quote',
        description: 'Get pricing for your project needs',
        completed: quoteCompleted,
        optional: false,
        ctaText: 'Request',
        href: '/catalog?quote=true'
      },
      {
        id: 'order',
        name: 'Place your first order',
        description: 'Submit your first order to get started',
        completed: orderCompleted,
        optional: false,
        ctaText: 'Order',
        href: '/quick-order'
      },
      {
        id: 'payment',
        name: 'Set up payments',
        description: 'Configure your preferred payment method',
        completed: paymentCompleted,
        optional: false,
        ctaText: 'Setup',
        href: '/dashboard/payments'
      },
      {
        id: 'team',
        name: 'Invite team members',
        description: 'Add your team to collaborate on projects',
        completed: teamCompleted,
        optional: true,
        ctaText: 'Invite',
        href: '/dashboard/settings?tab=team'
      }
    ]

    const completedCount = steps.filter(s => s.completed).length
    const totalCount = steps.length
    const percentComplete = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0

    const response: OnboardingResponse = {
      steps,
      completedCount,
      totalCount,
      percentComplete
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('Failed to get onboarding status:', error)
    return NextResponse.json(
      { error: 'Failed to get onboarding status' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const session = await getSession()

    if (!session) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    auditBuilder(session.builderId, session.companyName || 'Unknown', 'UPDATE', 'BuilderOnboarding').catch(() => {});

    const body = await request.json()
    const { stepId, dismissed } = body

    if (!stepId) {
      return NextResponse.json(
        { error: 'stepId is required' },
        { status: 400 }
      )
    }

    // For now, we're just acknowledging the action
    // In a full implementation, you could store dismissals in a preferences table

    return NextResponse.json({
      success: true,
      message: `Step ${stepId} marked as ${dismissed ? 'dismissed' : 'completed'}`
    })
  } catch (error) {
    console.error('Failed to update onboarding:', error)
    return NextResponse.json(
      { error: 'Failed to update onboarding' },
      { status: 500 }
    )
  }
}
