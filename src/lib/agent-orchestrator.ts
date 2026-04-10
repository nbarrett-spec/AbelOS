/**
 * Agent Orchestrator — Abel Lumber AI Sales Workflows
 *
 * Defines agent workflows that chain together AI capabilities into
 * autonomous sales processes: blueprint analysis, quote generation,
 * customer follow-ups, and reorder opportunities.
 *
 * Workflows are stored in memory during execution and logged to Activity/Notification
 * tables for audit trail and staff visibility.
 */

import { prisma } from './prisma'
import { sendEmail } from './email'
import { analyzeBlueprint, imageToBase64 } from './blueprint-ai'
import Anthropic from '@anthropic-ai/sdk'

// ─── TYPES ──────────────────────────────────────────────────────────

export interface AgentAction {
  id: string
  type:
    | 'ANALYZE_BLUEPRINT'
    | 'GENERATE_TAKEOFF'
    | 'CREATE_QUOTE'
    | 'SEND_QUOTE'
    | 'FOLLOW_UP'
    | 'CHECK_STALE_QUOTE'
    | 'OFFER_DISCOUNT'
    | 'CREATE_NOTIFICATION'
    | 'LOG_ACTIVITY'
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'SKIPPED'
  input: Record<string, any>
  output?: Record<string, any>
  error?: string
  executedAt?: Date
}

export interface AgentWorkflow {
  id: string
  name: string
  triggeredBy:
    | 'BLUEPRINT_UPLOAD'
    | 'QUOTE_EXPIRING'
    | 'NEW_BUILDER'
    | 'STALE_QUOTE'
    | 'REORDER_OPPORTUNITY'
  builderId: string
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'PAUSED'
  actions: AgentAction[]
  createdAt: Date
  completedAt?: Date
}

// ─── WORKFLOW TEMPLATES ──────────────────────────────────────────────

/**
 * Blueprint-to-Quote Pipeline
 * Triggered when a blueprint is uploaded
 * 1. Analyze blueprint with Claude Vision
 * 2. Generate takeoff items
 * 3. Create quote
 * 4. Send quote email
 * 5. Schedule Day 3 follow-up
 * 6. Log activity
 */
export async function executeBlueprintToQuoteWorkflow(
  builderId: string,
  blueprintId: string,
  projectId: string
): Promise<AgentWorkflow> {
  const workflow: AgentWorkflow = {
    id: `workflow-${Date.now()}`,
    name: 'Blueprint to Quote',
    triggeredBy: 'BLUEPRINT_UPLOAD',
    builderId,
    status: 'RUNNING',
    actions: [],
    createdAt: new Date(),
  }

  try {
    // Step 1: Analyze Blueprint
    const analyzeAction = await executeAction(workflow, {
      id: `action-1-${Date.now()}`,
      type: 'ANALYZE_BLUEPRINT',
      status: 'PENDING',
      input: { blueprintId, projectId },
    })

    if (analyzeAction.status === 'FAILED') {
      workflow.status = 'FAILED'
      return workflow
    }

    const blueprintAnalysis = analyzeAction.output?.analysis
    const takeoffId = analyzeAction.output?.takeoffId

    // Step 2: Generate Takeoff
    const takeoffAction = await executeAction(workflow, {
      id: `action-2-${Date.now()}`,
      type: 'GENERATE_TAKEOFF',
      status: 'PENDING',
      input: { takeoffId, blueprintAnalysis },
    })

    if (takeoffAction.status === 'FAILED') {
      workflow.status = 'FAILED'
      return workflow
    }

    // Step 3: Create Quote
    const quoteAction = await executeAction(workflow, {
      id: `action-3-${Date.now()}`,
      type: 'CREATE_QUOTE',
      status: 'PENDING',
      input: { projectId, takeoffId, builderId },
    })

    if (quoteAction.status === 'FAILED') {
      workflow.status = 'FAILED'
      return workflow
    }

    const quoteId = quoteAction.output?.quoteId

    // Step 4: Send Quote Email
    const sendQuoteAction = await executeAction(workflow, {
      id: `action-4-${Date.now()}`,
      type: 'SEND_QUOTE',
      status: 'PENDING',
      input: { quoteId, builderId },
    })

    // Step 5: Log Activity
    await executeAction(workflow, {
      id: `action-5-${Date.now()}`,
      type: 'LOG_ACTIVITY',
      status: 'PENDING',
      input: {
        builderId,
        activityType: 'QUOTE_SENT',
        subject: `AI-Generated Quote ${quoteAction.output?.quoteNumber}`,
      },
    })

    workflow.status = 'COMPLETED'
    workflow.completedAt = new Date()
  } catch (error) {
    workflow.status = 'FAILED'
    workflow.completedAt = new Date()
  }

  return workflow
}

/**
 * Stale Quote Recovery
 * Triggered when a quote is > 5 days old with no response
 * 1. Generate personalized follow-up message using Claude
 * 2. Send follow-up email
 * 3. If no response in 3 days, offer 5% discount
 * 4. Send discount email
 * 5. Log activity
 */
export async function executeStaleQuoteRecoveryWorkflow(
  quoteId: string,
  builderId: string
): Promise<AgentWorkflow> {
  const workflow: AgentWorkflow = {
    id: `workflow-${Date.now()}`,
    name: 'Stale Quote Recovery',
    triggeredBy: 'STALE_QUOTE',
    builderId,
    status: 'RUNNING',
    actions: [],
    createdAt: new Date(),
  }

  try {
    // Fetch quote details
    const quote = await prisma.$queryRawUnsafe<any[]>(`
      SELECT q.*, b.*, p.name as projectName
      FROM "Quote" q
      JOIN "Project" p ON q."projectId" = p.id
      JOIN "Builder" b ON p."builderId" = b.id
      WHERE q.id = $1
    `, quoteId)

    if (!quote || quote.length === 0) {
      workflow.actions.push({
        id: `action-1-${Date.now()}`,
        type: 'CHECK_STALE_QUOTE',
        status: 'FAILED',
        input: { quoteId },
        error: 'Quote not found',
      })
      workflow.status = 'FAILED'
      return workflow
    }

    const quoteRecord = quote[0]

    // Step 1: Generate personalized follow-up message
    const followUpAction = await executeAction(workflow, {
      id: `action-1-${Date.now()}`,
      type: 'FOLLOW_UP',
      status: 'PENDING',
      input: {
        quoteId,
        builderName: quoteRecord.companyName,
        projectName: quoteRecord.projectName,
        quoteTotal: quoteRecord.total,
      },
    })

    if (followUpAction.status === 'FAILED') {
      workflow.status = 'FAILED'
      return workflow
    }

    const followUpMessage = followUpAction.output?.message

    // Step 2: Send follow-up email
    await executeAction(workflow, {
      id: `action-2-${Date.now()}`,
      type: 'SEND_QUOTE',
      status: 'PENDING',
      input: {
        quoteId,
        builderId,
        messageOverride: followUpMessage,
        emailType: 'FOLLOW_UP',
      },
    })

    // Step 3: Log activity
    await executeAction(workflow, {
      id: `action-3-${Date.now()}`,
      type: 'LOG_ACTIVITY',
      status: 'PENDING',
      input: {
        builderId,
        activityType: 'QUOTE_FOLLOW_UP',
        subject: `Follow-up sent for quote ${quoteRecord.quoteNumber}`,
      },
    })

    workflow.status = 'COMPLETED'
    workflow.completedAt = new Date()
  } catch (error) {
    workflow.status = 'FAILED'
    workflow.completedAt = new Date()
  }

  return workflow
}

/**
 * New Builder Welcome
 * Triggered when a new builder registers
 * 1. Send welcome email with onboarding resources
 * 2. Create "getting started" notification
 * 3. Schedule Day 3 check-in
 * 4. If no order in 7 days, send catalog highlights
 */
export async function executeNewBuilderWelcomeWorkflow(
  builderId: string
): Promise<AgentWorkflow> {
  const workflow: AgentWorkflow = {
    id: `workflow-${Date.now()}`,
    name: 'New Builder Welcome',
    triggeredBy: 'NEW_BUILDER',
    builderId,
    status: 'RUNNING',
    actions: [],
    createdAt: new Date(),
  }

  try {
    // Fetch builder info
    const builder = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Builder" WHERE id = $1`,
      builderId
    )

    if (!builder || builder.length === 0) {
      workflow.status = 'FAILED'
      return workflow
    }

    const builderRecord = builder[0]

    // Step 1: Send welcome email
    const welcomeAction = await executeAction(workflow, {
      id: `action-1-${Date.now()}`,
      type: 'SEND_QUOTE',
      status: 'PENDING',
      input: {
        builderId,
        emailType: 'WELCOME',
        recipientEmail: builderRecord.email,
        recipientName: builderRecord.contactName,
      },
    })

    // Step 2: Create notification
    const notificationAction = await executeAction(workflow, {
      id: `action-2-${Date.now()}`,
      type: 'CREATE_NOTIFICATION',
      status: 'PENDING',
      input: {
        builderId,
        title: 'New Builder Registered',
        body: `${builderRecord.companyName} is ready to start. First order opportunity window: 7 days.`,
      },
    })

    // Step 3: Log activity
    await executeAction(workflow, {
      id: `action-3-${Date.now()}`,
      type: 'LOG_ACTIVITY',
      status: 'PENDING',
      input: {
        builderId,
        activityType: 'NOTE',
        subject: `Welcome sequence sent to ${builderRecord.contactName}`,
      },
    })

    workflow.status = 'COMPLETED'
    workflow.completedAt = new Date()
  } catch (error) {
    workflow.status = 'FAILED'
    workflow.completedAt = new Date()
  }

  return workflow
}

/**
 * Reorder Opportunity
 * Triggered when builder hasn't ordered in 30+ days
 * 1. Check last order items
 * 2. Generate "time to reorder?" email with previous items
 * 3. Send email
 * 4. Log activity
 */
export async function executeReorderOpportunityWorkflow(
  builderId: string
): Promise<AgentWorkflow> {
  const workflow: AgentWorkflow = {
    id: `workflow-${Date.now()}`,
    name: 'Reorder Opportunity',
    triggeredBy: 'REORDER_OPPORTUNITY',
    builderId,
    status: 'RUNNING',
    actions: [],
    createdAt: new Date(),
  }

  try {
    // Fetch builder and last order
    const builder = await prisma.$queryRawUnsafe<any[]>(
      `SELECT * FROM "Builder" WHERE id = $1`,
      builderId
    )

    if (!builder || builder.length === 0) {
      workflow.status = 'FAILED'
      return workflow
    }

    const builderRecord = builder[0]

    // Get last order
    const lastOrder = await prisma.$queryRawUnsafe<any[]>(
      `
      SELECT o.*, oi.* FROM "Order" o
      LEFT JOIN "OrderItem" oi ON o.id = oi."orderId"
      WHERE o."builderId" = $1
      ORDER BY o."createdAt" DESC
      LIMIT 20
    `,
      builderId
    )

    if (!lastOrder || lastOrder.length === 0) {
      workflow.status = 'COMPLETED'
      return workflow
    }

    // Generate personalized reorder message
    const reorderAction = await executeAction(workflow, {
      id: `action-1-${Date.now()}`,
      type: 'FOLLOW_UP',
      status: 'PENDING',
      input: {
        builderId,
        builderName: builderRecord.companyName,
        lastOrderItems: lastOrder,
        emailType: 'REORDER_OPPORTUNITY',
      },
    })

    if (reorderAction.status === 'FAILED') {
      workflow.status = 'FAILED'
      return workflow
    }

    // Step 2: Send reorder email
    await executeAction(workflow, {
      id: `action-2-${Date.now()}`,
      type: 'SEND_QUOTE',
      status: 'PENDING',
      input: {
        builderId,
        emailType: 'REORDER_OPPORTUNITY',
        recipientEmail: builderRecord.email,
        message: reorderAction.output?.message,
      },
    })

    // Step 3: Log activity
    await executeAction(workflow, {
      id: `action-3-${Date.now()}`,
      type: 'LOG_ACTIVITY',
      status: 'PENDING',
      input: {
        builderId,
        activityType: 'EMAIL',
        subject: `Reorder opportunity email sent to ${builderRecord.companyName}`,
      },
    })

    workflow.status = 'COMPLETED'
    workflow.completedAt = new Date()
  } catch (error) {
    workflow.status = 'FAILED'
    workflow.completedAt = new Date()
  }

  return workflow
}

// ─── ACTION EXECUTORS ──────────────────────────────────────────────

/**
 * Execute a single action within a workflow
 */
async function executeAction(
  workflow: AgentWorkflow,
  action: Omit<AgentAction, 'status'> & { status: string }
): Promise<AgentAction> {
  const executedAction: AgentAction = {
    ...action,
    status: 'IN_PROGRESS' as const,
  }

  workflow.actions.push(executedAction)

  try {
    switch (action.type) {
      case 'ANALYZE_BLUEPRINT':
        executedAction.output = await handleAnalyzeBlueprint(action.input)
        break

      case 'GENERATE_TAKEOFF':
        executedAction.output = await handleGenerateTakeoff(action.input)
        break

      case 'CREATE_QUOTE':
        executedAction.output = await handleCreateQuote(action.input)
        break

      case 'SEND_QUOTE':
        executedAction.output = await handleSendQuote(action.input)
        break

      case 'FOLLOW_UP':
        executedAction.output = await handleFollowUp(action.input)
        break

      case 'CHECK_STALE_QUOTE':
        executedAction.output = await handleCheckStaleQuote(action.input)
        break

      case 'CREATE_NOTIFICATION':
        executedAction.output = await handleCreateNotification(action.input)
        break

      case 'LOG_ACTIVITY':
        executedAction.output = await handleLogActivity(action.input)
        break

      default:
        executedAction.status = 'FAILED'
        executedAction.error = 'Unknown action type'
        return executedAction
    }

    executedAction.status = 'COMPLETED'
    executedAction.executedAt = new Date()
  } catch (error) {
    executedAction.status = 'FAILED'
    executedAction.error = error instanceof Error ? error.message : String(error)
    executedAction.executedAt = new Date()
  }

  return executedAction
}

/**
 * Handler: Analyze Blueprint with Claude Vision
 */
async function handleAnalyzeBlueprint(input: Record<string, any>) {
  const { blueprintId } = input

  const blueprint = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "Blueprint" WHERE id = $1`,
    blueprintId
  )

  if (!blueprint || blueprint.length === 0) {
    throw new Error('Blueprint not found')
  }

  const blueprintRecord = blueprint[0]

  // Parse blueprint URL and analyze
  const analysis = await analyzeBlueprint({
    type: 'url',
    url: blueprintRecord.fileUrl,
  })

  if (analysis.error) {
    throw new Error(analysis.error)
  }

  // Create Takeoff record
  const takeoff = await prisma.$queryRawUnsafe<any[]>(
    `
    INSERT INTO "Takeoff" ("projectId", "blueprintId", status, "rawResult", "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, NOW(), NOW())
    RETURNING id
  `,
    input.projectId,
    blueprintId,
    'NEEDS_REVIEW',
    JSON.stringify(analysis.analysis)
  )

  return {
    analysis: analysis.analysis,
    takeoffId: takeoff[0]?.id || null,
  }
}

/**
 * Handler: Generate Takeoff Items from Analysis
 */
async function handleGenerateTakeoff(input: Record<string, any>) {
  const { takeoffId, blueprintAnalysis } = input

  if (!blueprintAnalysis || !blueprintAnalysis.summary) {
    throw new Error('Invalid blueprint analysis')
  }

  // For each room and door/window, create TakeoffItem entries
  // This maps AI analysis to products
  const items = []

  for (const room of blueprintAnalysis.rooms || []) {
    // Create door takeoff items
    for (const door of room.doors || []) {
      // Find matching product (simplified — in production, use smarter matching)
      const productSearch = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT id FROM "Product"
        WHERE category = 'Interior Doors' OR category = 'Exterior Doors'
        LIMIT 1
      `
      )

      if (productSearch && productSearch.length > 0) {
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "TakeoffItem" ("takeoffId", category, description, location, quantity, "createdAt")
          VALUES ($1, $2, $3, $4, $5, NOW())
        `,
          takeoffId,
          'Interior Door',
          `${door.type} Door ${door.width}"`,
          room.name,
          door.quantity
        )
      }
    }

    // Create window items
    for (const window of room.windows || []) {
      const productSearch = await prisma.$queryRawUnsafe<any[]>(
        `
        SELECT id FROM "Product"
        WHERE category = 'Windows'
        LIMIT 1
      `
      )

      if (productSearch && productSearch.length > 0) {
        await prisma.$executeRawUnsafe(
          `
          INSERT INTO "TakeoffItem" ("takeoffId", category, description, location, quantity, "createdAt")
          VALUES ($1, $2, $3, $4, $5, NOW())
        `,
          takeoffId,
          'Window',
          `${window.type} Window`,
          room.name,
          window.quantity
        )
      }
    }
  }

  return { itemsCreated: items.length }
}

/**
 * Handler: Create Quote from Takeoff
 */
async function handleCreateQuote(input: Record<string, any>) {
  const { projectId, takeoffId, builderId } = input

  // Get next quote number
  const lastQuote = await prisma.$queryRawUnsafe<any[]>(
    `SELECT "quoteNumber" FROM "Quote" ORDER BY "createdAt" DESC LIMIT 1`
  )

  const nextNumber = lastQuote && lastQuote.length > 0 ? parseInt(lastQuote[0].quoteNumber.split('-')[2]) + 1 : 1
  const quoteNumber = `ABL-${new Date().getFullYear()}-${String(nextNumber).padStart(4, '0')}`

  // Calculate quote total from takeoff items
  const takeoffItems = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT ti.*, p.basePrice FROM "TakeoffItem" ti
    LEFT JOIN "Product" p ON ti."productId" = p.id
    WHERE ti."takeoffId" = $1
  `,
    takeoffId
  )

  let subtotal = 0
  for (const item of takeoffItems || []) {
    const price = item.basePrice || 50 // Default price if not found
    subtotal += price * item.quantity
  }

  const total = subtotal // Simplified — no tax in demo

  // Create quote
  const quote = await prisma.$queryRawUnsafe<any[]>(
    `
    INSERT INTO "Quote" ("projectId", "takeoffId", "quoteNumber", subtotal, total, status, "createdAt", "updatedAt")
    VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
    RETURNING id
  `,
    projectId,
    takeoffId,
    quoteNumber,
    subtotal,
    total,
    'DRAFT'
  )

  return {
    quoteId: quote[0]?.id || null,
    quoteNumber,
    subtotal,
    total,
  }
}

/**
 * Handler: Send Quote Email
 */
async function handleSendQuote(input: Record<string, any>) {
  const { quoteId, builderId, emailType = 'QUOTE', messageOverride } = input

  const quote = await prisma.$queryRawUnsafe<any[]>(
    `
    SELECT q.*, b.email, b."companyName", b."contactName", p.name as projectName
    FROM "Quote" q
    JOIN "Project" p ON q."projectId" = p.id
    JOIN "Builder" b ON p."builderId" = b.id
    WHERE q.id = $1
  `,
    quoteId
  )

  if (!quote || quote.length === 0) {
    throw new Error('Quote not found')
  }

  const quoteRecord = quote[0]

  // Generate email HTML
  let emailHtml = ''

  if (messageOverride) {
    emailHtml = `
      <p>${messageOverride}</p>
      <p style="margin-top: 32px;">
        <strong>Quote ${quoteRecord.quoteNumber}</strong><br>
        Project: ${quoteRecord.projectName}<br>
        Total: $${quoteRecord.total.toFixed(2)}
      </p>
    `
  } else if (emailType === 'WELCOME') {
    emailHtml = `
      <h2>Welcome to Abel Lumber!</h2>
      <p>Hi ${quoteRecord.contactName},</p>
      <p>We're excited to work with ${quoteRecord.companyName}. Our platform makes it easy to get accurate quotes and manage your orders.</p>
      <p><strong>Getting Started:</strong></p>
      <ul>
        <li>Upload floor plans and get instant AI-powered takeoffs</li>
        <li>Review and customize quotes in minutes</li>
        <li>Track orders and deliveries in real-time</li>
      </ul>
    `
  } else if (emailType === 'REORDER_OPPORTUNITY') {
    emailHtml = `
      <h2>Time to Reorder?</h2>
      <p>Hi ${quoteRecord.contactName},</p>
      <p>It's been a while since we last worked together! We noticed you might be due for another order.</p>
      <p>Based on your previous orders, we're ready to help with your next project.</p>
    `
  } else {
    emailHtml = `
      <h2>Your Quote is Ready</h2>
      <p>Hi ${quoteRecord.contactName},</p>
      <p>We've prepared a quote for your project.</p>
      <p><strong>Quote #${quoteRecord.quoteNumber}</strong><br>
      Project: ${quoteRecord.projectName}<br>
      Total: $${quoteRecord.total.toFixed(2)}</p>
      <p>Ready to move forward? Let us know!</p>
    `
  }

  const result = await sendEmail({
    to: quoteRecord.email,
    subject:
      emailType === 'WELCOME'
        ? 'Welcome to Abel Lumber!'
        : emailType === 'REORDER_OPPORTUNITY'
          ? 'Time to Reorder?'
          : `Your Quote #${quoteRecord.quoteNumber}`,
    html: emailHtml,
  })

  // Update quote status
  await prisma.$executeRawUnsafe(
    `UPDATE "Quote" SET status = 'SENT', "updatedAt" = NOW() WHERE id = $1`,
    quoteId
  )

  return {
    emailSent: result.success,
    emailId: result.id,
  }
}

/**
 * Handler: Generate Follow-up Message using Claude
 */
async function handleFollowUp(input: Record<string, any>) {
  const { builderName, projectName, quoteTotal, lastOrderItems, emailType } = input

  const client = new Anthropic()

  let prompt = ''

  if (emailType === 'REORDER_OPPORTUNITY' && lastOrderItems) {
    const itemsSummary = lastOrderItems
      .slice(0, 5)
      .map((item: any) => `${item.description} (qty: ${item.quantity})`)
      .join(', ')

    prompt = `You are a friendly sales follow-up specialist for Abel Lumber.

    Generate a personalized, brief reorder opportunity email for ${builderName}.
    They last ordered: ${itemsSummary}

    Keep it short (2-3 sentences), friendly, and focused on offering to help with their next project.
    Return ONLY the email body text, no subject line.`
  } else {
    prompt = `You are a friendly sales follow-up specialist for Abel Lumber.

    Generate a personalized follow-up message for ${builderName} regarding their quote for ${projectName} (total: $${quoteTotal}).

    The quote was sent a few days ago and we haven't heard back. Be friendly, offer to answer questions, and suggest next steps.
    Keep it short (2-3 sentences) and professional.
    Return ONLY the message text.`
  }

  const message = await client.messages.create({
    model: 'claude-opus-4-1-20250805',
    max_tokens: 300,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  })

  const responseText =
    message.content[0].type === 'text' ? message.content[0].text : 'Unable to generate message'

  return {
    message: responseText,
  }
}

/**
 * Handler: Check for Stale Quotes
 */
async function handleCheckStaleQuote(input: Record<string, any>) {
  const { quoteId } = input

  const quote = await prisma.$queryRawUnsafe<any[]>(
    `SELECT * FROM "Quote" WHERE id = $1`,
    quoteId
  )

  if (!quote || quote.length === 0) {
    throw new Error('Quote not found')
  }

  const quoteRecord = quote[0]
  const daysOld = Math.floor(
    (Date.now() - new Date(quoteRecord.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  )

  return {
    quoteNumber: quoteRecord.quoteNumber,
    daysOld,
    isStale: daysOld > 5 && quoteRecord.status === 'SENT',
  }
}

/**
 * Handler: Create Notification for Staff
 */
async function handleCreateNotification(input: Record<string, any>) {
  const { builderId, title, body } = input

  // Get admin/sales staff to notify
  const staff = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM "Staff" WHERE role IN ('ADMIN', 'SALES_REP', 'MANAGER') LIMIT 1`
  )

  if (staff && staff.length > 0) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Notification" ("staffId", type, title, body, "createdAt")
      VALUES ($1, $2, $3, $4, NOW())
    `,
      staff[0].id,
      'SYSTEM',
      title,
      body
    )
  }

  return {
    notificationCreated: staff && staff.length > 0,
  }
}

/**
 * Handler: Log Activity
 */
async function handleLogActivity(input: Record<string, any>) {
  const { builderId, activityType, subject, notes } = input

  // Get system user for logging (or first available staff)
  const staff = await prisma.$queryRawUnsafe<any[]>(
    `SELECT id FROM "Staff" WHERE role = 'ADMIN' LIMIT 1`
  )

  if (staff && staff.length > 0) {
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "Activity" ("staffId", "builderId", "activityType", subject, notes, "createdAt")
      VALUES ($1, $2, $3, $4, $5, NOW())
    `,
      staff[0].id,
      builderId,
      activityType,
      subject,
      notes || null
    )
  }

  return {
    activityLogged: staff && staff.length > 0,
  }
}

// ─── WORKFLOW UTILITIES ──────────────────────────────────────────

/**
 * Get recent workflows
 */
export async function getRecentWorkflows(limit = 20): Promise<AgentWorkflow[]> {
  // For now, workflows are in-memory. In production, store in a Workflows table
  return []
}

/**
 * Get workflow by ID
 */
export async function getWorkflowById(id: string): Promise<AgentWorkflow | null> {
  // In production, query from database
  return null
}

/**
 * Detect opportunities and queue workflows
 */
export async function detectAndQueueOpportunities() {
  // 1. Find stale quotes (> 5 days, status SENT)
  const staleQuotes = await prisma.$queryRawUnsafe<any[]>(`
    SELECT q.id, p."builderId"
    FROM "Quote" q
    JOIN "Project" p ON q."projectId" = p.id
    WHERE q.status::text = 'SENT'
    AND q."createdAt" < NOW() - INTERVAL '5 days'
    LIMIT 50
  `)

  for (const quote of staleQuotes || []) {
    await executeStaleQuoteRecoveryWorkflow(quote.id, quote.builderId)
  }

  // 2. Find builders with no orders in 30+ days
  const inactiveBuilders = await prisma.$queryRawUnsafe<any[]>(`
    SELECT DISTINCT b.id
    FROM "Builder" b
    WHERE b.status::text = 'ACTIVE'
    AND (
      SELECT MAX(o."createdAt")
      FROM "Order" o
      WHERE o."builderId" = b.id
    ) < NOW() - INTERVAL '30 days'
    LIMIT 50
  `)

  for (const builder of inactiveBuilders || []) {
    await executeReorderOpportunityWorkflow(builder.id)
  }

  // 3. Find blueprints uploaded but not analyzed
  const pendingBlueprints = await prisma.$queryRawUnsafe<any[]>(`
    SELECT b.id, b."projectId", p."builderId"
    FROM "Blueprint" b
    JOIN "Project" p ON b."projectId" = p.id
    WHERE b."processingStatus"::text = 'PENDING'
    AND b."createdAt" < NOW() - INTERVAL '1 hour'
    LIMIT 50
  `)

  for (const blueprint of pendingBlueprints || []) {
    await executeBlueprintToQuoteWorkflow(blueprint.builderId, blueprint.id, blueprint.projectId)
  }
}
