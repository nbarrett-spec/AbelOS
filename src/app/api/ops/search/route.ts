export const dynamic = 'force-dynamic'

import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

interface SearchResult {
  label: string
  subtitle: string
  href: string
}

interface SearchCategory {
  category: string
  items: SearchResult[]
}

interface SearchResponse {
  results: SearchCategory[]
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams
    const q = searchParams.get('q')?.trim()

    // Validate search term
    if (!q || q.length < 2) {
      return NextResponse.json({ results: [] })
    }

    const searchTerm = q

    // Execute all searches in parallel
    const [jobs, purchaseOrders, builders, products, vendors, staff] = await Promise.all([
      // Search Jobs
      prisma.$queryRawUnsafe(
        `SELECT id, "jobNumber", "jobAddress", community, "builderName"
         FROM "Job"
         WHERE "jobNumber" ILIKE '%' || $1 || '%'
            OR "jobAddress" ILIKE '%' || $1 || '%'
            OR community ILIKE '%' || $1 || '%'
            OR "builderName" ILIKE '%' || $1 || '%'
         LIMIT 5`,
        searchTerm
      ) as Promise<Array<{ id: string; jobNumber: string; jobAddress: string | null; community: string | null; builderName: string }>>,

      // Search Purchase Orders
      prisma.$queryRawUnsafe(
        `SELECT id, "poNumber", notes
         FROM "PurchaseOrder"
         WHERE "poNumber" ILIKE '%' || $1 || '%'
            OR notes ILIKE '%' || $1 || '%'
         LIMIT 5`,
        searchTerm
      ) as Promise<Array<{ id: string; poNumber: string; notes: string | null }>>,

      // Search Builders
      prisma.$queryRawUnsafe(
        `SELECT id, "companyName", "contactName", email
         FROM "Builder"
         WHERE "companyName" ILIKE '%' || $1 || '%'
            OR "contactName" ILIKE '%' || $1 || '%'
            OR email ILIKE '%' || $1 || '%'
         LIMIT 5`,
        searchTerm
      ) as Promise<Array<{ id: string; companyName: string; contactName: string; email: string }>>,

      // Search Products
      prisma.$queryRawUnsafe(
        `SELECT id, name, sku
         FROM "Product"
         WHERE name ILIKE '%' || $1 || '%'
            OR sku ILIKE '%' || $1 || '%'
         LIMIT 5`,
        searchTerm
      ) as Promise<Array<{ id: string; name: string; sku: string }>>,

      // Search Vendors
      prisma.$queryRawUnsafe(
        `SELECT id, name, code
         FROM "Vendor"
         WHERE name ILIKE '%' || $1 || '%'
            OR code ILIKE '%' || $1 || '%'
         LIMIT 5`,
        searchTerm
      ) as Promise<Array<{ id: string; name: string; code: string }>>,

      // Search Staff
      prisma.$queryRawUnsafe(
        `SELECT id, "firstName", "lastName", email
         FROM "Staff"
         WHERE "firstName" ILIKE '%' || $1 || '%'
            OR "lastName" ILIKE '%' || $1 || '%'
            OR email ILIKE '%' || $1 || '%'
         LIMIT 5`,
        searchTerm
      ) as Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>>,
    ])

    const results: SearchCategory[] = []

    // Format Jobs
    if (jobs && jobs.length > 0) {
      results.push({
        category: 'Jobs',
        items: jobs.map((job) => ({
          label: job.jobNumber,
          subtitle: `${job.jobAddress || 'No address'}${job.community ? ` - ${job.community}` : ''}`,
          href: `/ops/jobs/${job.id}`,
        })),
      })
    }

    // Format Purchase Orders
    if (purchaseOrders && purchaseOrders.length > 0) {
      results.push({
        category: 'Purchase Orders',
        items: purchaseOrders.map((po) => ({
          label: po.poNumber,
          subtitle: po.notes ? po.notes.substring(0, 60) : 'No notes',
          href: `/ops/purchasing/${po.id}`,
        })),
      })
    }

    // Format Builders
    if (builders && builders.length > 0) {
      results.push({
        category: 'Builders',
        items: builders.map((builder) => ({
          label: builder.companyName,
          subtitle: `${builder.contactName || 'N/A'} • ${builder.email}`,
          href: `/ops/accounts/${builder.id}`,
        })),
      })
    }

    // Format Products
    if (products && products.length > 0) {
      results.push({
        category: 'Products',
        items: products.map((product) => ({
          label: product.name,
          subtitle: `SKU: ${product.sku}`,
          href: `/ops/products/${product.id}`,
        })),
      })
    }

    // Format Vendors
    if (vendors && vendors.length > 0) {
      results.push({
        category: 'Vendors',
        items: vendors.map((vendor) => ({
          label: vendor.name,
          subtitle: `Code: ${vendor.code}`,
          href: `/ops/vendors/${vendor.id}`,
        })),
      })
    }

    // Format Staff
    if (staff && staff.length > 0) {
      results.push({
        category: 'Staff',
        items: staff.map((member) => ({
          label: `${member.firstName} ${member.lastName}`,
          subtitle: member.email,
          href: `/ops/staff/${member.id}`,
        })),
      })
    }

    return NextResponse.json({ results })
  } catch (error) {
    console.error('Search error:', error)
    return NextResponse.json({ results: [], error: 'Search failed' }, { status: 500 })
  }
}
