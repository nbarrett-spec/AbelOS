/**
 * PM Daily Tasks Cron
 *
 * Runs daily at 6:30 AM CT (11:30 UTC)
 * - Queries all active Project Managers
 * - For each PM, gathers:
 *   a) Jobs scheduled for today
 *   b) Material ETAs (POs expected to arrive)
 *   c) Open tasks assigned to PM
 *   d) Overdue jobs count
 *   e) Open warranty claims
 * - Sends personalized HTML email with morning briefing
 *
 * Requires CRON_SECRET for auth
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { sendEmail, wrap } from '@/lib/email'
import { startCronRun, finishCronRun } from '@/lib/cron'

interface PMData {
  id: string
  firstName: string
  lastName: string
  email: string
}

interface ScheduledJob {
  jobNumber: string
  address: string
  status: string
  builderName: string
  communityName: string | null
}

interface MaterialETA {
  poNumber: string
  expectedDate: Date
  supplierName: string
  lineCount: number
}

interface OpenTask {
  title: string
  priority: string
  dueDate: Date | null
  status: string
}

interface PMEmailData {
  name: string
  email: string
  jobCount: number
  taskCount: number
  success: boolean
  error?: string
}

const BRAND_COLORS = {
  walnut: '#0f2a3e',
  amber: '#C6A24E',
  lightGray: '#F5F5F5',
  darkGray: '#333',
  red: '#DC2626',
}

/**
 * Format date as human-readable string (e.g., "Tomorrow, Apr 20")
 */
function formatDate(date: Date): string {
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  const checkDate = new Date(date)
  checkDate.setHours(0, 0, 0, 0)

  const tomorrow = new Date(today)
  tomorrow.setDate(tomorrow.getDate() + 1)

  const isToday = checkDate.getTime() === today.getTime()
  const isTomorrow = checkDate.getTime() === tomorrow.getTime()

  const formatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  const dateStr = formatter.format(date)

  if (isToday) return `Today, ${dateStr}`
  if (isTomorrow) return `Tomorrow, ${dateStr}`
  return dateStr
}

/**
 * Generate priority badge HTML with color coding
 */
function priorityBadge(priority: string): string {
  const colors: Record<string, string> = {
    URGENT: '#DC2626',
    HIGH: '#EA580C',
    MEDIUM: '#F59E0B',
    LOW: '#10B981',
  }
  const color = colors[priority] || colors.MEDIUM
  return `<span style="background-color: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase;">${priority}</span>`
}

/**
 * Generate status badge HTML
 */
function statusBadge(status: string): string {
  const colors: Record<string, string> = {
    CREATED: '#9CA3AF',
    READINESS_CHECK: '#3B82F6',
    MATERIALS_LOCKED: '#8B5CF6',
    IN_PRODUCTION: '#EC4899',
    STAGED: '#F59E0B',
    LOADED: '#EF4444',
    IN_TRANSIT: '#E11D48',
    DELIVERED: '#10B981',
    TODO: '#6B7280',
    IN_PROGRESS: '#3B82F6',
    BLOCKED: '#EF4444',
    DONE: '#10B981',
    CANCELLED: '#9CA3AF',
  }
  const color = colors[status] || '#6B7280'
  return `<span style="background-color: ${color}; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">${status}</span>`
}

/**
 * Generate HTML email content for a single PM
 */
function generatePMEmail(
  pmName: string,
  jobs: ScheduledJob[],
  materials: MaterialETA[],
  tasks: OpenTask[],
  overdueCount: number
): string {
  const dayName = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(new Date())
  const monthDay = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date())

  let html = `
    <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; color: ${BRAND_COLORS.darkGray}; line-height: 1.6;">

      <!-- Greeting -->
      <div style="padding: 24px 32px; background-color: ${BRAND_COLORS.walnut}; color: white;">
        <h1 style="margin: 0; font-size: 20px; font-weight: 600;">Good morning, ${pmName}!</h1>
        <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Here's your day — ${dayName}, ${monthDay}</p>
      </div>

      <div style="padding: 32px;">
  `

  // ─── TODAY'S JOBS ──────────────────────────────────────────────────
  html += `
    <section style="margin-bottom: 32px;">
      <h2 style="font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.walnut}; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">
        📋 Today's Jobs (${jobs.length})
      </h2>
  `

  if (jobs.length === 0) {
    html += `<p style="color: #9CA3AF; font-size: 14px; margin: 0;">No jobs scheduled today.</p>`
  } else {
    html += `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid ${BRAND_COLORS.amber};">
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Job #</th>
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Builder / Community</th>
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Address</th>
            <th style="text-align: center; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Status</th>
          </tr>
        </thead>
        <tbody>
    `
    jobs.forEach((job) => {
      const location = job.communityName ? `${job.communityName} (${job.builderName})` : job.builderName
      html += `
          <tr style="border-bottom: 1px solid ${BRAND_COLORS.lightGray};">
            <td style="padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.amber};">${job.jobNumber}</td>
            <td style="padding: 12px 0;">${location}</td>
            <td style="padding: 12px 0; font-size: 12px; color: #6B7280;">${job.address || '—'}</td>
            <td style="padding: 12px 0; text-align: center;">${statusBadge(job.status)}</td>
          </tr>
      `
    })
    html += `
        </tbody>
      </table>
    `
  }

  html += `</section>`

  // ─── MATERIAL ARRIVALS ─────────────────────────────────────────────
  html += `
    <section style="margin-bottom: 32px;">
      <h2 style="font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.walnut}; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">
        📦 Material Arrivals Today (${materials.length})
      </h2>
  `

  if (materials.length === 0) {
    html += `<p style="color: #9CA3AF; font-size: 14px; margin: 0;">No material arrivals expected today.</p>`
  } else {
    html += `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid ${BRAND_COLORS.amber};">
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">PO #</th>
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Supplier</th>
            <th style="text-align: center; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Line Items</th>
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Expected</th>
          </tr>
        </thead>
        <tbody>
    `
    materials.forEach((mat) => {
      const expectedStr = formatDate(mat.expectedDate)
      html += `
          <tr style="border-bottom: 1px solid ${BRAND_COLORS.lightGray};">
            <td style="padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.amber};">${mat.poNumber}</td>
            <td style="padding: 12px 0;">${mat.supplierName || 'Unknown'}</td>
            <td style="padding: 12px 0; text-align: center; color: #6B7280;">${mat.lineCount} item${mat.lineCount !== 1 ? 's' : ''}</td>
            <td style="padding: 12px 0; font-size: 12px; color: #6B7280;">${expectedStr}</td>
          </tr>
      `
    })
    html += `
        </tbody>
      </table>
    `
  }

  html += `</section>`

  // ─── OPEN TASKS ────────────────────────────────────────────────────
  html += `
    <section style="margin-bottom: 32px;">
      <h2 style="font-size: 16px; font-weight: 600; color: ${BRAND_COLORS.walnut}; margin: 0 0 16px 0; text-transform: uppercase; letter-spacing: 0.5px;">
        ✓ Your Open Tasks (${tasks.length})
      </h2>
  `

  if (tasks.length === 0) {
    html += `<p style="color: #9CA3AF; font-size: 14px; margin: 0;">No open tasks. You're all caught up!</p>`
  } else {
    html += `
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="border-bottom: 2px solid ${BRAND_COLORS.amber};">
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Title</th>
            <th style="text-align: center; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Priority</th>
            <th style="text-align: left; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Due</th>
            <th style="text-align: center; padding: 12px 0; font-weight: 600; color: ${BRAND_COLORS.walnut};">Status</th>
          </tr>
        </thead>
        <tbody>
    `
    tasks.forEach((task) => {
      const dueStr = task.dueDate ? formatDate(task.dueDate) : '—'
      html += `
          <tr style="border-bottom: 1px solid ${BRAND_COLORS.lightGray};">
            <td style="padding: 12px 0; font-weight: 500;">${task.title}</td>
            <td style="padding: 12px 0; text-align: center;">${priorityBadge(task.priority)}</td>
            <td style="padding: 12px 0; font-size: 12px; color: #6B7280;">${dueStr}</td>
            <td style="padding: 12px 0; text-align: center;">${statusBadge(task.status)}</td>
          </tr>
      `
    })
    html += `
        </tbody>
      </table>
    `
  }

  html += `</section>`

  // ─── ALERTS ────────────────────────────────────────────────────────
  if (overdueCount > 0) {
    html += `
      <section style="margin-bottom: 32px; padding: 16px; background-color: #FEE2E2; border-left: 4px solid ${BRAND_COLORS.red}; border-radius: 4px;">
        <p style="margin: 0; font-weight: 600; color: ${BRAND_COLORS.red};">
          ⚠️ ${overdueCount} overdue job${overdueCount !== 1 ? 's' : ''} need attention
        </p>
      </section>
    `
  }

  // ─── FOOTER & CTA ──────────────────────────────────────────────────
  html += `
      </div>

      <div style="padding: 24px 32px; background-color: ${BRAND_COLORS.lightGray}; text-align: center; border-top: 1px solid #DDD;">
        <a href="https://app.abellumber.com/ops/my-day" style="display: inline-block; background-color: ${BRAND_COLORS.amber}; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none; font-weight: 600; font-size: 14px;">
          View Full Dashboard →
        </a>
        <p style="margin: 16px 0 0 0; font-size: 12px; color: #6B7280;">
          This email was sent by Abel Lumber's operations system. <br>
          Questions? Reply to this email or contact your manager.
        </p>
      </div>

    </div>
  `

  return html
}

export async function GET(request: NextRequest) {
  // ─── AUTH ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const runId = await startCronRun('pm-daily-tasks', 'schedule')
  const startTime = Date.now()
  const results: PMEmailData[] = []

  try {
    // ─── STEP 1: Find all active PMs ───────────────────────────────
    const pms = await prisma.$queryRawUnsafe<PMData[]>(`
      SELECT id, "firstName", "lastName", email
      FROM "Staff"
      WHERE active = true
        AND (role::text = 'PROJECT_MANAGER' OR roles LIKE '%PROJECT_MANAGER%')
      ORDER BY "firstName", "lastName"
    `)

    console.log(`[PM Daily Tasks] Found ${pms.length} active PMs`)

    // ─── STEP 2: For each PM, gather data and send email ──────────
    for (const pm of pms) {
      const emailData: PMEmailData = {
        name: `${pm.firstName} ${pm.lastName}`,
        email: pm.email,
        jobCount: 0,
        taskCount: 0,
        success: false,
      }

      try {
        // 2a: Jobs scheduled today assigned to this PM
        const jobs = await prisma.$queryRawUnsafe<ScheduledJob[]>(`
          SELECT j."jobNumber", j."jobAddress" AS "address", j.status::text,
                 b."companyName" AS "builderName",
                 c."name" AS "communityName"
          FROM "Job" j
          LEFT JOIN "Builder" b ON b.id = j."builderId"
          LEFT JOIN "Community" c ON c.id = j."communityId"
          WHERE j."assignedPMId" = $1
            AND j."scheduledDate"::date = CURRENT_DATE
            AND j.status::text NOT IN ('DELIVERED', 'CANCELLED')
          ORDER BY j."scheduledDate" ASC
        `, pm.id)

        emailData.jobCount = jobs.length

        // 2b: Material ETAs today (global — all incoming POs)
        const materials = await prisma.$queryRawUnsafe<MaterialETA[]>(`
          SELECT po."poNumber", po."expectedDate",
                 COALESCE(v."name", 'Unknown') AS "supplierName",
                 COUNT(pol.id)::int AS "lineCount"
          FROM "PurchaseOrder" po
          LEFT JOIN "Vendor" v ON v.id = po."vendorId"
          LEFT JOIN "PurchaseOrderItem" pol ON pol."purchaseOrderId" = po.id
          WHERE po."expectedDate"::date = CURRENT_DATE
            AND po.status::text = 'ORDERED'
          GROUP BY po.id, po."poNumber", po."expectedDate", v."name"
          ORDER BY po."expectedDate" ASC
        `)

        // 2c: Open tasks assigned to this PM (top 10, prioritized)
        const tasks = await prisma.$queryRawUnsafe<OpenTask[]>(`
          SELECT t.title, t.priority::text, t."dueDate", t.status::text
          FROM "Task" t
          WHERE t."assigneeId" = $1
            AND t.status::text NOT IN ('DONE', 'CANCELLED')
          ORDER BY
            CASE t.priority::text
              WHEN 'CRITICAL' THEN 1
              WHEN 'HIGH' THEN 2
              WHEN 'MEDIUM' THEN 3
              ELSE 4
            END,
            t."dueDate" ASC NULLS LAST
          LIMIT 10
        `, pm.id)

        emailData.taskCount = tasks.length

        // 2d: Count overdue jobs
        const overdueResult = await prisma.$queryRawUnsafe<Array<{ overdueJobs: number }>>(`
          SELECT COUNT(*)::int AS "overdueJobs"
          FROM "Job" j
          WHERE j."assignedPMId" = $1
            AND j."scheduledDate" < CURRENT_DATE
            AND j.status::text NOT IN ('DELIVERED', 'CANCELLED')
        `, pm.id)

        const overdueCount = overdueResult[0]?.overdueJobs || 0

        // ─── STEP 3: Generate and send email ──────────────────────
        const subject = `📋 Your Day — ${emailData.jobCount} jobs, ${emailData.taskCount} open tasks`
        const html = generatePMEmail(
          pm.firstName,
          jobs,
          materials,
          tasks,
          overdueCount
        )

        const emailResult = await sendEmail({
          to: pm.email,
          subject,
          html: wrap(html),
        })

        if (emailResult.success) {
          emailData.success = true
          console.log(`[PM Daily Tasks] ✓ Email sent to ${pm.email}`)
        } else {
          emailData.error = emailResult.error
          console.error(`[PM Daily Tasks] ✗ Email failed for ${pm.email}: ${emailResult.error}`)
        }
      } catch (error) {
        emailData.error = error instanceof Error ? error.message : String(error)
        console.error(`[PM Daily Tasks] Error processing PM ${pm.email}:`, error)
      }

      results.push(emailData)
    }

    // ─── STEP 4: Finalize cron run ─────────────────────────────────
    const duration = Date.now() - startTime
    const sent = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length

    const payload = {
      success: true,
      sent,
      failed,
      pms: results.map((r) => ({
        name: r.name,
        email: r.email,
        jobCount: r.jobCount,
        taskCount: r.taskCount,
        status: r.success ? 'sent' : 'failed',
        error: r.error,
      })),
      timestamp: new Date().toISOString(),
      duration_ms: duration,
    }

    console.log(`[PM Daily Tasks] Completed: ${sent} sent, ${failed} failed in ${duration}ms`)

    await finishCronRun(runId, 'SUCCESS', duration, { result: payload })
    return NextResponse.json(payload)
  } catch (error) {
    console.error('[PM Daily Tasks] Fatal error:', error)
    const duration = Date.now() - startTime
    await finishCronRun(runId, 'FAILURE', duration, {
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
