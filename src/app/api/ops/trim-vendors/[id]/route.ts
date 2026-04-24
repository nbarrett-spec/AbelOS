export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { parseRoles, StaffRole } from '@/lib/permissions'

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
// GET — single trim vendor
// ──────────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  const roleError = checkRole(request)
  if (roleError) return roleError

  try {
    const vendor = await prisma.trimVendor.findUnique({ where: { id: params.id } })
    if (!vendor) {
      return NextResponse.json({ error: 'Trim vendor not found' }, { status: 404 })
    }
    return NextResponse.json({ vendor }, { status: 200 })
  } catch (error) {
    console.error('GET /api/ops/trim-vendors/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch trim vendor' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH — update any subset of fields
// Accepts: name, contactEmail, contactPhone, rates, notes, active
// ──────────────────────────────────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  const roleError = checkRole(request)
  if (roleError) return roleError

  try {
    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }

    const existing = await prisma.trimVendor.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Trim vendor not found' }, { status: 404 })
    }

    const data: Record<string, any> = {}

    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) {
        return NextResponse.json(
          { error: 'name must be non-empty when provided' },
          { status: 400 }
        )
      }
      data.name = name
    }

    if (body.contactEmail !== undefined) {
      data.contactEmail = typeof body.contactEmail === 'string'
        ? body.contactEmail.trim() || null
        : null
    }

    if (body.contactPhone !== undefined) {
      data.contactPhone = typeof body.contactPhone === 'string'
        ? body.contactPhone.trim() || null
        : null
    }

    if (body.notes !== undefined) {
      data.notes = typeof body.notes === 'string' ? body.notes.trim() || null : null
    }

    if (body.rates !== undefined) {
      if (body.rates && typeof body.rates === 'object' && !Array.isArray(body.rates)) {
        data.rates = body.rates
      } else {
        return NextResponse.json(
          { error: 'rates must be a JSON object of { categoryKey: number }' },
          { status: 400 }
        )
      }
    }

    if (body.active !== undefined) {
      data.active = !!body.active
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ vendor: existing }, { status: 200 })
    }

    const vendor = await prisma.trimVendor.update({
      where: { id: params.id },
      data,
    })

    audit(request, 'UPDATE', 'TrimVendor', vendor.id, { fields: Object.keys(data) }).catch(() => {})

    return NextResponse.json({ vendor }, { status: 200 })
  } catch (error) {
    console.error('PATCH /api/ops/trim-vendors/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to update trim vendor' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE — soft delete (active = false). Hard-delete is forbidden so rate
// history can still be referenced from prior labor estimates.
// ──────────────────────────────────────────────────────────────────────────
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError
  const roleError = checkRole(request)
  if (roleError) return roleError

  try {
    const existing = await prisma.trimVendor.findUnique({ where: { id: params.id } })
    if (!existing) {
      return NextResponse.json({ error: 'Trim vendor not found' }, { status: 404 })
    }

    if (!existing.active) {
      return NextResponse.json(
        { vendor: existing, message: 'Trim vendor was already inactive' },
        { status: 200 }
      )
    }

    const vendor = await prisma.trimVendor.update({
      where: { id: params.id },
      data: { active: false },
    })

    audit(request, 'DEACTIVATE', 'TrimVendor', vendor.id, { name: vendor.name }).catch(() => {})

    return NextResponse.json(
      { vendor, message: 'Trim vendor deactivated' },
      { status: 200 }
    )
  } catch (error) {
    console.error('DELETE /api/ops/trim-vendors/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to deactivate trim vendor' },
      { status: 500 }
    )
  }
}
