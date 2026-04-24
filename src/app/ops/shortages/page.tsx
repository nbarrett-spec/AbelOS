// /ops/shortages — Forecast shortage viewer for the MRP surface.
//
// Reads DemandForecast through /api/ops/shortages on render and hands the
// payload to <ShortageTable /> (client) which owns the filter state and
// refetches. Safe to SSR because the API endpoint is idempotent and
// checkStaffAuth will pass through the inherited staff cookie when fetch
// runs inside a Next.js server component.

import { cookies, headers } from 'next/headers'
import { notFound } from 'next/navigation'
import ShortageTable from './ShortageTable'

export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Forecast Shortages · Aegis',
  description: 'SKUs the demand forecast says we will run short on.',
}

interface ApiResponse {
  asOf: string
  horizonDays: number
  severity: 'all' | 'high'
  vendorId: string | null
  summary: {
    shortSkus: number
    shortageDollars: number
    minDaysOfCoverage: number | null
  }
  items: any[]
  note?: string
}

async function loadInitial(
  horizonDays: number
): Promise<{ data: ApiResponse | null; error: string | null }> {
  try {
    const h = await headers()
    const host = h.get('x-forwarded-host') || h.get('host') || 'localhost:3000'
    const proto = h.get('x-forwarded-proto') || 'http'
    const url = `${proto}://${host}/api/ops/shortages?horizon=${horizonDays}`

    // Forward the staff cookie so checkStaffAuth (via middleware headers)
    // recognises the request. cookies() returns a RequestCookies — fold it
    // back to a Cookie header.
    const c = await cookies()
    const cookieHeader = c
      .getAll()
      .map((x) => `${x.name}=${x.value}`)
      .join('; ')

    const res = await fetch(url, {
      cache: 'no-store',
      headers: {
        cookie: cookieHeader,
        // Forward the staff identity headers set by middleware so the API
        // route's checkStaffAuth can validate without a second round-trip
        // through middleware.
        'x-staff-id': h.get('x-staff-id') || '',
        'x-staff-role': h.get('x-staff-role') || '',
        'x-staff-roles': h.get('x-staff-roles') || '',
        'x-staff-department': h.get('x-staff-department') || '',
        'x-staff-email': h.get('x-staff-email') || '',
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      return { data: null, error: body?.error || `HTTP ${res.status}` }
    }
    const json = (await res.json()) as ApiResponse
    return { data: json, error: null }
  } catch (err: any) {
    return {
      data: null,
      error: err?.message || 'Failed to load shortages',
    }
  }
}

export default async function ShortagesPage() {
  // Feature flag — default ON. Explicit "off" hides the page entirely.
  if (process.env.NEXT_PUBLIC_FEATURE_SHORTAGES === 'off') {
    notFound()
  }

  const { data, error } = await loadInitial(14)

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 sm:px-6 py-6">
      <ShortageTable initial={data} initialError={error} />
    </div>
  )
}
