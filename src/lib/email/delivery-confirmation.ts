/**
 * Delivery Confirmation email
 *
 * Auto-sent to the Builder contact email when a Delivery transitions to
 * COMPLETE (full complete only — partial deliveries wait for the follow-up).
 *
 * Why this exists: cheapest retention signal we have. The truck has left
 * the site, the builder's super is already onto the next task, and the
 * photos + signature tell them "it went right." No oversell. Factual and
 * complete — tone per memory/brand/voice.md.
 *
 * Idempotency lives in sendDeliveryConfirmation() via the
 * Delivery.confirmationSentAt column (added ALTER-TABLE style — we don't
 * touch schema.prisma per the current scope rules).
 *
 * Photos: the driver PWA resizes capture shots to 1280px / q=0.7 and we
 * store them inline in Delivery.notes under a [PROOF-JSON] sentinel until
 * blob storage lands. We read them from there and inline them as data
 * URLs in the HTML email body. 3–5 photos keeps the message under most
 * mailbox size limits even at ~150–250KB each.
 */

import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { sendEmail, wrap } from '@/lib/email'

const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.NODE_ENV === 'production'
    ? 'https://app.abellumber.com'
    : 'http://localhost:3000')

// How many photos we inline in the email. More = better "proof," but
// body size creeps up fast at 250KB each. 5 hits the brand-voice sweet
// spot (factual, complete, not overwhelming) without fattening the MIME.
const MAX_PHOTOS = 5

let columnEnsured = false

/** Add Delivery.confirmationSentAt column if missing — no-op after first run. */
async function ensureColumn(): Promise<void> {
  if (columnEnsured) return
  try {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "confirmationSentAt" TIMESTAMPTZ`,
    )
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "Delivery" ADD COLUMN IF NOT EXISTS "confirmationSentTo" TEXT`,
    )
    columnEnsured = true
  } catch (e) {
    // Log but don't throw — the read below will still succeed with NULLs if
    // the column already exists from a prior deploy or a manual migration.
    logger.warn('delivery_confirmation_alter_table_failed', { err: (e as any)?.message })
  }
}

// ─── Proof-blob decoder ─────────────────────────────────────────────────
// The driver PWA packs a JSON blob into Delivery.notes under [PROOF-JSON]:
//   notes starts like: "[DRIVER]: ...\n[PROOF-JSON]: { ...json... }"
// Pull it out without being fragile to extra \n inside the JSON.
interface ProofBlob {
  capturedAt?: string
  recipientName?: string | null
  deliveredBy?: string | null
  partialComplete?: boolean
  damagedItems?: string[]
  photosCount?: number
  hasSignature?: boolean
  signatureDataUrl?: string | null
  photos?: string[]
}

function parseProofBlob(notes: string | null): ProofBlob | null {
  if (!notes) return null
  const marker = '[PROOF-JSON]:'
  const ix = notes.lastIndexOf(marker)
  if (ix < 0) return null
  const raw = notes.slice(ix + marker.length).trim()
  // Proof blob runs to end-of-notes (driver-complete writes it last).
  try {
    return JSON.parse(raw) as ProofBlob
  } catch {
    // Sometimes notes get appended to after PROOF-JSON (e.g. a [FAILED]
    // marker on reschedule). Trim to the last closing brace we can find.
    const close = raw.lastIndexOf('}')
    if (close > 0) {
      try {
        return JSON.parse(raw.slice(0, close + 1)) as ProofBlob
      } catch {
        return null
      }
    }
    return null
  }
}

// ─── Data gather ────────────────────────────────────────────────────────
interface DeliveryEmailContext {
  deliveryId: string
  deliveryNumber: string
  completedAt: Date | null
  address: string
  builderEmail: string | null
  builderName: string
  contactName: string | null
  jobNumber: string
  orderNumber: string | null
  driverName: string | null
  recipientName: string | null
  driverNotes: string | null
  damagedItems: string[]
  photos: string[]
  signatureDataUrl: string | null
  alreadySentAt: Date | null
  alreadySentTo: string | null
}

async function gatherContext(deliveryId: string): Promise<DeliveryEmailContext | null> {
  await ensureColumn()

  const rows: any[] = await prisma.$queryRawUnsafe(
    `SELECT d."id", d."deliveryNumber", d."completedAt", d."address", d."notes",
            d."signedBy", d."confirmationSentAt", d."confirmationSentTo",
            j."jobNumber",
            o."orderNumber",
            b."email"       AS "builderEmail",
            b."companyName" AS "builderName",
            b."contactName" AS "contactName"
       FROM "Delivery" d
  LEFT JOIN "Job"     j ON j."id" = d."jobId"
  LEFT JOIN "Order"   o ON o."id" = j."orderId"
  LEFT JOIN "Builder" b ON b."id" = o."builderId"
      WHERE d."id" = $1
      LIMIT 1`,
    deliveryId,
  )
  if (rows.length === 0) return null
  const r = rows[0]
  const proof = parseProofBlob(r.notes) ?? {}

  // Driver notes live under [DRIVER]: marker in the same notes field.
  // We want everything up to the next [MARKER] (or end of string). Since the
  // /s flag isn't available on our target, match with [\s\S] instead to let
  // "." span newlines. Drivers rarely include [ inside their note text, so
  // the negative lookahead on "\n[" is safe in practice.
  let driverNotes: string | null = null
  if (typeof r.notes === 'string') {
    const m = r.notes.match(/\[DRIVER\]:\s*([\s\S]+?)(?=\n\[|$)/)
    if (m) driverNotes = m[1].trim()
  }

  return {
    deliveryId: r.id,
    deliveryNumber: r.deliveryNumber,
    completedAt: r.completedAt ? new Date(r.completedAt) : null,
    address: r.address || 'site',
    builderEmail: r.builderEmail || null,
    builderName: r.builderName || 'the builder',
    contactName: r.contactName || null,
    jobNumber: r.jobNumber || '—',
    orderNumber: r.orderNumber || null,
    driverName: proof.deliveredBy || null,
    recipientName: proof.recipientName || r.signedBy || null,
    driverNotes,
    damagedItems: Array.isArray(proof.damagedItems) ? proof.damagedItems : [],
    photos: Array.isArray(proof.photos) ? proof.photos.slice(0, MAX_PHOTOS) : [],
    signatureDataUrl: proof.signatureDataUrl || null,
    alreadySentAt: r.confirmationSentAt ? new Date(r.confirmationSentAt) : null,
    alreadySentTo: r.confirmationSentTo || null,
  }
}

// ─── HTML render ────────────────────────────────────────────────────────
function renderHtml(ctx: DeliveryEmailContext): string {
  const when = ctx.completedAt
    ? ctx.completedAt.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'today'
  const dateStr = ctx.completedAt
    ? ctx.completedAt.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    : ''

  const receiptUrl = `${APP_URL}/dashboard/deliveries/track/${ctx.deliveryId}`
  const firstName = ctx.contactName?.split(/\s+/)[0] || ctx.builderName

  // Photo strip — three-per-row at 180px. Inline as <img src="data:..."> if
  // data URL, otherwise as URL (in case a future Blob upload replaced it).
  const photoCells = ctx.photos
    .map(
      (src) => `
        <td style="padding:4px;vertical-align:top;">
          <img src="${escapeAttr(src)}" alt="Site photo" width="180"
               style="width:180px;max-width:100%;height:auto;border-radius:8px;display:block;border:1px solid #e5e7eb;" />
        </td>`,
    )
    .join('')
  const photoStrip =
    ctx.photos.length > 0
      ? `<table role="presentation" style="border-collapse:collapse;margin:16px 0;">
           <tr>${photoCells}</tr>
         </table>`
      : ''

  const damageLine =
    ctx.damagedItems.length > 0
      ? `<p style="color:#b91c1c;font-size:14px;line-height:1.6;margin:12px 0;">
           <strong>Noted on delivery:</strong> ${escapeHtml(ctx.damagedItems.join(', '))}.
           Our team will follow up on any replacements needed.
         </p>`
      : ''

  const driverNoteLine = ctx.driverNotes
    ? `<p style="color:#374151;font-size:14px;line-height:1.6;margin:12px 0;">
         <strong>From the driver:</strong> ${escapeHtml(ctx.driverNotes)}
       </p>`
    : ''

  const signedByLine = ctx.recipientName
    ? `<tr>
         <td style="padding:6px 0;color:#666;">Signed by</td>
         <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(ctx.recipientName)}</td>
       </tr>`
    : ''

  const driverLine = ctx.driverName
    ? `<tr>
         <td style="padding:6px 0;color:#666;">Driver</td>
         <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(ctx.driverName)}</td>
       </tr>`
    : ''

  const orderLine = ctx.orderNumber
    ? `<tr>
         <td style="padding:6px 0;color:#666;">Order</td>
         <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(ctx.orderNumber)}</td>
       </tr>`
    : ''

  return wrap(`
    <h2 style="color:#0f2a3e;margin-top:0;">Delivered at ${escapeHtml(when)}</h2>
    <p style="color:#333;font-size:15px;line-height:1.6;">
      Hi ${escapeHtml(firstName)},
    </p>
    <p style="color:#333;font-size:15px;line-height:1.6;">
      Your order was delivered to <strong>${escapeHtml(ctx.address)}</strong> ${dateStr ? `on ${escapeHtml(dateStr)} ` : ''}at ${escapeHtml(when)}. Here's what that looked like.
    </p>

    ${photoStrip}

    <div style="background:#f8f9fa;border-radius:8px;padding:20px;margin:24px 0;">
      <table style="width:100%;font-size:14px;color:#333;">
        <tr>
          <td style="padding:6px 0;color:#666;">Delivery</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(ctx.deliveryNumber)}</td>
        </tr>
        <tr>
          <td style="padding:6px 0;color:#666;">Job</td>
          <td style="padding:6px 0;text-align:right;font-weight:600;">${escapeHtml(ctx.jobNumber)}</td>
        </tr>
        ${orderLine}
        ${driverLine}
        ${signedByLine}
      </table>
    </div>

    ${driverNoteLine}
    ${damageLine}

    <div style="text-align:center;margin:32px 0;">
      <a href="${receiptUrl}" style="background-color:#0f2a3e;color:white;padding:14px 32px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;display:inline-block;">
        View delivery receipt
      </a>
    </div>

    <p style="color:#666;font-size:13px;line-height:1.6;">
      Questions on this drop? Reply here or call (940) 555-ABEL and reference ${escapeHtml(ctx.deliveryNumber)}.
    </p>
  `)
}

// ─── Public API ─────────────────────────────────────────────────────────

export interface SendDeliveryConfirmationResult {
  sent: boolean
  recipientEmails: string[]
  reason?: string
  deliveryId: string
  deliveryNumber?: string
  alreadySentAt?: Date | null
}

export interface SendDeliveryConfirmationOptions {
  /** Extra CC recipients, appended to the builder's on-file email. */
  ccEmails?: string[]
  /** If true, resend even when confirmationSentAt is already set. */
  force?: boolean
}

/**
 * Build + send the delivery confirmation email to the builder. Idempotent:
 * if Delivery.confirmationSentAt is non-null and force=false, the function
 * returns { sent: false, reason: 'already_sent' } without contacting
 * Resend. Caller can pass force=true (POST route does this on "Resend").
 */
export async function sendDeliveryConfirmation(
  deliveryId: string,
  opts: SendDeliveryConfirmationOptions = {},
): Promise<SendDeliveryConfirmationResult> {
  const ctx = await gatherContext(deliveryId)
  if (!ctx) {
    return { sent: false, recipientEmails: [], reason: 'delivery_not_found', deliveryId }
  }

  if (ctx.alreadySentAt && !opts.force) {
    return {
      sent: false,
      recipientEmails: ctx.alreadySentTo ? [ctx.alreadySentTo] : [],
      reason: 'already_sent',
      deliveryId,
      deliveryNumber: ctx.deliveryNumber,
      alreadySentAt: ctx.alreadySentAt,
    }
  }

  if (!ctx.builderEmail) {
    logger.warn('delivery_confirmation_skip_no_email', {
      deliveryId,
      deliveryNumber: ctx.deliveryNumber,
    })
    return {
      sent: false,
      recipientEmails: [],
      reason: 'no_builder_email',
      deliveryId,
      deliveryNumber: ctx.deliveryNumber,
    }
  }

  const subject = `Delivery complete — Job ${ctx.jobNumber} at ${ctx.address}`
  const html = renderHtml(ctx)

  const ccEmails = (opts.ccEmails ?? [])
    .map((e) => e.trim())
    .filter((e) => e.length > 0 && e.includes('@'))

  // Resend helper in src/lib/email.ts accepts a single `to` string. For CC,
  // we send one call to the primary + a call per cc (keeps idempotency
  // single-source-of-truth on the primary recipient).
  const primaryResult = await sendEmail({
    to: ctx.builderEmail,
    subject,
    html,
    replyTo: 'ops@abellumber.com',
  })

  const sentTo: string[] = []
  if (primaryResult.success) {
    sentTo.push(ctx.builderEmail)
  } else {
    logger.error('delivery_confirmation_send_failed', primaryResult.error, {
      deliveryId,
      to: ctx.builderEmail,
    })
    return {
      sent: false,
      recipientEmails: [ctx.builderEmail],
      reason: primaryResult.error || 'email_send_failed',
      deliveryId,
      deliveryNumber: ctx.deliveryNumber,
    }
  }

  for (const cc of ccEmails) {
    const ccRes = await sendEmail({
      to: cc,
      subject,
      html,
      replyTo: 'ops@abellumber.com',
    })
    if (ccRes.success) sentTo.push(cc)
  }

  // Stamp the delivery — use the primary recipient so we can report
  // "Confirmation sent HH:MM to <email>" on the UI without a join.
  try {
    await prisma.$executeRawUnsafe(
      `UPDATE "Delivery"
         SET "confirmationSentAt" = NOW(),
             "confirmationSentTo" = $2,
             "updatedAt" = NOW()
       WHERE "id" = $1`,
      deliveryId,
      ctx.builderEmail,
    )
  } catch (e) {
    logger.warn('delivery_confirmation_stamp_failed', {
      deliveryId,
      err: (e as any)?.message,
    })
  }

  return {
    sent: true,
    recipientEmails: sentTo,
    deliveryId,
    deliveryNumber: ctx.deliveryNumber,
  }
}

// ─── helpers ────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Escape a string going into a double-quoted HTML attribute. Preserves
 *  data: URLs (which contain ; : / , = + and base64 chars) because none of
 *  those are special inside a "..."-delimited attribute value. We only
 *  escape the five HTML entities plus the attribute-breaking quote. */
function escapeAttr(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}
