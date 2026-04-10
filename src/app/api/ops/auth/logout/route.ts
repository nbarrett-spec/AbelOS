export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { clearStaffSession } from '@/lib/staff-auth'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/logout — Staff logout
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    await clearStaffSession()
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Staff logout error:', error)
    return NextResponse.json(
      { error: 'Logout failed' },
      { status: 500 }
    )
  }
}
