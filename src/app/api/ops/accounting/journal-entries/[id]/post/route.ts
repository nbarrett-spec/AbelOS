/**
 * POST /api/ops/accounting/journal-entries/[id]/post — DRAFT → POSTED.
 *
 * Validates that total debits === total credits before flipping status.
 * Stamps approvedById + approvedAt. ADMIN, MANAGER, or ACCOUNTING can
 * post.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const authError = checkStaffAuth(request)
    if (authError) return authError

    const role = request.headers.get('x-staff-role')
    const roles = (request.headers.get('x-staff-roles') || role || '')
      .split(',')
      .map((r) => r.trim())
    const allowed = roles.some((r) => r === 'ADMIN' || r === 'MANAGER' || r === 'ACCOUNTING')
    if (!allowed) {
      return NextResponse.json(
        { error: 'ADMIN, MANAGER, or ACCOUNTING role required to post' },
        { status: 403 },
      )
    }

    const { id } = await params
    const entry = await prisma.journalEntry.findUnique({
      where: { id },
      include: { lines: true },
    })
    if (!entry) {
      return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
    }
    if (entry.status !== 'DRAFT') {
      return NextResponse.json(
        { error: `Cannot post a ${entry.status} entry — only DRAFT entries can be posted` },
        { status: 400 },
      )
    }
    if (entry.lines.length < 2) {
      return NextResponse.json(
        { error: 'At least 2 line items required' },
        { status: 400 },
      )
    }

    const totalDebits = entry.lines.reduce((s, l) => s + l.debit, 0)
    const totalCredits = entry.lines.reduce((s, l) => s + l.credit, 0)
    if (Math.abs(totalDebits - totalCredits) > 0.005) {
      return NextResponse.json(
        {
          error: `Debits (${totalDebits.toFixed(2)}) ≠ Credits (${totalCredits.toFixed(2)}). Entry must balance to post.`,
          totalDebits,
          totalCredits,
        },
        { status: 400 },
      )
    }

    const approvedById = request.headers.get('x-staff-id') || null

    const posted = await prisma.journalEntry.update({
      where: { id },
      data: {
        status: 'POSTED',
        approvedById,
        approvedAt: new Date(),
      },
      include: { lines: true },
    })

    await audit(request, 'UPDATE', 'JournalEntry', id, {
      action: 'POST',
      entryNumber: entry.entryNumber,
      totalDebits,
      totalCredits,
    }).catch(() => {})

    return NextResponse.json({ ok: true, entry: posted })
  } catch (err: any) {
    console.error('POST /api/ops/accounting/journal-entries/[id]/post error:', err)
    return NextResponse.json(
      { error: err?.message || 'Internal error' },
      { status: 500 }
    )
  }
}
