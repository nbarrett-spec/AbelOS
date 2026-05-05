/**
 * /api/ops/admin/api-keys/[id] — DELETE = revoke (soft).
 *
 * Sets revokedAt + revokedById. The row stays for audit. Once revoked,
 * the key never authenticates again — verifyApiKey() filters by
 * revokedAt IS NULL.
 *
 * No hard-delete endpoint by design — keeping the audit trail is more
 * valuable than the row count.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const role = request.headers.get('x-staff-role')
  const roles = (request.headers.get('x-staff-roles') || role || '')
    .split(',')
    .map((r) => r.trim())
  if (!roles.includes('ADMIN')) {
    return NextResponse.json(
      { error: 'ADMIN role required to revoke API keys' },
      { status: 403 },
    )
  }

  const { id } = await params
  const revokedById = request.headers.get('x-staff-id') || null

  try {
    const existing = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, name: true, revokedAt: true },
    })
    if (!existing) {
      return NextResponse.json({ error: 'API key not found' }, { status: 404 })
    }
    if (existing.revokedAt) {
      return NextResponse.json(
        { error: 'API key already revoked', revokedAt: existing.revokedAt },
        { status: 409 },
      )
    }

    const updated = await prisma.apiKey.update({
      where: { id },
      data: {
        revokedAt: new Date(),
        revokedById,
      },
      select: {
        id: true,
        name: true,
        scope: true,
        prefix: true,
        revokedAt: true,
        revokedById: true,
      },
    })

    await audit(request, 'DELETE', 'ApiKey', id, {
      name: existing.name,
      revokedById,
    }).catch(() => {})

    return NextResponse.json({ ok: true, key: updated })
  } catch (err: any) {
    console.error('DELETE /api/ops/admin/api-keys/[id] error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to revoke API key' },
      { status: 500 },
    )
  }
}
