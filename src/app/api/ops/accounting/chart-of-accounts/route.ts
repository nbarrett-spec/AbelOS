/**
 * /api/ops/accounting/chart-of-accounts — list + create accounts.
 *
 * The migration in scripts/migrate-aegis-ops-finance.sql seeds 23
 * starter accounts (Cash, AR, Inventory, AP, Equity, Revenue,
 * COGS, OpEx). Use this endpoint to add custom ones or rename.
 *
 * GET  ?type=ASSET|LIABILITY|EQUITY|REVENUE|EXPENSE  &activeOnly=true
 * POST { code, name, type, subType?, description?, parentId? }
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE'] as const
type AccountType = (typeof ACCOUNT_TYPES)[number]
function isType(t: any): t is AccountType {
  return typeof t === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(t)
}

// ──────────────────────────────────────────────────────────────────────
// GET — list accounts (open to any logged-in staff)
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = request.nextUrl
  const type = url.searchParams.get('type') || undefined
  const activeOnly = url.searchParams.get('activeOnly') !== 'false' // default true

  const where: any = {}
  if (type && isType(type)) where.type = type
  if (activeOnly) where.isActive = true

  try {
    const accounts = await prisma.chartOfAccount.findMany({
      where,
      orderBy: { code: 'asc' },
      take: 500,
    })
    return NextResponse.json({ accounts })
  } catch (err: any) {
    console.error('GET /api/ops/accounting/chart-of-accounts error:', err)
    return NextResponse.json({ error: 'Failed to list accounts' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST — create new account (ADMIN, MANAGER, or ACCOUNTING)
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const role = request.headers.get('x-staff-role')
  const roles = (request.headers.get('x-staff-roles') || role || '')
    .split(',')
    .map((r) => r.trim())
  const allowed = roles.some((r) => r === 'ADMIN' || r === 'MANAGER' || r === 'ACCOUNTING')
  if (!allowed) {
    return NextResponse.json(
      { error: 'ADMIN, MANAGER, or ACCOUNTING role required' },
      { status: 403 },
    )
  }

  try {
    const body = await request.json()
    const { code, name, type, subType, description, parentId } = body || {}

    if (!code?.trim()) return NextResponse.json({ error: 'code is required' }, { status: 400 })
    if (!name?.trim()) return NextResponse.json({ error: 'name is required' }, { status: 400 })
    if (!isType(type)) {
      return NextResponse.json(
        { error: `type must be one of ${ACCOUNT_TYPES.join(', ')}` },
        { status: 400 },
      )
    }

    // Verify parent if supplied
    if (parentId) {
      const parent = await prisma.chartOfAccount.findUnique({ where: { id: parentId } })
      if (!parent) {
        return NextResponse.json({ error: 'parentId not found' }, { status: 400 })
      }
    }

    const account = await prisma.chartOfAccount.create({
      data: {
        code: code.trim(),
        name: name.trim(),
        type,
        subType: subType || null,
        description: description || null,
        parentId: parentId || null,
      },
    })

    await audit(request, 'CREATE', 'ChartOfAccount', account.id, {
      code: account.code,
      name: account.name,
      type: account.type,
    }).catch(() => {})

    return NextResponse.json(account, { status: 201 })
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: `Account code already exists` },
        { status: 409 },
      )
    }
    console.error('POST /api/ops/accounting/chart-of-accounts error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to create account' },
      { status: 500 },
    )
  }
}
