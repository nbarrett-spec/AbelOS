/**
 * Inbox Feed Generator Cron
 *
 * Runs every 15 minutes
 * - Scans all source systems for new actionable items
 * - Creates InboxItem rows for anything not already tracked
 * - Sets priority based on financial impact and urgency
 * - Uses cron instrumentation from src/lib/cron.ts
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { startCronRun, finishCronRun } from '@/lib/cron'

async function createInboxItem(data: {
  type: string
  source: string
  title: string
  description?: string
  priority: string
  entityType?: string
  entityId?: string
  financialImpact?: number
  actionData?: any
}) {
  const id = `inb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const now = new Date().toISOString()
  await prisma.$executeRawUnsafe(
    `INSERT INTO "InboxItem" (id, type, source, title, description, priority, "entityType", "entityId", "financialImpact", "actionData", status, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'PENDING', $11, $11)`,
    id, data.type, data.source, data.title, data.description || null, data.priority,
    data.entityType || null, data.entityId || null, data.financialImpact || 0,
    data.actionData ? JSON.stringify(data.actionData) : null, now
  )
  return id
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('inbox-feed', 'schedule')
  const startTime = Date.now()
  let itemsCreated = 0

  try {
    // ── 1. MRP RECOMMENDATIONS ──────────────────────────────────────────
    try {
      const mrpSuggestions = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT
          s."id",
          p."supplierName" || ' - ' || STRING_AGG(DISTINCT pl."sku", ', ') AS title,
          s."totalEstimatedCost" AS financial_impact,
          CASE
            WHEN s."totalEstimatedCost" > 10000 THEN 'CRITICAL'
            WHEN s."totalEstimatedCost" > 5000 THEN 'HIGH'
            ELSE 'MEDIUM'
          END AS priority
        FROM "PurchaseOrderSuggestion" s
        LEFT JOIN "Supplier" p ON s."supplierId" = p."id"
        LEFT JOIN "PurchaseOrderSuggestionLine" sl ON s."id" = sl."suggestionId"
        LEFT JOIN "ProductLine" pl ON sl."productLineId" = pl."id"
        WHERE s."status" = 'PENDING'
        AND NOT EXISTS (
          SELECT 1 FROM "InboxItem"
          WHERE "source" = 'mrp' AND "type" = 'MRP_RECOMMENDATION' AND "entityId" = s."id"
        )
        GROUP BY s."id", s."totalEstimatedCost", p."supplierName"
        LIMIT 50`
      )

      for (const row of mrpSuggestions) {
        await createInboxItem({
          type: 'MRP_RECOMMENDATION',
          source: 'mrp',
          title: row.title,
          description: `Auto-generated PO recommendation for ${row.title}`,
          priority: row.priority,
          entityType: 'PurchaseOrderSuggestion',
          entityId: row.id,
          financialImpact: parseFloat(row.financial_impact || 0),
          actionData: { poSuggestionId: row.id },
        })
        itemsCreated++
      }
    } catch (e: any) {
      logger.warn('inbox_feed_mrp_scan_failed', { error: e?.message })
    }

    // ── 2. COLLECTION ACTIONS ───────────────────────────────────────────
    try {
      const collectionActions = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT
          i."id",
          b."companyName" || ' - Invoice ' || i."invoiceNumber" AS title,
          i."totalAmount" - COALESCE(i."amountPaid", 0) AS financial_impact,
          CASE
            WHEN CURRENT_DATE - i."dueDate" > 60 THEN 'CRITICAL'
            WHEN CURRENT_DATE - i."dueDate" > 30 THEN 'HIGH'
            WHEN CURRENT_DATE - i."dueDate" > 0 THEN 'MEDIUM'
            ELSE 'LOW'
          END AS priority
        FROM "Invoice" i
        JOIN "Builder" b ON i."builderId" = b."id"
        WHERE i."status" = 'SENT'
        AND i."dueDate" < CURRENT_DATE
        AND (i."totalAmount" - COALESCE(i."amountPaid", 0)) > 0
        AND NOT EXISTS (
          SELECT 1 FROM "InboxItem"
          WHERE "source" = 'collections' AND "type" = 'COLLECTION_ACTION' AND "entityId" = i."id"
        )
        LIMIT 50`
      )

      for (const row of collectionActions) {
        await createInboxItem({
          type: 'COLLECTION_ACTION',
          source: 'collections',
          title: row.title,
          description: `Payment overdue`,
          priority: row.priority,
          entityType: 'Invoice',
          entityId: row.id,
          financialImpact: parseFloat(row.financial_impact || 0),
          actionData: { invoiceId: row.id },
        })
        itemsCreated++
      }
    } catch (e: any) {
      logger.warn('inbox_feed_collections_scan_failed', { error: e?.message })
    }

    // ── 3. DEAL FOLLOW-UPS ──────────────────────────────────────────────
    try {
      const dealFollowups = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT
          q."id",
          'Quote Followup - ' || q."quoteNumber" AS title,
          COALESCE(q."total", 0) AS financial_impact,
          CASE
            WHEN CURRENT_DATE - q."createdAt"::date > 14 THEN 'CRITICAL'
            WHEN CURRENT_DATE - q."createdAt"::date > 7 THEN 'HIGH'
            ELSE 'MEDIUM'
          END AS priority
        FROM "Quote" q
        WHERE q."status" = 'SENT'
        AND q."createdAt" < NOW() - INTERVAL '5 days'
        AND NOT EXISTS (
          SELECT 1 FROM "InboxItem"
          WHERE "source" = 'sales' AND "type" = 'DEAL_FOLLOWUP' AND "entityId" = q."id"
        )
        LIMIT 50`
      )

      for (const row of dealFollowups) {
        await createInboxItem({
          type: 'DEAL_FOLLOWUP',
          source: 'sales',
          title: row.title,
          description: `Quote needs follow-up`,
          priority: row.priority,
          entityType: 'Quote',
          entityId: row.id,
          financialImpact: parseFloat(row.financial_impact || 0),
          actionData: { quoteId: row.id },
        })
        itemsCreated++
      }
    } catch (e: any) {
      logger.warn('inbox_feed_deals_scan_failed', { error: e?.message })
    }

    // ── 4. AGENT TASKS ──────────────────────────────────────────────────
    try {
      const agentTasks = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "id", "title", "priority"
        FROM "AIAgentTask"
        WHERE "status" = 'PENDING'
        AND NOT EXISTS (
          SELECT 1 FROM "InboxItem"
          WHERE "source" = 'agent-hub' AND "type" = 'AGENT_TASK' AND "entityId" = "AIAgentTask"."id"
        )
        LIMIT 30`
      )

      for (const row of agentTasks) {
        await createInboxItem({
          type: 'AGENT_TASK',
          source: 'agent-hub',
          title: row.title,
          priority: row.priority || 'MEDIUM',
          entityType: 'AIAgentTask',
          entityId: row.id,
          actionData: { taskId: row.id },
        })
        itemsCreated++
      }
    } catch (e: any) {
      logger.warn('inbox_feed_agent_tasks_scan_failed', { error: e?.message })
    }

    // ── 5. MATERIAL ARRIVALS ────────────────────────────────────────────
    try {
      const materialArrivals = await prisma.$queryRawUnsafe<any[]>(
        `SELECT DISTINCT
          mw."id",
          pl."name" || ' - materials arriving soon' AS title
        FROM "MaterialWatch" mw
        JOIN "ProductLine" pl ON mw."productLineId" = pl."id"
        WHERE mw."status" = 'AWAITING_ARRIVAL'
        AND mw."expectedArrival" <= CURRENT_DATE + INTERVAL '3 days'
        AND NOT EXISTS (
          SELECT 1 FROM "InboxItem"
          WHERE "source" = 'inventory' AND "type" = 'MATERIAL_ARRIVAL' AND "entityId" = mw."id"
        )
        LIMIT 30`
      )

      for (const row of materialArrivals) {
        await createInboxItem({
          type: 'MATERIAL_ARRIVAL',
          source: 'inventory',
          title: row.title,
          description: 'Materials expected to arrive within 3 days',
          priority: 'MEDIUM',
          entityType: 'MaterialWatch',
          entityId: row.id,
          actionData: { materialWatchId: row.id },
        })
        itemsCreated++
      }
    } catch (e: any) {
      logger.warn('inbox_feed_materials_scan_failed', { error: e?.message })
    }

    const duration = Date.now() - startTime
    const payload = {
      success: true,
      itemsCreated,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    }

    await finishCronRun(runId, 'SUCCESS', duration, { result: payload })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[Inbox Feed Cron] Error:', error)
    const duration = Date.now() - startTime
    await finishCronRun(runId, 'FAILURE', duration, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}
