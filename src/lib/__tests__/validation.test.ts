/**
 * Smoke tests for Zod validation schemas.
 *
 * Ensures valid payloads pass and invalid payloads produce clear errors.
 */
import { describe, it, expect } from 'vitest'
import {
  parseBody,
  orderCreateSchema,
  orderUpdateSchema,
  invoiceCreateSchema,
  paymentRecordSchema,
  quoteCreateSchema,
  deliveryTrackingSchema,
  dispatchSchema,
  partialShipmentSchema,
  materialWatchCreateSchema,
  vehicleLocationSchema,
  builderRegisterSchema,
  paymentCheckoutSchema,
} from '../validation'

// ── parseBody helper ────────────────────────────────────────────────────

describe('parseBody', () => {
  it('returns data on valid input', () => {
    const result = parseBody(paymentCheckoutSchema, { invoiceId: 'inv_abc' })
    expect(result.error).toBeUndefined()
    expect(result.data).toEqual({ invoiceId: 'inv_abc' })
  })

  it('returns NextResponse error on invalid input', () => {
    const result = parseBody(paymentCheckoutSchema, { invoiceId: '' })
    expect(result.data).toBeUndefined()
    expect(result.error).toBeDefined()
    // It's a NextResponse with status 400
    expect(result.error!.status).toBe(400)
  })
})

// ── Order schemas ───────────────────────────────────────────────────────

describe('orderCreateSchema', () => {
  const valid = {
    builderId: 'bld_123',
    subtotal: 1500.0,
    taxAmount: 0,
    total: 1500.0,
    paymentTerm: 'NET_30',
    items: [
      {
        productId: 'prod_1',
        description: '2x4x8 SPF',
        quantity: 100,
        unitPrice: 15.0,
        lineTotal: 1500.0,
      },
    ],
  }

  it('accepts valid order', () => {
    const r = orderCreateSchema.safeParse(valid)
    expect(r.success).toBe(true)
  })

  it('rejects empty items array', () => {
    const r = orderCreateSchema.safeParse({ ...valid, items: [] })
    expect(r.success).toBe(false)
  })

  it('rejects negative total', () => {
    const r = orderCreateSchema.safeParse({ ...valid, total: -100 })
    expect(r.success).toBe(false)
  })

  it('rejects missing builderId', () => {
    const { builderId, ...rest } = valid
    const r = orderCreateSchema.safeParse(rest)
    expect(r.success).toBe(false)
  })

  it('rejects invalid paymentTerm', () => {
    const r = orderCreateSchema.safeParse({ ...valid, paymentTerm: 'NET_999' })
    expect(r.success).toBe(false)
  })
})

describe('orderUpdateSchema', () => {
  it('accepts partial update', () => {
    expect(orderUpdateSchema.safeParse({ status: 'CONFIRMED' }).success).toBe(true)
    expect(orderUpdateSchema.safeParse({ deliveryNotes: 'gate code 1234' }).success).toBe(true)
  })

  it('rejects empty object', () => {
    expect(orderUpdateSchema.safeParse({}).success).toBe(false)
  })
})

// ── Invoice ─────────────────────────────────────────────────────────────

describe('invoiceCreateSchema', () => {
  const valid = {
    builderId: 'bld_123',
    subtotal: 5000,
    total: 5000,
    paymentTerm: 'NET_30',
    items: [{ description: 'Framing package', quantity: 1, unitPrice: 5000, lineTotal: 5000 }],
  }

  it('accepts valid invoice', () => {
    expect(invoiceCreateSchema.safeParse(valid).success).toBe(true)
  })

  it('rejects zero total', () => {
    expect(invoiceCreateSchema.safeParse({ ...valid, total: 0 }).success).toBe(false)
  })
})

describe('paymentRecordSchema', () => {
  it('accepts valid payment', () => {
    const r = paymentRecordSchema.safeParse({
      invoiceId: 'inv_1',
      amount: 2500.0,
      method: 'CHECK',
      reference: 'Check #4521',
    })
    expect(r.success).toBe(true)
  })

  it('rejects invalid method', () => {
    const r = paymentRecordSchema.safeParse({
      invoiceId: 'inv_1',
      amount: 100,
      method: 'BITCOIN',
    })
    expect(r.success).toBe(false)
  })
})

// ── Quote ───────────────────────────────────────────────────────────────

describe('quoteCreateSchema', () => {
  it('accepts valid quote', () => {
    const r = quoteCreateSchema.safeParse({
      builderId: 'bld_1',
      title: 'Foundation lumber',
      items: [{ description: 'PT 2x10x16', quantity: 50, unitPrice: 22, lineTotal: 1100 }],
    })
    expect(r.success).toBe(true)
  })
})

// ── Delivery tracking ──────────────────────────────────────────────────

describe('deliveryTrackingSchema', () => {
  it('accepts all valid statuses', () => {
    const statuses = ['PICKING', 'LOADED', 'DEPARTED', 'EN_ROUTE', 'NEARBY', 'ARRIVED', 'UNLOADING', 'COMPLETE']
    for (const status of statuses) {
      expect(deliveryTrackingSchema.safeParse({ deliveryId: 'del_1', status }).success).toBe(true)
    }
  })

  it('rejects unknown status', () => {
    expect(deliveryTrackingSchema.safeParse({ deliveryId: 'del_1', status: 'LOST' }).success).toBe(false)
  })
})

// ── Dispatch ────────────────────────────────────────────────────────────

describe('dispatchSchema', () => {
  it('accepts ASSIGN_CREW with crewId', () => {
    const r = dispatchSchema.safeParse({ deliveryId: 'del_1', action: 'ASSIGN_CREW', crewId: 'crew_1' })
    expect(r.success).toBe(true)
  })

  it('accepts BOOK_CURRI with vehicleType', () => {
    const r = dispatchSchema.safeParse({ deliveryId: 'del_1', action: 'BOOK_CURRI', vehicleType: 'flatbed' })
    expect(r.success).toBe(true)
  })

  it('rejects invalid vehicle type', () => {
    const r = dispatchSchema.safeParse({ deliveryId: 'del_1', action: 'BOOK_CURRI', vehicleType: 'helicopter' })
    expect(r.success).toBe(false)
  })
})

// ── Partial shipment ───────────────────────────────────────────────────

describe('partialShipmentSchema', () => {
  it('accepts valid partial shipment', () => {
    const r = partialShipmentSchema.safeParse({
      orderId: 'ord_1',
      deliveryId: 'del_1',
      items: [{
        productId: 'prod_1',
        sku: 'SPF-2X4-8',
        productName: '2x4x8 SPF',
        qtyOrdered: 100,
        qtyShipped: 60,
      }],
    })
    expect(r.success).toBe(true)
  })
})

// ── Material watch ─────────────────────────────────────────────────────

describe('materialWatchCreateSchema', () => {
  it('accepts valid watch', () => {
    const r = materialWatchCreateSchema.safeParse({
      orderId: 'ord_1',
      productId: 'prod_1',
      sku: 'LVL-1.75X14',
      productName: '1-3/4 x 14 LVL',
      qtyNeeded: 20,
    })
    expect(r.success).toBe(true)
  })

  it('rejects zero quantity', () => {
    const r = materialWatchCreateSchema.safeParse({
      orderId: 'ord_1',
      productId: 'prod_1',
      sku: 'X',
      productName: 'X',
      qtyNeeded: 0,
    })
    expect(r.success).toBe(false)
  })
})

// ── Vehicle location ───────────────────────────────────────────────────

describe('vehicleLocationSchema', () => {
  it('accepts DFW-area coordinates', () => {
    const r = vehicleLocationSchema.safeParse({
      crewId: 'crew_1',
      latitude: 32.7357,
      longitude: -97.1081,
    })
    expect(r.success).toBe(true)
  })

  it('rejects coordinates outside continental US', () => {
    // Hawaii
    expect(vehicleLocationSchema.safeParse({
      crewId: 'crew_1',
      latitude: 21.3,
      longitude: -157.8,
    }).success).toBe(false)
  })
})

// ── Builder registration ───────────────────────────────────────────────

describe('builderRegisterSchema', () => {
  it('accepts valid registration', () => {
    const r = builderRegisterSchema.safeParse({
      companyName: 'DFW Custom Homes',
      contactName: 'Mike Johnson',
      contactEmail: 'mike@dfwcustom.com',
      contactPhone: '817-555-1234',
      city: 'Fort Worth',
      state: 'TX',
      zip: '76102',
    })
    expect(r.success).toBe(true)
  })

  it('rejects invalid email', () => {
    const r = builderRegisterSchema.safeParse({
      companyName: 'Test',
      contactName: 'Test',
      contactEmail: 'not-an-email',
    })
    expect(r.success).toBe(false)
  })

  it('rejects invalid zip format', () => {
    const r = builderRegisterSchema.safeParse({
      companyName: 'Test',
      contactName: 'Test',
      contactEmail: 'a@b.com',
      zip: 'ABCDE',
    })
    expect(r.success).toBe(false)
  })

  it('accepts zip+4 format', () => {
    const r = builderRegisterSchema.safeParse({
      companyName: 'Test',
      contactName: 'Test',
      contactEmail: 'a@b.com',
      zip: '76102-1234',
    })
    expect(r.success).toBe(true)
  })
})
