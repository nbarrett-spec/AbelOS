/**
 * /api/ops/notes — generic per-entity notes (B-UX-7, 2026-05-05).
 *
 * GET  ?entityType=&entityId=  → list notes (newest first), with author name.
 * POST { entityType, entityId, body } → create note. Author = x-staff-id.
 *
 * Backs the <NotesSection> component on /ops/{invoices,jobs,accounts,
 * purchasing}/[id] detail pages.
 *
 * Note vs. notes-column: many entities (Order.notes, Quote.notes, …) carry a
 * single free-text field for a summary. This route is the timestamped,
 * append-only activity log — multiple authors, ordered, dated.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const ALLOWED_ENTITY_TYPES = new Set([
  'order',
  'job',
  'builder',
  'invoice',
  'purchaseOrder',
  'quote',
  'delivery',
])

// ──────────────────────────────────────────────────────────────────────
// GET /api/ops/notes?entityType=&entityId=
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = request.nextUrl
  const entityType = (url.searchParams.get('entityType') || '').trim()
  const entityId = (url.searchParams.get('entityId') || '').trim()

  if (!entityType || !entityId) {
    return NextResponse.json(
      { error: 'entityType and entityId are required' },
      { status: 400 },
    )
  }
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json(
      { error: `Unsupported entityType '${entityType}'` },
      { status: 400 },
    )
  }

  // Pull the notes + the author's name in one round trip.
  // Cast to any: prisma.ts re-exports the extended client as PrismaClient,
  // which strips delegate types for newly-added models. Same workaround
  // pattern as prisma.staff in /api/ops/auth/login.
  const notes = await (prisma as any).note.findMany({
    where: { entityType, entityId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  }) as Array<{
    id: string
    entityType: string
    entityId: string
    body: string
    authorStaffId: string | null
    createdAt: Date
  }>

  // Resolve author names without forcing a relation in the schema (Note has
  // no FK to Staff so we can keep the model fully generic).
  const authorIds = Array.from(
    new Set(notes.map((n) => n.authorStaffId).filter((s): s is string => !!s)),
  )
  const staff = authorIds.length
    ? await prisma.staff.findMany({
        where: { id: { in: authorIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : []
  const nameById = new Map(
    staff.map((s) => [s.id, `${s.firstName} ${s.lastName}`.trim()]),
  )

  return NextResponse.json({
    notes: notes.map((n) => ({
      id: n.id,
      entityType: n.entityType,
      entityId: n.entityId,
      body: n.body,
      authorStaffId: n.authorStaffId,
      authorName: n.authorStaffId ? nameById.get(n.authorStaffId) || null : null,
      createdAt: n.createdAt.toISOString(),
    })),
  })
}

// ──────────────────────────────────────────────────────────────────────
// POST /api/ops/notes  { entityType, entityId, body }
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const staffId = request.headers.get('x-staff-id') || null

  let payload: any
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const entityType = String(payload?.entityType || '').trim()
  const entityId = String(payload?.entityId || '').trim()
  const body = String(payload?.body || '').trim()

  if (!entityType || !entityId || !body) {
    return NextResponse.json(
      { error: 'entityType, entityId, and body are required' },
      { status: 400 },
    )
  }
  if (!ALLOWED_ENTITY_TYPES.has(entityType)) {
    return NextResponse.json(
      { error: `Unsupported entityType '${entityType}'` },
      { status: 400 },
    )
  }
  if (body.length > 10_000) {
    return NextResponse.json(
      { error: 'Note body exceeds 10,000 characters' },
      { status: 400 },
    )
  }

  const created = await (prisma as any).note.create({
    data: {
      entityType,
      entityId,
      body,
      authorStaffId: staffId,
    },
  }) as {
    id: string
    entityType: string
    entityId: string
    body: string
    authorStaffId: string | null
    createdAt: Date
  }

  // Best-effort audit log; never block the user on it.
  audit(request, 'CREATE', 'Note', created.id, {
    entityType,
    entityId,
    bodyPreview: body.slice(0, 80),
  }).catch(() => {})

  // Resolve author name for the immediate response so the UI doesn't need
  // a follow-up GET to render the new row correctly.
  let authorName: string | null = null
  if (staffId) {
    const s = await prisma.staff.findUnique({
      where: { id: staffId },
      select: { firstName: true, lastName: true },
    })
    if (s) authorName = `${s.firstName} ${s.lastName}`.trim()
  }

  return NextResponse.json({
    note: {
      id: created.id,
      entityType: created.entityType,
      entityId: created.entityId,
      body: created.body,
      authorStaffId: created.authorStaffId,
      authorName,
      createdAt: created.createdAt.toISOString(),
    },
  })
}
