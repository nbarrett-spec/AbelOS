export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getPermissions, getFieldAccess, parseRoles, canViewSensitiveFinancials, canViewOperationalFinancials, type StaffRole } from '@/lib/permissions'

// GET /api/ops/auth/permissions — Return current user's permissions (multi-role)
export async function GET(request: NextRequest) {
  try {
    const roleStr = request.headers.get('x-staff-role')
    const rolesStr = request.headers.get('x-staff-roles')
    if (!roleStr) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Parse all roles
    const allRoles = parseRoles(rolesStr || roleStr) as StaffRole[]
    const permissions = getPermissions(allRoles)

    // Also return field access for common sensitive fields
    const fieldAccess: Record<string, string> = {}
    const sensitiveFields = [
      'Deal.dealValue', 'Deal.probability', 'Deal.lostReason',
      'Quote.unitPrice', 'Quote.lineTotal',
      'Invoice.amount',
      'Builder.creditLimit',
      'Staff.salary',
      'Company.cashBalance', 'Company.totalAR', 'Company.totalAP',
      'Company.bankBalance', 'Company.profitMargin',
    ]
    for (const field of sensitiveFields) {
      fieldAccess[field] = getFieldAccess(allRoles, field)
    }

    return NextResponse.json({
      role: roleStr,              // Primary role (backward compat)
      roles: allRoles,            // All roles
      permissions,
      fieldAccess,
      canViewOperationalFinancials: canViewOperationalFinancials(allRoles),
      canViewSensitiveFinancials: canViewSensitiveFinancials(allRoles),
      permissionCount: permissions.length,
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
