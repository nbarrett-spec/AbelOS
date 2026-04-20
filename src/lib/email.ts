/**
 * Email service for Abel Builder Platform
 *
 * Uses Resend (https://resend.com) for transactional email.
 *
 * Setup:
 *   1. npm install resend
 *   2. Add RESEND_API_KEY to .env
 *   3. Add RESEND_FROM_EMAIL to .env (e.g., "Abel Lumber <quotes@abellumber.com>")
 *   4. Verify your domain in Resend dashboard
 */

import { logger } from './logger'

const RESEND_API_KEY = process.env.RESEND_API_KEY || ''
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'Abel Lumber <noreply@abellumber.com>'
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === 'production' ? 'https://app.abellumber.com' : 'http://localhost:3000')

interface EmailOptions {
  to: string
  subject: string
  html: string
  replyTo?: string
}

/**
 * Send an email via Resend API (or log to console in dev mode)
 */
export async function sendEmail(options: EmailOptions): Promise<{ success: boolean; id?: string; error?: string }> {
  const { to, subject, html, replyTo } = options

  // If no API key, log warning and return failure so callers know email wasn't sent
  if (!RESEND_API_KEY) {
    logger.warn('email_service_not_configured', { to, subject })
    return { success: false, error: 'Email service not configured (RESEND_API_KEY missing)' }
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject,
        html,
        reply_to: replyTo,
      }),
    })

    const data = await res.json()

    if (!res.ok) {
      logger.error('email_send_api_error', data, { to, subject })
      return { success: false, error: data.message || 'Email send failed' }
    }

    return { success: true, id: data.id }
  } catch (error: any) {
    logger.error('email_send_error', error, { to, subject })
    return { success: false, error: error.message }
  }
}

// ─── EMAIL TEMPLATES ──────────────────────────────────────────────────────

const HEADER = `
  <div style="background-color: #3E2A1E; padding: 24px 32px; text-align: left;">
    <table><tr>
      <td style="background-color: #C9822B; border-radius: 8px; width: 36px; height: 36px; text-align: center; vertical-align: middle; font-weight: bold; color: white; font-size: 14px;">AB</td>
      <td style="padding-left: 12px; color: white; font-size: 18px; font-weight: 600;">Abel Lumber</td>
    </tr></table>
  </div>
`

const FOOTER = `
  <div style="padding: 24px 32px; text-align: center; color: #999; font-size: 12px; border-top: 1px solid #eee;">
    <p>Abel Lumber &middot; Door &amp; Trim Specialists</p>
    <p>Gainesville, TX &middot; <a href="${APP_URL}" style="color: #C9822B;">abellumber.com</a></p>
  </div>
`

export function wrap(content: string): string {
  return `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
    <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f5f5f5;">
      <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 8px; overflow: hidden; margin-top: 20px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
        ${HEADER}
        <div style="padding: 32px;">
          ${content}
        </div>
        ${FOOTER}
      </div>
    </body>
    </html>
  `
}

/**
 * Send password reset email
 */
export async function sendPasswordResetEmail(params: {
  to: string
  name: string
  resetUrl: string
}) {
  return sendEmail({
    to: params.to,
    subject: 'Reset Your Abel Builder Password',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Reset Your Password</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.name},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        We received a request to reset your password. Click the button below to create a new one:
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.resetUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.
      </p>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        Can't click the button? Copy and paste this link: <br>
        <a href="${params.resetUrl}" style="color: #C9822B; word-break: break-all;">${params.resetUrl}</a>
      </p>
    `),
  })
}

/**
 * Send employee invitation email
 */
export async function sendInviteEmail(params: {
  to: string
  firstName: string
  inviteUrl: string
}) {
  return sendEmail({
    to: params.to,
    subject: 'Welcome to Abel Lumber — Set Up Your Account',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Welcome to Abel Lumber!</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.firstName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        You've been invited to join the Abel Operations platform. Click below to create your password and review the employee handbook.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.inviteUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Set Up Your Account
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        This invitation link expires in 7 days. If it expires, ask your manager to resend the invite.
      </p>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        Can't click the button? Copy and paste this link: <br>
        <a href="${params.inviteUrl}" style="color: #C9822B; word-break: break-all;">${params.inviteUrl}</a>
      </p>
    `),
  })
}

/**
 * Send staff password reset email (ops portal)
 */
export async function sendStaffPasswordResetEmail(params: {
  to: string
  firstName: string
  resetUrl: string
}) {
  return sendEmail({
    to: params.to,
    subject: 'Abel Lumber — Reset Your Password',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Password Reset</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.firstName}, a password reset was requested for your Abel Operations account.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.resetUrl}" style="background-color: #3E2A1E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Reset Password
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        This link expires in 24 hours. If you didn't request this, you can ignore this email.
      </p>
      <p style="color: #999; font-size: 12px; margin-top: 24px;">
        Can't click the button? Copy and paste this link: <br>
        <a href="${params.resetUrl}" style="color: #C9822B; word-break: break-all;">${params.resetUrl}</a>
      </p>
    `),
  })
}

/**
 * Send quote ready notification to builder
 */
export async function sendQuoteReadyEmail(params: {
  to: string
  builderName: string
  projectName: string
  quoteNumber: string
  total: number
  validUntil: string
  quoteUrl: string
}) {
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.total)
  const formattedDate = new Date(params.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return sendEmail({
    to: params.to,
    subject: `Quote ${params.quoteNumber} Ready — ${params.projectName}`,
    replyTo: 'quotes@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Your Quote is Ready</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Your quote for <strong>${params.projectName}</strong> has been prepared and is ready for review.
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Quote Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.quoteNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Project</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Total</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #3E2A1E;">${formattedTotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Valid Until</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${formattedDate}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.quoteUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          View Quote Details
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        You can review the full itemized breakdown, download a PDF, or approve the quote directly from your dashboard. Questions? Reply to this email or call us at (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send order confirmation to builder
 */
export async function sendOrderConfirmationEmail(params: {
  to: string
  builderName: string
  orderNumber: string
  projectName: string
  total: number
  estimatedDelivery?: string
  orderUrl?: string
}) {
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.total)

  return sendEmail({
    to: params.to,
    subject: `Order ${params.orderNumber} Confirmed — ${params.projectName}`,
    replyTo: 'orders@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Order Confirmed!</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Great news — your order for <strong>${params.projectName}</strong> has been confirmed and is being processed.
      </p>
      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Order Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.orderNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Project</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Total</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #27AE60;">${formattedTotal}</td>
          </tr>
          ${params.estimatedDelivery ? `
          <tr>
            <td style="padding: 6px 0; color: #666;">Est. Delivery</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.estimatedDelivery}</td>
          </tr>
          ` : ''}
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard" style="background-color: #3E2A1E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Track Your Order
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        We'll keep you updated as your order moves through production and delivery. You can check the status anytime from your dashboard.
      </p>
    `),
  })
}

/**
 * Send quote request confirmation to builder
 */
export async function sendQuoteRequestConfirmationEmail(params: {
  to: string
  builderName: string
  referenceNumber: string
  projectName: string
  projectAddress: string
}) {
  return sendEmail({
    to: params.to,
    subject: `Quote Request ${params.referenceNumber} Received`,
    replyTo: 'quotes@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Quote Request Received</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        We've received your quote request and our estimating team is on it. You'll receive a detailed quote within 1-2 business days.
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Reference</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.referenceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Project</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Address</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectAddress}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard/quotes" style="background-color: #3E2A1E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          View Your Requests
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Have questions? Reply to this email or call us at (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send invoice notification to builder
 */
export async function sendInvoiceEmail(params: {
  to: string
  builderName: string
  invoiceNumber: string
  orderNumber: string
  total: number
  dueDate: string
  paymentTerm: string
}) {
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.total)
  const formattedDate = new Date(params.dueDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return sendEmail({
    to: params.to,
    subject: `Invoice ${params.invoiceNumber} — ${formattedTotal} Due ${formattedDate}`,
    replyTo: 'billing@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">New Invoice</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        A new invoice has been generated for your order <strong>${params.orderNumber}</strong>.
      </p>
      <div style="background: #fff8f0; border: 1px solid #f0d0a0; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Invoice Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Order</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.orderNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Amount Due</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #C9822B;">${formattedTotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Due Date</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${formattedDate}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Terms</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.paymentTerm.replace(/_/g, ' ')}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard/invoices" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          View Invoice
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Questions about this invoice? Reply to this email or call our billing team at (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send warranty claim status update to builder
 */
export async function sendWarrantyUpdateEmail(params: {
  to: string
  builderName: string
  claimNumber: string
  subject: string
  oldStatus: string
  newStatus: string
  resolutionNotes?: string
}) {
  const statusColors: Record<string, string> = {
    APPROVED: '#27AE60',
    RESOLVED: '#27AE60',
    IN_PROGRESS: '#2980B9',
    UNDER_REVIEW: '#D9993F',
    INSPECTION_SCHEDULED: '#8E44AD',
    DENIED: '#E74C3C',
    CLOSED: '#95A5A6',
  }
  const color = statusColors[params.newStatus] || '#3E2A1E'
  const displayStatus = params.newStatus.replace(/_/g, ' ')

  return sendEmail({
    to: params.to,
    subject: `Warranty Claim ${params.claimNumber} — ${displayStatus}`,
    replyTo: 'warranty@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Warranty Claim Update</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Your warranty claim has been updated:
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Claim</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.claimNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Subject</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.subject}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Status</td>
            <td style="padding: 6px 0; text-align: right;">
              <span style="background: ${color}; color: white; padding: 4px 12px; border-radius: 12px; font-size: 12px; font-weight: 600;">
                ${displayStatus}
              </span>
            </td>
          </tr>
        </table>
      </div>
      ${params.resolutionNotes ? `
      <div style="background: #f0fdf4; border-left: 4px solid #27AE60; padding: 16px; margin: 16px 0; border-radius: 0 8px 8px 0;">
        <p style="margin: 0; color: #333; font-size: 14px; font-weight: 600;">Resolution Notes:</p>
        <p style="margin: 8px 0 0; color: #555; font-size: 14px; line-height: 1.6;">${params.resolutionNotes}</p>
      </div>
      ` : ''}
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard/warranty" style="background-color: #3E2A1E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          View Claim Details
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Questions? Reply to this email or call us at (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send order status update to builder
 */
export async function sendOrderStatusEmail(params: {
  to: string
  builderName: string
  orderNumber: string
  projectName: string
  newStatus: string
  deliveryDate?: string
}) {
  const statusLabels: Record<string, string> = {
    CONFIRMED: 'Confirmed & Processing',
    IN_PRODUCTION: 'In Production',
    READY_TO_SHIP: 'Ready to Ship',
    SHIPPED: 'Shipped',
    DELIVERED: 'Delivered',
    COMPLETE: 'Complete',
  }
  const label = statusLabels[params.newStatus] || params.newStatus.replace(/_/g, ' ')

  return sendEmail({
    to: params.to,
    subject: `Order ${params.orderNumber} — ${label}`,
    replyTo: 'orders@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Order ${label}</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Your order <strong>${params.orderNumber}</strong> for <strong>${params.projectName}</strong> has been updated.
      </p>
      <div style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="margin: 0; font-size: 24px; font-weight: 700; color: #3E2A1E;">${label}</p>
        ${params.deliveryDate ? `<p style="margin: 8px 0 0; color: #666; font-size: 14px;">Estimated Delivery: ${new Date(params.deliveryDate).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</p>` : ''}
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard" style="background-color: #3E2A1E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Track Your Order
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        We'll keep you updated as your order progresses. Questions? Reply to this email or call (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send warranty claim submission confirmation to builder
 */
export async function sendWarrantyClaimConfirmationEmail(params: {
  to: string
  builderName: string
  claimNumber: string
  subject: string
  type: string
}) {
  return sendEmail({
    to: params.to,
    subject: `Warranty Claim ${params.claimNumber} Submitted`,
    replyTo: 'warranty@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Warranty Claim Received</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.builderName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Your warranty claim has been submitted and our team will review it within 1-2 business days.
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Claim Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.claimNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Subject</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.subject}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Type</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.type.replace(/_/g, ' ')}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard/warranty" style="background-color: #3E2A1E; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          View Your Claims
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        You'll receive updates as the claim progresses. Questions? Reply to this email or call (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send quote follow-up email (Day 3)
 */
export async function sendQuoteFollowUpDay3(params: {
  to: string
  firstName: string
  projectName: string
  quoteNumber: string
  total: number
  quoteUrl: string
}) {
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.total)

  return sendEmail({
    to: params.to,
    subject: `Following up on Quote #${params.quoteNumber} — Abel Lumber`,
    replyTo: 'quotes@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Just Checking In</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.firstName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Just checking in on your quote for <strong>${params.projectName}</strong>. We've got your materials ready to go and would love to help you move forward.
      </p>
      <div style="background: #f8f9fa; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Quote Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.quoteNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Project</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Total</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #3E2A1E;">${formattedTotal}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.quoteUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          View Quote
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Have any questions about the quote? Reply to this email or give us a call at (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send quote follow-up email (Day 7)
 */
export async function sendQuoteFollowUpDay7(params: {
  to: string
  firstName: string
  projectName: string
  quoteNumber: string
  total: number
  validUntil: string
  quoteUrl: string
}) {
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.total)
  const formattedDate = new Date(params.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return sendEmail({
    to: params.to,
    subject: `Your quote expires in 7 days — Abel Lumber`,
    replyTo: 'quotes@abellumber.com',
    html: wrap(`
      <h2 style="color: #C9822B; margin-top: 0;">Quote Expiring Soon</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.firstName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Your quote <strong>#${params.quoteNumber}</strong> is valid until <strong>${formattedDate}</strong>. Lock in these prices before they expire.
      </p>
      <div style="background: #fff8f0; border: 1px solid #f0d0a0; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Quote Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.quoteNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Project</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Total</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #C9822B;">${formattedTotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Valid Until</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${formattedDate}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.quoteUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Review & Approve
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Ready to move forward? Approve the quote now to lock in pricing. Questions? Reply here or call (940) 555-ABEL.
      </p>
    `),
  })
}

/**
 * Send quote expiring email (Last chance)
 */
export async function sendQuoteExpiringEmail(params: {
  to: string
  firstName: string
  projectName: string
  quoteNumber: string
  total: number
  validUntil: string
  quoteUrl: string
}) {
  const formattedTotal = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(params.total)
  const formattedDate = new Date(params.validUntil).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  return sendEmail({
    to: params.to,
    subject: `Last chance: Quote #${params.quoteNumber} expires tomorrow`,
    replyTo: 'quotes@abellumber.com',
    html: wrap(`
      <h2 style="color: #E74C3C; margin-top: 0;">Last Chance to Lock In Pricing</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.firstName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        This is your last chance to lock in pricing on <strong>${params.projectName}</strong>. After <strong>${formattedDate}</strong>, we'll need to requote based on current market pricing.
      </p>
      <div style="background: #fef5f5; border: 1px solid #f5c6c6; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Quote Number</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.quoteNumber}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Project</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.projectName}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Total</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-size: 18px; color: #E74C3C;">${formattedTotal}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Expires</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${formattedDate}</td>
          </tr>
        </table>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${params.quoteUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Approve Now
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        If you'd like to discuss pricing or have questions, reply to this email and we'll be happy to work with you.
      </p>
    `),
  })
}

/**
 * Send application received confirmation to a new builder applicant
 */
export async function sendApplicationReceivedEmail(params: {
  to: string
  contactName: string
  companyName: string
  refNumber: string
}) {
  return sendEmail({
    to: params.to,
    subject: `Application Received — ${params.refNumber}`,
    replyTo: 'sales@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Application Received</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.contactName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Thank you for applying for a builder account with Abel Lumber. We've received your application
        for <strong>${params.companyName}</strong> and our team is reviewing it now.
      </p>
      <div style="background: #f0f7ff; border: 1px solid #d0e4f7; border-radius: 8px; padding: 20px; margin: 24px 0; text-align: center;">
        <p style="color: #666; font-size: 13px; margin: 0 0 4px;">Your Reference Number</p>
        <p style="color: #3E2A1E; font-size: 22px; font-weight: 700; font-family: monospace; margin: 0;">${params.refNumber}</p>
      </div>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        <strong>What happens next:</strong>
      </p>
      <ol style="color: #333; font-size: 14px; line-height: 1.8; padding-left: 20px;">
        <li>Our team reviews your application (typically 1-2 business days)</li>
        <li>You'll receive an email with your login credentials once approved</li>
        <li>Start ordering with AI-powered takeoffs, instant quotes, and flexible terms</li>
      </ol>
      <p style="color: #666; font-size: 13px; line-height: 1.6; margin-top: 24px;">
        Questions? Reply to this email or call us at <strong>(469) 300-0090</strong>.
      </p>
    `),
  })
}

/**
 * Send approval notification to a builder with their credentials
 */
export async function sendApplicationApprovedEmail(params: {
  to: string
  contactName: string
  companyName: string
  tempPassword: string
}) {
  return sendEmail({
    to: params.to,
    subject: `Welcome to Abel Builder — Your Account is Ready`,
    replyTo: 'sales@abellumber.com',
    html: wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Your Account is Approved!</h2>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Hi ${params.contactName},
      </p>
      <p style="color: #333; font-size: 15px; line-height: 1.6;">
        Great news — your builder account for <strong>${params.companyName}</strong> has been approved!
        You can now log in to the Abel Builder Platform.
      </p>
      <div style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; font-size: 14px; color: #333;">
          <tr>
            <td style="padding: 6px 0; color: #666;">Email</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 600;">${params.to}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #666;">Temporary Password</td>
            <td style="padding: 6px 0; text-align: right; font-weight: 700; font-family: monospace; font-size: 16px; color: #3E2A1E;">${params.tempPassword}</td>
          </tr>
        </table>
      </div>
      <p style="color: #E74C3C; font-size: 13px; font-weight: 600;">
        Please change your password after your first login.
      </p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/login" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block;">
          Log In Now
        </a>
      </div>
      <p style="color: #666; font-size: 13px; line-height: 1.6;">
        Need help getting started? Reply to this email and your account manager will reach out.
      </p>
    `),
  })
}

// ─── TEMPLATE REGISTRY ──────────────────────────────────────────────────────
// Central registry of all email templates with metadata for admin/ops preview.

export interface EmailTemplateInfo {
  key: string
  name: string
  description: string
  category: 'auth' | 'sales' | 'ops' | 'billing' | 'warranty' | 'onboarding'
  requiredParams: string[]
}

export const EMAIL_TEMPLATE_REGISTRY: EmailTemplateInfo[] = [
  { key: 'password_reset', name: 'Password Reset', description: 'Builder password reset link', category: 'auth', requiredParams: ['to', 'name', 'resetUrl'] },
  { key: 'invite', name: 'Builder Invite', description: 'New builder account invite', category: 'onboarding', requiredParams: ['to', 'companyName', 'inviteUrl'] },
  { key: 'staff_password_reset', name: 'Staff Password Reset', description: 'Staff password reset link', category: 'auth', requiredParams: ['to', 'name', 'resetUrl'] },
  { key: 'quote_ready', name: 'Quote Ready', description: 'Notification that a new quote is available', category: 'sales', requiredParams: ['to', 'builderName', 'quoteNumber', 'total', 'expiresAt'] },
  { key: 'order_confirmation', name: 'Order Confirmation', description: 'Order placed confirmation with details', category: 'sales', requiredParams: ['to', 'builderName', 'orderNumber', 'total'] },
  { key: 'quote_request_confirmation', name: 'Quote Request Received', description: 'Acknowledgment that a quote request was submitted', category: 'sales', requiredParams: ['to', 'builderName', 'projectName'] },
  { key: 'invoice', name: 'Invoice', description: 'Invoice notification with payment link', category: 'billing', requiredParams: ['to', 'builderName', 'invoiceNumber', 'total', 'dueDate'] },
  { key: 'warranty_update', name: 'Warranty Update', description: 'Warranty claim status change', category: 'warranty', requiredParams: ['to', 'builderName', 'claimNumber', 'status'] },
  { key: 'order_status', name: 'Order Status Update', description: 'Order status change notification', category: 'ops', requiredParams: ['to', 'builderName', 'orderNumber', 'status'] },
  { key: 'warranty_claim_confirmation', name: 'Warranty Claim Filed', description: 'Confirmation that a warranty claim was received', category: 'warranty', requiredParams: ['to', 'builderName', 'claimNumber'] },
  { key: 'quote_followup_day3', name: 'Quote Follow-Up (Day 3)', description: '3-day quote reminder', category: 'sales', requiredParams: ['to', 'builderName', 'quoteNumber', 'total'] },
  { key: 'quote_followup_day7', name: 'Quote Follow-Up (Day 7)', description: '7-day quote final reminder', category: 'sales', requiredParams: ['to', 'builderName', 'quoteNumber', 'total'] },
  { key: 'quote_expiring', name: 'Quote Expiring', description: 'Quote about to expire notification', category: 'sales', requiredParams: ['to', 'builderName', 'quoteNumber', 'expiresAt'] },
  { key: 'application_received', name: 'Application Received', description: 'Builder application acknowledgment', category: 'onboarding', requiredParams: ['to', 'companyName', 'contactName'] },
  { key: 'application_approved', name: 'Application Approved', description: 'Builder application approval with login instructions', category: 'onboarding', requiredParams: ['to', 'companyName', 'contactName'] },
]

/**
 * Generate a preview of an email template with sample data (for admin preview).
 * Returns the rendered HTML without sending.
 */
export function previewTemplate(templateKey: string): string | null {
  const sampleData: Record<string, any> = {
    to: 'preview@example.com',
    name: 'John Smith',
    companyName: 'DFW Custom Homes',
    builderName: 'DFW Custom Homes',
    contactName: 'John Smith',
    resetUrl: `${APP_URL}/reset-password?token=PREVIEW_TOKEN`,
    inviteUrl: `${APP_URL}/signup?invite=PREVIEW_TOKEN`,
    quoteNumber: 'Q-2026-0042',
    orderNumber: 'ORD-2026-0105',
    invoiceNumber: 'INV-2026-0089',
    claimNumber: 'WC-2026-0007',
    total: 8750.00,
    expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
    dueDate: new Date(Date.now() + 30 * 86400000).toISOString(),
    status: 'IN_PRODUCTION',
    projectName: 'Lakewood Estates Phase 2',
  }

  const templates: Record<string, () => string> = {
    password_reset: () => wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Reset Your Password</h2>
      <p>Hi ${sampleData.name},</p>
      <p>Click below to reset your password. This link expires in 1 hour.</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${sampleData.resetUrl}" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Reset Password
        </a>
      </div>
    `),
    quote_ready: () => wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Your Quote Is Ready</h2>
      <p>Hi ${sampleData.builderName},</p>
      <p>Quote <strong>${sampleData.quoteNumber}</strong> is ready for your review.</p>
      <p style="font-size: 24px; font-weight: bold; color: #3E2A1E;">$${sampleData.total.toLocaleString()}</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard/quotes" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          View Quote
        </a>
      </div>
    `),
    order_confirmation: () => wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Order Confirmed</h2>
      <p>Hi ${sampleData.builderName},</p>
      <p>Your order <strong>${sampleData.orderNumber}</strong> has been received and confirmed.</p>
      <p style="font-size: 24px; font-weight: bold; color: #3E2A1E;">$${sampleData.total.toLocaleString()}</p>
    `),
    invoice: () => wrap(`
      <h2 style="color: #3E2A1E; margin-top: 0;">Invoice ${sampleData.invoiceNumber}</h2>
      <p>Hi ${sampleData.builderName},</p>
      <p>A new invoice for <strong>$${sampleData.total.toLocaleString()}</strong> is ready.</p>
      <p>Due: ${new Date(sampleData.dueDate).toLocaleDateString()}</p>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${APP_URL}/dashboard/payments" style="background-color: #C9822B; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
          Pay Now
        </a>
      </div>
    `),
  }

  const generator = templates[templateKey]
  return generator ? generator() : null
}

/**
 * Get all templates by category.
 */
export function getTemplatesByCategory(): Record<string, EmailTemplateInfo[]> {
  const grouped: Record<string, EmailTemplateInfo[]> = {}
  for (const tmpl of EMAIL_TEMPLATE_REGISTRY) {
    if (!grouped[tmpl.category]) grouped[tmpl.category] = []
    grouped[tmpl.category].push(tmpl)
  }
  return grouped
}
