export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

// GET /api/orders/[id] — Get single order detail with items
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Get order with builder verification, project info via quote
    const orders: any[] = await prisma.$queryRaw`
      SELECT o.*,
             b."companyName", b."contactName",
             COALESCE(p."name", b."companyName") as "projectName",
             p."planName", p."jobAddress",
             p."city" as "projectCity", p."state" as "projectState"
      FROM "Order" o
      JOIN "Builder" b ON b."id" = o."builderId"
      LEFT JOIN "Quote" q ON q."id" = o."quoteId"
      LEFT JOIN "Project" p ON p."id" = q."projectId"
      WHERE o."id" = ${params.id} AND o."builderId" = ${session.builderId}
      LIMIT 1
    ` as any[]

    if (orders.length === 0) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 })
    }

    const order = orders[0]

    // Get order items
    const items: any[] = await prisma.$queryRaw`
      SELECT oi.*, pr."name" as "productName", pr."sku"
      FROM "OrderItem" oi
      LEFT JOIN "Product" pr ON pr."id" = oi."productId"
      WHERE oi."orderId" = ${params.id}
      ORDER BY oi."description" ASC
    ` as any[]

    return NextResponse.json({
      ...order,
      project: {
        name: order.projectName,
        planName: order.planName,
        jobAddress: order.jobAddress,
        city: order.projectCity,
        state: order.projectState,
      },
      builder: {
        companyName: order.companyName,
        contactName: order.contactName,
      },
      items,
    })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
