export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getSession } from '@/lib/auth'
import { audit } from '@/lib/audit'
import {
  computeCoImpact,
  type CoLineInput,
  type CoLineType,
  type CoImpactResult,
} from '@/lib/mrp/co-impact'

/**
 * POST /api/builder-portal/jobs/:jobId/co-preview
 *
 * Builder-facing CO preview. Enforces ownership (the job's order must belong
 * to the authenticated builder), then runs the same impact engine.
 *
 * Response is tuned for builder eyes — we strip SKU/vendor/unit-cost so a
 * builder can't spreadsheet our ATP. They see the date shift, not the yard.
 *
 * Set `confirm: true` when the builder clicks "Confirm" — this is how we log
 * who agreed to what-with-what-impact.
 */

function isValidType(t: any): t is CoLineType {
  return t === 'ADD' || t === 'REMOVE' || t === 'SUBSTITUTE'
}

function normalizeLines(raw: any): { lines: CoLineInput[]; error: string | null } {
  if (!Array.isArray(raw)) {
    return { lines: [], error: 'coLines must be an array' }
  }
  const lines: CoLineInput[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const productId = typeof r.productId === 'string' ? r.productId : null
    const qty = typeof r.qty === 'number' ? r.qty : Number(r.qty)
    const type = r.type
    if (!productId) return { lines: [], error: 'Each line requires a productId' }
    if (!isValidType(type)) {
      return { lines: [], error: `Invalid line type: ${type}` }
    }
    if (!Number.isFinite(qty)) {
      return { lines: [], error: 'Each line requires a numeric qty' }
    }
    if (type === 'SUBSTITUTE' && typeof r.substituteProductId !== 'string') {
      return { lines: [], error: 'SUBSTITUTE lines require substituteProductId' }
    }
    lines.push({
      productId,
      qty,
      type,
      substituteProductId: r.substituteProductId,
      note: typeof r.note === 'string' ? r.note : undefined,
    })
  }
  return { lines, error: null }
}

/**
 * Builder-safe shape — no unitCost, no committedToOthers, no SKUs pulled
 * from our catalog beyond what's on the builder's own order. We keep the
 * plain-English `reason` and the date shift.
 */
interface BuilderCoLineImpact {
  productId: string
  productName: string | null
  qty: number
  type: CoLineType
  substitute?: { productId: string; productName: string | null } | null
  daysToShelf: number | null
  arrivalDate: string | null
  status: string
  reason: string | null
}

interface BuilderCoImpactResult {
  jobId: string
  jobNumber: string | null
  scheduledDate: string | null
  newCompletionDate: string | null
  daysShifted: number
  overallImpact: CoImpactResult['overallImpact']
  // Builder voice: short, quiet, factual.
  headline: string
  message: string
  /** Force-acknowledge required — set when overallImpact is WILL_MISS. */
  requiresAcknowledgment: boolean
  lines: BuilderCoLineImpact[]
}

function toBuilderView(full: CoImpactResult): BuilderCoImpactResult {
  const lines: BuilderCoLineImpact[] = full.lines.map((l) => ({
    productId: l.productId,
    productName: l.productName,
    qty: l.qty,
    type: l.input.type,
    substitute: l.substitute
      ? { productId: l.substitute.productId, productName: l.substitute.productName }
      : null,
    daysToShelf: l.daysToShelf,
    arrivalDate: l.arrivalDate ? l.arrivalDate.toISOString() : null,
    status: l.status,
    reason: l.reason,
  }))

  // Brand voice: dry, factual, no oversell. Assume the builder is a super
  // who reads date, cost, and impact — not marketing copy.
  const fmtDate = (d: Date | null) =>
    d ? d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : null
  const scheduled = full.scheduledDate ? new Date(full.scheduledDate) : null
  const newDate = full.newCompletionDate ? new Date(full.newCompletionDate) : null

  let headline: string
  let message: string
  switch (full.overallImpact) {
    case 'NONE':
      headline = 'No delivery impact'
      message = scheduled
        ? `Delivery still ${fmtDate(scheduled)}. Your change fits.`
        : 'Your change fits current inventory.'
      break
    case 'DELAYED_BUT_OK':
      headline = 'Fits the window'
      message = scheduled
        ? `Still on for ${fmtDate(scheduled)}. Tighter than we like — nothing we can't handle.`
        : 'Your change fits the planned window.'
      break
    case 'AT_RISK':
      headline = newDate
        ? `Delivery shifts to ${fmtDate(newDate)}`
        : 'Delivery at risk'
      message =
        scheduled && newDate
          ? `Accepting this change will shift your delivery from ${fmtDate(scheduled)} to ${fmtDate(newDate)}.`
          : 'Accepting this change will push the delivery date out.'
      break
    case 'WILL_MISS':
      headline = 'This will miss your target'
      message =
        scheduled && newDate
          ? `We can't source the new material before ${fmtDate(scheduled)}. Earliest is ${fmtDate(newDate)}. Confirm only if you're OK moving the date.`
          : 'We cannot source the new material in time for the current delivery date.'
      break
  }

  return {
    jobId: full.jobId,
    jobNumber: full.jobNumber,
    scheduledDate: full.scheduledDate ? full.scheduledDate.toISOString() : null,
    newCompletionDate: full.newCompletionDate ? full.newCompletionDate.toISOString() : null,
    daysShifted: full.daysShifted,
    overallImpact: full.overallImpact,
    headline,
    message,
    requiresAcknowledgment: full.overallImpact === 'WILL_MISS',
    lines,
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { jobId: string } }
) {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  const { jobId } = params

  // Ownership guard — only the builder who owns the underlying Order can
  // preview a CO on this job.
  const ownership = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
    `SELECT j."id" FROM "Job" j
     JOIN "Order" o ON o."id" = j."orderId"
     WHERE j."id" = $1 AND o."builderId" = $2
     LIMIT 1`,
    jobId,
    session.builderId
  )
  if (ownership.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { lines, error } = normalizeLines(body?.coLines)
  if (error) {
    return NextResponse.json({ error }, { status: 400 })
  }

  try {
    const full = await computeCoImpact(jobId, lines, { skipBaseline: true })
    const safe = toBuilderView(full)

    if (body?.acknowledged === true || body?.confirm === true) {
      // Log a ChangeOrderPreview audit entry for the builder acknowledgment.
      // Builder context flows through audit via `staffId: builder:<id>` per
      // the convention in auditBuilder() — we use audit() here so we also get
      // IP + user agent from the request headers.
      await audit(
        request,
        safe.requiresAcknowledgment ? 'PREVIEW_FORCE_ACK' : 'PREVIEW_CONFIRM',
        'ChangeOrderPreview',
        body?.changeOrderId || jobId,
        {
          jobId,
          builderId: session.builderId,
          companyName: session.companyName,
          changeOrderId: body?.changeOrderId || null,
          lines,
          overallImpact: full.overallImpact,
          newCompletionDate: full.newCompletionDate,
          daysShifted: full.daysShifted,
          source: 'builder-portal',
        },
        full.overallImpact === 'WILL_MISS' ? 'WARN' : 'INFO'
      )
    }

    return NextResponse.json(safe)
  } catch (err: any) {
    console.error('[builder-portal co-preview POST]', err)
    const msg = err?.message || 'Failed to compute CO impact'
    const status = msg.includes('Job not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
