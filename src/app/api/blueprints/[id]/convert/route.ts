export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { audit } from '@/lib/audit'

/**
 * POST /api/blueprints/[id]/convert
 *
 * Convert a completed takeoff into a quote request or order.
 * Builder auth required.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const session = await getSession()
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    audit(request, 'CREATE', 'BlueprintConversion', params.id).catch(() => {});

    const body = await request.json()
    const { action, takeoffId, notes } = body // action: 'quote' | 'order'

    if (!action || !takeoffId) {
      return NextResponse.json(
        { error: 'action and takeoffId are required' },
        { status: 400 }
      )
    }

    // Verify blueprint ownership
    const blueprint: any = await prisma.blueprint.findUnique({
      where: { id: params.id },
      include: { project: { select: { id: true, builderId: true, name: true } } },
    })

    if (!blueprint || blueprint.project.builderId !== session.builderId) {
      return NextResponse.json({ error: 'Access denied' }, { status: 403 })
    }

    // Get the takeoff with items
    const takeoff = await prisma.takeoff.findUnique({
      where: { id: takeoffId },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, sku: true, basePrice: true },
            },
          },
        },
      },
    })

    if (!takeoff || takeoff.blueprintId !== params.id) {
      return NextResponse.json({ error: 'Takeoff not found' }, { status: 404 })
    }

    if (action === 'quote') {
      // Generate a quote number
      const quoteCount = await prisma.quote.count()
      const quoteNumber = `ABL-${new Date().getFullYear()}-${String(quoteCount + 1).padStart(4, '0')}`

      // Calculate total from matched products
      const total = takeoff.items.reduce((sum, item) => {
        if (item.product) return sum + item.product.basePrice * item.quantity
        return sum
      }, 0)

      // Create quote record
      const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days
      const quote = await prisma.quote.create({
        data: {
          projectId: blueprint.project.id,
          takeoffId: takeoff.id,
          quoteNumber,
          status: 'DRAFT',
          subtotal: total,
          total,
          validUntil,
        },
      })

      // Create quote items from takeoff items
      for (const item of takeoff.items) {
        if (item.product) {
          await prisma.quoteItem.create({
            data: {
              quoteId: quote.id,
              productId: item.product.id,
              description: item.description,
              quantity: item.quantity,
              unitPrice: item.product.basePrice,
              lineTotal: item.product.basePrice * item.quantity,
            },
          })
        }
      }

      // Update takeoff status
      await prisma.takeoff.update({
        where: { id: takeoff.id },
        data: { status: 'APPROVED' },
      })

      return NextResponse.json({
        success: true,
        action: 'quote',
        quote: {
          id: quote.id,
          quoteNumber,
          total,
          itemCount: takeoff.items.filter((i) => i.product).length,
          validUntil: validUntil.toISOString(),
        },
      })
    }

    // Action === 'order' — direct order from takeoff
    // For now, route to quote first (ops team reviews before order)
    return NextResponse.json({
      success: false,
      error: 'Direct ordering from takeoff is coming soon. Please create a quote first.',
      action: 'order',
    }, { status: 400 })
  } catch (error: any) {
    console.error('POST /api/blueprints/[id]/convert error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
