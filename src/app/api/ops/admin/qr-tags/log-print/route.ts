export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ────────────────────────────────────────────────────────────────────────────
// QR Tag Print Log
// POST { kind: 'product'|'bay'|'pallet', count: number, ids?: string[], label?: string }
// Writes one AuditLog entry per print action — compliance trail for who
// printed which sheet and when.
// ────────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const body = await request.json().catch(() => ({}))
    const kind = String(body.kind || '').toLowerCase()
    const count = Math.max(0, parseInt(String(body.count ?? 0), 10) || 0)
    const ids = Array.isArray(body.ids) ? body.ids.slice(0, 500).map(String) : undefined
    const label = body.label ? String(body.label).slice(0, 120) : undefined

    if (!['product', 'bay', 'pallet'].includes(kind)) {
      return NextResponse.json(
        { error: 'Invalid kind. Use product|bay|pallet.' },
        { status: 400 }
      )
    }

    if (count <= 0) {
      return NextResponse.json({ error: 'count must be > 0' }, { status: 400 })
    }

    const auditId = await audit(
      request,
      'PRINT',
      'QRTagSheet',
      undefined,
      { kind, count, ids, label },
      'INFO'
    )

    return NextResponse.json({ ok: true, auditId, kind, count })
  } catch (error: any) {
    console.error('[qr-tags/log-print] POST error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to log print' },
      { status: 500 }
    )
  }
}
