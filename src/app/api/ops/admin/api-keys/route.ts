/**
 * /api/ops/admin/api-keys — list + create API keys.
 *
 * Manages the ApiKey table backing self-serve key generation for the
 * Aegis MCP and friends. Reading is open to ADMIN/MANAGER (visibility
 * for ops audit) but creating + revoking requires ADMIN — keys carry
 * service-level access, you only want a tight set of people minting
 * them.
 *
 *   GET   /api/ops/admin/api-keys          list (newest first)
 *   POST  /api/ops/admin/api-keys          generate a new key
 *
 * The raw key is returned ONLY in the POST response — once. After that
 * we only have the prefix (first 8 chars) for display. lib/api-keys.ts
 * stores the sha256 hash for verification.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { generateApiKey } from '@/lib/api-keys'

const ALLOWED_SCOPES = ['mcp', 'agent', 'admin'] as const

// ──────────────────────────────────────────────────────────────────────
// GET — list keys (open to ADMIN + MANAGER)
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const role = request.headers.get('x-staff-role')
  const roles = (request.headers.get('x-staff-roles') || role || '')
    .split(',')
    .map((r) => r.trim())
  if (!roles.includes('ADMIN') && !roles.includes('MANAGER')) {
    return NextResponse.json(
      { error: 'ADMIN or MANAGER role required to view API keys' },
      { status: 403 },
    )
  }

  try {
    const keys = await prisma.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        scope: true,
        prefix: true,
        createdById: true,
        createdAt: true,
        revokedAt: true,
        revokedById: true,
        lastUsedAt: true,
        notes: true,
      },
      take: 200,
    })

    // Hydrate creator + revoker names so the UI doesn't have to chase IDs
    const staffIds = Array.from(
      new Set(
        keys.flatMap((k) => [k.createdById, k.revokedById].filter(Boolean) as string[]),
      ),
    )
    const staff = staffIds.length
      ? await prisma.staff.findMany({
          where: { id: { in: staffIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : []
    const staffMap = new Map(
      staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()]),
    )

    const enriched = keys.map((k) => ({
      ...k,
      createdByName: k.createdById ? staffMap.get(k.createdById) || null : null,
      revokedByName: k.revokedById ? staffMap.get(k.revokedById) || null : null,
    }))

    return NextResponse.json({ keys: enriched })
  } catch (err: any) {
    console.error('GET /api/ops/admin/api-keys error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to list API keys' },
      { status: 500 },
    )
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST — generate a new key (ADMIN only)
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const role = request.headers.get('x-staff-role')
  const roles = (request.headers.get('x-staff-roles') || role || '')
    .split(',')
    .map((r) => r.trim())
  if (!roles.includes('ADMIN')) {
    return NextResponse.json(
      { error: 'ADMIN role required to generate API keys' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    const { name, scope = 'mcp', notes } = body || {}

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'name is required' }, { status: 400 })
    }
    if (!(ALLOWED_SCOPES as readonly string[]).includes(scope)) {
      return NextResponse.json(
        { error: `scope must be one of ${ALLOWED_SCOPES.join(', ')}` },
        { status: 400 },
      )
    }

    const { rawKey, prefix, hashedKey } = generateApiKey()
    const createdById = request.headers.get('x-staff-id') || null

    const created = await prisma.apiKey.create({
      data: {
        name: name.trim(),
        scope,
        prefix,
        hashedKey,
        createdById,
        notes: typeof notes === 'string' && notes.trim() ? notes.trim() : null,
      },
      select: {
        id: true,
        name: true,
        scope: true,
        prefix: true,
        createdAt: true,
        notes: true,
      },
    })

    await audit(request, 'CREATE', 'ApiKey', created.id, {
      name: created.name,
      scope: created.scope,
      prefix: created.prefix,
    }).catch(() => {})

    // RawKey returned ONCE — after this response, only the prefix is
    // recoverable. Caller must save it now.
    return NextResponse.json(
      { ...created, rawKey, message: 'Save this key now — it cannot be shown again.' },
      { status: 201 },
    )
  } catch (err: any) {
    console.error('POST /api/ops/admin/api-keys error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to generate API key' },
      { status: 500 },
    )
  }
}
