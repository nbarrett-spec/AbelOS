/**
 * Builder Portal — Documents.
 *
 * Phase 4 of BUILDER-PORTAL-SPEC.md (§4.9).
 *
 * Server fetches invoices + quotes in parallel; statements are derived
 * from the existing /api/builder/statement/export endpoint (one row per
 * builder per month — we synthesize a row for the current and prior
 * month). Client owns tab filtering and the batch-pay flow.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import {
  DocumentsClient,
  type InvoiceRow,
  type QuoteRow,
} from './_DocumentsClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Documents',
  description: 'Invoices, statements, and quotes.',
}

interface InvoicesResponse {
  invoices: InvoiceRow[]
  summary: {
    totalOutstanding: number
    overdueAmount: number
    overdueCount: number
    openCount: number
    paidThisMonth: number
    totalInvoices: number
  }
}

interface QuotesResponse {
  quotes: QuoteRow[]
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
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return null
    return (await res.json()) as T
  } catch {
    return null
  }
}

export default async function PortalDocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; payment?: string }>
}) {
  const session = await getSession()
  if (!session) return null

  const sp = await searchParams

  const [invoiceRes, quoteRes] = await Promise.all([
    fetchJson<InvoicesResponse>('/api/invoices'),
    fetchJson<QuotesResponse>('/api/quotes'),
  ])

  return (
    <Suspense fallback={null}>
      <DocumentsClient
        invoices={invoiceRes?.invoices ?? []}
        summary={invoiceRes?.summary ?? null}
        quotes={quoteRes?.quotes ?? []}
        initialTab={sp.tab ?? 'all'}
        paymentResult={sp.payment ?? null}
      />
    </Suspense>
  )
}
