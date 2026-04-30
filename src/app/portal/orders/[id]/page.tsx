/**
 * Builder Portal — Order detail.
 *
 * Phase 2 of BUILDER-PORTAL-SPEC.md (§4.2.1).
 *
 * Server fetches /api/orders/[id] (already builder-scoped). On 404 it
 * redirects through Next's not-found.tsx file. On success the
 * _OrderDetailClient renders the timeline, line items, totals, and
 * the reorder action.
 */

import { Suspense } from 'react'
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { OrderDetailClient, type OrderDetailPayload } from './_OrderDetailClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Order ${id.slice(0, 8).toUpperCase()}`,
    description: 'Order detail and timeline.',
  }
}

async function fetchOrder(id: string): Promise<OrderDetailPayload | null> {
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
    const url = `${proto}://${host}/api/orders/${encodeURIComponent(id)}`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as OrderDetailPayload
  } catch {
    return null
  }
}

export default async function PortalOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) return null

  const { id } = await params
  const order = await fetchOrder(id)
  if (!order) notFound()

  return (
    <Suspense fallback={null}>
      <OrderDetailClient order={order} />
    </Suspense>
  )
}
