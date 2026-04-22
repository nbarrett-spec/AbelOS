export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

const INFLOW_BASE = 'https://cloudapi.inflowinventory.com'

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/integrations/inflow/debug
//   Diagnostic: fetches 1 page (2 records) from each InFlow endpoint
//   and returns the raw JSON so we can verify field names and response shapes.
// ─────────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const apiKey = process.env.INFLOW_API_KEY
  const companyId = process.env.INFLOW_COMPANY_ID

  if (!apiKey || !companyId) {
    return NextResponse.json({ error: 'INFLOW_API_KEY or INFLOW_COMPANY_ID not set' }, { status: 400 })
  }

  const headers: Record<string, string> = {
    'Authorization': `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json;version=2026-02-24',
  }

  const results: Record<string, any> = {}

  // Test each endpoint
  const endpoints = [
    { name: 'products', path: '/products?page=1&pageSize=2&includeInactive=false' },
    { name: 'purchaseOrders', path: '/purchase-orders?page=1&pageSize=2' },
    { name: 'salesOrders', path: '/sales-orders?page=1&pageSize=2' },
    { name: 'vendors', path: '/vendors?page=1&pageSize=2' },
    { name: 'customers', path: '/customers?page=1&pageSize=2' },
  ]

  for (const ep of endpoints) {
    try {
      const url = `${INFLOW_BASE}/${companyId}${ep.path}`
      const res = await fetch(url, { headers })
      const status = res.status

      if (!res.ok) {
        const text = await res.text()
        results[ep.name] = { status, error: text.substring(0, 500) }
      } else {
        const data = await res.json()
        // Return the raw shape — first 2 items if array
        const items = Array.isArray(data) ? data : (data.data || data)
        results[ep.name] = {
          status,
          isArray: Array.isArray(data),
          hasDataProp: !!data.data,
          totalCount: data.totalCount ?? data.total ?? null,
          itemCount: Array.isArray(items) ? items.length : 'not_array',
          topLevelKeys: Object.keys(data),
          firstItem: Array.isArray(items) && items.length > 0 ? items[0] : null,
          firstItemKeys: Array.isArray(items) && items.length > 0 ? Object.keys(items[0]) : [],
        }
      }
    } catch (err: any) {
      results[ep.name] = { error: err.message }
    }
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    companyId,
    results,
  })
}
