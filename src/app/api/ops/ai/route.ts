export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

interface AIRequest {
  message: string
  context?: string
}

interface AIResponse {
  text: string
  data?: {
    type: string
    content: string
  }
  suggestions?: string[]
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Ai', undefined, { method: 'POST' }).catch(() => {})

    const body: AIRequest = await request.json()
    const { message } = body

    if (!message || message.trim().length === 0) {
      return NextResponse.json(
        { error: 'Message is required' },
        { status: 400 }
      )
    }

    const messageLower = message.toLowerCase()
    let response: AIResponse = {
      text: 'I can help with scheduling, communications, and workflow insights. How can I assist?',
    }

    // Route to appropriate handler based on message content
    if (messageLower.includes('schedule') || messageLower.includes('week') || messageLower.includes('when')) {
      response = await handleScheduleQuery(message)
    } else if (messageLower.includes('overdue') || messageLower.includes('invoice') || messageLower.includes('payment')) {
      response = await handleInvoiceQuery(message)
    } else if (messageLower.includes('email') || messageLower.includes('draft') || messageLower.includes('builder')) {
      response = await handleEmailTemplate(message)
    } else if (messageLower.includes('status') || messageLower.includes('report') || messageLower.includes('job')) {
      response = await handleJobReport(message)
    } else if (messageLower.includes('material') || messageLower.includes('stock') || messageLower.includes('inventory')) {
      response = await handleInventoryQuery(message)
    } else if (messageLower.includes('performance') || messageLower.includes('kpi')) {
      response = await handlePerformanceKPI(message)
    } else {
      response = await handleDefaultResponse(message)
    }

    return NextResponse.json(response)
  } catch (error) {
    console.error('AI API error:', error)
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    )
  }
}

async function handleScheduleQuery(message: string): Promise<AIResponse> {
  try {
    // Get upcoming scheduled entries for next 7 days
    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)
    const now = new Date()

    const entries = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        title: string
        scheduledDate: string
        entryType: string
        jobNumber: string
        builderName: string
        crewName: string | null
      }>
    >(
      `
      SELECT
        se.id,
        se.title,
        se."scheduledDate",
        se."entryType",
        j."jobNumber",
        j."builderName",
        c."name" as "crewName"
      FROM "ScheduleEntry" se
      LEFT JOIN "Job" j ON se."jobId" = j.id
      LEFT JOIN "Crew" c ON se."crewId" = c.id
      WHERE se."scheduledDate" >= $1 AND se."scheduledDate" <= $2
      ORDER BY se."scheduledDate" ASC
      `,
      now,
      nextWeek
    )

    if (entries.length === 0) {
      return {
        text: 'No scheduled entries for the next week. Would you like me to suggest optimal delivery schedules based on current workload?',
      }
    }

    const byType: Record<string, number> = {}
    entries.forEach((e) => {
      byType[e.entryType] = (byType[e.entryType] || 0) + 1
    })

    const summary = Object.entries(byType)
      .map(([type, count]) => `${count} ${type.toLowerCase()}${count > 1 ? 's' : ''}`)
      .join(', ')

    const entriesList = entries
      .slice(0, 5)
      .map((e) => {
        const scheduledDate = new Date(e.scheduledDate)
        return `• ${e.title} on ${scheduledDate.toLocaleDateString()} (${e.crewName || 'Unassigned'})`
      })
      .join('\n')

    return {
      text: `Here's your upcoming schedule for the next 7 days:\n\n${entriesList}\n\nTotal: ${summary}.\n\nWould you like me to suggest optimizations or reschedule any entries?`,
    }
  } catch (error) {
    console.error('Schedule query error:', error)
    return {
      text: 'I could not retrieve schedule information. Please try again or contact your administrator.',
    }
  }
}

async function handleInvoiceQuery(message: string): Promise<AIResponse> {
  try {
    // Get overdue invoices
    const now = new Date()
    const overdue = await prisma.$queryRawUnsafe<
      Array<{
        id: string
        invoiceNumber: string
        balanceDue: number
        dueDate: string
      }>
    >(
      `
      SELECT
        id,
        "invoiceNumber",
        "balanceDue",
        "dueDate"
      FROM "Invoice"
      WHERE status = 'OVERDUE' AND "dueDate" <= $1
      ORDER BY "dueDate" ASC
      `,
      now
    )

    if (overdue.length === 0) {
      return {
        text: 'Great news! There are no overdue invoices at this time. All accounts are current.',
      }
    }

    const totalOverdue = overdue.reduce((sum, inv) => sum + (inv.balanceDue || 0), 0)
    const oldestDueDate = new Date(overdue[0].dueDate)
    const oldestDays = Math.floor(
      (now.getTime() - oldestDueDate.getTime()) / (1000 * 60 * 60 * 24)
    )

    const invoiceList = overdue
      .slice(0, 5)
      .map((inv) => `• INV-${inv.invoiceNumber}: $${inv.balanceDue.toFixed(2)} (${oldestDays} days overdue)`)
      .join('\n')

    return {
      text: `You have ${overdue.length} overdue invoice${overdue.length > 1 ? 's' : ''} totaling $${totalOverdue.toFixed(2)}:\n\n${invoiceList}\n\nWould you like me to draft reminder emails or suggest collection strategies?`,
    }
  } catch (error) {
    console.error('Invoice query error:', error)
    return {
      text: 'I could not retrieve invoice information. Please try again.',
    }
  }
}

async function handleEmailTemplate(message: string): Promise<AIResponse> {
  const templates = [
    {
      type: 'DELIVERY_CONFIRMATION',
      subject: 'Delivery Scheduled',
      body: 'Dear [Builder Name],\n\nWe are pleased to confirm that your order delivery is scheduled for [Date] at [Time]. Our delivery team will contact you 24 hours before arrival with any additional details.\n\nOrder Number: [Order Number]\nDelivery Address: [Address]\n\nIf you have any questions or need to reschedule, please contact us immediately.\n\nBest regards,\nAbel Lumber Operations',
    },
    {
      type: 'READINESS_CHECK',
      subject: 'T-72 Readiness Check Confirmation',
      body: 'Dear [Builder Name],\n\nWe have completed our T-72 readiness check for your order. All materials and specifications have been verified and are confirmed.\n\nOrder Number: [Order Number]\nTarget Delivery: [Scheduled Date]\n\nPlease confirm that everything looks correct from your end. Contact us if you have any changes.\n\nBest regards,\nAbel Lumber Operations',
    },
    {
      type: 'INVOICE_REMINDER',
      subject: 'Invoice Payment Reminder',
      body: 'Dear [Builder Name],\n\nThis is a friendly reminder that invoice [Invoice Number] in the amount of $[Amount] is now due.\n\nPayment Terms: [Payment Term]\nDue Date: [Due Date]\n\nPlease remit payment at your earliest convenience. If you have already processed payment, please disregard this notice.\n\nThank you,\nAbel Lumber Finance',
    },
  ]

  const template = templates[Math.floor(Math.random() * templates.length)]

  return {
    text: `I've prepared a professional email template for you:\n\n**Subject:** ${template.subject}\n\n${template.body}\n\nWould you like me to customize this template with specific order or builder details?`,
  }
}

async function handleJobReport(message: string): Promise<AIResponse> {
  try {
    const statusCounts = await prisma.$queryRawUnsafe<
      Array<{
        status: string
        count: number
      }>
    >(
      `
      SELECT status, COUNT(*)::int as count
      FROM "Job"
      GROUP BY status
      `
    )

    const summary: Record<string, number> = {}
    statusCounts.forEach((item) => {
      summary[item.status] = item.count
    })

    const activeStatuses = [
      'CREATED',
      'READINESS_CHECK',
      'MATERIALS_LOCKED',
      'IN_PRODUCTION',
      'STAGED',
      'LOADED',
      'IN_TRANSIT',
      'DELIVERED',
      'INSTALLING',
      'PUNCH_LIST',
    ]
    const activeCount = activeStatuses.reduce((sum, s) => sum + (summary[s] || 0), 0)
    const completeCount = summary['COMPLETE'] || 0

    const report = `
📊 **Job Status Report**

**Active Pipeline:** ${activeCount} jobs
  • Readiness Check: ${summary['READINESS_CHECK'] || 0}
  • Materials Locked: ${summary['MATERIALS_LOCKED'] || 0}
  • In Production: ${summary['IN_PRODUCTION'] || 0}
  • Staged: ${summary['STAGED'] || 0}
  • In Transit: ${summary['IN_TRANSIT'] || 0}
  • Delivered: ${summary['DELIVERED'] || 0}
  • Installing: ${summary['INSTALLING'] || 0}

**Completed:** ${completeCount} jobs
**Total:** ${activeCount + completeCount} jobs

Key Insights:
• Focus on moving jobs through readiness checks to maintain momentum
• ${summary['PUNCH_LIST'] || 0} jobs in punch list phase
• Strong completion rate indicates efficient operations

Would you like detailed analysis of any specific stage?
    `.trim()

    return {
      text: report,
    }
  } catch (error) {
    console.error('Job report error:', error)
    return {
      text: 'I could not generate the job report. Please try again.',
    }
  }
}

async function handleInventoryQuery(message: string): Promise<AIResponse> {
  try {
    const products = await prisma.$queryRawUnsafe<
      Array<{
        sku: string
        name: string
        category: string
        inStock: boolean
      }>
    >(
      `
      SELECT sku, name, category, "inStock"
      FROM "Product"
      WHERE active = true
      LIMIT 10
      `
    )

    const inStock = products.filter((p) => p.inStock).length
    const outOfStock = products.filter((p) => !p.inStock).length

    const categories = Array.from(new Set(products.map((p) => p.category)))
    const categorySummary = categories
      .slice(0, 3)
      .map((cat, i) => {
        const count = products.filter((p) => p.category === cat).length
        return `  ${i + 1}. ${cat}: ${count} items`
      })
      .join('\n')

    return {
      text: `📦 **Inventory Status**

Based on ${products.length} products surveyed:
• ${inStock} items in stock
• ${outOfStock} items out of stock or low inventory

Top Categories:
${categorySummary}

Would you like me to:
• Check availability for a specific product or category?
• Show what's low in stock?
• Suggest reorder quantities based on recent sales?`,
    }
  } catch (error) {
    console.error('Inventory query error:', error)
    return {
      text: 'I could not retrieve inventory information. Please try again.',
    }
  }
}

async function handlePerformanceKPI(message: string): Promise<AIResponse> {
  try {
    const jobs = await prisma.$queryRawUnsafe<
      Array<{
        status: string
        createdAt: string
        completedAt: string | null
      }>
    >(
      `
      SELECT status, "createdAt", "completedAt"
      FROM "Job"
      `
    )

    const completed = jobs.filter((j) => j.completedAt)
    let avgDays = 0
    if (completed.length > 0) {
      avgDays =
        completed.reduce((sum, j) => {
          const createdTime = new Date(j.createdAt).getTime()
          const completedTime = new Date(j.completedAt!).getTime()
          const days = (completedTime - createdTime) / (1000 * 60 * 60 * 24)
          return sum + days
        }, 0) / completed.length
    }

    const completionPercent = jobs.length > 0 ? ((completed.length / jobs.length) * 100).toFixed(1) : '0.0'

    return {
      text: `📈 **Performance KPIs**

**Job Metrics:**
• Total Jobs: ${jobs.length}
• Completed: ${completed.length} (${completionPercent}%)
• Average Completion Time: ${avgDays.toFixed(1)} days
• Current Active: ${jobs.length - completed.length}

**Throughput Analysis:**
• Trend: ${completed.length > 5 ? 'Positive - consistent completions' : 'Building'}
• Efficiency: ${avgDays < 14 ? 'Above average' : 'Needs optimization'}

**Recommendations:**
• Focus on jobs stuck in readiness check phase
• Consider load balancing across production teams
• Monitor invoice aging closely

Would you like detailed analysis of any metric?`,
    }
  } catch (error) {
    console.error('Performance query error:', error)
    return {
      text: 'I could not retrieve performance data. Please try again.',
    }
  }
}

async function handleDefaultResponse(message: string): Promise<AIResponse> {
  return {
    text: `I'm your Abel Lumber AI Assistant. I can help with:

📅 **Scheduling** - View upcoming deliveries, suggest optimal schedules, manage crew assignments
💰 **Invoicing** - Analyze overdue invoices, view aging, draft payment reminders
✉️ **Communications** - Draft professional emails to builders and stakeholders
📊 **Reports** - Generate job status reports and performance analytics
📦 **Inventory** - Check material availability and stock levels
🎯 **Workflow** - Identify bottlenecks and suggest improvements

What would you like help with today? Try asking about:
• "Schedule for next week"
• "Overdue invoices"
• "Draft email to builder"
• "Job status report"
• "Material availability"`,
  }
}
