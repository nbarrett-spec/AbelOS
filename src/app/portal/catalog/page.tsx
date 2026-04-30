/**
 * Builder Portal — Catalog grid.
 *
 * Phase 2 of BUILDER-PORTAL-SPEC.md (§4.4).
 *
 * Server fetches /api/catalog with builder-tier pricing already applied.
 * The client component owns search, category tab, and pagination.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import type { CatalogResponse } from '@/types/portal'
import { CatalogClient } from './_CatalogClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Catalog',
  description: 'Browse our product catalog with your tier pricing.',
}

interface SearchParams {
  search?: string
  category?: string
  page?: string
  limit?: string
}

async function fetchCatalog(
  search: SearchParams,
): Promise<CatalogResponse | null> {
  try {
    const cookieStore = await cookies()
    const headerStore = await headers()
    const proto =
      headerStore.get('x-forwarded-proto') ||
      (process.env.NODE_ENV === 'production' ? 'https' : 'http')
    const host =
      headerStore.get('x-forwarded-host') ||
      headerStore.get('host') ||
      `localhost:${process.env.PORT || 3000}`

    const params = new URLSearchParams()
    if (search.search) params.set('search', search.search)
    if (search.category && search.category !== 'All')
      params.set('category', search.category)
    params.set('page', search.page ?? '1')
    params.set('limit', search.limit ?? '40')

    const url = `${proto}://${host}/api/catalog?${params.toString()}`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as CatalogResponse
  } catch {
    return null
  }
}

export default async function PortalCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) return null

  const sp = await searchParams
  const initial = await fetchCatalog(sp)

  return (
    <Suspense fallback={null}>
      <CatalogClient
        initialData={initial}
        initialSearch={sp.search ?? ''}
        initialCategory={sp.category ?? 'All'}
        initialPage={parseInt(sp.page ?? '1', 10)}
        initialLimit={parseInt(sp.limit ?? '40', 10)}
      />
    </Suspense>
  )
}
