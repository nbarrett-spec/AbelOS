import { prisma } from '@/lib/prisma'
import { createNotification } from '@/lib/notifications'
import { logAudit } from '@/lib/audit'

// ─── TYPES ───────────────────────────────────────────────────────

export interface WorkflowTrigger {
  event: string // e.g. 'DEAL_STAGE_CHANGE', 'DEAL_CREATED', 'DEAL_WON', 'DEAL_LOST', 'QUOTE_SENT', 'CONTRACT_SIGNED'
  condition?: (context: any) => boolean
  actions: WorkflowAction[]
}

export interface WorkflowAction {
  type: 'NOTIFICATION' | 'CREATE_ACTIVITY' | 'UPDATE_FIELD' | 'CREATE_TASK' | 'SEND_EMAIL_QUEUE'
  config: Record<string, any>
}

// ─── HELPERS ───────────────────────────────────────────────────────

function generateId(prefix: string): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
}

function addBusinessDays(date: Date, days: number): Date {
  let count = 0
  const result = new Date(date)
  while (count < days) {
    result.setDate(result.getDate() + 1)
    if (result.getDay() !== 0 && result.getDay() !== 6) count++
  }
  return result
}

// ─── WORKFLOW DEFINITIONS ───────────────────────────────────────

export const WORKFLOW_DEFINITIONS: WorkflowTrigger[] = [
  // DEAL_STAGE_CHANGE to BID_SUBMITTED
  {
    event: 'DEAL_STAGE_CHANGE',
    condition: (ctx) => ctx.newStage === 'BID_SUBMITTED',
    actions: [
      {
        type: 'CREATE_ACTIVITY',
        config: {
          type: 'FOLLOW_UP',
          subject: 'Follow up on submitted bid',
          followUpDate: addBusinessDays(new Date(), 3),
        },
      },
    ],
  },

  // DEAL_STAGE_CHANGE to NEGOTIATION
  {
    event: 'DEAL_STAGE_CHANGE',
    condition: (ctx) => ctx.newStage === 'NEGOTIATION',
    actions: [
      {
        type: 'NOTIFICATION',
        config: {
          roles: ['MANAGER'],
          title: 'Deal moved to Negotiation',
          message: 'Deal {{dealNumber}} ({{companyName}}) is now in negotiation phase.',
          type: 'SYSTEM',
        },
      },
    ],
  },

  // DEAL_STAGE_CHANGE to WON
  {
    event: 'DEAL_STAGE_CHANGE',
    condition: (ctx) => ctx.newStage === 'WON',
    actions: [
      {
        type: 'NOTIFICATION',
        config: {
          roles: ['MANAGER', 'ACCOUNTING'],
          title: 'Deal won!',
          message: 'Deal {{dealNumber}} ({{companyName}}) has been won.',
          type: 'SYSTEM',
        },
      },
      {
        type: 'CREATE_ACTIVITY',
        config: {
          type: 'NOTE',
          subject: 'Deal won - begin onboarding',
        },
      },
      {
        type: 'SEND_EMAIL_QUEUE',
        config: {
          recipientEmail: '{{contactEmail}}',
          recipientName: '{{contactName}}',
          subject: 'Welcome! Your Project with Abel Lumber',
          template: 'DEAL_WON',
          dealId: '{{dealId}}',
        },
      },
    ],
  },

  // DEAL_STAGE_CHANGE to LOST
  {
    event: 'DEAL_STAGE_CHANGE',
    condition: (ctx) => ctx.newStage === 'LOST',
    actions: [
      {
        type: 'NOTIFICATION',
        config: {
          staffId: 'owner_manager',
          title: 'Deal lost',
          message: 'Deal {{dealNumber}} ({{companyName}}) has been lost.',
          type: 'SYSTEM',
        },
      },
      {
        type: 'CREATE_ACTIVITY',
        config: {
          type: 'NOTE',
          subject: 'Deal lost',
        },
      },
    ],
  },

  // DEAL_CREATED
  {
    event: 'DEAL_CREATED',
    actions: [
      {
        type: 'NOTIFICATION',
        config: {
          roles: ['MANAGER'],
          title: 'New deal in pipeline',
          message: 'New deal {{dealNumber}} ({{companyName}}) created by {{staffName}}.',
          type: 'SYSTEM',
        },
      },
    ],
  },

  // QUOTE_SENT
  {
    event: 'QUOTE_SENT',
    actions: [
      {
        type: 'CREATE_ACTIVITY',
        config: {
          type: 'FOLLOW_UP',
          subject: 'Follow up on quote',
          followUpDate: addBusinessDays(new Date(), 5),
        },
      },
    ],
  },

  // CONTRACT_SIGNED
  {
    event: 'CONTRACT_SIGNED',
    actions: [
      {
        type: 'NOTIFICATION',
        config: {
          roles: ['ACCOUNTING'],
          title: 'Contract signed',
          message: 'Contract for deal {{dealNumber}} ({{companyName}}) has been signed.',
          type: 'SYSTEM',
        },
      },
      {
        type: 'CREATE_ACTIVITY',
        config: {
          type: 'NOTE',
          subject: 'Contract signed - onboarding checklist created',
        },
      },
    ],
  },
]

// ─── MAIN EXECUTION ENGINE ───────────────────────────────────────

export async function executeWorkflows(
  event: string,
  context: {
    dealId?: string
    staffId: string
    oldStage?: string
    newStage?: string
    dealData?: any
    [key: string]: any
  }
): Promise<{ executed: string[]; errors: string[] }> {
  const executed: string[] = []
  const errors: string[] = []

  // Find matching workflows
  const matchingWorkflows = WORKFLOW_DEFINITIONS.filter((wf) => {
    if (wf.event !== event) return false
    if (wf.condition) {
      try {
        return wf.condition(context)
      } catch (e: any) {
        errors.push(`Condition check failed: ${e.message}`)
        return false
      }
    }
    return true
  })

  if (matchingWorkflows.length === 0) {
    return { executed, errors }
  }

  // Fetch deal data if dealId provided and not already in context
  let dealData = context.dealData
  if (context.dealId && !dealData) {
    try {
      const result: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "Deal" WHERE "id" = $1 LIMIT 1`,
        context.dealId
      )
      if (result.length > 0) dealData = result[0]
    } catch (e: any) {
      errors.push(`Failed to fetch deal data: ${e.message}`)
    }
  }

  // Enrich context with deal data
  const enrichedContext = {
    ...context,
    dealData,
    dealNumber: dealData?.dealNumber || context.dealId,
    companyName: dealData?.companyName || 'Unknown',
    contactName: dealData?.contactName || 'Unknown',
    contactEmail: dealData?.contactEmail || 'unknown@example.com',
  }

  // Execute each workflow
  for (const workflow of matchingWorkflows) {
    for (const action of workflow.actions) {
      try {
        switch (action.type) {
          case 'NOTIFICATION':
            await executeNotificationAction(action.config, enrichedContext)
            executed.push(`NOTIFICATION: ${action.config.title}`)
            break

          case 'CREATE_ACTIVITY':
            await executeCreateActivityAction(action.config, enrichedContext)
            executed.push(`CREATE_ACTIVITY: ${action.config.type}`)
            break

          case 'CREATE_TASK':
            await executeCreateTaskAction(action.config, enrichedContext)
            executed.push(`CREATE_TASK`)
            break

          case 'SEND_EMAIL_QUEUE':
            await executeSendEmailQueueAction(action.config, enrichedContext)
            executed.push(`SEND_EMAIL_QUEUE`)
            break

          case 'UPDATE_FIELD':
            await executeUpdateFieldAction(action.config, enrichedContext)
            executed.push(`UPDATE_FIELD`)
            break

          default:
            errors.push(`Unknown action type: ${action.type}`)
        }
      } catch (e: any) {
        errors.push(`${action.type} failed: ${e.message}`)
      }
    }
  }

  return { executed, errors }
}

// ─── ACTION EXECUTORS ───────────────────────────────────────────

async function executeNotificationAction(
  config: Record<string, any>,
  context: any
): Promise<void> {
  const { roles, staffId: configStaffId, title, message, type } = config

  let staffIds: string[] = []

  if (configStaffId === 'owner_manager' && context.dealData) {
    // Get the owner's manager
    const owner: any[] = await prisma.$queryRawUnsafe(
      `SELECT "managerId" FROM "Staff" WHERE "id" = $1 LIMIT 1`,
      context.dealData.ownerId
    )
    if (owner.length > 0 && owner[0].managerId) {
      staffIds.push(owner[0].managerId)
    }
  } else if (roles && Array.isArray(roles)) {
    // Get all staff with specified roles
    const placeholders = roles.map((_, i) => `$${i + 1}`).join(',')
    const staff: any[] = await prisma.$queryRawUnsafe(
      `SELECT "id" FROM "Staff" WHERE "role" IN (${placeholders})`,
      ...roles
    )
    staffIds = staff.map((s) => s.id)
  } else if (configStaffId) {
    staffIds.push(configStaffId)
  }

  // Interpolate message with context
  let interpolatedMessage = message || ''
  Object.entries(context).forEach(([key, value]) => {
    interpolatedMessage = interpolatedMessage.replace(`{{${key}}}`, String(value || ''))
  })

  // Create notifications for each staff member
  for (const staffId of staffIds) {
    await createNotification({
      staffId,
      type,
      title,
      message: interpolatedMessage,
    })
  }
}

async function executeCreateActivityAction(
  config: Record<string, any>,
  context: any
): Promise<void> {
  if (!context.dealId) {
    throw new Error('dealId required for CREATE_ACTIVITY')
  }

  const { type, subject, notes, followUpDate } = config
  const activityId = generateId('act')

  const finalFollowUpDate = followUpDate instanceof Date ? followUpDate : null

  await prisma.$queryRawUnsafe(
    `INSERT INTO "DealActivity" ("id", "dealId", "staffId", "type", "subject", "notes", "followUpDate", "createdAt")
     VALUES ($1, $2, $3, $4::text, $5, $6, $7, NOW())`,
    activityId,
    context.dealId,
    context.staffId,
    type,
    subject,
    notes || null,
    finalFollowUpDate
  )

  // Log audit
  await logAudit({
    staffId: context.staffId,
    action: 'CREATE_ACTIVITY_WORKFLOW',
    entity: 'DealActivity',
    entityId: activityId,
    details: { type, subject, dealId: context.dealId },
  })
}

async function executeCreateTaskAction(
  config: Record<string, any>,
  context: any
): Promise<void> {
  const { title, description, dueDate, priority = 'MEDIUM' } = config
  const taskId = generateId('tsk')

  await prisma.$queryRawUnsafe(
    `INSERT INTO "Task" ("id", "staffId", "title", "description", "dueDate", "priority", "status", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6::text, 'PENDING', NOW())`,
    taskId,
    context.staffId,
    title,
    description || null,
    dueDate || null,
    priority
  )

  await logAudit({
    staffId: context.staffId,
    action: 'CREATE_TASK_WORKFLOW',
    entity: 'Task',
    entityId: taskId,
  })
}

async function executeSendEmailQueueAction(
  config: Record<string, any>,
  context: any
): Promise<void> {
  const { recipientEmail: rawEmail, recipientName: rawName, subject, template, dealId } = config

  // Interpolate recipient email and name
  let recipientEmail = rawEmail || ''
  let recipientName = rawName || ''

  Object.entries(context).forEach(([key, value]) => {
    recipientEmail = recipientEmail.replace(`{{${key}}}`, String(value || ''))
    recipientName = recipientName.replace(`{{${key}}}`, String(value || ''))
  })

  const emailId = generateId('eml')

  await prisma.$queryRawUnsafe(
    `INSERT INTO "EmailQueue" ("id", "recipientEmail", "recipientName", "subject", "template", "dealId", "status", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, 'PENDING', NOW())`,
    emailId,
    recipientEmail,
    recipientName || null,
    subject || 'Message from Abel Lumber',
    template || 'DEFAULT',
    dealId || null
  )

  await logAudit({
    staffId: context.staffId,
    action: 'QUEUE_EMAIL_WORKFLOW',
    entity: 'EmailQueue',
    entityId: emailId,
  })
}

async function executeUpdateFieldAction(
  config: Record<string, any>,
  context: any
): Promise<void> {
  const { entity, entityId, field, value } = config

  if (!entity || !entityId || !field) {
    throw new Error('entity, entityId, and field are required for UPDATE_FIELD')
  }

  const escapedField = `"${field.replace(/"/g, '""')}"`
  const escapedEntity = `"${entity.replace(/"/g, '""')}"`

  await prisma.$queryRawUnsafe(
    `UPDATE ${escapedEntity} SET ${escapedField} = $1, "updatedAt" = NOW() WHERE "id" = $2`,
    value,
    entityId
  )

  await logAudit({
    staffId: context.staffId,
    action: 'UPDATE_FIELD_WORKFLOW',
    entity,
    entityId,
    details: { field, value },
  })
}

// ─── PUBLIC API ───────────────────────────────────────────────────

export function getWorkflowDefinitions(): WorkflowTrigger[] {
  return WORKFLOW_DEFINITIONS
}
