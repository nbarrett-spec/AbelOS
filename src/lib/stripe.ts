// ──────────────────────────────────────────────────────────────────────────
// Stripe Integration — REST API wrapper (no npm package needed)
//
// Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in your .env
// For testing, use Stripe test mode keys (sk_test_...)
// ──────────────────────────────────────────────────────────────────────────

const STRIPE_API = 'https://api.stripe.com/v1'

function getSecretKey(): string {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured')
  return key
}

/** Make an authenticated request to the Stripe API */
async function stripeRequest(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: Record<string, any>
): Promise<any> {
  const key = getSecretKey()
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  }

  let urlBody: string | undefined
  if (body) {
    urlBody = encodeParams(body)
  }

  const res = await fetch(`${STRIPE_API}${path}`, {
    method,
    headers,
    body: urlBody,
  })

  const data = await res.json()
  if (data.error) {
    throw new Error(`Stripe error: ${data.error.message}`)
  }
  return data
}

/** Encode nested params for Stripe's URL-encoded format */
function encodeParams(obj: Record<string, any>, prefix?: string): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key
    if (value === null || value === undefined) continue
    if (typeof value === 'object' && !Array.isArray(value)) {
      parts.push(encodeParams(value, fullKey))
    } else if (Array.isArray(value)) {
      value.forEach((v, i) => {
        if (typeof v === 'object') {
          parts.push(encodeParams(v, `${fullKey}[${i}]`))
        } else {
          parts.push(`${encodeURIComponent(fullKey)}[${i}]=${encodeURIComponent(v)}`)
        }
      })
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(value)}`)
    }
  }
  return parts.filter(Boolean).join('&')
}

// ──────────────────────────────────────────────────────────────────────────
// Customers
// ──────────────────────────────────────────────────────────────────────────

/** Create or retrieve a Stripe customer for a builder */
export async function getOrCreateCustomer(builderId: string, email: string, companyName: string): Promise<string> {
  // Search for existing customer by metadata
  const existing = await stripeRequest('GET', `/customers?email=${encodeURIComponent(email)}&limit=1`)
  if (existing.data?.length > 0) {
    return existing.data[0].id
  }

  // Create new customer
  const customer = await stripeRequest('POST', '/customers', {
    email,
    name: companyName,
    metadata: { builderId, platform: 'abel-builder' },
  })
  return customer.id
}

// ──────────────────────────────────────────────────────────────────────────
// Payment Intents (for one-time invoice payments)
// ──────────────────────────────────────────────────────────────────────────

/** Create a PaymentIntent for an invoice */
export async function createPaymentIntent(params: {
  amount: number        // in dollars (we convert to cents)
  customerId: string
  invoiceNumber: string
  invoiceId: string
  builderId: string
}): Promise<{ clientSecret: string; paymentIntentId: string }> {
  const pi = await stripeRequest('POST', '/payment_intents', {
    amount: Math.round(params.amount * 100), // Convert to cents
    currency: 'usd',
    customer: params.customerId,
    automatic_payment_methods: { enabled: 'true' },
    metadata: {
      invoiceNumber: params.invoiceNumber,
      invoiceId: params.invoiceId,
      builderId: params.builderId,
      platform: 'abel-builder',
    },
    description: `Payment for Invoice ${params.invoiceNumber}`,
  })
  return { clientSecret: pi.client_secret, paymentIntentId: pi.id }
}

/** Retrieve a PaymentIntent status */
export async function getPaymentIntent(id: string): Promise<any> {
  return stripeRequest('GET', `/payment_intents/${id}`)
}

// ──────────────────────────────────────────────────────────────────────────
// Payment Links (shareable payment URLs)
// ──────────────────────────────────────────────────────────────────────────

/** Create a Stripe Checkout Session (payment link) for an invoice */
export async function createCheckoutSession(params: {
  amount: number
  invoiceNumber: string
  invoiceId: string
  builderId: string
  customerEmail: string
  successUrl: string
  cancelUrl: string
}): Promise<{ url: string; sessionId: string }> {
  const session = await stripeRequest('POST', '/checkout/sessions', {
    mode: 'payment',
    customer_email: params.customerEmail,
    'line_items[0][price_data][currency]': 'usd',
    'line_items[0][price_data][unit_amount]': Math.round(params.amount * 100),
    'line_items[0][price_data][product_data][name]': `Invoice ${params.invoiceNumber}`,
    'line_items[0][price_data][product_data][description]': `Abel Lumber - Invoice ${params.invoiceNumber}`,
    'line_items[0][quantity]': 1,
    success_url: params.successUrl,
    cancel_url: params.cancelUrl,
    metadata: {
      invoiceNumber: params.invoiceNumber,
      invoiceId: params.invoiceId,
      builderId: params.builderId,
      platform: 'abel-builder',
    },
  })
  return { url: session.url, sessionId: session.id }
}

/** Retrieve Checkout Session (for verifying payment after redirect) */
export async function getCheckoutSession(sessionId: string): Promise<any> {
  return stripeRequest('GET', `/checkout/sessions/${sessionId}`)
}

// ──────────────────────────────────────────────────────────────────────────
// Webhook Verification
// ──────────────────────────────────────────────────────────────────────────

/** Verify Stripe webhook signature (using Web Crypto API, no npm needed) */
export async function verifyWebhookSignature(
  payload: string,
  signatureHeader: string
): Promise<boolean> {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured')

  const parts = signatureHeader.split(',')
  const timestamp = parts.find(p => p.startsWith('t='))?.split('=')[1]
  const signature = parts.find(p => p.startsWith('v1='))?.split('=')[1]

  if (!timestamp || !signature) return false

  // Check timestamp is within 5 minutes
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp)
  if (age > 300) return false

  // Compute expected signature
  const signedPayload = `${timestamp}.${payload}`
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload))
  const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')

  return expected === signature
}

// ──────────────────────────────────────────────────────────────────────────
// Health check
// ──────────────────────────────────────────────────────────────────────────

export function isStripeConfigured(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}
