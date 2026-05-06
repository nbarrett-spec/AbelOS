export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { clearSession } from '@/lib/auth'

export async function POST() {
  try {
    await clearSession()
    return NextResponse.json({ success: true })
  } catch (err: any) {
    console.error('POST /api/auth/logout error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
