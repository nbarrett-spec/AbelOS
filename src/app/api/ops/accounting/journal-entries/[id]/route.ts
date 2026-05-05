/**
 * /api/ops/accounting/journal-entries/[id] — read + edit DRAFT + void.
 *
 *   GET    full entry + lines (with account names hydrated)
 *   PATCH  edit DRAFT (description, reference, lines). POSTED entries
 *          cannot be edited — use /reverse instead.
 *   DELETE void DRAFT or POSTED entries (sets status=VOID).
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

async function getEntryOr404(id: string) {
  const entry = await prisma.journalEntry.findUnique({
    where: { id },
    include: {
      lines: {
        include: {
          account: { select: { id: true, code: true, name: true, type: true } },
        },
      },
    },
  })
  return entry
}

// ──────────────────────────────────────────────────────────────────────
// GET — entry detail
// ──────────────────────────────────────────────────────────────────────
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id } = await params
  const entry = await getEntryOr404(id)
  if (!entry) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
  }

  const totalDebits = entry.lines.reduce((s, l) => s + l.debit, 0)
  const totalCredits = entry.lines.reduce((s, l) => s + l.credit, 0)

  return NextResponse.json({
    ...entry,
    totalDebits,
    totalCredits,
    isBalanced: Math.abs(totalDebits - totalCredits) < 0.005,
  })
}

// ──────────────────────────────────────────────────────────────────────
// PATCH — edit DRAFT entry
// ──────────────────────────────────────────────────────────────────────
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const { id } = await params
  const existing = await prisma.journalEntry.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
  }
  if (existing.status !== 'DRAFT') {
    return NextResponse.json(
      {
        error: `Cannot edit a ${existing.status} entry — use POST /reverse to make a correction`,
      },
      { status: 400 },
    )
  }

  try {
    const body = await request.json()
    const { date, description, reference, lines } = body || {}

    const data: any = {}
    if (date !== undefined) data.date = new Date(date)
    if (description !== undefined) data.description = description.trim()
    if (reference !== undefined) data.reference = reference?.trim() || null

    if (Array.isArray(lines)) {
      // Validate
      if (lines.length < 2) {
        return NextResponse.json(
          { error: 'At least 2 line items required' },
          { status: 400 },
        )
      }
      for (const [i, l] of lines.entries()) {
        if (!l.accountId) {
          return NextResponse.json(
            { error: `Line ${i + 1}: accountId required` },
            { status: 400 },
          )
        }
        const debit = typeof l.debit === 'number' ? l.debit : 0
        const credit = typeof l.credit === 'number' ? l.credit : 0
        if ((debit > 0) === (credit > 0)) {
          return NextResponse.json(
            { error: `Line ${i + 1}: must have exactly one of debit OR credit > 0` },
            { status: 400 },
          )
        }
      }

      // Wholesale replace lines (DRAFT only — safe, no posted txns to break)
      await prisma.$transaction([
        prisma.journalEntryLine.deleteMany({ where: { journalEntryId: id } }),
        prisma.journalEntryLine.createMany({
          data: lines.map((l: any) => ({
            journalEntryId: id,
            accountId: l.accountId,
            debit: l.debit || 0,
            credit: l.credit || 0,
            memo: l.memo?.trim() || null,
          })),
        }),
      ])
    }

    const updated = await prisma.journalEntry.update({
      where: { id },
      data,
      include: {
        lines: {
          include: {
            account: { select: { id: true, code: true, name: true, type: true } },
          },
        },
      },
    })

    await audit(request, 'UPDATE', 'JournalEntry', id, {
      entryNumber: existing.entryNumber,
    }).catch(() => {})

    return NextResponse.json(updated)
  } catch (err: any) {
    console.error('PATCH /api/ops/accounting/journal-entries/[id] error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to update journal entry' },
      { status: 500 },
    )
  }
}

// ──────────────────────────────────────────────────────────────────────
// DELETE — void entry (sets status=VOID, keeps row)
// ──────────────────────────────────────────────────────────────────────
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
  if (!roles.includes('ADMIN') && !roles.includes('ACCOUNTING')) {
    return NextResponse.json(
      { error: 'ADMIN or ACCOUNTING role required to void' },
      { status: 403 },
    )
  }

  const { id } = await params
  const existing = await prisma.journalEntry.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
  }
  if (existing.status === 'VOID') {
    return NextResponse.json({ error: 'Already void' }, { status: 409 })
  }

  const voided = await prisma.journalEntry.update({
    where: { id },
    data: { status: 'VOID' },
  })

  await audit(request, 'UPDATE', 'JournalEntry', id, {
    action: 'VOID',
    entryNumber: existing.entryNumber,
  }).catch(() => {})

  return NextResponse.json({ ok: true, entry: voided })
}
