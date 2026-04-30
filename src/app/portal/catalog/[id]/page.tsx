/**
 * Builder Portal — Product detail.
 *
 * Phase 2 of BUILDER-PORTAL-SPEC.md (§4.4.1).
 *
 * Server fetches /api/catalog/[id] which returns the product with builder
 * pricing, alternatives (good/better/best), and related items.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import {
  ProductDetailClient,
  type ProductDetailPayload,
} from './_ProductDetailClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Product ${id.slice(0, 8).toUpperCase()}`,
    description: 'Product specifications and pricing.',
  }
}

async function fetchProduct(id: string): Promise<ProductDetailPayload | null> {
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
    const url = `${proto}://${host}/api/catalog/${encodeURIComponent(id)}`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as ProductDetailPayload
  } catch {
    return null
  }
}

export default async function PortalProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) return null

  const { id } = await params
  const detail = await fetchProduct(id)
  if (!detail) notFound()

  return (
    <Suspense fallback={null}>
      <ProductDetailClient detail={detail} />
    </Suspense>
  )
}
