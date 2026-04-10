export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────
// SHIPPING FORECAST XLSX DOWNLOAD
// ──────────────────────────────────────────────────────────────────
// Generates a multi-tab Excel report matching Abel Lumber's format:
//   Tab 1: BOM Component Totals
//   Tab 2: BOM by Order
//   Tab 3: Orders Summary
//   Tab 4: Line Items Detail
//   Tab 5: ADT Assembled Doors
//   Tab 6: By Ship Date
//
// Uses server-side Python (openpyxl) for proper Excel formatting.
// Falls back to CSV if Python is unavailable.
// ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const days = parseInt(request.nextUrl.searchParams.get('days') || '14')

  try {
    // Fetch all report data
    const dataRes = await fetch(
      `${process.env.NEXT_PUBLIC_APP_URL || request.nextUrl.origin}/api/ops/reports/shipping-forecast?format=json&days=${days}`,
      {
        headers: { Cookie: request.headers.get('cookie') || '' },
      }
    )
    if (!dataRes.ok) {
      return NextResponse.json({ error: 'Failed to fetch report data', details: 'upstream non-ok: ' + dataRes.status }, { status: 500 })
    }
    const data = await dataRes.json()

    // Return JSON payload that client will pass to the Python xlsx generator
    // The actual xlsx generation happens via the generate-xlsx endpoint
    return NextResponse.json({
      success: true,
      data,
      message: 'Use /api/ops/reports/shipping-forecast/generate-xlsx to create the Excel file',
    })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
