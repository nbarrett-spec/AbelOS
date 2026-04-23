export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import {
  computeCoImpact,
  type CoLineInput,
  type CoLineType,
} from '@/lib/mrp/co-impact'

/**
 * POST /api/ops/jobs/:id/co-preview
 *
 * Preview the material impact of a proposed change order on a Job, without
 * modifying any state. Used by the "Preview Change Order" sheet on the Job
 * detail page and by the builder portal's CO submit flow (via a thin wrapper).
 *
 * Body:
 *   {
 *     coLines: [
 *       { productId, qty, type: 'ADD' | 'REMOVE' | 'SUBSTITUTE',
 *         substituteProductId?, note? }
 *     ],
 *     confirm?: boolean  // when true, logs a ChangeOrderPreview audit row
 *                        // indicating the PM/builder is "accepting" this preview
 *                        // as the basis for a CO they're about to create.
 *     changeOrderId?: string // optional link to a ChangeOrder being confirmed
 *   }
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
    if (!productId) {
      return { lines: [], error: 'Each line requires a productId' }
    }
    if (!isValidType(type)) {
      return { lines: [], error: `Invalid line type: ${type}` }
    }
    if (!Number.isFinite(qty)) {
      return { lines: [], error: 'Each line requires a numeric qty' }
    }
    if (type === 'SUBSTITUTE' && typeof r.substituteProductId !== 'string') {
      return {
        lines: [],
        error: 'SUBSTITUTE lines require substituteProductId',
      }
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

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { id: jobId } = params

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
    const result = await computeCoImpact(jobId, lines)

    // If caller flipped `confirm: true`, log the preview as an audit entry.
    // This is how we know who accepted what-with-what-impact. The ChangeOrder
    // row itself is created/updated by /api/ops/change-orders — this is just
    // the attestation that the preview was seen and accepted.
    if (body?.confirm === true) {
      await audit(
        request,
        'PREVIEW_CONFIRM',
        'ChangeOrderPreview',
        body?.changeOrderId || jobId,
        {
          jobId,
          changeOrderId: body?.changeOrderId || null,
          lines,
          overallImpact: result.overallImpact,
          newCompletionDate: result.newCompletionDate,
          daysShifted: result.daysShifted,
          totalNewValue: result.totalNewValue,
          source: 'ops',
        },
        result.overallImpact === 'WILL_MISS' ? 'WARN' : 'INFO'
      )
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[co-preview POST]', err)
    const msg = err?.message || 'Failed to compute CO impact'
    const status = msg.includes('Job not found') ? 404 : 500
    return NextResponse.json({ error: msg }, { status })
  }
}
