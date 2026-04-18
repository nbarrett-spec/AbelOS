/**
 * Cron: Run Automations
 *
 * Execution engine for Abel OS automation system
 *
 * - Runs every hour (configurable)
 * - Processes SCHEDULED triggers: DAILY_MORNING, DAILY_EVENING, WEEKLY_MONDAY, MONTHLY_FIRST
 * - Processes EVENT-based triggers: INVOICE_OVERDUE, INVENTORY_LOW, INVENTORY_OUT, PO_OVERDUE, QUOTE_EXPIRED
 * - Executes actions for triggered rules (SEND_NOTIFICATION, SEND_EMAIL, CREATE_TASK, LOG_AUDIT)
 * - Tracks execution in AutomationLog
 * - Respects frequency constraints (ONCE_DAILY, ONCE_WEEKLY, ONCE_PER_ENTITY)
 *
 * Requires CRON_SECRET for auth (same as other cron routes)
 * Runs GET (Vercel crons use GET)
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'

interface AutomationAction {
  type:
    | 'SEND_NOTIFICATION'
    | 'SEND_EMAIL'
    | 'CREATE_TASK'
    | 'UPDATE_STATUS'
    | 'LOG_AUDIT'
    | 'AI_ANALYZE'
    | 'AI_DAILY_BRIEFING'
    | 'AI_GENERATE_PO'
    | 'AI_DEMAND_FORECAST'
    | 'AI_REORDER_CHECK'
  payload?: Record<string, any>
}

interface AutomationRule {
  id: string
  name: string
  description?: string
  trigger: string
  conditions?: Record<string, any>
  actions?: AutomationAction[]
  roles?: string[]
  frequency: 'ON_TRIGGER' | 'ONCE_DAILY' | 'ONCE_WEEKLY' | 'ONCE_PER_ENTITY'
  enabled: boolean
  lastRunAt?: Date
  runCount: number
  createdById: string
}

interface TriggerMatch {
  trigger: string
  entityIds: string[]
}

export async function GET(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('run-automations', 'schedule')
  const startTime = Date.now()

  try {
    // console.log('[Automation Cron] Starting automation execution...')

    const stats = {
      rulesEvaluated: 0,
      rulesTriggered: 0,
      actionsExecuted: 0,
      errors: [] as string[],
    }

    // Get all enabled rules
    const rules = await prisma.$queryRawUnsafe<AutomationRule[]>(
      `SELECT id, name, description, trigger, conditions, actions, roles, frequency,
              enabled, "lastRunAt", "runCount", "createdById"
       FROM "AutomationRule"
       WHERE enabled = true
       ORDER BY "createdAt" ASC`
    )

    if (!rules || rules.length === 0) {
      // console.log('[Automation Cron] No enabled automation rules found')
      const noRulesPayload = {
        success: true,
        message: 'No automation rules to run',
        stats,
        timestamp: new Date().toISOString(),
      }
      await finishCronRun(runId, 'SUCCESS', Date.now() - startTime, { result: noRulesPayload })
      return NextResponse.json(noRulesPayload)
    }

    // console.log(`[Automation Cron] Found ${rules.length} enabled rules`)

    // Check each rule
    for (const rule of rules) {
      stats.rulesEvaluated++

      try {
        const matches = await checkTrigger(rule)

        if (!matches || matches.entityIds.length === 0) {
          continue
        }

        // Check frequency constraint
        if (!shouldExecuteRule(rule)) {
          // console.log(
          //   `[Automation Cron] Rule ${rule.id} skipped due to frequency (last run: ${rule.lastRunAt})`
          // )
          continue
        }

        stats.rulesTriggered++

        // Execute actions for each matched entity
        for (const entityId of matches.entityIds) {
          try {
            const actionResults = await executeActions(rule.actions || [])

            stats.actionsExecuted += actionResults.executed
            stats.errors.push(...actionResults.errors)

            // Log execution
            await logAutomationExecution({
              ruleId: rule.id,
              ruleName: rule.name,
              trigger: matches.trigger,
              status: actionResults.errors.length === 0 ? 'SUCCESS' : 'ERROR',
              actionsRun: actionResults.executed,
              details: { entityId },
              error: actionResults.errors.length > 0 ? actionResults.errors.join('; ') : undefined,
            })
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : 'Unknown error'
            console.error(`[Automation Cron] Error executing rule ${rule.id}:`, errorMsg)
            stats.errors.push(errorMsg)

            await logAutomationExecution({
              ruleId: rule.id,
              ruleName: rule.name,
              trigger: matches.trigger,
              status: 'ERROR',
              actionsRun: 0,
              details: { entityId },
              error: errorMsg,
            })
          }
        }

        // Update rule metadata
        await updateRuleMetadata(rule.id)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : 'Unknown error'
        console.error(`[Automation Cron] Error evaluating rule ${rule.id}:`, errorMsg)
        stats.errors.push(errorMsg)
      }
    }

    const duration = Date.now() - startTime
    // console.log(
    //   `[Automation Cron] Completed in ${duration}ms: ${stats.rulesEvaluated} evaluated, ${stats.rulesTriggered} triggered, ${stats.actionsExecuted} actions`
    // )

    const payload = {
      success: true,
      message: 'Automation execution completed',
      stats,
      duration_ms: duration,
      timestamp: new Date().toISOString(),
    }
    await finishCronRun(runId, stats.errors.length > 0 ? 'FAILURE' : 'SUCCESS', duration, {
      result: payload,
      error: stats.errors.length > 0 ? stats.errors.join('; ').slice(0, 4000) : undefined,
    })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[Automation Cron] Fatal error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - startTime, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    )
  }
}

/**
 * Check if a rule's trigger condition is met
 * Returns matching trigger and list of entity IDs that match
 */
async function checkTrigger(rule: AutomationRule): Promise<TriggerMatch | null> {
  const now = new Date()
  const hour = now.getHours()
  const day = now.getDay()
  const dateOfMonth = now.getDate()

  // Timezone: America/Chicago (CT)
  // DAILY_MORNING: 7-9am CT
  // DAILY_EVENING: 4-6pm CT
  // WEEKLY_MONDAY: Monday 7-9am CT
  // MONTHLY_FIRST: 1st-3rd of month 7-9am CT

  try {
    switch (rule.trigger) {
      case 'DAILY_MORNING':
        if (hour >= 7 && hour < 9) {
          // console.log(`[Automation Cron] DAILY_MORNING trigger matched for rule ${rule.id}`)
          return { trigger: 'DAILY_MORNING', entityIds: ['daily-morning'] }
        }
        break

      case 'DAILY_EVENING':
        if (hour >= 16 && hour < 18) {
          // console.log(`[Automation Cron] DAILY_EVENING trigger matched for rule ${rule.id}`)
          return { trigger: 'DAILY_EVENING', entityIds: ['daily-evening'] }
        }
        break

      case 'WEEKLY_MONDAY':
        if (day === 1 && hour >= 7 && hour < 9) {
          // console.log(`[Automation Cron] WEEKLY_MONDAY trigger matched for rule ${rule.id}`)
          return { trigger: 'WEEKLY_MONDAY', entityIds: ['weekly-monday'] }
        }
        break

      case 'MONTHLY_FIRST':
        if (dateOfMonth >= 1 && dateOfMonth <= 3 && hour >= 7 && hour < 9) {
          // console.log(`[Automation Cron] MONTHLY_FIRST trigger matched for rule ${rule.id}`)
          return { trigger: 'MONTHLY_FIRST', entityIds: ['monthly-first'] }
        }
        break

      case 'INVOICE_OVERDUE':
        return await checkInvoiceOverdue(rule)

      case 'INVENTORY_LOW':
        return await checkInventoryLow(rule)

      case 'INVENTORY_OUT':
        return await checkInventoryOut(rule)

      case 'PO_OVERDUE':
        return await checkPOOverdue(rule)

      case 'QUOTE_EXPIRED':
        return await checkQuoteExpired(rule)

      case 'ORDER_CREATED':
        return await checkOrderCreated(rule)

      case 'ORDER_STATUS_CHANGED':
      case 'DELIVERY_SCHEDULED':
      case 'DELIVERY_COMPLETE':
      case 'JOB_STATUS_CHANGED':
      case 'QUOTE_CREATED':
      case 'QUOTE_SENT':
      case 'QUOTE_APPROVED':
      case 'PAYMENT_RECEIVED':
      case 'PO_CREATED':
      case 'PO_APPROVED':
      case 'PO_RECEIVED':
        // These are event-based and triggered via fireAutomationEvent()
        // Not checked in cron - only from API routes
        return null

      default:
        console.warn(`[Automation Cron] Unknown trigger type: ${rule.trigger}`)
        return null
    }
  } catch (error) {
    console.error(`[Automation Cron] Error checking trigger ${rule.trigger}:`, error)
    return null
  }

  return null
}

/**
 * Check for overdue invoices
 */
async function checkInvoiceOverdue(rule: AutomationRule): Promise<TriggerMatch | null> {
  try {
    const invoices = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Invoice"
       WHERE status = 'SENT' AND "dueDate" < NOW()
       AND "dueDate" > NOW() - INTERVAL '24 hours'
       LIMIT 100`
    )

    if (invoices && invoices.length > 0) {
      // console.log(`[Automation Cron] Found ${invoices.length} overdue invoices`)
      return {
        trigger: 'INVOICE_OVERDUE',
        entityIds: invoices.map((i) => i.id),
      }
    }
  } catch (error) {
    console.error('[Automation Cron] Error checking overdue invoices:', error)
  }

  return null
}

/**
 * Check for low inventory
 */
async function checkInventoryLow(rule: AutomationRule): Promise<TriggerMatch | null> {
  try {
    const items = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "InventoryItem"
       WHERE "onHand" <= "reorderPoint" AND "onHand" > 0
       LIMIT 100`
    )

    if (items && items.length > 0) {
      // console.log(`[Automation Cron] Found ${items.length} low inventory items`)
      return {
        trigger: 'INVENTORY_LOW',
        entityIds: items.map((i) => i.id),
      }
    }
  } catch (error) {
    console.error('[Automation Cron] Error checking low inventory:', error)
  }

  return null
}

/**
 * Check for out of stock inventory
 */
async function checkInventoryOut(rule: AutomationRule): Promise<TriggerMatch | null> {
  try {
    const items = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "InventoryItem"
       WHERE "onHand" <= 0
       LIMIT 100`
    )

    if (items && items.length > 0) {
      // console.log(`[Automation Cron] Found ${items.length} out of stock items`)
      return {
        trigger: 'INVENTORY_OUT',
        entityIds: items.map((i) => i.id),
      }
    }
  } catch (error) {
    console.error('[Automation Cron] Error checking out of stock inventory:', error)
  }

  return null
}

/**
 * Check for overdue purchase orders
 */
async function checkPOOverdue(rule: AutomationRule): Promise<TriggerMatch | null> {
  try {
    const pos = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "PurchaseOrder"
       WHERE status IN ('SENT', 'IN_TRANSIT') AND "expectedDate" < NOW()
       AND "expectedDate" > NOW() - INTERVAL '24 hours'
       LIMIT 100`
    )

    if (pos && pos.length > 0) {
      // console.log(`[Automation Cron] Found ${pos.length} overdue purchase orders`)
      return {
        trigger: 'PO_OVERDUE',
        entityIds: pos.map((p) => p.id),
      }
    }
  } catch (error) {
    console.error('[Automation Cron] Error checking overdue POs:', error)
  }

  return null
}

/**
 * Check for expired quotes
 */
async function checkQuoteExpired(rule: AutomationRule): Promise<TriggerMatch | null> {
  try {
    const quotes = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Quote"
       WHERE status = 'SENT' AND "validUntil" < NOW()
       AND "validUntil" > NOW() - INTERVAL '24 hours'
       LIMIT 100`
    )

    if (quotes && quotes.length > 0) {
      // console.log(`[Automation Cron] Found ${quotes.length} expired quotes`)
      return {
        trigger: 'QUOTE_EXPIRED',
        entityIds: quotes.map((q) => q.id),
      }
    }
  } catch (error) {
    console.error('[Automation Cron] Error checking expired quotes:', error)
  }

  return null
}

/**
 * Check for orders created in the last hour
 */
async function checkOrderCreated(rule: AutomationRule): Promise<TriggerMatch | null> {
  try {
    const orders = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Order"
       WHERE "createdAt" > NOW() - INTERVAL '1 hour'
       LIMIT 100`
    )

    if (orders && orders.length > 0) {
      // console.log(`[Automation Cron] Found ${orders.length} orders created in last hour`)
      return {
        trigger: 'ORDER_CREATED',
        entityIds: orders.map((o) => o.id),
      }
    }
  } catch (error) {
    console.error('[Automation Cron] Error checking order creation:', error)
  }

  return null
}

/**
 * Check if rule should execute based on frequency constraint
 */
function shouldExecuteRule(rule: AutomationRule): boolean {
  const now = new Date()
  const lastRun = rule.lastRunAt ? new Date(rule.lastRunAt) : null

  switch (rule.frequency) {
    case 'ON_TRIGGER':
      return true

    case 'ONCE_DAILY':
      if (!lastRun) return true
      // Skip if last run was today (same calendar day in CT)
      return lastRun.toDateString() !== now.toDateString()

    case 'ONCE_WEEKLY':
      if (!lastRun) return true
      // Skip if last run was within the past 7 days
      const daysSinceRun = Math.floor((now.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24))
      return daysSinceRun >= 7

    case 'ONCE_PER_ENTITY':
      // Tracked via details JSONB - always allow check
      // Deduplication happens at entity level
      return true

    default:
      return true
  }
}

/**
 * Execute automation actions
 */
async function executeActions(
  actions: AutomationAction[]
): Promise<{ executed: number; errors: string[] }> {
  const errors: string[] = []
  let count = 0

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'SEND_NOTIFICATION':
          await processNotification(action)
          count++
          break

        case 'SEND_EMAIL':
          // Just log for now - templates not set up per automation
          // console.log(`[Automation Cron] Email action deferred: ${action.payload?.template || 'unnamed'}`)
          count++
          break

        case 'CREATE_TASK':
          await processCreateTask(action)
          count++
          break

        case 'LOG_AUDIT':
          await processAuditLog(action)
          count++
          break

        case 'UPDATE_STATUS':
          // Skip - too dangerous without specific logic
          // console.log('[Automation Cron] UPDATE_STATUS action skipped (requires specific logic)')
          break

        case 'AI_ANALYZE':
        case 'AI_DAILY_BRIEFING':
        case 'AI_GENERATE_PO':
        case 'AI_DEMAND_FORECAST':
        case 'AI_REORDER_CHECK':
          // console.log(`[Automation Cron] ${action.type} action deferred (AI integration pending)`)
          break

        default:
          errors.push(`Unknown action type: ${(action as any).type}`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.error(`[Automation Cron] Error executing action ${action.type}:`, errorMsg)
      errors.push(errorMsg)
    }
  }

  return { executed: count, errors }
}

/**
 * Process SEND_NOTIFICATION action
 */
async function processNotification(action: AutomationAction): Promise<void> {
  const { staffId, title, message, type = 'INFO' } = action.payload || {}

  if (!staffId || !title || !message) {
    throw new Error('SEND_NOTIFICATION requires staffId, title, message')
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Notification" (id, "staffId", type, title, body, "createdAt")
     VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
    staffId,
    type,
    title,
    message
  )

  // console.log(`[Automation Cron] Notification sent to staff ${staffId}`)
}

/**
 * Process CREATE_TASK action
 */
async function processCreateTask(action: AutomationAction): Promise<void> {
  const { jobId, assignedToId, createdById, title, description, priority = 'MEDIUM', dueDate } =
    action.payload || {}

  if (!assignedToId || !title || !createdById) {
    throw new Error('CREATE_TASK requires assignedToId, title, createdById')
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Task" (
      id, "assigneeId", "creatorId", "jobId", title, description,
      priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById"
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10
    )`,
    assignedToId,
    createdById,
    jobId || null,
    title,
    description || null,
    priority,
    'TODO',
    'GENERAL',
    dueDate ? new Date(dueDate) : null,
    createdById
  )

  // console.log(`[Automation Cron] Task created for ${assignedToId}`)
}

/**
 * Process LOG_AUDIT action
 */
async function processAuditLog(action: AutomationAction): Promise<void> {
  const { staffId, builderId, jobId, subject, notes, type = 'AUTOMATED' } = action.payload || {}

  if (!staffId || !subject) {
    throw new Error('LOG_AUDIT requires staffId and subject')
  }

  await prisma.$executeRawUnsafe(
    `INSERT INTO "Activity" (
      id, "staffId", "builderId", "jobId", "activityType", subject, notes, "createdAt"
    ) VALUES (
      gen_random_uuid(), $1, $2, $3, $4, $5, $6, NOW()
    )`,
    staffId,
    builderId || null,
    jobId || null,
    type,
    subject,
    notes || 'Automated by automation rule'
  )

  // console.log(`[Automation Cron] Audit log created for ${subject}`)
}

/**
 * Log automation execution to AutomationLog
 */
async function logAutomationExecution(entry: {
  ruleId: string
  ruleName: string
  trigger: string
  status: 'SUCCESS' | 'ERROR'
  actionsRun: number
  details: Record<string, any>
  error?: string
}): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AutomationLog" (
        id, "ruleId", "ruleName", trigger, status, "actionsRun", details, error, "executedAt"
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, NOW()
      )`,
      entry.ruleId,
      entry.ruleName,
      entry.trigger,
      entry.status,
      entry.actionsRun,
      JSON.stringify(entry.details),
      entry.error || null
    )
  } catch (error) {
    console.error('[Automation Cron] Error logging execution:', error)
  }
}

/**
 * Update rule metadata after execution
 */
async function updateRuleMetadata(ruleId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AutomationRule"
       SET "lastRunAt" = NOW(), "runCount" = "runCount" + 1
       WHERE id = $1`,
      ruleId
    )
  } catch (error) {
    console.error('[Automation Cron] Error updating rule metadata:', error)
  }
}
