export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { getStaffSession } from '@/lib/staff-auth'
import { canAccessRoute, parseRoles } from '@/lib/permissions'
import type { StaffRole, PortalOverrides } from '@/lib/permissions'
import { prisma } from '@/lib/prisma'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/auth/me — Get current staff session + permissions (multi-role)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const session = await getStaffSession()

    if (!session) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      )
    }

    // Parse all roles (multi-role support)
    const allRoles = parseRoles(session.roles || session.role) as StaffRole[]

    // Check if user is authorized to access /ops (must be staff with a role, not just any authenticated user)
    // All staff roles should have at least view access
    if (allRoles.length === 0) {
      return NextResponse.json(
        { error: 'Insufficient permissions to access operations portal' },
        { status: 403 }
      )
    }

    // Check if user can access the /ops portal itself
    if (!canAccessRoute(allRoles, '/ops')) {
      return NextResponse.json(
        { error: 'Your role does not have access to the operations portal' },
        { status: 403 }
      )
    }

    // Fetch portal overrides from the database
    let portalOverrides: PortalOverrides | null = null
    try {
      const rows: any[] = await prisma.$queryRawUnsafe(
        `SELECT "portalOverrides" FROM "Staff" WHERE id = $1`,
        session.staffId
      )
      if (rows.length > 0 && rows[0].portalOverrides) {
        portalOverrides = rows[0].portalOverrides as PortalOverrides
      }
    } catch (e) {
      // Column may not exist yet — silently fallback to role defaults
    }

    return NextResponse.json({
      staff: {
        id: session.staffId,
        firstName: session.firstName,
        lastName: session.lastName,
        email: session.email,
        role: session.role,         // Primary role (backward compat)
        roles: allRoles,            // All roles
        department: session.department,
        title: session.title,
        portalOverrides: portalOverrides || {},
      },
      permissions: {
        canViewExecutive: canAccessRoute(allRoles, '/ops/executive', portalOverrides),
        canViewJobs: canAccessRoute(allRoles, '/ops/jobs', portalOverrides),
        canViewAccounts: canAccessRoute(allRoles, '/ops/accounts', portalOverrides),
        canViewManufacturing: canAccessRoute(allRoles, '/ops/manufacturing', portalOverrides),
        canViewSupplyChain: canAccessRoute(allRoles, '/ops/supply-chain', portalOverrides),
        canViewFinance: canAccessRoute(allRoles, '/ops/finance', portalOverrides),
        canViewPortals: canAccessRoute(allRoles, '/ops/portal', portalOverrides),
        canManageStaff: canAccessRoute(allRoles, '/ops/staff', portalOverrides),
        canViewAI: canAccessRoute(allRoles, '/ops/ai', portalOverrides),
        canViewReports: canAccessRoute(allRoles, '/ops/reports', portalOverrides),
        canViewSales: canAccessRoute(allRoles, '/ops/sales', portalOverrides),
        canViewGrowth: canAccessRoute(allRoles, '/ops/growth', portalOverrides),
        canViewDelivery: canAccessRoute(allRoles, '/ops/delivery', portalOverrides),
        canViewSchedule: canAccessRoute(allRoles, '/ops/schedule', portalOverrides),
        canViewCrews: canAccessRoute(allRoles, '/ops/crews', portalOverrides),
        canViewPricing: canAccessRoute(allRoles, '/ops/pricing', portalOverrides),
      },
    })
  } catch (error: any) {
    console.error('Staff /me error:', error)
    return NextResponse.json(
      { error: 'Failed to get session' },
      { status: 500 }
    )
  }
}
