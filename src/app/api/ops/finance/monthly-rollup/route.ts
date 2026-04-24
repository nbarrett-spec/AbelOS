export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { getMonthlyFinancials } from '@/lib/finance/monthly-rollup'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const yearParam = searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getUTCFullYear()

  if (!Number.isFinite(year) || year < 2000 || year > 2100) {
    return NextResponse.json({ error: 'Invalid year' }, { status: 400 })
  }

  try {
    const rollup = await getMonthlyFinancials(year)
    return NextResponse.json(rollup, {
      headers: { 'Cache-Control': 'private, max-age=30' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
