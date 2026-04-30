/**
 * Builder Portal — Orders list.
 *
 * Phase 2 of BUILDER-PORTAL-SPEC.md (§4.2).
 *
 * Server component fetches the first page from /api/builder/orders/search
 * (which scopes by builderId from the abel_session cookie) then hands off
 * to the client component for filter tabs, search, and pagination.
 *
 * Status filter tabs reload the page server-side via URL query string
 * (`?status=...`) so a deep link is shareable. The pagination + search
 * box are pure client interactions inside _OrdersClient.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import type { OrderSearchResponse } from '@/types/portal'
import { OrdersClient } from './_OrdersClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Orders',
  description: 'Track and manage your active and past orders.',
}

interface SearchParams {
  q?: string
  status?: string
  page?: string
  limit?: string
}

async function fetchOrders(
  search: SearchParams,
): Promise<OrderSearchResponse | null> {
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
    if (search.q) params.set('q', search.q)
    if (search.status) params.set('status', search.status)
    params.set('page', search.page ?? '1')
    params.set('limit', search.limit ?? '20')

    const url = `${proto}://${host}/api/builder/orders/search?${params.toString()}`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as OrderSearchResponse
  } catch {
    return null
  }
}

export default async function PortalOrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const session = await getSession()
  if (!session) return null

  const sp = await searchParams
  const initial = await fetchOrders(sp)

  return (
    <Suspense fallback={null}>
      <OrdersClient
        initialData={initial}
        initialQuery={sp.q ?? ''}
        initialStatus={sp.status ?? ''}
        initialPage={parseInt(sp.page ?? '1', 10)}
        initialLimit={parseInt(sp.limit ?? '20', 10)}
      />
    </Suspense>
  )
}
