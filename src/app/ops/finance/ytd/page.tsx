// ──────────────────────────────────────────────────────────────────────────
// /ops/finance/ytd — single-glance YTD summary page.
//
// Server component: handles feature-flag gating + passes current server-side
// year/asOfMonth to the client charts so first render doesn't flash stale
// browser-clock values. Data itself is fetched client-side so it always
// reflects the latest in-memory cache on the API side.
// ──────────────────────────────────────────────────────────────────────────

import { notFound } from 'next/navigation'
import YtdCharts from './YtdCharts'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'YTD Financial Summary · Aegis',
  description:
    'Revenue, COGS, gross margin and operating expense — year to date with 3-year compare.',
}

export default function YtdPage() {
  // Feature flag — default ON, only disabled when explicitly set to 'off'
  if (process.env.NEXT_PUBLIC_FEATURE_FINANCE_YTD === 'off') {
    notFound()
  }

  const now = new Date()
  const year = now.getUTCFullYear()
  const asOfMonth = now.getUTCMonth() + 1

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1600px] mx-auto">
      <YtdCharts initialYear={year} asOfMonth={asOfMonth} />
    </div>
  )
}
