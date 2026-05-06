// A-BIZ-12 — Quote revision tracking helpers.
//
// Append-only revision log for Quote edits. Every Quote PATCH (header
// fields, status, line items) calls writeQuoteRevision() to snapshot the
// post-update state and compute a field-by-field diff against the prior
// revision. The Quote row itself is revision 0 (no row written on insert);
// the first UPDATE creates revision 1, etc.
//
// Diff computation is intentionally tiny — a few-line walk over both
// snapshots noting added / removed / changed keys. No external diff lib.

import { prisma } from './prisma'

// ──────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────

export interface QuoteSnapshotItem {
  id: string
  productId: string | null
  description: string
  quantity: number
  unitPrice: number
  lineTotal: number
  location: string | null
  sortOrder: number
}

export interface QuoteSnapshot {
  id: string
  quoteNumber: string
  projectId: string | null
  takeoffId: string | null
  status: string
  subtotal: number
  taxRate: number
  taxAmount: number
  termAdjustment: number
  total: number
  validUntil: string | null
  notes: string | null
  version: number | null
  items: QuoteSnapshotItem[]
}

export type QuoteFieldDiff =
  | { kind: 'added'; value: unknown }
  | { kind: 'removed'; value: unknown }
  | { kind: 'changed'; from: unknown; to: unknown }

export interface QuoteSnapshotDiff {
  // Header-level field diffs keyed by field name (excluding 'items').
  fields: Record<string, QuoteFieldDiff>
  // Line-item diffs keyed by item id; uses the same shape as fields except
  // each item id maps to either an add/remove/change entry whose payload is
  // the full item (add/remove) or a sub-record of changed fields (change).
  items: Record<
    string,
    | { kind: 'added'; item: QuoteSnapshotItem }
    | { kind: 'removed'; item: QuoteSnapshotItem }
    | { kind: 'changed'; fields: Record<string, QuoteFieldDiff> }
  >
}

// ──────────────────────────────────────────────────────────────────────
// Snapshot loader — fetch the current Quote + items from the DB.
// Called immediately AFTER an UPDATE inside the same request handler.
// Uses raw SQL to match the existing route style (no Prisma client model
// for QuoteRevision yet — that requires `prisma generate`, which the
// caller handles separately).
// ──────────────────────────────────────────────────────────────────────

export async function loadQuoteSnapshot(
  quoteId: string
): Promise<QuoteSnapshot | null> {
  const headers = await prisma.$queryRawUnsafe<any[]>(
    `SELECT q."id", q."quoteNumber", q."projectId", q."takeoffId", q."status"::text AS "status",
            q."subtotal", q."taxRate", q."taxAmount", q."termAdjustment", q."total",
            q."validUntil", q."notes", q."version"
     FROM "Quote" q WHERE q."id" = $1 LIMIT 1`,
    quoteId
  )
  const head = headers[0]
  if (!head) return null

  const items = await prisma.$queryRawUnsafe<any[]>(
    `SELECT qi."id", qi."productId", qi."description", qi."quantity",
            qi."unitPrice", qi."lineTotal", qi."location", qi."sortOrder"
     FROM "QuoteItem" qi WHERE qi."quoteId" = $1 ORDER BY qi."sortOrder" ASC, qi."id" ASC`,
    quoteId
  )

  return {
    id: head.id,
    quoteNumber: head.quoteNumber,
    projectId: head.projectId ?? null,
    takeoffId: head.takeoffId ?? null,
    status: head.status,
    subtotal: Number(head.subtotal),
    taxRate: Number(head.taxRate),
    taxAmount: Number(head.taxAmount),
    termAdjustment: Number(head.termAdjustment),
    total: Number(head.total),
    validUntil: head.validUntil ? new Date(head.validUntil).toISOString() : null,
    notes: head.notes ?? null,
    version: head.version ?? null,
    items: items.map((it) => ({
      id: it.id,
      productId: it.productId ?? null,
      description: it.description,
      quantity: Number(it.quantity),
      unitPrice: Number(it.unitPrice),
      lineTotal: Number(it.lineTotal),
      location: it.location ?? null,
      sortOrder: Number(it.sortOrder ?? 0),
    })),
  }
}

// ──────────────────────────────────────────────────────────────────────
// Diff computation — small, dependency-free.
// Treats arrays/objects via JSON-equality; primitives via ===.
// ──────────────────────────────────────────────────────────────────────

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a == null || b == null) return a === b
  if (typeof a !== typeof b) return false
  if (typeof a === 'object') return JSON.stringify(a) === JSON.stringify(b)
  return false
}

export function diffQuoteSnapshots(
  prev: QuoteSnapshot | null,
  next: QuoteSnapshot
): QuoteSnapshotDiff {
  const fields: Record<string, QuoteFieldDiff> = {}
  const items: QuoteSnapshotDiff['items'] = {}

  // Header fields — every key on `next` except 'items'.
  const headerKeys = Object.keys(next).filter((k) => k !== 'items') as Array<
    keyof QuoteSnapshot
  >
  if (prev == null) {
    for (const k of headerKeys) {
      fields[k as string] = { kind: 'added', value: (next as any)[k] }
    }
    for (const it of next.items) {
      items[it.id] = { kind: 'added', item: it }
    }
    return { fields, items }
  }

  for (const k of headerKeys) {
    const a = (prev as any)[k]
    const b = (next as any)[k]
    if (!shallowEqual(a, b)) {
      fields[k as string] = { kind: 'changed', from: a, to: b }
    }
  }

  // Line items — keyed by id.
  const prevById = new Map(prev.items.map((it) => [it.id, it]))
  const nextById = new Map(next.items.map((it) => [it.id, it]))

  for (const [id, b] of nextById) {
    const a = prevById.get(id)
    if (!a) {
      items[id] = { kind: 'added', item: b }
      continue
    }
    const itemFieldDiffs: Record<string, QuoteFieldDiff> = {}
    for (const k of Object.keys(b) as Array<keyof QuoteSnapshotItem>) {
      if (!shallowEqual((a as any)[k], (b as any)[k])) {
        itemFieldDiffs[k as string] = {
          kind: 'changed',
          from: (a as any)[k],
          to: (b as any)[k],
        }
      }
    }
    if (Object.keys(itemFieldDiffs).length > 0) {
      items[id] = { kind: 'changed', fields: itemFieldDiffs }
    }
  }
  for (const [id, a] of prevById) {
    if (!nextById.has(id)) {
      items[id] = { kind: 'removed', item: a }
    }
  }

  return { fields, items }
}

// ──────────────────────────────────────────────────────────────────────
// Revision writer — call AFTER the Quote UPDATE (and any item replace)
// has committed. Resolves the next revision number via aggregate query
// and inserts a row. Failures are logged but never throw — revision
// tracking must not block the user's edit.
//
// Returns the new revision number, or null if write failed.
// ──────────────────────────────────────────────────────────────────────

export async function writeQuoteRevision(
  quoteId: string,
  authorStaffId?: string | null
): Promise<number | null> {
  try {
    const next = await loadQuoteSnapshot(quoteId)
    if (!next) {
      console.warn('[QuoteRevision] Quote vanished before snapshot:', quoteId)
      return null
    }

    // Resolve the next revision number.
    const maxResult = await prisma.$queryRawUnsafe<{ max: number | null }[]>(
      `SELECT MAX("revision") AS "max" FROM "QuoteRevision" WHERE "quoteId" = $1`,
      quoteId
    )
    const prevRevision = maxResult[0]?.max ?? 0
    const revision = Number(prevRevision) + 1

    // Load the previous snapshot (if any) for the diff.
    let prev: QuoteSnapshot | null = null
    if (Number(prevRevision) > 0) {
      const prevRow = await prisma.$queryRawUnsafe<{ snapshot: any }[]>(
        `SELECT "snapshot" FROM "QuoteRevision"
         WHERE "quoteId" = $1 AND "revision" = $2 LIMIT 1`,
        quoteId,
        Number(prevRevision)
      )
      const raw = prevRow[0]?.snapshot
      prev =
        raw == null
          ? null
          : typeof raw === 'string'
          ? (JSON.parse(raw) as QuoteSnapshot)
          : (raw as QuoteSnapshot)
    }

    const diff = diffQuoteSnapshots(prev, next)

    const id = `qrev_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`

    await prisma.$executeRawUnsafe(
      `INSERT INTO "QuoteRevision"
         ("id", "quoteId", "revision", "snapshot", "changes", "authorStaffId", "createdAt")
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, NOW())`,
      id,
      quoteId,
      revision,
      JSON.stringify(next),
      JSON.stringify(diff),
      authorStaffId || null
    )

    return revision
  } catch (e: any) {
    console.warn('[QuoteRevision] Failed to write revision:', e?.message || e)
    return null
  }
}

// ──────────────────────────────────────────────────────────────────────
// Lister — used by GET /api/ops/quotes/[id]/revisions
// ──────────────────────────────────────────────────────────────────────

export interface QuoteRevisionRow {
  id: string
  quoteId: string
  revision: number
  snapshot: QuoteSnapshot
  changes: QuoteSnapshotDiff | null
  authorStaffId: string | null
  authorStaffName: string | null
  createdAt: string
}

export async function listQuoteRevisions(
  quoteId: string
): Promise<QuoteRevisionRow[]> {
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `SELECT r."id", r."quoteId", r."revision", r."snapshot", r."changes",
            r."authorStaffId", r."createdAt",
            CASE WHEN s."id" IS NOT NULL
                 THEN TRIM(COALESCE(s."firstName", '') || ' ' || COALESCE(s."lastName", ''))
                 ELSE NULL
            END AS "authorStaffName"
     FROM "QuoteRevision" r
     LEFT JOIN "Staff" s ON s."id" = r."authorStaffId"
     WHERE r."quoteId" = $1
     ORDER BY r."revision" DESC`,
    quoteId
  )
  return rows.map((r) => ({
    id: r.id,
    quoteId: r.quoteId,
    revision: Number(r.revision),
    snapshot:
      typeof r.snapshot === 'string'
        ? (JSON.parse(r.snapshot) as QuoteSnapshot)
        : (r.snapshot as QuoteSnapshot),
    changes:
      r.changes == null
        ? null
        : typeof r.changes === 'string'
        ? (JSON.parse(r.changes) as QuoteSnapshotDiff)
        : (r.changes as QuoteSnapshotDiff),
    authorStaffId: r.authorStaffId ?? null,
    authorStaffName: r.authorStaffName ?? null,
    createdAt: new Date(r.createdAt).toISOString(),
  }))
}
