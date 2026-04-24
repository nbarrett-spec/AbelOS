export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { parseRoles, StaffRole } from '@/lib/permissions'

// ──────────────────────────────────────────────────────────────────────────
// Third-Party Trim Vendor Management
// ──────────────────────────────────────────────────────────────────────────
// Manages outsourced trim install vendors (e.g. "DFW Door", "Texas Innovation")
// and their per-product-category $ rates. Distinct from in-house labor rates
// (those live on Product.laborCost / Product.overheadCost via /api/ops/manufacturing/labor-rates).
//
// NOTE FOR ORCHESTRATOR: /api/ops/trim-vendors is not yet listed in
// src/lib/permissions.ts → API_ACCESS. Without an entry, only ADMIN can
// access it (default-deny). Add the route prefix to API_ACCESS post-wave:
//   '/api/ops/trim-vendors': ['ADMIN', 'MANAGER', 'PURCHASING'],
// ──────────────────────────────────────────────────────────────────────────

const ALLOWED_ROLES: StaffRole[] = ['ADMIN', 'MANAGER', 'PURCHASING']

function checkRole(request: NextRequest): NextResponse | null {
  const staffRolesStr = request.headers.get('x-staff-roles')
  const staffRole = request.headers.get('x-staff-role')
  const allRoles = parseRoles(staffRolesStr || staffRole || '') as StaffRole[]
  if (allRoles.includes('ADMIN')) return null
  const ok = allRoles.some(r => ALLOWED_ROLES.includes(r))
  if (!ok) {
    return NextResponse.json(
      { error: 'Insufficient permissions. ADMIN, MANAGER, or PURCHASING required.' },
      { status: 403 }
    )
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────────
// GET — list all trim vendors. ?active=true filters to active only.
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  const roleError = checkRole(request)
  if (roleError) return roleError

  try {
    const activeParam = request.nextUrl.searchParams.get('active')
    const where = activeParam === 'true' ? { active: true } : undefined

    const vendors = await prisma.trimVendor.findMany({
      where,
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    })

    return NextResponse.json({ vendors }, { status: 200 })
  } catch (error) {
    console.error('GET /api/ops/trim-vendors error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch trim vendors' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST — create a new trim vendor.
// Body: { name, contactEmail?, contactPhone?, rates?: object, notes? }
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  const roleError = checkRole(request)
  if (roleError) return roleError

  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) {
      return NextResponse.json(
        { error: 'name is required and must be non-empty' },
        { status: 400 }
      )
    }

    const contactEmail = typeof body.contactEmail === 'string' ? body.contactEmail.trim() || null : null
    const contactPhone = typeof body.contactPhone === 'string' ? body.contactPhone.trim() || null : null
    const notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    const rates = body.rates && typeof body.rates === 'object' && !Array.isArray(body.rates)
      ? body.rates
      : {}

    const vendor = await prisma.trimVendor.create({
      data: {
        name,
        contactEmail,
        contactPhone,
        notes,
        rates,
        active: true,
      },
    })

    audit(request, 'CREATE', 'TrimVendor', vendor.id, { name }).catch(() => {})

    return NextResponse.json({ vendor }, { status: 201 })
  } catch (error) {
    console.error('POST /api/ops/trim-vendors error:', error)
    return NextResponse.json(
      { error: 'Failed to create trim vendor' },
      { status: 500 }
    )
  }
}
