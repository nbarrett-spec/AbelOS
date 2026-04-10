export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { verifyToken } from '@/lib/auth'

interface SearchResultItem {
  icon: string
  label: string
  subtitle: string
  href: string
  type: string
  total?: number
}

// GET /api/search?q=... — Global builder search across products, orders, projects, invoices
export async function GET(request: NextRequest) {
  const token = request.cookies.get('abel_session')?.value
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let session: any
  try { session = await verifyToken(token) } catch {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }

  const q = new URL(request.url).searchParams.get('q')?.trim()
  if (!q || q.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const like = `%${q}%`
  const builderId = session.builderId

  try {
    // Search products by name/sku/category
    const products: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, sku, name, category, "basePrice" as price
      FROM "Product"
      WHERE active = true
        AND (sku ILIKE $1 OR name ILIKE $1 OR category ILIKE $1)
      ORDER BY name ASC LIMIT 5
    `, like)

    // Search orders
    const orders: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "orderNumber", status, total, "createdAt"
      FROM "Order"
      WHERE "builderId" = $1
        AND ("orderNumber" ILIKE $2 OR "poNumber" ILIKE $2 OR "deliveryNotes" ILIKE $2)
      ORDER BY "createdAt" DESC LIMIT 5
    `, builderId, like)

    // Search projects
    const projects: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, name, "jobAddress", status
      FROM "Project"
      WHERE "builderId" = $1
        AND (name ILIKE $2 OR "jobAddress" ILIKE $2)
      ORDER BY name ASC LIMIT 5
    `, builderId, like)

    // Search invoices
    const invoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT id, "invoiceNumber", status, total, "createdAt"
      FROM "Invoice"
      WHERE "builderId" = $1
        AND ("invoiceNumber" ILIKE $2 OR notes ILIKE $2)
      ORDER BY "createdAt" DESC LIMIT 5
    `, builderId, like)

    const results: SearchResultItem[] = [
      ...products.map(r => ({
        icon: '🏷️',
        label: r.name,
        subtitle: `${r.category} · ${r.sku}`,
        href: `/catalog?search=${encodeURIComponent(r.sku)}`,
        type: 'product',
        total: Number(r.price) || 0,
      })),
      ...orders.map(r => ({
        icon: '📦',
        label: r.orderNumber,
        subtitle: `Order ${r.status}`,
        href: `/dashboard/orders/${r.id}`,
        type: 'order',
        total: Number(r.total) || 0,
      })),
      ...projects.map(r => ({
        icon: '📐',
        label: r.name,
        subtitle: r.jobAddress || '(No address)',
        href: `/dashboard/projects/${r.id}`,
        type: 'project',
      })),
      ...invoices.map(r => ({
        icon: '💳',
        label: r.invoiceNumber,
        subtitle: `Invoice ${r.status}`,
        href: `/dashboard/invoices?filter=${r.id}`,
        type: 'invoice',
        total: Number(r.total) || 0,
      })),
    ]

    return NextResponse.json({ results })
  } catch (e: any) {
    console.error('Search error:', e)
    return NextResponse.json({ results: [] })
  }
}
