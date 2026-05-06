/**
 * Automation Executor
 *
 * Provides core automation execution logic:
 * - fireAutomationEvent: Query and execute rules matching a trigger event
 * - processAutomationAction: Execute individual action types
 * - Track execution in AutomationLog
 *
 * Called by API routes when events occur (e.g., ORDER_CREATED, INVOICE_OVERDUE)
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export interface AutomationAction {
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

export interface AutomationRule {
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

interface AutomationLogEntry {
  ruleId: string
  ruleName: string
  trigger: string
  status: 'SUCCESS' | 'ERROR'
  actionsRun: number
  details: Record<string, any>
  error?: string
  executedAt: Date
}

/**
 * Fire automation event - query matching rules and execute them
 * Called when business events occur (order created, invoice overdue, etc.)
 */
export async function fireAutomationEvent(
  trigger: string,
  entityId?: string,
  context?: Record<string, any>
): Promise<{ rulesTriggered: number; actionsExecuted: number; errors: string[] }> {
  const startTime = Date.now()
  const errors: string[] = []
  let rulesTriggered = 0
  let actionsExecuted = 0

  try {
    // console.log(`[Automation] Fire event: ${trigger}, entityId: ${entityId}`)

    // Query all enabled rules matching this trigger
    const rules = await prisma.$queryRawUnsafe<AutomationRule[]>(
      `SELECT * FROM "AutomationRule"
       WHERE enabled = true
       AND (trigger = $1 OR trigger LIKE $2)`,
      trigger,
      `%${trigger}%`
    )

    if (!rules || rules.length === 0) {
      // console.log(`[Automation] No rules found for trigger: ${trigger}`)
      return { rulesTriggered: 0, actionsExecuted: 0, errors: [] }
    }

    // console.log(`[Automation] Found ${rules.length} matching rules`)

    for (const rule of rules) {
      try {
        // Check frequency constraints
        if (!shouldExecuteRule(rule)) {
          // console.log(`[Automation] Rule ${rule.id} skipped due to frequency constraint`)
          continue
        }

        // Check conditions if they exist
        if (rule.conditions && !evaluateConditions(rule.conditions, context)) {
          // console.log(`[Automation] Rule ${rule.id} conditions not met`)
          continue
        }

        rulesTriggered++

        // Execute actions
        const actionResults = await executeActions(rule.actions || [], {
          ruleId: rule.id,
          ruleName: rule.name,
          entityId,
          context,
        })

        actionsExecuted += actionResults.executed
        errors.push(...actionResults.errors)

        // Log successful execution
        await logAutomationExecution({
          ruleId: rule.id,
          ruleName: rule.name,
          trigger,
          status: 'SUCCESS',
          actionsRun: actionResults.executed,
          details: {
            entityId,
            context,
            actionsRun: actionResults.actions,
          },
          executedAt: new Date(),
        })

        // Update rule metadata
        await updateRuleMetadata(rule.id)
      } catch (error) {
        const errorMsg =
          error instanceof Error ? error.message : 'Unknown error executing rule'
        logger.error('automation_rule_execute_failed', error, { ruleId: rule.id })
        errors.push(errorMsg)

        // Log error
        await logAutomationExecution({
          ruleId: rule.id,
          ruleName: rule.name,
          trigger,
          status: 'ERROR',
          actionsRun: 0,
          details: { entityId, context },
          error: errorMsg,
          executedAt: new Date(),
        })
      }
    }

    const duration = Date.now() - startTime
    // console.log(
    //   `[Automation] Completed in ${duration}ms: ${rulesTriggered} rules, ${actionsExecuted} actions`
    // )

    return { rulesTriggered, actionsExecuted, errors }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error'
    logger.error('automation_fire_event_fatal', error, { trigger })
    errors.push(errorMsg)
    return { rulesTriggered, actionsExecuted, errors }
  }
}

/**
 * Check if rule should execute based on frequency
 */
function shouldExecuteRule(rule: AutomationRule): boolean {
  const now = new Date()
  const lastRun = rule.lastRunAt ? new Date(rule.lastRunAt) : null

  switch (rule.frequency) {
    case 'ON_TRIGGER':
      return true

    case 'ONCE_DAILY':
      if (!lastRun) return true
      // Check if last run was today (same calendar day)
      return (
        lastRun.toDateString() !== now.toDateString()
      )

    case 'ONCE_WEEKLY':
      if (!lastRun) return true
      // Check if last run was in a different week
      const daysSinceRun = Math.floor((now.getTime() - lastRun.getTime()) / (1000 * 60 * 60 * 24))
      return daysSinceRun >= 7

    case 'ONCE_PER_ENTITY':
      // Will be checked via details JSONB tracking per entity
      return true

    default:
      return true
  }
}

/**
 * Evaluate simple condition logic
 * Conditions are in format: { field: value, operator: 'eq'|'gt'|'lt'|'contains' }
 */
function evaluateConditions(conditions: Record<string, any>, context?: Record<string, any>): boolean {
  if (!context) return true

  try {
    for (const [key, expected] of Object.entries(conditions)) {
      const actual = context[key]
      if (actual === undefined) return false
      if (actual !== expected) return false
    }
    return true
  } catch (error) {
    logger.error('automation_evaluate_conditions_failed', error)
    return false
  }
}

/**
 * Execute automation actions
 */
async function executeActions(
  actions: AutomationAction[],
  metadata: {
    ruleId: string
    ruleName: string
    entityId?: string
    context?: Record<string, any>
  }
): Promise<{ executed: number; actions: string[]; errors: string[] }> {
  const executed: string[] = []
  const errors: string[] = []
  let count = 0

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'SEND_NOTIFICATION':
          await processNotification(action, metadata)
          executed.push(action.type)
          count++
          break

        case 'SEND_EMAIL':
          // Just log for now - templates not set up per automation
          // console.log(`[Automation] Email action deferred: ${action.payload?.template || 'unnamed'}`)
          executed.push(action.type)
          count++
          break

        case 'CREATE_TASK':
          await processCreateTask(action, metadata)
          executed.push(action.type)
          count++
          break

        case 'LOG_AUDIT':
          await processAuditLog(action, metadata)
          executed.push(action.type)
          count++
          break

        case 'UPDATE_STATUS':
          // Skip for now - too dangerous without specific logic
          // console.log('[Automation] UPDATE_STATUS action deferred (requires specific logic)')
          break

        case 'AI_ANALYZE':
        case 'AI_DAILY_BRIEFING':
        case 'AI_GENERATE_PO':
        case 'AI_DEMAND_FORECAST':
        case 'AI_REORDER_CHECK':
          // console.log(`[Automation] ${action.type} action deferred (AI integration pending)`)
          break

        default:
          errors.push(`Unknown action type: ${(action as any).type}`)
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      logger.error('automation_action_execute_failed', error, { actionType: action.type })
      errors.push(errorMsg)
    }
  }

  return { executed: count, actions: executed, errors }
}

/**
 * Process SEND_NOTIFICATION action
 */
async function processNotification(
  action: AutomationAction,
  metadata: { ruleId: string; ruleName: string; entityId?: string; context?: Record<string, any> }
): Promise<void> {
  const { staffId, title, message, type = 'INFO' } = action.payload || {}

  if (!staffId || !title || !message) {
    throw new Error('SEND_NOTIFICATION requires staffId, title, message')
  }

  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Notification" (id, "staffId", type, title, body, "createdAt")
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW())`,
      staffId,
      type,
      title,
      message
    )

    // console.log(`[Automation] Notification sent to staff ${staffId}`)
  } catch (error) {
    logger.error('automation_send_notification_failed', error, { staffId })
    throw error
  }
}

/**
 * Process CREATE_TASK action
 */
async function processCreateTask(
  action: AutomationAction,
  metadata: { ruleId: string; ruleName: string; entityId?: string; context?: Record<string, any> }
): Promise<void> {
  const { jobId, assignedToId, title, description, priority = 'MEDIUM', dueDate } = action.payload || {}

  if (!assignedToId || !title) {
    throw new Error('CREATE_TASK requires assignedToId and title')
  }

  try {
    // Task requires creatorId and createdById - use system user or rule creator
    const creatorId = metadata.context?.staffId || metadata.context?.createdById

    if (!creatorId) {
      throw new Error('CREATE_TASK requires creatorId in context')
    }

    await prisma.$executeRawUnsafe(
      `INSERT INTO "Task" (
        id, "assigneeId", "creatorId", "jobId", title, description,
        priority, status, category, "dueDate", "createdAt", "updatedAt", "createdById"
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW(), $10
      )`,
      assignedToId,
      creatorId,
      jobId || null,
      title,
      description || null,
      priority,
      'TODO',
      'GENERAL',
      dueDate ? new Date(dueDate) : null,
      creatorId
    )

    // console.log(`[Automation] Task created for ${assignedToId}`)
  } catch (error) {
    logger.error('automation_create_task_failed', error, { assignedToId })
    throw error
  }
}

/**
 * Process LOG_AUDIT action
 */
async function processAuditLog(
  action: AutomationAction,
  metadata: { ruleId: string; ruleName: string; entityId?: string; context?: Record<string, any> }
): Promise<void> {
  const { staffId, builderId, jobId, subject, notes, type = 'AUTOMATED' } = action.payload || {}

  if (!staffId || !subject) {
    throw new Error('LOG_AUDIT requires staffId and subject')
  }

  try {
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
      notes || `Automated by rule: ${metadata.ruleName}`
    )

    // console.log(`[Automation] Audit log created for ${subject}`)
  } catch (error) {
    logger.error('automation_log_audit_failed', error, { subject })
    throw error
  }
}

/**
 * Log automation execution to AutomationLog table
 */
async function logAutomationExecution(entry: AutomationLogEntry): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "AutomationLog" (
        id, "ruleId", "ruleName", trigger, status, "actionsRun", details, error, "executedAt"
      ) VALUES (
        gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8
      )`,
      entry.ruleId,
      entry.ruleName,
      entry.trigger,
      entry.status,
      entry.actionsRun,
      JSON.stringify(entry.details),
      entry.error || null,
      entry.executedAt
    )
  } catch (error) {
    logger.error('automation_log_execution_failed', error)
    // Don't throw - logging errors shouldn't stop automation
  }
}

/**
 * Update rule metadata after execution
 */
async function updateRuleMetadata(ruleId: string): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "AutomationRule"
       SET "lastRunAt" = NOW(), "runCount" = "runCount" + 1, "updatedAt" = NOW()
       WHERE id = $1`,
      ruleId
    )
  } catch (error) {
    logger.error('automation_update_rule_metadata_failed', error)
    // Don't throw - metadata updates shouldn't stop automation
  }
}
