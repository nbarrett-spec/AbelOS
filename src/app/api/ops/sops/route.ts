export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { parseRoles } from '@/lib/permissions'
import { getSOPsForRole, getSOPsForPage, getSOPsByCategory, CATEGORY_LABELS } from '@/lib/sops'
import type { StaffRole } from '@/lib/permissions'
import { neon } from '@neondatabase/serverless'

// GET /api/ops/sops — Get SOPs for the current user's role(s)
// Query params:
//   page=<route>    — filter by page route (e.g., /ops/orders)
//   category=<cat>  — filter by category
//   grouped=true    — return grouped by category
//   source=files    — return DB-ingested SOP documents (from Sop table)
//   role=<role>     — (files mode) override role filter
//   limit=<n>       — (files mode) cap results (default 5)

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
  const staffRole = request.headers.get('x-staff-role') || 'VIEWER'
  const staffRoles = parseRoles(request.headers.get('x-staff-roles') || staffRole) as StaffRole[]

  const { searchParams } = new URL(request.url)
  const page = searchParams.get('page')
  const category = searchParams.get('category')
  const grouped = searchParams.get('grouped') === 'true'
  const source = searchParams.get('source')

  // ── Files mode: return DB-ingested SOP documents (from Sop table) ──
  if (source === 'files') {
    const sql = neon(process.env.DATABASE_URL as string)
    const roleParam = (searchParams.get('role') || '').toUpperCase()
    const roleFilter = roleParam ? [roleParam] : staffRoles
    const limit = Math.min(parseInt(searchParams.get('limit') || '5', 10), 50)

    // overlaps() on text[] — match if the row's roles share ANY element with ours.
    const rows = await sql`
      SELECT "id", "title", "roles", "department", "filePath", "fileType", "summary", "lastUpdatedAt"
      FROM "Sop"
      WHERE "roles" && ${roleFilter}::text[]
      ORDER BY "lastUpdatedAt" DESC NULLS LAST, "title"
      LIMIT ${limit}
    `
    return NextResponse.json({
      sops: rows.map((r: any) => ({
        id: r.id,
        title: r.title,
        roles: r.roles,
        department: r.department,
        filePath: r.filePath,
        fileType: r.fileType,
        summary: r.summary,
        lastUpdatedAt: r.lastUpdatedAt,
      })),
      total: rows.length,
    })
  }

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
  } catch (error: any) {
    console.error('[SOPs] Error:', error)
    return NextResponse.json({ error: 'Failed to load SOPs' }, { status: 500 })
  }
}
