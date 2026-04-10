export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { getAuditLogs, getAuditStats } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/audit — View audit logs with filtering (Admin + Manager only)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Only Admin and Manager can view audit logs
  const roles = (request.headers.get('x-staff-roles') || request.headers.get('x-staff-role') || '').split(',')
  const canView = roles.some(r => ['ADMIN', 'MANAGER'].includes(r.trim()))
  if (!canView) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(request.url)
    const view = searchParams.get('view')

    // Stats summary
    if (view === 'stats') {
      const stats = await getAuditStats()
      return NextResponse.json({ stats })
    }

    // Full logs with filtering
    const entity = searchParams.get('entity') || undefined
    const entityId = searchParams.get('entityId') || undefined
    const action = searchParams.get('action') || undefined
    const staffId = searchParams.get('staffId') || undefined
    const severity = searchParams.get('severity') || undefined
    const search = searchParams.get('search') || undefined
    const startDate = searchParams.get('startDate') || undefined
    const endDate = searchParams.get('endDate') || undefined
    const limit = parseInt(searchParams.get('limit') || '50', 10)
    const offset = parseInt(searchParams.get('offset') || '0', 10)

    const { logs, total } = await getAuditLogs({
      entity, entityId, action, staffId, severity,
      search, startDate, endDate, limit, offset,
    })

    return NextResponse.json({ logs, total, limit, offset })
  } catch (error) {
    console.error('Failed to fetch audit logs:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
