/**
 * Builder Portal — Spend & Analytics.
 *
 * Phase 3 of BUILDER-PORTAL-SPEC.md (§4.7).
 *
 * Server fetches in parallel:
 *   - /api/builder/analytics  (monthly, top products, spend by category, KPIs)
 *   - /api/builder/volume-savings  (tier + estimated savings per tier)
 *   - /api/builder/pricing-intelligence  (tier status, savings breakdown)
 *
 * Cost-predictor is fetched client-side (lazy) since exec-only and not
 * always available. The client component wires:
 *   - Period selector (MTD / QTD / YTD)
 *   - 4 KPI cards
 *   - 2x2 SVG chart grid (no Chart.js — same pattern as DashboardClient)
 *   - Exec-only volume tier progress
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { getSession } from '@/lib/auth'
import type { AnalyticsResponse } from '@/types/portal'
import {
  AnalyticsClient,
  type VolumeSavingsResponse,
  type PricingIntelligenceResponse,
} from './_AnalyticsClient'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Analytics',
  description: 'Spend, savings, and forecasting.',
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

export default async function PortalAnalyticsPage() {
  const session = await getSession()
  if (!session) return null

  const [analytics, volume, pricing] = await Promise.all([
    fetchJson<AnalyticsResponse>('/api/builder/analytics'),
    fetchJson<VolumeSavingsResponse>('/api/builder/volume-savings'),
    fetchJson<PricingIntelligenceResponse>('/api/builder/pricing-intelligence'),
  ])

  return (
    <Suspense fallback={null}>
      <AnalyticsClient
        analytics={analytics}
        volume={volume}
        pricing={pricing}
      />
    </Suspense>
  )
}
