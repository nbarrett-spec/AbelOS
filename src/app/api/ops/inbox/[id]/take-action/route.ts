/**
 * Take action on an inbox item
 *
 * POST /api/ops/inbox/[id]/take-action
 *   body: optional override payload
 *
 * Uses the stored `actionData` payload to execute the implied action based
 * on the item's `type`. Returns either:
 *   - { redirectTo: "/ops/..." }         — a dedicated UI handles the action
 *   - { executed: true, result: {...} }  — action was executed in-place
 *
 * NOTE: This is intentionally a thin router. We don't call downstream
 * endpoints server-to-server here to keep CSRF surfaces tight — for most
 * types we return a `redirectTo` and the client sends the follow-up POST
 * with the staff cookie attached. Audits the dispatch.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

function buildRedirect(type: string, item: any): string | null {
  const entityId = item?.entityId
  const actionData = item?.actionData || {}
  const ad = typeof actionData === 'object' ? actionData : {}

  switch (type) {
    case 'PO_APPROVAL':
    case 'MRP_RECOMMENDATION':
      if (entityId) return `/ops/purchasing?po=${encodeURIComponent(entityId)}`
      return '/ops/purchasing'

    case 'COLLECTION_ACTION':
      if (entityId) return `/ops/collections?builder=${encodeURIComponent(entityId)}`
      return '/ops/collections'

    case 'CREDIT_ALERT':
      return '/ops/finance/ar'

    case 'QC_ALERT':
      if (entityId) return `/ops/manufacturing/qc?id=${encodeURIComponent(entityId)}`
      return '/ops/manufacturing/qc'

    case 'MATERIAL_ARRIVAL':
      return '/ops/receiving'

    case 'SCHEDULE_CHANGE':
      if (entityId) return `/ops/schedule?job=${encodeURIComponent(entityId)}`
      return '/ops/schedule'

    case 'DEAL_FOLLOWUP':
    case 'OUTREACH_REVIEW':
      if (entityId) return `/ops/sales?deal=${encodeURIComponent(entityId)}`
      return '/ops/sales'

    case 'IMPROVEMENT_REVENUE':
    case 'IMPROVEMENT_PRICING':
      return '/ops/pricing'

    case 'IMPROVEMENT_SUPPLIER':
      return '/ops/vendors'

    case 'IMPROVEMENT_INVENTORY':
      return '/ops/inventory'

    case 'IMPROVEMENT_CASHFLOW':
    case 'IMPROVEMENT_COST':
    case 'FINANCIAL_IMPROVEMENT':
      return '/ops/finance'

    case 'ACTION_REQUIRED': {
      const href = (ad as any).href || (ad as any).url
      if (typeof href === 'string' && href.startsWith('/ops/')) return href
      return '/ops/my-day'
    }

    default:
      return null
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "InboxItem" WHERE id = $1`,
      id
    )
    if (!existing.length) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const item = existing[0]
    const redirectTo = buildRedirect(item.type, item)

    await audit(request, 'TAKE_ACTION', 'InboxItem', id, {
      type: item.type,
      redirectTo,
    })

    if (redirectTo) {
      return NextResponse.json({
        id,
        redirectTo,
        type: item.type,
      })
    }

    // No dedicated route — acknowledge but don't resolve automatically.
    return NextResponse.json({
      id,
      type: item.type,
      message: 'No dedicated action handler for this type. Resolve manually.',
    })
  } catch (error: any) {
    logger.error('inbox_take_action_failed', { error: error?.message, id })
    return NextResponse.json(
      { error: error?.message || 'Failed to take action' },
      { status: 500 }
    )
  }
}
