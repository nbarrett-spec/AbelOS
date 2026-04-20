/**
 * Unified Operator Inbox API
 *
 * GET:   Fetch inbox items
 *        ?status=PENDING&type=MRP_RECOMMENDATION&assignedTo=staffId&limit=50
 *
 * POST:  Create a new inbox item manually
 *        body: { type, source, title, description?, priority?, entityType?, entityId?, financialImpact?, actionData?, dueBy?, assignedTo? }
 *
 * PATCH: Update item status (approve/reject/snooze)
 *        body: { itemId, action: 'APPROVE' | 'REJECT' | 'SNOOZE', notes?, snoozedUntil? }
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET: Fetch inbox items via raw SQL
// ──────────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const status = searchParams.get('status')
    const type = searchParams.get('type')
    const assignedTo = searchParams.get('assignedTo')
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 100)

    // Build dynamic WHERE
    const conditions: string[] = []
    const params: any[] = []
    let paramIdx = 1

    if (status) {
      conditions.push(`status = $${paramIdx++}`)
      params.push(status)
    }
    if (type) {
      conditions.push(`type = $${paramIdx++}`)
      params.push(type)
    }
    if (assignedTo) {
      conditions.push(`"assignedTo" = $${paramIdx++}`)
      params.push(assignedTo)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const items = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "InboxItem" ${whereClause}
       ORDER BY
         CASE priority WHEN 'CRITICAL' THEN 1 WHEN 'HIGH' THEN 2 WHEN 'MEDIUM' THEN 3 ELSE 4 END,
         "createdAt" DESC
       LIMIT $${paramIdx}`,
      ...params, limit
    )

    return NextResponse.json({ items, count: items.length })
  } catch (error: any) {
    logger.error('inbox_get_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch inbox' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// POST: Create new inbox item
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      type, source, title, description, priority = 'MEDIUM',
      entityType, entityId, financialImpact, actionData, dueBy, assignedTo,
    } = body

    if (!type || !source || !title) {
      return NextResponse.json(
        { error: 'Missing required fields: type, source, title' },
        { status: 400 }
      )
    }

    const id = `inb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    const now = new Date().toISOString()

    await prisma.$executeRawUnsafe(
      `INSERT INTO "InboxItem" (id, type, source, title, description, priority, "entityType", "entityId", "financialImpact", "actionData", "dueBy", "assignedTo", status, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'PENDING', $13, $13)`,
      id, type, source, title, description || null, priority,
      entityType || null, entityId || null, financialImpact || 0,
      actionData ? JSON.stringify(actionData) : null,
      dueBy ? new Date(dueBy).toISOString() : null,
      assignedTo || null, now
    )

    logger.info('inbox_item_created', { itemId: id, type, source })

    return NextResponse.json({ id, type, source, title, priority, status: 'PENDING' }, { status: 201 })
  } catch (error: any) {
    logger.error('inbox_post_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to create inbox item' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH: Update inbox item (approve/reject/snooze)
// ──────────────────────────────────────────────────────────────────────────
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { itemId, action, notes, snoozedUntil } = body

    if (!itemId || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: itemId, action' },
        { status: 400 }
      )
    }

    const existing = await prisma.$queryRawUnsafe<any[]>(
      `SELECT id, status FROM "InboxItem" WHERE id = $1`, itemId
    )
    if (!existing.length) {
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })
    }

    const now = new Date().toISOString()

    switch (action) {
      case 'APPROVE':
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem" SET status = 'APPROVED', "resolvedAt" = $1, result = $2, "updatedAt" = $1 WHERE id = $3`,
          now, JSON.stringify({ approved: true, notes }), itemId
        )
        break
      case 'REJECT':
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem" SET status = 'REJECTED', "resolvedAt" = $1, result = $2, "updatedAt" = $1 WHERE id = $3`,
          now, JSON.stringify({ rejected: true, notes }), itemId
        )
        break
      case 'SNOOZE':
        if (!snoozedUntil) {
          return NextResponse.json({ error: 'snoozedUntil required for SNOOZE' }, { status: 400 })
        }
        await prisma.$executeRawUnsafe(
          `UPDATE "InboxItem" SET status = 'SNOOZED', "snoozedUntil" = $1, "updatedAt" = $2 WHERE id = $3`,
          new Date(snoozedUntil).toISOString(), now, itemId
        )
        break
      default:
        return NextResponse.json({ error: 'Invalid action. Must be APPROVE, REJECT, or SNOOZE' }, { status: 400 })
    }

    audit(request, 'UPDATE', 'InboxItem', itemId, { action, notes })

    return NextResponse.json({ id: itemId, action, status: action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'SNOOZED' })
  } catch (error: any) {
    logger.error('inbox_patch_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to update inbox item' },
      { status: 500 }
    )
  }
}
