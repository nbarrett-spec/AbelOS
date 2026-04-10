export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface WorkflowAlert {
  id: string
  severity: 'HIGH' | 'MEDIUM' | 'LOW'
  title: string
  description: string
  actionHref: string
  actionLabel: string
  count?: number
  timeframe?: string
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const alerts: WorkflowAlert[] = []
    const now = new Date()
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    // 1. Jobs stuck in READINESS_CHECK for more than 48 hours
    try {
      const stuckReadiness = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          jobNumber: string
          builderName: string
        }>
      >(
        `
        SELECT id, "jobNumber", "builderName"
        FROM "Job"
        WHERE "status"::text = 'READINESS_CHECK' AND "updatedAt" < $1
        `,
        twoDaysAgo
      )

      if (stuckReadiness.length > 0) {
        alerts.push({
          id: 'stuck-readiness',
          severity: 'HIGH',
          title: `${stuckReadiness.length} Job${stuckReadiness.length > 1 ? 's' : ''} Stuck in Readiness Check`,
          description: `${stuckReadiness.length} job${stuckReadiness.length > 1 ? 's' : ''} have been in T-72 readiness check for more than 48 hours. Review and resolve to maintain schedule.`,
          actionHref: '/ops/jobs',
          actionLabel: 'Review Jobs',
          count: stuckReadiness.length,
          timeframe: '48+ hours',
        })
      }
    } catch (error) {
      console.error('Error checking stuck readiness jobs:', error)
    }

    // 2. Overdue invoices
    try {
      const overdueInvoices = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          invoiceNumber: string
          balanceDue: number
        }>
      >(
        `
        SELECT id, "invoiceNumber", "balanceDue"
        FROM "Invoice"
        WHERE "status"::text = 'OVERDUE' AND "dueDate" <= $1
        `,
        now
      )

      if (overdueInvoices.length > 0) {
        const totalOverdue = overdueInvoices.reduce((sum, inv) => sum + inv.balanceDue, 0)
        alerts.push({
          id: 'overdue-invoices',
          severity: 'HIGH',
          title: `${overdueInvoices.length} Overdue Invoice${overdueInvoices.length > 1 ? 's' : ''}`,
          description: `${overdueInvoices.length} invoice${overdueInvoices.length > 1 ? 's' : ''} totaling $${totalOverdue.toFixed(2)} are overdue. Immediate collection action recommended.`,
          actionHref: '/ops/invoices',
          actionLabel: 'Manage Invoices',
          count: overdueInvoices.length,
        })
      }
    } catch (error) {
      console.error('Error checking overdue invoices:', error)
    }

    // 3. Jobs with no PM assigned
    try {
      const noPMJobs = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          jobNumber: string
        }>
      >(
        `
        SELECT id, "jobNumber"
        FROM "Job"
        WHERE "assignedPMId" IS NULL AND "status"::text IN ('CREATED', 'READINESS_CHECK', 'MATERIALS_LOCKED')
        `
      )

      if (noPMJobs.length > 0) {
        alerts.push({
          id: 'no-pm-assigned',
          severity: 'MEDIUM',
          title: `${noPMJobs.length} Job${noPMJobs.length > 1 ? 's' : ''} Without PM Assignment`,
          description: `${noPMJobs.length} active job${noPMJobs.length > 1 ? 's' : ''} do not have a project manager assigned. Assign PMs to ensure proper oversight.`,
          actionHref: '/ops/jobs',
          actionLabel: 'Assign PMs',
          count: noPMJobs.length,
        })
      }
    } catch (error) {
      console.error('Error checking jobs without PM:', error)
    }

    // 4. Schedule entries with no crew assigned
    try {
      const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      const noCrewSchedules = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          title: string
          scheduledDate: string
        }>
      >(
        `
        SELECT id, title, "scheduledDate"
        FROM "ScheduleEntry"
        WHERE "crewId" IS NULL AND status::text IN ('TENTATIVE', 'FIRM')
          AND "scheduledDate" >= $1 AND "scheduledDate" <= $2
        `,
        now,
        sevenDaysLater
      )

      if (noCrewSchedules.length > 0) {
        alerts.push({
          id: 'unassigned-crew',
          severity: 'MEDIUM',
          title: `${noCrewSchedules.length} Schedule${noCrewSchedules.length > 1 ? 's' : ''} Missing Crew Assignment`,
          description: `${noCrewSchedules.length} upcoming schedule${noCrewSchedules.length > 1 ? 's' : ''} in the next 7 days have no crew assigned. Assign crews to prevent delays.`,
          actionHref: '/ops/schedule',
          actionLabel: 'Assign Crews',
          count: noCrewSchedules.length,
        })
      }
    } catch (error) {
      console.error('Error checking schedules without crew:', error)
    }

    // 5. POs in DRAFT for more than 7 days
    try {
      const staleDraftPOs = await prisma.$queryRawUnsafe<
        Array<{
          id: string
          poNumber: string
          createdAt: string
        }>
      >(
        `
        SELECT id, "poNumber", "createdAt"
        FROM "PurchaseOrder"
        WHERE status::text = 'DRAFT' AND "createdAt" < $1
        `,
        sevenDaysAgo
      )

      if (staleDraftPOs.length > 0) {
        alerts.push({
          id: 'stale-pos',
          severity: 'LOW',
          title: `${staleDraftPOs.length} Purchase Order${staleDraftPOs.length > 1 ? 's' : ''} in Draft`,
          description: `${staleDraftPOs.length} purchase order${staleDraftPOs.length > 1 ? 's' : ''} have been in draft status for more than 7 days. Review and finalize or delete.`,
          actionHref: '/ops/purchasing',
          actionLabel: 'Review POs',
          count: staleDraftPOs.length,
          timeframe: '7+ days',
        })
      }
    } catch (error) {
      console.error('Error checking stale POs:', error)
    }

    // Sort by severity: HIGH > MEDIUM > LOW
    const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 }
    alerts.sort(
      (a, b) => severityOrder[a.severity] - severityOrder[b.severity]
    )

    return NextResponse.json({
      alerts: alerts.slice(0, 10),
      totalAlerts: alerts.length,
      criticalCount: alerts.filter((a) => a.severity === 'HIGH').length,
    })
  } catch (error) {
    console.error('Alerts generation error:', error)
    return NextResponse.json(
      { error: 'Failed to generate alerts', alerts: [] },
      { status: 500 }
    )
  }
}
