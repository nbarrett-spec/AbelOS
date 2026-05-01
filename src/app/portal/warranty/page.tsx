/**
 * Builder Portal — Warranty.
 *
 * Phase 4 of BUILDER-PORTAL-SPEC.md (§4.11).
 *
 * Server fetches /api/builders/warranty (claims + active warranty
 * policies for the dropdown). Client owns the claim submission form
 * and renders the existing claims list.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import {
  WarrantyClient,
  type WarrantyClaim,
  type WarrantyPolicy,
} from './_WarrantyClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Warranty',
  description: 'File and track warranty claims.',
}

interface WarrantyResponse {
  claims: WarrantyClaim[]
  policies: WarrantyPolicy[]
}

async function fetchWarranty(): Promise<WarrantyResponse> {
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
    const url = `${proto}://${host}/api/builders/warranty`
    const res = await fetch(url, {
      headers: { cookie: cookieStore.toString() },
      cache: 'no-store',
    })
    if (!res.ok) return { claims: [], policies: [] }
    return (await res.json()) as WarrantyResponse
  } catch {
    return { claims: [], policies: [] }
  }
}

export default async function PortalWarrantyPage() {
  const session = await getSession()
  if (!session) return null

  const { claims, policies } = await fetchWarranty()

  return (
    <Suspense fallback={null}>
      <WarrantyClient claims={claims} policies={policies} />
    </Suspense>
  )
}
