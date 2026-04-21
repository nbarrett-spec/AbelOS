export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { clearStaffSession } from '@/lib/staff-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/auth/logout — Staff logout
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Capture staff headers before the session is cleared — audit() reads
    // them synchronously.
    audit(request, 'LOGOUT', 'Staff', request.headers.get('x-staff-id') || undefined).catch(() => {})
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
