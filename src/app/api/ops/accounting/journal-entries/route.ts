/**
 * /api/ops/accounting/journal-entries — list + create.
 *
 *   GET   ?status=&dateFrom=&dateTo=&search=&page=&limit=
 *   POST  { date, description, reference?, lines: [{ accountId, debit, credit, memo? }, ...] }
 *
 * On create, status starts as DRAFT. Use POST /[id]/post to lock as
 * POSTED (with debits = credits validation).
 *
 * Entry numbers are auto-generated as JE-YYYY-NNNN, computed from the
 * current count of entries in the calendar year + 1.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const ALLOWED_STATUSES = ['DRAFT', 'POSTED', 'REVERSED', 'VOID'] as const

// ──────────────────────────────────────────────────────────────────────
// GET — list with filters
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = request.nextUrl
  const status = url.searchParams.get('status') || undefined
  const dateFrom = url.searchParams.get('dateFrom') || undefined
  const dateTo = url.searchParams.get('dateTo') || undefined
  const search = url.searchParams.get('search') || undefined
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')))
  const skip = (page - 1) * limit

  const where: any = {}
  if (status && (ALLOWED_STATUSES as readonly string[]).includes(status)) {
    where.status = status
  }
  if (dateFrom || dateTo) {
    where.date = {}
    if (dateFrom) where.date.gte = new Date(dateFrom)
    if (dateTo) where.date.lte = new Date(dateTo)
  }
  if (search) {
    where.OR = [
      { entryNumber: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { reference: { contains: search, mode: 'insensitive' } },
    ]
  }

  try {
    const [entries, total] = await Promise.all([
      prisma.journalEntry.findMany({
        where,
        include: {
          lines: {
            select: { id: true, accountId: true, debit: true, credit: true, memo: true },
          },
        },
        orderBy: [{ date: 'desc' }, { entryNumber: 'desc' }],
        skip,
        take: limit,
      }),
      prisma.journalEntry.count({ where }),
    ])

    // Compute totals per entry for the list view
    const enriched = entries.map((e) => {
      const totalDebits = e.lines.reduce((s, l) => s + l.debit, 0)
      const totalCredits = e.lines.reduce((s, l) => s + l.credit, 0)
      return { ...e, totalDebits, totalCredits, lineCount: e.lines.length }
    })

    return NextResponse.json({
      entries: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err: any) {
    console.error('GET /api/ops/accounting/journal-entries error:', err)
    return NextResponse.json({ error: 'Failed to list entries' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST — create new draft entry
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
    const { date, description, reference, lines } = body || {}

    if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })
    if (!description?.trim()) {
      return NextResponse.json({ error: 'description is required' }, { status: 400 })
    }
    if (!Array.isArray(lines) || lines.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 line items required' },
        { status: 400 },
      )
    }

    // Validate every line
    for (const [i, l] of lines.entries()) {
      if (!l.accountId) {
        return NextResponse.json(
          { error: `Line ${i + 1}: accountId required` },
          { status: 400 },
        )
      }
      const debit = typeof l.debit === 'number' ? l.debit : 0
      const credit = typeof l.credit === 'number' ? l.credit : 0
      if (debit < 0 || credit < 0) {
        return NextResponse.json(
          { error: `Line ${i + 1}: amounts cannot be negative` },
          { status: 400 },
        )
      }
      if (debit > 0 && credit > 0) {
        return NextResponse.json(
          { error: `Line ${i + 1}: cannot have both debit AND credit` },
          { status: 400 },
        )
      }
      if (debit === 0 && credit === 0) {
        return NextResponse.json(
          { error: `Line ${i + 1}: must have either debit > 0 OR credit > 0` },
          { status: 400 },
        )
      }
    }

    // Verify all accountIds exist
    const accountIds = Array.from(new Set(lines.map((l: any) => l.accountId)))
    const accounts = await prisma.chartOfAccount.findMany({
      where: { id: { in: accountIds } },
      select: { id: true },
    })
    if (accounts.length !== accountIds.length) {
      return NextResponse.json(
        { error: 'One or more accountIds are invalid' },
        { status: 400 },
      )
    }

    // Generate entry number — JE-YYYY-NNNN (count-based, unique per year)
    const year = new Date().getFullYear()
    const yearStart = new Date(`${year}-01-01T00:00:00Z`)
    const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`)
    const countThisYear = await prisma.journalEntry.count({
      where: { createdAt: { gte: yearStart, lt: yearEnd } },
    })
    const entryNumber = `JE-${year}-${String(countThisYear + 1).padStart(4, '0')}`

    const createdById = request.headers.get('x-staff-id') || null

    const entry = await prisma.journalEntry.create({
      data: {
        entryNumber,
        date: new Date(date),
        description: description.trim(),
        reference: reference?.trim() || null,
        status: 'DRAFT',
        createdById,
        lines: {
          create: lines.map((l: any) => ({
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            memo: l.memo?.trim() || null,
          })),
        },
      },
      include: { lines: true },
    })

    await audit(request, 'CREATE', 'JournalEntry', entry.id, {
      entryNumber: entry.entryNumber,
      lineCount: entry.lines.length,
    }).catch(() => {})

    return NextResponse.json(entry, { status: 201 })
  } catch (err: any) {
    console.error('POST /api/ops/accounting/journal-entries error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to create journal entry' },
      { status: 500 },
    )
  }
}
