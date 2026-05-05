/**
 * POST /api/ops/accounting/journal-entries/[id]/reverse
 *
 * Creates a new POSTED journal entry that swaps every original line's
 * debit and credit. The original is flipped to status=REVERSED so it
 * can never be re-reversed by accident. Both rows survive — that's the
 * whole point of reversal vs. edit, you keep the audit chain.
 *
 * The new reversing entry's reversalOf field points back to the
 * original's id, so the UI can show the linkage.
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
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const role = request.headers.get('x-staff-role')
  const roles = (request.headers.get('x-staff-roles') || role || '')
    .split(',')
    .map((r) => r.trim())
  const allowed = roles.some((r) => r === 'ADMIN' || r === 'MANAGER' || r === 'ACCOUNTING')
  if (!allowed) {
    return NextResponse.json(
      { error: 'ADMIN, MANAGER, or ACCOUNTING role required to reverse' },
      { status: 403 },
    )
  }

  const { id } = await params
  const original = await prisma.journalEntry.findUnique({
    where: { id },
    include: { lines: true },
  })
  if (!original) {
    return NextResponse.json({ error: 'Journal entry not found' }, { status: 404 })
  }
  if (original.status !== 'POSTED') {
    return NextResponse.json(
      {
        error: `Only POSTED entries can be reversed (this entry is ${original.status})`,
      },
      { status: 400 },
    )
  }

  // Generate new entry number
  const year = new Date().getFullYear()
  const yearStart = new Date(`${year}-01-01T00:00:00Z`)
  const yearEnd = new Date(`${year + 1}-01-01T00:00:00Z`)
  const countThisYear = await prisma.journalEntry.count({
    where: { createdAt: { gte: yearStart, lt: yearEnd } },
  })
  const newNumber = `JE-${year}-${String(countThisYear + 1).padStart(4, '0')}`

  const createdById = request.headers.get('x-staff-id') || null

  // Wrap in a transaction so original-flip and reversal-insert succeed/fail together
  const result = await prisma.$transaction(async (tx) => {
    const reversal = await tx.journalEntry.create({
      data: {
        entryNumber: newNumber,
        date: new Date(),
        description: `Reversal of ${original.entryNumber}: ${original.description}`,
        reference: original.reference,
        status: 'POSTED',
        createdById,
        approvedById: createdById,
        approvedAt: new Date(),
        reversalOf: original.id,
        lines: {
          create: original.lines.map((l) => ({
            accountId: l.accountId,
            // Swap debit and credit
            debit: l.credit,
            credit: l.debit,
            memo: l.memo ? `Reversal: ${l.memo}` : 'Reversal',
          })),
        },
      },
      include: { lines: true },
    })

    await tx.journalEntry.update({
      where: { id: original.id },
      data: { status: 'REVERSED' },
    })

    return reversal
  })

  await audit(request, 'CREATE', 'JournalEntry', result.id, {
    action: 'REVERSE',
    entryNumber: result.entryNumber,
    reversalOf: original.entryNumber,
  }).catch(() => {})

  return NextResponse.json({ ok: true, reversal: result }, { status: 201 })
}
