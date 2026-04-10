export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'

interface OrderDetail {
  id: string
  orderNumber: string
  status: string
  total: number
  itemCount: number
  createdAt: string
}

interface DeliveryDetail {
  id: string
  jobId: string
  deliveryDate: string
  status: string
  notes: string | null
}

interface InvoiceDetail {
  id: string
  invoiceNumber: string
  amount: number
  status: string
  dueDate: string | null
  createdAt: string
}

interface ProjectDetail {
  id: string
  name: string
  address: string
  community: string | null
  status: string
  createdAt: string
  orders: OrderDetail[]
  deliveries: DeliveryDetail[]
  invoices: InvoiceDetail[]
  orderCount: number
  totalSpend: number
  upcomingDeliveryCount: number
}

// GET /api/projects/[id]/details — Get full project detail with orders, deliveries, invoices
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  try {
    // Verify project belongs to this builder
    const projects: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, name, address, community, status, "createdAt"
       FROM "Project"
       WHERE id = $1 AND "builderId" = $2
       LIMIT 1`,
      params.id,
      session.builderId
    )

    if (projects.length === 0) {
      return NextResponse.json(
        { error: 'Project not found' },
        { status: 404 }
      )
    }

    const project = projects[0]

    // Fetch all orders for this project
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT
        o.id,
        o."orderNumber",
        o.status,
        o.total,
        o."createdAt",
        COUNT(oi.id)::int as "itemCount"
       FROM "Order" o
       LEFT JOIN "Quote" q ON o."quoteId" = q.id
       LEFT JOIN "OrderItem" oi ON oi."orderId" = o.id
       WHERE q."projectId" = $1
       GROUP BY o.id, o."orderNumber", o.status, o.total, o."createdAt"
       ORDER BY o."createdAt" DESC`,
      params.id
    )

    // Fetch all deliveries for this project
    const deliveries: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT
        d.id,
        d."jobId",
        d."deliveryDate",
        d.status,
        d.notes
       FROM "Delivery" d
       JOIN "Job" j ON d."jobId" = j.id
       JOIN "Order" o ON j."orderId" = o.id
       JOIN "Quote" q ON o."quoteId" = q.id
       WHERE q."projectId" = $1
       ORDER BY d."deliveryDate" DESC`,
      params.id
    )

    // Fetch all invoices related to orders in this project
    const invoices: any[] = await prisma.$queryRawUnsafe(
      `SELECT DISTINCT
        inv.id,
        inv."invoiceNumber",
        inv.amount,
        inv.status,
        inv."dueDate",
        inv."createdAt"
       FROM "Invoice" inv
       JOIN "Order" o ON inv."orderId" = o.id
       JOIN "Quote" q ON o."quoteId" = q.id
       WHERE q."projectId" = $1
       ORDER BY inv."createdAt" DESC`,
      params.id
    )

    const formattedOrders: OrderDetail[] = orders.map(o => ({
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      total: Number(o.total || 0),
      itemCount: o.itemCount || 0,
      createdAt: o.createdAt.toISOString(),
    }))

    const formattedDeliveries: DeliveryDetail[] = deliveries.map(d => ({
      id: d.id,
      jobId: d.jobId,
      deliveryDate: d.deliveryDate.toISOString(),
      status: d.status,
      notes: d.notes,
    }))

    const formattedInvoices: InvoiceDetail[] = invoices.map(inv => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: Number(inv.amount || 0),
      status: inv.status,
      dueDate: inv.dueDate ? inv.dueDate.toISOString() : null,
      createdAt: inv.createdAt.toISOString(),
    }))

    const upcomingDeliveries = deliveries.filter(
      d => new Date(d.deliveryDate) > new Date()
    )

    const response: ProjectDetail = {
      id: project.id,
      name: project.name,
      address: project.address,
      community: project.community,
      status: project.status,
      createdAt: project.createdAt.toISOString(),
      orders: formattedOrders,
      deliveries: formattedDeliveries,
      invoices: formattedInvoices,
      orderCount: formattedOrders.length,
      totalSpend: formattedOrders.reduce((sum, o) => sum + o.total, 0),
      upcomingDeliveryCount: upcomingDeliveries.length,
    }

    return NextResponse.json(response)
  } catch (error: any) {
    console.error('GET /api/projects/[id]/details error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch project details' },
      { status: 500 }
    )
  }
}
