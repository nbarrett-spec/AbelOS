/**
 * Builder Portal — Dashboard.
 *
 * Phase 1 of BUILDER-PORTAL-SPEC.md (§4.1).
 *
 * Server component that fetches initial data from the existing builder APIs
 * (analytics + recent orders) and hands off to a client component for the
 * role-aware widget composition (KPIs, quick actions, recent orders, activity).
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import type {
  AnalyticsResponse,
  OrderSearchResponse,
} from '@/types/portal'
import { DashboardClient } from './_dashboard/DashboardClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Dashboard',
  description: 'Your active orders, deliveries, and spend at a glance.',
}

async function fetchJson<T>(path: string): Promise<T | null> {
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
    const url = `${proto}://${host}${path}`

    const res = await fetch(url, {
      headers: {
        cookie: cookieStore.toString(),
      },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export default async function PortalDashboardPage() {
  const session = await getSession()
  if (!session) return null // layout handles redirect

  // Fetch in parallel — both endpoints already scope by builderId from cookie.
  const [analytics, recentOrders] = await Promise.all([
    fetchJson<AnalyticsResponse>('/api/builder/analytics'),
    fetchJson<OrderSearchResponse>('/api/builder/orders/search?limit=5&sort=createdAt:desc'),
  ])

  return (
    <Suspense fallback={null}>
      <DashboardClient
        firstName={session.companyName.split(' ')[0]}
        analytics={analytics}
        recentOrders={recentOrders?.orders ?? []}
      />
    </Suspense>
  )
}
