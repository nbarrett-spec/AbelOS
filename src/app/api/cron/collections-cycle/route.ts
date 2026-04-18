/**
 * Cron: Collections Cycle
 *
 * Runs daily at 8am CT (1pm UTC) on weekdays.
 * Calls the collections run-cycle endpoint internally to:
 * - Process overdue invoices through collection rules
 * - Auto-offer payment plans for 45+ day invoices
 * - Create approval tasks for high-stakes actions (FINAL_NOTICE, ACCOUNT_HOLD)
 * - Calibrate tone based on builder intelligence profiles
 *
 * Requires CRON_SECRET for auth
 */

export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { startCronRun, finishCronRun } from '@/lib/cron'
import { fireAutomationEvent } from '@/lib/automation-executor'

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('collections-cycle', 'schedule')
  const started = Date.now()

  try {
    // console.log('[Collections Cycle] Starting daily collection run...')

    // Fetch all active collection rules
    const rules: any[] = await prisma.$queryRawUnsafe(`
      SELECT * FROM "CollectionRule"
      WHERE "isActive" = true
      ORDER BY "daysOverdue" ASC
    `)

    if (rules.length === 0) {
      const payload = { success: true, message: 'No active collection rules', actionsCreated: 0 }
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result: payload })
      return NextResponse.json(payload)
    }

    // Find all overdue invoices
    const overdueInvoices: any[] = await prisma.$queryRawUnsafe(`
      SELECT i."id", i."builderId", i."dueDate", i."invoiceNumber",
             i."status"::text AS "status", i."balanceDue", i."total",
             i."paymentPlanOffered"
      FROM "Invoice" i
      WHERE (i."status"::text IN ('OVERDUE', 'SENT'))
        AND i."dueDate" < NOW()
      ORDER BY i."dueDate" ASC
    `)

    if (overdueInvoices.length === 0) {
      const payload = { success: true, message: 'No overdue invoices', actionsCreated: 0 }
      await finishCronRun(runId, 'SUCCESS', Date.now() - started, { result: payload })
      return NextResponse.json(payload)
    }

    // Batch-fetch builder intelligence
    const builderIds = [...new Set(overdueInvoices.map(inv => inv.builderId).filter(Boolean))]
    let intelligenceMap: Record<string, any> = {}

    if (builderIds.length > 0) {
      const placeholders = builderIds.map((_, i) => `$${i + 1}`).join(', ')
      try {
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
      } catch (e) {
        console.warn('[Collections Cycle] BuilderIntelligence table not available:', e)
      }
    }

    let actionsCreated = 0
    let escalationsCreated = 0
    let paymentPlansOffered = 0
    const REQUIRES_APPROVAL = ['FINAL_NOTICE', 'ACCOUNT_HOLD']

    for (const invoice of overdueInvoices) {
      const now = new Date()
      const daysOverdue = Math.floor(
        (now.getTime() - new Date(invoice.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      )

      const intel = intelligenceMap[invoice.builderId] || null
      const tone = determineTone(intel, daysOverdue)

      // Auto-offer payment plan for 45+ days, if not already offered
      if (daysOverdue >= 45 && !invoice.paymentPlanOffered && Number(invoice.balanceDue) > 500) {
        const installments = 3
        const installmentAmount = Math.ceil(Number(invoice.balanceDue) / installments * 100) / 100
        try {
          await prisma.$executeRawUnsafe(`
            UPDATE "Invoice"
            SET "paymentPlanOffered" = true,
                "paymentPlanDetails" = $2::jsonb
            WHERE "id" = $1
          `, invoice.id, JSON.stringify({ installments, installmentAmount, offeredAt: now.toISOString() }))

          const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
          await prisma.$executeRawUnsafe(`
            INSERT INTO "CollectionAction" (
              "id", "invoiceId", "actionType", "channel", "notes", "sentAt", "createdAt",
              "toneUsed", "intelligenceSnapshot"
            ) VALUES ($1, $2, 'PAYMENT_PLAN', 'EMAIL', $3, NOW(), NOW(), $4, $5::jsonb)
          `,
            actionId,
            invoice.id,
            `Auto payment plan: ${installments}x $${installmentAmount.toFixed(2)}. ${daysOverdue}d overdue.`,
            tone,
            JSON.stringify(intel || {})
          )
          paymentPlansOffered++
          actionsCreated++
        } catch (e) {
          console.error('[Collections Cycle] Payment plan offer failed:', e)
        }
      }

      // Process rules
      for (const rule of rules) {
        if (daysOverdue >= rule.daysOverdue) {
          const existing: any[] = await prisma.$queryRawUnsafe(`
            SELECT "id" FROM "CollectionAction"
            WHERE "invoiceId" = $1 AND "actionType" = $2 LIMIT 1
          `, invoice.id, rule.actionType)

          if (existing.length === 0) {
            const needsApproval = REQUIRES_APPROVAL.includes(rule.actionType)
            const actionId = `act_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

            await prisma.$executeRawUnsafe(`
              INSERT INTO "CollectionAction" (
                "id", "invoiceId", "actionType", "channel", "notes", "sentAt", "createdAt",
                "requiresApproval", "toneUsed", "intelligenceSnapshot"
              ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW(), $6, $7, $8::jsonb)
            `,
              actionId,
              invoice.id,
              rule.actionType,
              rule.channel,
              `Cron: ${rule.name}. ${daysOverdue}d overdue. Tone: ${tone}.${needsApproval ? ' AWAITING APPROVAL.' : ''}`,
              needsApproval,
              tone,
              JSON.stringify(intel || {})
            )

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
                    'cron:collections-cycle', NOW(), NOW()
                  )
                `,
                  taskId,
                  `${rule.actionType} — ${invoice.invoiceNumber}`,
                  `${rule.actionType} for ${invoice.invoiceNumber} ($${Number(invoice.balanceDue).toFixed(2)}, ${daysOverdue}d overdue)`,
                  JSON.stringify({
                    collectionActionId: actionId,
                    invoiceId: invoice.id,
                    invoiceNumber: invoice.invoiceNumber,
                    builderId: invoice.builderId,
                    actionType: rule.actionType,
                    balanceDue: Number(invoice.balanceDue),
                    daysOverdue,
                    tone,
                  })
                )
                escalationsCreated++
              } catch (e) {
                console.error('[Collections Cycle] Approval task creation failed:', e)
              }
            }

            actionsCreated++
          }
        }
      }

      // Fire automation event (non-blocking)
      fireAutomationEvent('INVOICE_OVERDUE', invoice.id, {
        invoiceNumber: invoice.invoiceNumber,
        builderId: invoice.builderId,
        balanceDue: invoice.balanceDue,
        daysOverdue,
      }).catch(() => {})
    }

    const duration = Date.now() - started
    const payload = {
      success: true,
      message: 'Collections cycle completed',
      duration_ms: duration,
      invoicesProcessed: overdueInvoices.length,
      actionsCreated,
      escalationsCreated,
      paymentPlansOffered,
      timestamp: new Date().toISOString(),
    }

    // console.log(
    //   `[Collections Cycle] Done in ${duration}ms — ${overdueInvoices.length} invoices, ${actionsCreated} actions, ${escalationsCreated} escalations, ${paymentPlansOffered} plans`
    // )

    await finishCronRun(runId, 'SUCCESS', duration, { result: payload })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[Collections Cycle] Error:', error)
    await finishCronRun(runId, 'FAILURE', Date.now() - started, {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    )
  }
}

function determineTone(intel: any | null, daysOverdue: number): string {
  if (!intel) {
    if (daysOverdue <= 15) return 'FRIENDLY'
    if (daysOverdue <= 30) return 'PROFESSIONAL'
    if (daysOverdue <= 60) return 'FIRM'
    return 'URGENT'
  }
  const ltv = Number(intel.totalLifetimeValue) || 0
  const onTimeRate = Number(intel.onTimePaymentRate) || 0
  const healthScore = Number(intel.healthScore) || 50

  if (ltv > 50000 && onTimeRate > 0.7 && daysOverdue <= 30) return 'FRIENDLY'
  if (ltv > 20000 && healthScore > 60 && daysOverdue <= 45) return 'PROFESSIONAL'
  if (intel.paymentTrend === 'IMPROVING' && daysOverdue <= 45) return 'PROFESSIONAL'
  if (intel.paymentTrend === 'DECLINING' && daysOverdue > 30) return 'FIRM'

  if (daysOverdue <= 15) return 'FRIENDLY'
  if (daysOverdue <= 30) return 'PROFESSIONAL'
  if (daysOverdue <= 60) return 'FIRM'
  return 'URGENT'
}
