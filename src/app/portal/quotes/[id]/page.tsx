/**
 * Builder Portal — Quote detail.
 *
 * Phase 3 of BUILDER-PORTAL-SPEC.md (§4.4).
 *
 * Server fetches /api/quotes/[id] (already builder-scoped). Client renders
 * line items, totals, and status-aware actions: APPROVED → convert,
 * EXPIRED → requote, otherwise → download PDF.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import {
  QuoteDetailClient,
  type QuoteDetailPayload,
} from './_QuoteDetailClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  return {
    title: `Quote ${id.slice(0, 8).toUpperCase()}`,
    description: 'Quote detail.',
  }
}

async function fetchQuote(id: string): Promise<QuoteDetailPayload | null> {
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
    const url = `${proto}://${host}/api/quotes/${encodeURIComponent(id)}`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as QuoteDetailPayload
  } catch {
    return null
  }
}

export default async function PortalQuoteDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await getSession()
  if (!session) return null

  const { id } = await params
  const quote = await fetchQuote(id)
  if (!quote) notFound()

  return (
    <Suspense fallback={null}>
      <QuoteDetailClient quote={quote} />
    </Suspense>
  )
}
