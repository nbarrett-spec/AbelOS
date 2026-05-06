/**
 * Global search across all major entities.
 *
 * Returns top 5 hits per entity type for the given query. Used by the
 * Command Menu (Cmd+K) in the ops layout. Ports the shape of the MCP
 * `global_search` tool but covers more entities (Orders, Quotes, Invoices,
 * Communities) and tighter typing.
 *
 * GET /api/ops/global-search?q=<term>   (staff auth)
 *
 *   200 → { jobs, orders, builders, products, vendors,
 *           purchaseOrders, quotes, invoices, communities }
 *
 * Each list capped at 5 rows. ILIKE %q% on the documented columns.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

const PER_ENTITY_LIMIT = 5

export interface GlobalSearchHit {
  id: string
  label: string
  subtitle?: string
  href: string
}

export interface GlobalSearchResponse {
  query: string
  jobs: GlobalSearchHit[]
  orders: GlobalSearchHit[]
  builders: GlobalSearchHit[]
  products: GlobalSearchHit[]
  vendors: GlobalSearchHit[]
  purchaseOrders: GlobalSearchHit[]
  quotes: GlobalSearchHit[]
  invoices: GlobalSearchHit[]
  communities: GlobalSearchHit[]
  totals: Record<string, number>
}

function emptyResponse(query: string): GlobalSearchResponse {
  return {
    query,
    jobs: [],
    orders: [],
    builders: [],
    products: [],
    vendors: [],
    purchaseOrders: [],
    quotes: [],
    invoices: [],
    communities: [],
    totals: {
      jobs: 0,
      orders: 0,
      builders: 0,
      products: 0,
      vendors: 0,
      purchaseOrders: 0,
      quotes: 0,
      invoices: 0,
      communities: 0,
    },
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const q = request.nextUrl.searchParams.get('q')?.trim() ?? ''
  if (q.length < 2) {
    return NextResponse.json(emptyResponse(q))
  }

  const ilike = { contains: q, mode: 'insensitive' as const }

  try {
    const [
      jobs,
      orders,
      builders,
      products,
      vendors,
      purchaseOrders,
      quotes,
      invoices,
      communities,
    ] = await Promise.all([
      prisma.job.findMany({
        where: {
          OR: [
            { jobNumber: ilike },
            { jobAddress: ilike },
            { community: ilike },
            { builderName: ilike },
          ],
        },
        select: {
          id: true,
          jobNumber: true,
          jobAddress: true,
          community: true,
          builderName: true,
          status: true,
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.findMany({
        where: { OR: [{ orderNumber: ilike }, { poNumber: ilike }] },
        select: {
          id: true,
          orderNumber: true,
          status: true,
          total: true,
          builder: { select: { companyName: true } },
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.builder.findMany({
        where: {
          OR: [{ companyName: ilike }, { contactName: ilike }, { email: ilike }],
        },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          email: true,
          status: true,
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { companyName: 'asc' },
      }),
      prisma.product.findMany({
        where: { OR: [{ name: ilike }, { sku: ilike }] },
        select: { id: true, sku: true, name: true, basePrice: true },
        take: PER_ENTITY_LIMIT,
        orderBy: { name: 'asc' },
      }),
      prisma.vendor.findMany({
        where: { OR: [{ name: ilike }, { code: ilike }, { email: ilike }] },
        select: { id: true, name: true, code: true, active: true },
        take: PER_ENTITY_LIMIT,
        orderBy: { name: 'asc' },
      }),
      prisma.purchaseOrder.findMany({
        where: { OR: [{ poNumber: ilike }, { vendor: { name: ilike } }] },
        select: {
          id: true,
          poNumber: true,
          status: true,
          total: true,
          vendor: { select: { name: true } },
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.quote.findMany({
        where: { quoteNumber: ilike },
        select: {
          id: true,
          quoteNumber: true,
          status: true,
          total: true,
          project: { select: { builder: { select: { companyName: true } } } },
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.invoice.findMany({
        where: { invoiceNumber: ilike },
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          total: true,
          balanceDue: true,
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.community.findMany({
        where: { OR: [{ name: ilike }, { code: ilike }] },
        select: {
          id: true,
          name: true,
          code: true,
          city: true,
          state: true,
          builder: { select: { companyName: true } },
        },
        take: PER_ENTITY_LIMIT,
        orderBy: { name: 'asc' },
      }),
    ])

    const response: GlobalSearchResponse = {
      query: q,
      jobs: jobs.map((j) => ({
        id: j.id,
        label: j.jobNumber,
        subtitle: [j.jobAddress, j.community, j.builderName].filter(Boolean).join(' • '),
        href: `/ops/jobs/${j.id}`,
      })),
      orders: orders.map((o) => ({
        id: o.id,
        label: o.orderNumber,
        subtitle: [o.builder?.companyName, o.status, `$${(o.total ?? 0).toLocaleString()}`]
          .filter(Boolean)
          .join(' • '),
        href: `/ops/orders?q=${encodeURIComponent(o.orderNumber)}`,
      })),
      builders: builders.map((b) => ({
        id: b.id,
        label: b.companyName,
        subtitle: [b.contactName, b.email].filter(Boolean).join(' • '),
        href: `/ops/accounts/${b.id}`,
      })),
      products: products.map((p) => ({
        id: p.id,
        label: p.name,
        subtitle: `SKU: ${p.sku}`,
        href: `/ops/products/${p.id}`,
      })),
      vendors: vendors.map((v) => ({
        id: v.id,
        label: v.name,
        subtitle: v.code ? `Code: ${v.code}` : undefined,
        href: `/ops/vendors/${v.id}`,
      })),
      purchaseOrders: purchaseOrders.map((po) => ({
        id: po.id,
        label: po.poNumber,
        subtitle: [po.vendor?.name, po.status, `$${(po.total ?? 0).toLocaleString()}`]
          .filter(Boolean)
          .join(' • '),
        href: `/ops/purchasing/${po.id}`,
      })),
      quotes: quotes.map((q) => ({
        id: q.id,
        label: q.quoteNumber,
        subtitle: [q.project?.builder?.companyName, q.status, `$${(q.total ?? 0).toLocaleString()}`]
          .filter(Boolean)
          .join(' • '),
        href: `/ops/quotes?q=${encodeURIComponent(q.quoteNumber)}`,
      })),
      invoices: invoices.map((inv) => ({
        id: inv.id,
        label: inv.invoiceNumber,
        subtitle: [inv.status, `Bal: $${(inv.balanceDue ?? 0).toLocaleString()}`]
          .filter(Boolean)
          .join(' • '),
        href: `/ops/finance/ar?q=${encodeURIComponent(inv.invoiceNumber)}`,
      })),
      communities: communities.map((c) => ({
        id: c.id,
        label: c.name,
        subtitle: [c.builder?.companyName, [c.city, c.state].filter(Boolean).join(', ')]
          .filter(Boolean)
          .join(' • '),
        href: `/ops/communities/${c.id}`,
      })),
      totals: {
        jobs: jobs.length,
        orders: orders.length,
        builders: builders.length,
        products: products.length,
        vendors: vendors.length,
        purchaseOrders: purchaseOrders.length,
        quotes: quotes.length,
        invoices: invoices.length,
        communities: communities.length,
      },
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('global-search error:', error)
    return NextResponse.json(
      { ...emptyResponse(q), error: 'Search failed' },
      { status: 500 },
    )
  }
}
