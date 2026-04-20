import { prisma } from '@/lib/prisma'

export async function createNotification(params: {
  staffId: string
  type?: string // Valid NotificationType: JOB_UPDATE, TASK_ASSIGNED, MESSAGE, PO_APPROVAL, DELIVERY_UPDATE, QC_ALERT, INVOICE_OVERDUE, SCHEDULE_CHANGE, SYSTEM
  title: string
  message?: string
  link?: string
}) {
  const id = 'ntf' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  await prisma.$queryRawUnsafe(
    `INSERT INTO "Notification" ("id", "staffId", "type", "title", "body", "link", "read", "createdAt")
     VALUES ($1, $2, $3::"NotificationType", $4, $5, $6, false, NOW())`,
    id,
    params.staffId,
    params.type || 'SYSTEM',
    params.title,
    params.message || null,
    params.link || null
  )
  return id
}

/**
 * Builder notification system for email queue and in-app notifications
 * Handles events: quote_ready, order_confirmed, order_shipped, order_delivered, 
 * invoice_created, invoice_overdue, payment_received, warranty_update
 */

export interface NotificationEvent {
  type: string
  builderId: string
  title: string
  message: string
  email?: {
    to: string
    subject: string
    html: string
  }
  link?: string
}

/**
 * Ensure notification tables exist in the database
 */
async function ensureNotificationTables() {
  try {
    // Create Notification table if it doesn't exist (may have different schema than staff notifications)
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BuilderNotification" (
        id TEXT PRIMARY KEY,
        "builderId" TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        link TEXT,
        read BOOLEAN DEFAULT FALSE,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    // Create index on builderId for faster queries
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_builder_notification_builder" ON "BuilderNotification"("builderId")`
    )

    // Create EmailQueue table if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "EmailQueue" (
        id TEXT PRIMARY KEY,
        "toEmail" TEXT NOT NULL,
        subject TEXT NOT NULL,
        "htmlBody" TEXT,
        status TEXT DEFAULT 'PENDING',
        "sentAt" TIMESTAMP WITH TIME ZONE,
        error TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `)

    // Create index on status for queue processing
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "idx_email_queue_status" ON "EmailQueue"(status)`
    )
  } catch (error) {
    console.error('Error ensuring builder notification tables:', error)
  }
}

/**
 * Send a notification event for builders
 * Creates both in-app notification and queues email if provided
 */
export async function sendBuilderNotification(event: NotificationEvent) {
  try {
    await ensureNotificationTables()

    const notifId = 'notif_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // Create in-app notification
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderNotification" (id, "builderId", type, title, message, link, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())`,
      notifId,
      event.builderId,
      event.type,
      event.title,
      event.message,
      event.link || null
    )

    // Queue email if provided
    if (event.email) {
      const emailId = 'email_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
      await prisma.$executeRawUnsafe(
        `INSERT INTO "EmailQueue" (id, "toEmail", subject, "htmlBody", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        emailId,
        event.email.to,
        event.email.subject,
        event.email.html
      )
    }

    return { success: true, notificationId: notifId }
  } catch (error) {
    console.error('Builder notification dispatch error:', error)
    return { success: false, error }
  }
}

/**
 * HTML email template wrapper with Abel branding
 */
function emailTemplate(content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        <!-- Header -->
        <div style="background-color: #3E2A1E; padding: 24px 32px; text-align: left;">
          <table style="border-collapse: collapse;">
            <tr>
              <td style="background-color: #C9822B; border-radius: 8px; width: 36px; height: 36px; text-align: center; vertical-align: middle; font-weight: bold; color: white; font-size: 14px;">AB</td>
              <td style="padding-left: 12px; color: white; font-size: 18px; font-weight: 600;">Abel Lumber</td>
            </tr>
          </table>
        </div>

        <!-- Content -->
        <div style="padding: 32px;">
          ${content}
        </div>

        <!-- Footer -->
        <div style="padding: 24px 32px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee;">
          <p>Abel Lumber &middot; Door &amp; Trim Specialists</p>
          <p>Gainesville, TX &middot; <a href="https://abellumber.com" style="color: #C9822B; text-decoration: none;">abellumber.com</a></p>
        </div>
      </div>
    </body>
    </html>
  `
}

/**
 * Notify when a quote is ready for a builder
 */
export async function notifyQuoteReady(
  builderId: string,
  builderEmail: string,
  quoteNumber: string,
  projectName: string,
  total: number
) {
  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Your Quote is Ready</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      Your quote for <strong>${projectName}</strong> has been prepared and is ready for review.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Quote #${quoteNumber}</strong></p>
      <p style="margin: 0 0 8px 0;">Project: ${projectName}</p>
      <p style="margin: 0; font-size: 18px; color: #3E2A1E;"><strong>Total: $${total.toFixed(2)}</strong></p>
    </div>
    <p style="color: #333; line-height: 1.6;">
      Log in to your account to review the quote and place an order.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/quotes" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Quote</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'quote_ready',
    builderId,
    title: 'Quote Ready',
    message: `Quote #${quoteNumber} for ${projectName} is ready`,
    email: {
      to: builderEmail,
      subject: `Your Quote #${quoteNumber} is Ready`,
      html,
    },
    link: `/dashboard/quotes`,
  })
}

/**
 * Notify when an order is confirmed
 */
export async function notifyOrderConfirmed(
  builderId: string,
  builderEmail: string,
  orderNumber: string,
  projectName: string,
  total: number,
  itemCount: number
) {
  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Order Confirmed</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      Your order has been confirmed and we're preparing it for shipment.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
      <p style="margin: 0 0 8px 0;">Project: ${projectName}</p>
      <p style="margin: 0 0 8px 0;">Items: ${itemCount}</p>
      <p style="margin: 0; font-size: 18px; color: #3E2A1E;"><strong>Total: $${total.toFixed(2)}</strong></p>
    </div>
    <p style="color: #333; line-height: 1.6;">
      We'll notify you when your items are ready to ship. You can track your order status in your account at any time.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/orders" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">Track Order</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'order_confirmed',
    builderId,
    title: 'Order Confirmed',
    message: `Order #${orderNumber} has been confirmed`,
    email: {
      to: builderEmail,
      subject: `Order #${orderNumber} Confirmed`,
      html,
    },
    link: `/dashboard/orders`,
  })
}

/**
 * Notify when an order is shipped
 */
export async function notifyOrderShipped(
  builderId: string,
  builderEmail: string,
  orderNumber: string,
  projectName: string,
  trackingNumber?: string
) {
  const trackingHtml = trackingNumber
    ? `<p style="margin: 0 0 8px 0;">Tracking #: <strong>${trackingNumber}</strong></p>`
    : ''

  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Order Shipped</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      Your order has been shipped! Your items are on the way.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
      <p style="margin: 0 0 8px 0;">Project: ${projectName}</p>
      ${trackingHtml}
    </div>
    <p style="color: #333; line-height: 1.6;">
      Track your shipment in your account to see estimated delivery date.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/deliveries" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">Track Shipment</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'order_shipped',
    builderId,
    title: 'Order Shipped',
    message: `Order #${orderNumber} has been shipped`,
    email: {
      to: builderEmail,
      subject: `Order #${orderNumber} Has Shipped`,
      html,
    },
    link: `/dashboard/deliveries`,
  })
}

/**
 * Notify when an order is delivered
 */
export async function notifyOrderDelivered(
  builderId: string,
  builderEmail: string,
  orderNumber: string,
  projectName: string
) {
  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Order Delivered</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      Your order has been delivered! Thank you for your business.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Order #${orderNumber}</strong></p>
      <p style="margin: 0;">Project: ${projectName}</p>
    </div>
    <p style="color: #333; line-height: 1.6;">
      If you have any questions about your order or need anything else, please don't hesitate to reach out.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/orders" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Order</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'order_delivered',
    builderId,
    title: 'Order Delivered',
    message: `Order #${orderNumber} has been delivered`,
    email: {
      to: builderEmail,
      subject: `Order #${orderNumber} Delivered`,
      html,
    },
    link: `/dashboard/orders`,
  })
}

/**
 * Notify when an invoice is created
 */
export async function notifyInvoiceCreated(
  builderId: string,
  builderEmail: string,
  invoiceNumber: string,
  total: number,
  dueDate: string
) {
  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Invoice Created</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      A new invoice has been created for your account.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Invoice #${invoiceNumber}</strong></p>
      <p style="margin: 0 0 8px 0;">Amount Due: <strong style="color: #3E2A1E;">$${total.toFixed(2)}</strong></p>
      <p style="margin: 0;">Due Date: ${dueDate}</p>
    </div>
    <p style="color: #333; line-height: 1.6;">
      View the invoice details in your account to see itemized charges and payment options.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/invoices" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Invoice</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'invoice_created',
    builderId,
    title: 'Invoice Created',
    message: `Invoice #${invoiceNumber} created for $${total.toFixed(2)}`,
    email: {
      to: builderEmail,
      subject: `Invoice #${invoiceNumber} - $${total.toFixed(2)}`,
      html,
    },
    link: `/dashboard/invoices`,
  })
}

/**
 * Notify when an invoice is overdue
 */
export async function notifyInvoiceOverdue(
  builderId: string,
  builderEmail: string,
  invoiceNumber: string,
  total: number,
  daysOverdue: number
) {
  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Invoice Overdue</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      We noticed that an invoice on your account is now overdue.
    </p>
    <div style="background-color: #fff3cd; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Invoice #${invoiceNumber}</strong></p>
      <p style="margin: 0 0 8px 0;">Amount Due: <strong style="color: #3E2A1E;">$${total.toFixed(2)}</strong></p>
      <p style="margin: 0; color: #C9822B;"><strong>${daysOverdue} days overdue</strong></p>
    </div>
    <p style="color: #333; line-height: 1.6;">
      Please submit payment as soon as possible. If payment has already been sent, please disregard this notice.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/invoices" style="background-color: #C9822B; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">Pay Now</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'invoice_overdue',
    builderId,
    title: 'Invoice Overdue',
    message: `Invoice #${invoiceNumber} is ${daysOverdue} days overdue`,
    email: {
      to: builderEmail,
      subject: `⚠ Invoice #${invoiceNumber} is Overdue`,
      html,
    },
    link: `/dashboard/invoices`,
  })
}

/**
 * Notify when a payment is received
 */
export async function notifyPaymentReceived(
  builderId: string,
  builderEmail: string,
  amount: number,
  paymentMethod: string,
  invoiceNumber?: string
) {
  const invoiceHtml = invoiceNumber ? `<p style="margin: 0;">Invoice #: ${invoiceNumber}</p>` : ''

  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Payment Received</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      We've received your payment. Thank you!
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Amount Received</strong></p>
      <p style="margin: 0 0 8px 0; font-size: 18px; color: #3E2A1E;"><strong>$${amount.toFixed(2)}</strong></p>
      <p style="margin: 0 0 8px 0;">Method: ${paymentMethod}</p>
      ${invoiceHtml}
    </div>
    <p style="color: #333; line-height: 1.6;">
      Your payment has been applied to your account. View your account details for payment history.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/invoices" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Account</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'payment_received',
    builderId,
    title: 'Payment Received',
    message: `Payment of $${amount.toFixed(2)} has been received`,
    email: {
      to: builderEmail,
      subject: `Payment Received - $${amount.toFixed(2)}`,
      html,
    },
    link: `/dashboard/invoices`,
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Automated Delivery Notifications
// Triggered by delivery status changes in the crew/ops workflow
// ──────────────────────────────────────────────────────────────────────────

const DELIVERY_STATUS_TO_EVENT: Record<string, { type: string; title: (dn: string) => string; msg: (dn: string, addr: string) => string }> = {
  SCHEDULED:   { type: 'delivery_scheduled',   title: (dn) => `Delivery ${dn} Scheduled`,           msg: (dn, addr) => `Delivery ${dn} has been scheduled for ${addr}` },
  LOADING:     { type: 'delivery_loading',      title: (dn) => `Truck Loading — ${dn}`,             msg: (dn) => `Your delivery ${dn} is being loaded onto the truck` },
  IN_TRANSIT:  { type: 'delivery_in_transit',   title: (dn) => `On the Way — ${dn}`,                msg: (dn) => `Your delivery ${dn} is on the way! Please ensure site access.` },
  ARRIVED:     { type: 'delivery_arrived',      title: (dn) => `Truck Arrived — ${dn}`,             msg: (dn) => `The truck for delivery ${dn} has arrived at your job site` },
  COMPLETE:    { type: 'delivery_complete',     title: (dn) => `Delivery Complete — ${dn}`,         msg: (dn) => `Delivery ${dn} has been completed. Check your portal for details.` },
  RESCHEDULED: { type: 'delivery_rescheduled',  title: (dn) => `Delivery Rescheduled — ${dn}`,      msg: (dn) => `Delivery ${dn} has been rescheduled. Check your portal for the new date.` },
}

/**
 * Auto-notify builder when a delivery status changes.
 * Call this from any endpoint that updates Delivery.status.
 */
export async function notifyDeliveryStatusChange(
  deliveryId: string,
  newStatus: string,
  extraData?: Record<string, any>
): Promise<{ sent: boolean } | null> {
  const event = DELIVERY_STATUS_TO_EVENT[newStatus]
  if (!event) return null

  try {
    const rows: any[] = await prisma.$queryRawUnsafe(`
      SELECT d."deliveryNumber", d."scheduledDate", d.address, d."signedBy", d."damageNotes", d.notes,
             j."jobNumber", j.community, j."lotBlock",
             b.id as "builderId", b."companyName" as "builderName", b.email, b.phone
      FROM "Delivery" d
      JOIN "Job" j ON d."jobId" = j.id
      JOIN "Builder" b ON j."builderId" = b.id
      WHERE d.id = $1
    `, deliveryId)

    if (rows.length === 0) return null
    const r = rows[0]
    const dn = r.deliveryNumber || deliveryId.slice(0, 8)
    const addr = r.address || r.community || 'your job site'

    // Build the notification email
    const details: string[] = []
    if (r.scheduledDate) details.push(`📅 Date: ${new Date(r.scheduledDate).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`)
    if (r.address) details.push(`📍 Address: ${r.address}`)
    if (r.jobNumber) details.push(`🏗️ Job: ${r.jobNumber}${r.community ? ` — ${r.community}` : ''}${r.lotBlock ? ` Lot ${r.lotBlock}` : ''}`)
    if (newStatus === 'COMPLETE' && r.signedBy) details.push(`✍️ Signed by: ${r.signedBy}`)
    if (r.damageNotes && newStatus === 'COMPLETE') details.push(`⚠️ Notes: ${r.damageNotes}`)
    if (extraData?.reason) details.push(`📝 Reason: ${extraData.reason}`)
    if (extraData?.newDate) details.push(`📅 New date: ${extraData.newDate}`)

    const detailsHtml = details.length > 0
      ? `<div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">${details.map(d => `<p style="margin: 4px 0;">${d}</p>`).join('')}</div>`
      : ''

    const statusLabels: Record<string, string> = {
      SCHEDULED: 'has been scheduled',
      LOADING: 'is being loaded onto the truck',
      IN_TRANSIT: 'is on the way to your job site',
      ARRIVED: 'truck has arrived at the site',
      COMPLETE: 'has been completed successfully',
      RESCHEDULED: 'has been rescheduled',
    }

    const html = emailTemplate(`
      <h2 style="color: #3E2A1E; margin-top: 0;">${event.title(dn)}</h2>
      <p style="color: #333; line-height: 1.6;">
        Hi ${r.builderName},<br><br>
        Your delivery <strong>${dn}</strong> ${statusLabels[newStatus] || 'has been updated'}.
      </p>
      ${detailsHtml}
      <p style="color: #333; line-height: 1.6;">
        ${newStatus === 'IN_TRANSIT' ? 'Please ensure the job site is accessible for unloading.' : ''}
        ${newStatus === 'COMPLETE' ? 'View delivery photos and details in your Builder Portal.' : ''}
        ${newStatus === 'RESCHEDULED' ? 'We apologize for any inconvenience.' : ''}
      </p>
      <div style="text-align: center; margin-top: 24px;">
        <a href="https://abellumber.com/dashboard/deliveries" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Delivery</a>
      </div>
    `)

    const result = await sendBuilderNotification({
      type: event.type,
      builderId: r.builderId,
      title: event.title(dn),
      message: event.msg(dn, addr),
      email: {
        to: r.email,
        subject: event.title(dn),
        html,
      },
      link: '/dashboard/deliveries',
    })

    // console.log(`[DELIVERY NOTIFICATION] ${newStatus} → ${r.email}: ${event.title(dn)}`)
    return { sent: result.success }
  } catch (e: any) {
    console.error('[DELIVERY NOTIFICATION ERROR]', e.message)
    return null
  }
}

/**
 * Notify when a warranty claim status changes
 */
export async function notifyWarrantyUpdate(
  builderId: string,
  builderEmail: string,
  claimNumber: string,
  status: string,
  message: string
) {
  const statusLabel = status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
  const statusColor = status === 'APPROVED' ? '#3E2A1E' : status === 'REJECTED' ? '#C9822B' : '#999'

  const html = emailTemplate(`
    <h2 style="color: #3E2A1E; margin-top: 0;">Warranty Claim Update</h2>
    <p style="color: #333; line-height: 1.6;">
      Hi there,<br><br>
      There's an update on your warranty claim.
    </p>
    <div style="background-color: #f9f9f9; border-left: 4px solid #C9822B; padding: 16px; margin: 20px 0;">
      <p style="margin: 0 0 8px 0;"><strong>Claim #${claimNumber}</strong></p>
      <p style="margin: 0 0 12px 0;">
        Status: <strong style="color: ${statusColor};">${statusLabel}</strong>
      </p>
      <p style="margin: 0; color: #555; line-height: 1.6;">${message}</p>
    </div>
    <p style="color: #333; line-height: 1.6;">
      For more details, please check your warranty claims page.
    </p>
    <div style="text-align: center; margin-top: 24px;">
      <a href="https://abellumber.com/dashboard/warranty" style="background-color: #3E2A1E; color: white; padding: 12px 28px; text-decoration: none; border-radius: 6px; font-weight: 600;">View Claim</a>
    </div>
  `)

  return sendBuilderNotification({
    type: 'warranty_update',
    builderId,
    title: `Warranty Claim ${statusLabel}`,
    message: `Warranty claim #${claimNumber} has been ${statusLabel.toLowerCase()}`,
    email: {
      to: builderEmail,
      subject: `Warranty Claim #${claimNumber} - ${statusLabel}`,
      html,
    },
    link: `/dashboard/warranty`,
  })
}
