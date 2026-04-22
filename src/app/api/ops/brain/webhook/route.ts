/**
 * Brain → Aegis: Webhook Receiver
 *
 * POST: Receives actions, alerts, and entity updates from the NUC Brain.
 *       The FeedAgent pushes here when:
 *       - An action is auto-executed (NOTIFY tier)
 *       - A P0 alert fires
 *       - An entity health status changes
 *       - Morning brief is generated
 *
 * All events land as InboxItems in the unified operator inbox.
 *
 * Auth: Bearer token matching NUC_BRAIN_API_KEY
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { audit } from '@/lib/audit'

function validateBrainAuth(request: NextRequest): boolean {
  const key = process.env.NUC_BRAIN_API_KEY
  if (!key) return false
  return request.headers.get('authorization') === `Bearer ${key}`
}

// Map Brain priority to InboxItem priority
function mapPriority(brainPriority: string): string {
  const map: Record<string, string> = {
    P0: 'CRITICAL',
    P1: 'HIGH',
    P2: 'MEDIUM',
    P3: 'LOW',
  }
  return map[brainPriority] || 'MEDIUM'
}

// Map Brain event types to InboxItem types
function mapEventType(eventType: string): string {
  const map: Record<string, string> = {
    action_executed: 'BRAIN_ACTION',
    action_approved: 'BRAIN_ACTION',
    action_rejected: 'BRAIN_ACTION',
    p0_alert: 'BRAIN_ALERT',
    health_change: 'BRAIN_HEALTH',
    morning_brief: 'BRAIN_BRIEF',
    anomaly_detected: 'BRAIN_ANOMALY',
    score_change: 'BRAIN_SCORE_ALERT',
    gap_detected: 'BRAIN_GAP',
  }
  return map[eventType] || 'BRAIN_EVENT'
}

// Resolve Brain entity references to Aegis entity IDs
// The Brain sends entity names/refs, we try to find the matching Aegis record.
async function resolveEntityToAegis(
  brainEntityId: string | null,
  entityName: string | null,
  entityType: string | null
): Promise<{ aegisId: string | null; aegisType: string }> {
  if (!brainEntityId && !entityName) return { aegisId: null, aegisType: 'BrainEntity' }

  const searchName = entityName || brainEntityId || ''

  // Try to match against Builders (most common Brain entity type)
  if (!entityType || entityType === 'customer' || entityType === 'builder' || entityType === 'account') {
    const builders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Builder" WHERE LOWER("companyName") ILIKE $1 OR LOWER("contactName") ILIKE $1 LIMIT 1`,
      `%${searchName.toLowerCase()}%`
    )
    if (builders.length > 0) return { aegisId: builders[0].id, aegisType: 'Builder' }
  }

  // Try Products
  if (!entityType || entityType === 'product' || entityType === 'item') {
    const products: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Product" WHERE LOWER(name) ILIKE $1 OR sku = $2 LIMIT 1`,
      `%${searchName.toLowerCase()}%`, searchName
    )
    if (products.length > 0) return { aegisId: products[0].id, aegisType: 'Product' }
  }

  // Try Vendors
  if (!entityType || entityType === 'vendor' || entityType === 'supplier') {
    const vendors: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Vendor" WHERE LOWER(name) ILIKE $1 OR code = $2 LIMIT 1`,
      `%${searchName.toLowerCase()}%`, searchName
    )
    if (vendors.length > 0) return { aegisId: vendors[0].id, aegisType: 'Vendor' }
  }

  // Try Orders
  if (!entityType || entityType === 'order') {
    const orders: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Order" WHERE "orderNumber" = $1 LIMIT 1`, searchName
    )
    if (orders.length > 0) return { aegisId: orders[0].id, aegisType: 'Order' }
  }

  // Try Jobs
  if (!entityType || entityType === 'job') {
    const jobs: any[] = await prisma.$queryRawUnsafe(
      `SELECT id FROM "Job" WHERE "jobNumber" = $1 LIMIT 1`, searchName
    )
    if (jobs.length > 0) return { aegisId: jobs[0].id, aegisType: 'Job' }
  }

  // Unresolved — store with Brain reference for manual resolution
  return { aegisId: brainEntityId, aegisType: 'BrainEntity' }
}

export async function POST(request: NextRequest) {
  if (!validateBrainAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json()

    // Support single event or batch
    const events: any[] = Array.isArray(body) ? body : [body]
    let created = 0
    let duplicatesSkipped = 0

    for (const event of events) {
      const {
        event_type,
        priority = 'P2',
        title,
        body: eventBody,
        description,
        entity_ids = [],
        action_ids = [],
        brain_id,
        timestamp,
        // Extra fields for specific event types
        action_data,
        financial_impact,
      } = event

      if (!title) {
        continue // Skip events without a title
      }

      const inboxType = mapEventType(event_type || 'brain_event')
      const inboxPriority = mapPriority(priority)
      const brainEntityId = entity_ids[0] || null
      const descriptionText = description || eventBody || ''

      // Resolve Brain entity IDs to Aegis entity IDs
      const entityName = event.entity_name || event.customer_name || event.product_name || event.vendor_name || null
      const entityKind = event.entity_type || null
      const { aegisId, aegisType } = await resolveEntityToAegis(brainEntityId, entityName, entityKind)

      // Dedup: check for existing PENDING item with same type + entity
      if (aegisId) {
        const existing = await prisma.$queryRawUnsafe<any[]>(
          `SELECT id FROM "InboxItem"
           WHERE type = $1 AND "entityId" = $2 AND status = 'PENDING'
           LIMIT 1`,
          inboxType, aegisId
        )
        if (existing.length > 0) {
          duplicatesSkipped++
          continue
        }
      }

      const id = `inb_brain_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const now = new Date().toISOString()

      const actionPayload = {
        brain_id,
        event_type,
        entity_ids,
        action_ids,
        brain_timestamp: timestamp,
        brain_entity_name: entityName,
        aegis_resolved: aegisType !== 'BrainEntity',
        ...(action_data || {}),
      }

      await prisma.$executeRawUnsafe(
        `INSERT INTO "InboxItem"
         (id, type, source, title, description, priority, "entityType", "entityId", "financialImpact", "actionData", status, "createdAt", "updatedAt")
         VALUES ($1, $2, 'nuc-brain', $3, $4, $5, $6, $7, $8, $9, 'PENDING', $10, $10)`,
        id,
        inboxType,
        title.slice(0, 500),
        descriptionText.slice(0, 2000),
        inboxPriority,
        aegisType,
        aegisId,
        financial_impact || 0,
        JSON.stringify(actionPayload),
        now
      )
      created++
    }

    logger.info('brain_webhook_received', {
      eventsReceived: events.length,
      created,
      duplicatesSkipped,
    })

    await audit(request, 'CREATE', 'InboxItem', 'batch', { eventCount: events.length, itemsCreated: created, duplicatesSkipped })

    return NextResponse.json({
      received: events.length,
      created,
      duplicatesSkipped,
      timestamp: new Date().toISOString(),
    })
  } catch (error: any) {
    logger.error('brain_webhook_failed', { error: error?.message })
    return NextResponse.json(
      { error: error?.message || 'Failed to process brain webhook' },
      { status: 500 }
    )
  }
}
