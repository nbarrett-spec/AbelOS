export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

interface Template {
  type: string
  subject: string
  body: string
  variables: string[]
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const jobId = searchParams.get('jobId')

    const templates: Record<string, Template> = {
      DELIVERY_CONFIRMATION: {
        type: 'DELIVERY_CONFIRMATION',
        subject: 'Your Delivery is Scheduled',
        body: `Dear [Builder Name],

We are pleased to confirm that your delivery for [Job] is scheduled for [Delivery Date] at [Delivery Time].

**Delivery Details:**
Job Number: [Job Number]
Delivery Address: [Address]
Order Number: [Order Number]
Estimated Delivery Window: [Delivery Time]

Our delivery team will contact you 24 hours before arrival to confirm access and any specific delivery instructions.

If you have any questions or need to reschedule, please contact us immediately at [Contact Number].

Best regards,
Abel Lumber Operations Team`,
        variables: ['Builder Name', 'Job', 'Delivery Date', 'Delivery Time', 'Job Number', 'Address', 'Order Number', 'Contact Number'],
      },

      READINESS_CHECK: {
        type: 'READINESS_CHECK',
        subject: 'T-72 Readiness Check Complete',
        body: `Dear [Builder Name],

We have completed our T-72 readiness check for your order. All materials and specifications have been verified and confirmed accurate.

**Order Details:**
Job Number: [Job Number]
Order Number: [Order Number]
Target Delivery: [Scheduled Date]
Verification Date: [Check Date]

All items have been confirmed against your specifications and are ready for production scheduling. We will proceed to T-48 materials locking and staging in the coming days.

If you have any changes or questions about your order, please contact us immediately.

Best regards,
Abel Lumber Operations Team`,
        variables: ['Builder Name', 'Job Number', 'Order Number', 'Scheduled Date', 'Check Date'],
      },

      INVOICE_REMINDER: {
        type: 'INVOICE_REMINDER',
        subject: 'Payment Reminder: Invoice [Invoice Number] Now Due',
        body: `Dear [Builder Name],

This is a friendly reminder that the following invoice is now due:

**Invoice Details:**
Invoice Number: [Invoice Number]
Invoice Amount: $[Amount]
Due Date: [Due Date]
Days Outstanding: [Days]

Payment Terms: [Payment Term]
Remittance Address: [Remittance Address]

Please remit payment at your earliest convenience. If you have already processed this payment, please disregard this notice and accept our thanks.

For payment questions or to arrange alternative payment arrangements, please contact our Finance Team at [Finance Contact].

Thank you for your business.

Best regards,
Abel Lumber Finance Team`,
        variables: ['Builder Name', 'Invoice Number', 'Amount', 'Due Date', 'Days', 'Payment Term', 'Remittance Address', 'Finance Contact'],
      },

      COMPLETION_NOTICE: {
        type: 'COMPLETION_NOTICE',
        subject: 'Job Completion Notice: [Job Number]',
        body: `Dear [Builder Name],

We are pleased to confirm that job [Job Number] has been completed and all work has been finalized.

**Completion Details:**
Job Number: [Job Number]
Builder: [Builder Name]
Site Address: [Job Address]
Completion Date: [Completion Date]
Final Invoice: [Invoice Number]

All items have been delivered and installed according to your specifications. Any punch list items have been addressed and verified.

Thank you for choosing Abel Lumber. We appreciate your business and look forward to working with you on future projects.

If you have any questions or concerns, please don't hesitate to contact us.

Best regards,
Abel Lumber Operations Team`,
        variables: ['Builder Name', 'Job Number', 'Job Address', 'Completion Date', 'Invoice Number'],
      },

      SCHEDULE_CHANGE: {
        type: 'SCHEDULE_CHANGE',
        subject: 'Schedule Change Notification: [Job Number]',
        body: `Dear [Builder Name],

We need to notify you of a scheduling change for your order.

**Change Details:**
Job Number: [Job Number]
Original Date: [Original Date]
New Scheduled Date: [New Date]
Reason: [Reason]

We apologize for any inconvenience this may cause. The new date represents an optimal delivery window based on production scheduling and crew availability.

If the new date does not work for you, please contact us immediately so we can discuss alternative options.

Thank you for your flexibility and continued partnership.

Best regards,
Abel Lumber Operations Team`,
        variables: ['Builder Name', 'Job Number', 'Original Date', 'New Date', 'Reason'],
      },
    }

    // If specific template requested
    if (type && templates[type]) {
      let template = templates[type]

      // If jobId provided, try to populate real data
      if (jobId) {
        try {
          const job = await prisma.$queryRawUnsafe<
            Array<{
              id: string
              jobNumber: string
              builderName: string
              jobAddress: string | null
            }>
          >(
            `
            SELECT id, "jobNumber", "builderName", "jobAddress"
            FROM "Job"
            WHERE id = $1
            `,
            jobId
          )

          if (job && job.length > 0) {
            const jobData = job[0]
            const scheduleEntry = await prisma.$queryRawUnsafe<
              Array<{
                scheduledDate: string
              }>
            >(
              `
              SELECT "scheduledDate"
              FROM "ScheduleEntry"
              WHERE "jobId" = $1
              ORDER BY "scheduledDate" DESC
              LIMIT 1
              `,
              jobId
            )

            const nextSchedule = scheduleEntry && scheduleEntry.length > 0 ? new Date(scheduleEntry[0].scheduledDate) : null

            template = {
              ...template,
              body: template.body
                .replace('[Job]', `#${jobData.jobNumber}`)
                .replace('[Job Number]', jobData.jobNumber)
                .replace('[Builder Name]', jobData.builderName)
                .replace('[Address]', jobData.jobAddress || 'TBD')
                .replace(
                  '[Delivery Date]',
                  nextSchedule ? nextSchedule.toLocaleDateString() : 'TBD'
                ),
            }
          }
        } catch (dbError) {
          console.error('Error fetching job data for template:', dbError)
          // Continue with template as-is if query fails
        }
      }

      return NextResponse.json({ template })
    }

    // Return all templates
    return NextResponse.json({
      templates: Object.values(templates),
      count: Object.keys(templates).length,
    })
  } catch (error) {
    console.error('Template retrieval error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve templates' },
      { status: 500 }
    )
  }
}
