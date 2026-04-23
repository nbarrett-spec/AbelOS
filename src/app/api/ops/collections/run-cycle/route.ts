export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { generateCollectionCall, isElevenLabsConfigured } from '@/lib/elevenlabs'

/**
 * POST /api/ops/collections/run-cycle
 * Enhanced collection cycle with intelligence-aware tone calibration,
 * payment plan auto-offers for 45+ day invoices, and human escalation gates
 * for FINAL_NOTICE and above.
 */
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const now = new Date()

    // Fetch all active collection rules
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CollectionRule"
      WHERE "isActive" = true
      ORDER BY "daysOverdue" ASC
    `)

    if (rules.length === 0) {
      return NextResponse.json({
        message: 'No active collection rules found',
        actionsCreated: 0,
        invoicesProcessed: 0,
      })
    }

    // Find all open invoices (any non-terminal status) where dueDate has
    // passed and there is an outstanding balance. Covers the full open bucket
    // in the InvoiceStatus enum: ISSUED | SENT | PARTIALLY_PAID | OVERDUE.
    const overdueInvoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."builderId", i."dueDate", i."invoiceNumber",
             i."status"::text AS "status", (i."total" - COALESCE(i."amountPaid",0))::float AS "balanceDue", i."total",
             i."paymentPlanOffered"
      FROM "Invoice" i
      WHERE i."status"::text IN ('ISSUED', 'SENT', 'PARTIALLY_PAID', 'OVERDUE')
        AND i."dueDate" < NOW()
        AND (i."total" - COALESCE(i."amountPaid",0)) > 0
      ORDER BY i."dueDate" ASC
    `)

    // Batch-fetch builder intelligence for all affected builders
    const builderIds = [...new Set(overdueInvoices.map(inv => inv.builderId).filter(Boolean))]
    let intelligenceMap: Record<string, any> = {}

    if (builderIds.length > 0) {
      const placeholders = builderIds.map((_, i) => `$${i + 1}`).join(', ')
      const profiles: any[] = await prisma.$queryRawUnsafe(`
        SELECT bi."builderId", bi."healthScore", bi."creditRiskScore",
               bi."onTimePaymentRate", bi."paymentTrend", bi."orderTrend",
               bi."totalLifetimeValue", bi."avgDaysToPayment"
        FROM "BuilderIntelligence" bi
        WHERE bi."builderId" IN (${placeholders})
      `, ...builderIds)

      for (const p of profiles) {
        intelligenceMap[p.builderId] = p
      }
    }

    let actionsCreated = 0
    let escalationsCreated = 0
    let paymentPlansOffered = 0
    const actionsLog: any[] = []

    // High-stakes action types that require human approval
    const REQUIRES_APPROVAL = ['FINAL_NOTICE', 'ACCOUNT_HOLD']

    for (const invoice of overdueInvoices) {
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      const intel = intelligenceMap[invoice.builderId] || null

      // ── Determine tone based on intelligence ──
      const tone = determineTone(intel, daysOverdue)

      // ── Auto-offer payment plan for 45+ days, if not already offered ──
      if (daysOverdue >= 45 && !invoice.paymentPlanOffered && Number(invoice.balanceDue) > 500) {
        const planDetails = generatePaymentPlan(Number(invoice.balanceDue), 3)
        try {
          await prisma.$executeRawUnsafe(`
            UPDATE "Invoice"
            SET "paymentPlanOffered" = true,
                "paymentPlanDetails" = $2::jsonb
            WHERE "id" = $1
          `, invoice.id, JSON.stringify(planDetails))

          // Create payment plan offer action
          const planActionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(`
            INSERT INTO "CollectionAction" (
              "id", "invoiceId", "actionType", "channel", "notes", "sentAt", "createdAt",
              "toneUsed", "intelligenceSnapshot"
            ) VALUES (
              $1, $2, 'PAYMENT_PLAN', 'EMAIL', $3, NOW(), NOW(), $4, $5::jsonb
            )
          `,
            planActionId,
            invoice.id,
            `Auto-generated payment plan offer. ${planDetails.installments} installments of $${planDetails.installmentAmount.toFixed(2)}. Days overdue: ${daysOverdue}`,
            tone,
            JSON.stringify(intel || {})
          )

          paymentPlansOffered++
          actionsCreated++
          actionsLog.push({
            invoiceId: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            builderId: invoice.builderId,
            actionType: 'PAYMENT_PLAN',
            channel: 'EMAIL',
            daysOverdue,
            tone,
            autoPaymentPlan: true,
            planDetails,
          })
        } catch (e) {
          console.error('Payment plan offer failed:', e)
        }
      }

      // ── Process rules ──
      for (const rule of rules) {
        if (daysOverdue >= rule.daysOverdue) {
          // Check if this action type already exists for this invoice
          const existingAction: any[] = await prisma.$queryRawUnsafe(`
            SELECT "id" FROM "CollectionAction"
            WHERE "invoiceId" = $1 AND "actionType" = $2
            LIMIT 1
          `, invoice.id, rule.actionType)

          if (existingAction.length === 0) {
            const needsApproval = REQUIRES_APPROVAL.includes(rule.actionType)
            const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

            // Create the collection action (with approval gate if needed)
            await prisma.$executeRawUnsafe(`
              INSERT INTO "CollectionAction" (
                "id", "invoiceId", "actionType", "channel", "notes", "sentAt", "createdAt",
                "requiresApproval", "toneUsed", "intelligenceSnapshot"
              ) VALUES (
                $1, $2, $3, $4, $5, NOW(), NOW(), $6, $7, $8::jsonb
              )
            `,
              actionId,
              invoice.id,
              rule.actionType,
              rule.channel,
              buildActionNotes(rule, daysOverdue, tone, intel, needsApproval),
              needsApproval,
              tone,
              JSON.stringify(intel || {})
            )

            // If needs approval, also create an AgentTask for the Command Center
            if (needsApproval) {
              const taskId = `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
              try {
                await prisma.$executeRawUnsafe(`
                  INSERT INTO "AgentTask" (
                    "id", "agentRole", "taskType", "title", "description",
                    "priority", "status", "payload", "requiresApproval",
                    "createdBy", "createdAt", "updatedAt"
                  ) VALUES (
                    $1, 'OPS', 'COLLECTION_ACTION', $2, $3,
                    'HIGH', 'PENDING', $4::jsonb, true,
                    'agent:OPS', NOW(), NOW()
                  )
                `,
                  taskId,
                  `${rule.actionType} — ${invoice.invoiceNumber}`,
                  `Collection action requires approval: ${rule.actionType} for invoice ${invoice.invoiceNumber} ($${Number(invoice.balanceDue).toFixed(2)}, ${daysOverdue} days overdue)`,
                  JSON.stringify({
                    collectionActionId: actionId,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    builderId: invoice.builderId,
                    actionType: rule.actionType,
                    balanceDue: Number(invoice.balanceDue),
                    daysOverdue,
                    tone,
                    intelligence: intel,
                  })
                )
                escalationsCreated++
              } catch (e) {
                console.error('Failed to create approval task:', e)
              }
            }

            // If ACCOUNT_HOLD and NOT requiring approval (shouldn't normally happen, but safety check)
            if (rule.actionType === 'ACCOUNT_HOLD' && !needsApproval) {
              await prisma.$executeRawUnsafe(`
                UPDATE "Builder"
                SET "status" = 'SUSPENDED'::"AccountStatus", "updatedAt" = NOW()
                WHERE "id" = $1
              `, invoice.builderId)
            }

            actionsCreated++
            actionsLog.push({
              invoiceId: invoice.id,
              invoiceNumber: invoice.invoiceNumber,
              builderId: invoice.builderId,
              actionType: rule.actionType,
              channel: rule.channel,
              daysOverdue,
              ruleName: rule.name,
              tone,
              requiresApproval: needsApproval,
            })
          }
        }
      }
    }

    await audit(request, 'CREATE', 'CollectionCycle', `cycle_${Date.now()}`, {
      invoicesProcessed: overdueInvoices.length,
      actionsCreated,
      escalationsCreated,
      paymentPlansOffered,
    })

    // Fire automation events for overdue invoices (non-blocking)
    // This triggers any configured automation rules like "Invoice Overdue Escalation"
    for (const invoice of overdueInvoices) {
      fireAutomationEvent('INVOICE_OVERDUE', invoice.id, {
        invoiceNumber: invoice.invoiceNumber,
        builderId: invoice.builderId,
        balanceDue: invoice.balanceDue,
        daysOverdue: Math.floor(
          (new Date().getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
        ),
      }).catch(err => {
        // Log but don't fail the collection cycle if automation events fail
        console.error(`Failed to fire automation event for invoice ${invoice.id}:`, err)
      })
    }

    // Generate voice messages for 30+ day overdue invoices (non-blocking)
    let voiceMessagesQueued = 0
    if (isElevenLabsConfigured()) {
      for (const invoice of overdueInvoices) {
        const daysOver = Math.floor(
          (new Date().getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
        )
        if (daysOver >= 30) {
          generateCollectionCall({
            companyName: invoice.builderName || 'valued customer',
            invoiceNumber: invoice.invoiceNumber,
            amount: invoice.balanceDue,
            dueDate: new Date(invoice.dueDate).toLocaleDateString('en-US'),
            daysOverdue: daysOver,
          }).catch(err => console.warn(`[Collections TTS] Failed for ${invoice.invoiceNumber}:`, err))
          voiceMessagesQueued++
        }
      }
    }

    return NextResponse.json({
      message: 'Smart collection cycle completed',
      invoicesProcessed: overdueInvoices.length,
      actionsCreated,
      escalationsCreated,
      paymentPlansOffered,
      voiceMessagesQueued,
      actions: actionsLog,
    })
  } catch (error) {
    console.error('POST /api/ops/collections/run-cycle error:', error)
    return NextResponse.json(
      { error: 'Failed to run collection cycle', details: String(error) },
      { status: 500 }
    )
  }
}

/**
 * Determine collection tone based on builder intelligence profile.
 * Returns: 'FRIENDLY' | 'PROFESSIONAL' | 'FIRM' | 'URGENT'
 */
function determineTone(intel: any | null, daysOverdue: number): string {
  if (!intel) {
    // No intelligence profile — use days-based default
    if (daysOverdue <= 15) return 'FRIENDLY'
    if (daysOverdue <= 30) return 'PROFESSIONAL'
    if (daysOverdue <= 60) return 'FIRM'
    return 'URGENT'
  }

  const healthScore = Number(intel.healthScore) || 50
  const ltv = Number(intel.totalLifetimeValue) || 0
  const onTimeRate = Number(intel.onTimePaymentRate) || 0
  const paymentTrend = intel.paymentTrend

  // High-value builder with good history but late — be gentle
  if (ltv > 50000 && onTimeRate > 0.7 && daysOverdue <= 30) return 'FRIENDLY'
  if (ltv > 20000 && healthScore > 60 && daysOverdue <= 45) return 'PROFESSIONAL'

  // Payment trend improving — encouraging tone
  if (paymentTrend === 'IMPROVING' && daysOverdue <= 45) return 'PROFESSIONAL'

  // Payment trend declining or high risk
  if (paymentTrend === 'DECLINING' && daysOverdue > 30) return 'FIRM'

  // Default escalation by days
  if (daysOverdue <= 15) return 'FRIENDLY'
  if (daysOverdue <= 30) return 'PROFESSIONAL'
  if (daysOverdue <= 60) return 'FIRM'
  return 'URGENT'
}

/**
 * Generate a 3-installment payment plan for overdue invoices.
 */
function generatePaymentPlan(balanceDue: number, installments: number) {
  const installmentAmount = Math.ceil(balanceDue / installments * 100) / 100
  const today = new Date()
  const schedule = []

  for (let i = 0; i < installments; i++) {
    const dueDate = new Date(today)
    dueDate.setDate(dueDate.getDate() + (i + 1) * 14) // Every 2 weeks
    schedule.push({
      installment: i + 1,
      amount: i === installments - 1
        ? Math.round((balanceDue - installmentAmount * (installments - 1)) * 100) / 100
        : installmentAmount,
      dueDate: dueDate.toISOString().split('T')[0],
    })
  }

  return {
    totalAmount: balanceDue,
    installments,
    installmentAmount,
    schedule,
    offeredAt: today.toISOString(),
  }
}

/**
 * Build descriptive notes for the collection action.
 */
function buildActionNotes(
  rule: any, daysOverdue: number, tone: string, intel: any | null, needsApproval: boolean
): string {
  let notes = `Auto-generated by smart collection cycle. Days overdue: ${daysOverdue}. Rule: ${rule.name}. Tone: ${tone}.`
  if (intel) {
    notes += ` Builder health: ${intel.healthScore}/100, LTV: $${Number(intel.totalLifetimeValue).toFixed(0)}, On-time rate: ${(Number(intel.onTimePaymentRate) * 100).toFixed(0)}%.`
  }
  if (needsApproval) {
    notes += ' AWAITING HUMAN APPROVAL before execution.'
  }
  return notes
}
