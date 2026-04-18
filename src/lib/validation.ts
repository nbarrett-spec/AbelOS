/**
 * Zod validation schemas for critical API routes.
 *
 * Usage in route handlers:
 *   import { parseBody, orderCreateSchema } from '@/lib/validation'
 *   const parsed = parseBody(orderCreateSchema, body)
 *   if (parsed.error) return parsed.error  // NextResponse with 400
 *   const data = parsed.data
 */
import { z } from 'zod'
import { NextResponse } from 'next/server'

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Parse a body against a Zod schema. Returns { data } on success or
 * { error: NextResponse } on failure (ready to return from handler).
 */
export function parseBody<T extends z.ZodTypeAny>(
  schema: T,
  body: unknown
): { data: z.infer<T>; error?: never } | { data?: never; error: NextResponse } {
  const result = schema.safeParse(body)
  if (result.success) return { data: result.data }

  const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`)
  return {
    error: NextResponse.json(
      { error: 'Validation failed', details: issues },
      { status: 400 }
    ),
  }
}

// ── Common ──────────────────────────────────────────────────────────────

const nonEmptyString = z.string().trim().min(1, 'Required')
const optString = z.string().trim().optional().nullable()
const positiveFloat = z.number().positive('Must be positive')
const nonNegFloat = z.number().min(0, 'Cannot be negative')
const optDate = z.string().datetime().optional().nullable()
const email = z.string().email('Invalid email')

// ── Order ───────────────────────────────────────────────────────────────

export const orderCreateSchema = z.object({
  builderId: nonEmptyString,
  quoteId: optString,
  poNumber: optString,
  subtotal: positiveFloat,
  taxAmount: nonNegFloat.default(0),
  shippingCost: nonNegFloat.default(0),
  total: positiveFloat,
  paymentTerm: z.enum(['NET_15', 'NET_30', 'NET_45', 'NET_60', 'DUE_ON_RECEIPT', 'DUE_ON_DELIVERY', 'PREPAY']),
  deliveryDate: optDate,
  deliveryNotes: optString,
  items: z.array(z.object({
    productId: nonEmptyString,
    description: nonEmptyString,
    quantity: z.number().int().positive(),
    unitPrice: positiveFloat,
    lineTotal: positiveFloat,
  })).min(1, 'At least one item required'),
})

export const orderUpdateSchema = z.object({
  status: z.enum([
    'RECEIVED', 'CONFIRMED', 'IN_PRODUCTION', 'AWAITING_MATERIAL',
    'READY_TO_SHIP', 'PARTIAL_SHIPPED', 'SHIPPED', 'DELIVERED',
    'COMPLETE', 'CANCELLED',
  ]).optional(),
  deliveryDate: optDate,
  deliveryNotes: optString,
  poNumber: optString,
}).refine(obj => Object.values(obj).some(v => v !== undefined), {
  message: 'At least one field must be provided',
})

// ── Invoice ─────────────────────────────────────────────────────────────

export const invoiceCreateSchema = z.object({
  builderId: nonEmptyString,
  orderId: optString,
  jobId: optString,
  subtotal: positiveFloat,
  taxAmount: nonNegFloat.default(0),
  total: positiveFloat,
  paymentTerm: z.enum(['NET_15', 'NET_30', 'NET_45', 'NET_60', 'DUE_ON_RECEIPT', 'DUE_ON_DELIVERY', 'PREPAY']),
  dueDate: optDate,
  notes: optString,
  items: z.array(z.object({
    productId: optString,
    description: nonEmptyString,
    quantity: z.number().int().positive(),
    unitPrice: positiveFloat,
    lineTotal: positiveFloat,
  })).min(1, 'At least one item required'),
})

export const paymentRecordSchema = z.object({
  invoiceId: nonEmptyString,
  amount: positiveFloat,
  method: z.enum(['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER']),
  reference: optString,
  notes: optString,
})

// ── Quote ───────────────────────────────────────────────────────────────

export const quoteCreateSchema = z.object({
  builderId: nonEmptyString,
  projectId: optString,
  title: nonEmptyString,
  notes: optString,
  validUntil: optDate,
  items: z.array(z.object({
    productId: optString,
    description: nonEmptyString,
    quantity: z.number().int().positive(),
    unitPrice: positiveFloat,
    lineTotal: positiveFloat,
  })).min(1, 'At least one item required'),
})

// ── Delivery ────────────────────────────────────────────────────────────

export const deliveryTrackingSchema = z.object({
  deliveryId: nonEmptyString,
  status: z.enum([
    'PICKING', 'LOADED', 'DEPARTED', 'EN_ROUTE',
    'NEARBY', 'ARRIVED', 'UNLOADING', 'COMPLETE',
  ]),
  location: optString,
  notes: optString,
  eta: optDate,
})

export const dispatchSchema = z.object({
  deliveryId: nonEmptyString,
  action: z.enum(['ASSIGN_CREW', 'BOOK_CURRI', 'AUTO']),
  crewId: optString,
  vehicleType: z.enum(['car', 'suv', 'pickup_truck', 'cargo_van', 'box_truck', 'flatbed']).optional(),
  scheduledAt: optDate,
  contactName: optString,
  contactPhone: optString,
})

export const partialShipmentSchema = z.object({
  orderId: nonEmptyString,
  deliveryId: nonEmptyString,
  items: z.array(z.object({
    productId: nonEmptyString,
    sku: nonEmptyString,
    productName: nonEmptyString,
    qtyOrdered: z.number().int().positive(),
    qtyShipped: z.number().int().min(0).default(0),
    orderItemId: optString,
    purchaseOrderId: optString,
    notes: optString,
  })).min(1, 'At least one item required'),
})

// ── Material Watch ──────────────────────────────────────────────────────

export const materialWatchCreateSchema = z.object({
  orderId: nonEmptyString,
  productId: nonEmptyString,
  sku: nonEmptyString,
  productName: nonEmptyString,
  qtyNeeded: z.number().int().positive(),
  orderItemId: optString,
  jobId: optString,
  salesRepId: optString,
  purchaseOrderId: optString,
  notes: optString,
})

// ── GPS Location ────────────────────────────────────────────────────────

export const vehicleLocationSchema = z.object({
  crewId: nonEmptyString,
  latitude: z.number().min(25).max(50),   // Continental US bounds
  longitude: z.number().min(-130).max(-60),
  heading: z.number().min(0).max(360).optional(),
  speed: z.number().min(0).max(200).optional(),
  status: z.enum(['IDLE', 'EN_ROUTE', 'AT_STOP', 'RETURNING']).optional(),
  activeDeliveryId: optString,
  vehicleId: optString,
  address: optString,
})

// ── Builder Registration ────────────────────────────────────────────────

export const builderRegisterSchema = z.object({
  companyName: nonEmptyString,
  contactName: nonEmptyString,
  contactEmail: email,
  contactPhone: optString,
  address: optString,
  city: optString,
  state: optString,
  zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP').optional().nullable(),
  businessLicense: optString,
  taxId: optString,
  estimatedAnnualVolume: optString,
  referralSource: optString,
  notes: optString,
})

// ── Stripe Checkout ─────────────────────────────────────────────────────

export const paymentCheckoutSchema = z.object({
  invoiceId: nonEmptyString,
})
