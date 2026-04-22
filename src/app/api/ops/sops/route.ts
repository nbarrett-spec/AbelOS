export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { parseRoles } from '@/lib/permissions'
import { getSOPsForRole, getSOPsForPage, getSOPsByCategory, CATEGORY_LABELS } from '@/lib/sops'
import type { StaffRole } from '@/lib/permissions'

// GET /api/ops/sops — Get SOPs for the current user's role(s)
// Query params:
//   page=<route>    — filter by page route (e.g., /ops/orders)
//   category=<cat>  — filter by category
//   grouped=true    — return grouped by category

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffRole = request.headers.get('x-staff-role') || 'VIEWER'
  const staffRoles = parseRoles(request.headers.get('x-staff-roles') || staffRole) as StaffRole[]

  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page')
  const category = searchParams.get('category')
  const grouped = searchParams.get('grouped') === 'true'

  if (grouped) {
    const byCategory = getSOPsByCategory(staffRoles)
    return NextResponse.json({
      categories: Object.entries(byCategory).map(([cat, sops]) => ({
        category: cat,
        label: CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat,
        sops: sops.map(s => ({ id: s.id, title: s.title, category: s.category, stepCount: s.steps.length })),
      })),
    })
  }

  let sops = page ? getSOPsForPage(page, staffRoles) : getSOPsForRole(staffRoles)

  if (category) {
    sops = sops.filter(s => s.category === category)
  }

  return NextResponse.json({
    sops: sops.map(s => ({
      id: s.id,
      title: s.title,
      category: s.category,
      steps: s.steps,
      tips: s.tips || [],
      troubleshooting: s.troubleshooting || [],
    })),
    total: sops.length,
  })
}
