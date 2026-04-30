/**
 * Builder Portal — New Quote (multi-step builder).
 *
 * Phase 3 of BUILDER-PORTAL-SPEC.md (§4.5).
 *
 * Server-side: hydrates the current cart from `/api/catalog/cart` and the
 * builder's communities from PortalContext. Hands off to the QuoteBuilder
 * client component.
 *
 * Submission path: this builder uses the cart-based `POST /api/quotes`
 * endpoint (which writes a real Quote record), not the public
 * `/api/builders/quote-request` (which writes a QuoteRequest staging row).
 * Per spec the latter is for first-time/anonymous flow; an authed builder
 * with line items already wants a Quote.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { QuoteBuilder, type CartItem } from './_QuoteBuilder'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'New Quote',
  description: 'Build a new quote.',
}

async function fetchCart(): Promise<CartItem[]> {
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
    const url = `${proto}://${host}/api/catalog/cart`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { items?: CartItem[] }
    return data.items ?? []
  } catch {
    return []
  }
}

export default async function PortalNewQuotePage() {
  const session = await getSession()
  if (!session) return null

  const cart = await fetchCart()

  return (
    <Suspense fallback={null}>
      <QuoteBuilder initialCart={cart} />
    </Suspense>
  )
}
