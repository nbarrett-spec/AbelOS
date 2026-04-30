/**
 * Builder Portal — Quotes list.
 *
 * Phase 3 of BUILDER-PORTAL-SPEC.md (§4.4).
 *
 * Server fetches /api/quotes (already builder-scoped) and forwards to the
 * client component, which owns the status-tab filtering. The list is small
 * enough that we don't bother with server-side pagination here — most
 * builders have 10-30 quotes total.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import { QuotesClient, type PortalQuoteRow } from './_QuotesClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Quotes',
  description: 'Pending, approved, and expired quotes.',
}

interface QuotesResponse {
  quotes: PortalQuoteRow[]
}

async function fetchQuotes(): Promise<PortalQuoteRow[]> {
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

    const url = `${proto}://${host}/api/quotes`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as QuotesResponse
    return data.quotes ?? []
  } catch {
    return []
  }
}

export default async function PortalQuotesPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const session = await getSession()
  if (!session) return null

  const sp = await searchParams
  const quotes = await fetchQuotes()

  return (
    <Suspense fallback={null}>
      <QuotesClient quotes={quotes} initialStatus={sp.status ?? ''} />
    </Suspense>
  )
}
