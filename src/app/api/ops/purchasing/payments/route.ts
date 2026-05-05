/**
 * /api/ops/purchasing/payments — VendorPayment CRUD.
 *
 * FIX-3 from AEGIS-OPS-FINANCE-HANDOFF.docx (2026-05-05). Mirrors the
 * existing /api/ops/invoices/[id]/payments pattern but on the AP side:
 * outgoing payments to vendors (utilities, rent, PO settlements, ad-hoc).
 *
 *   GET  /api/ops/purchasing/payments
 *     query params (all optional):
 *       vendorId, purchaseOrderId, method, dateFrom, dateTo, search, page, limit
 *     returns { payments: [...], total, page, limit, totalPages }
 *
 *   POST /api/ops/purchasing/payments
 *     body: {
 *       vendorId  (required)
 *       amount    (required, > 0)
 *       method    (required — CHECK | ACH | WIRE | CREDIT_CARD | CASH | OTHER)
 *       checkNumber?       (required when method=CHECK)
 *       reference?
 *       memo?
 *       paidAt?            (ISO; defaults to NOW())
 *       purchaseOrderId?   (optional — utilities/rent have no PO)
 *     }
 *
 * Auth: cookie-based via middleware. The route reads x-staff-id stamped
 * by middleware to populate createdById.
 */
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

const ALLOWED_METHODS = ['CHECK', 'ACH', 'WIRE', 'CREDIT_CARD', 'CASH', 'OTHER'] as const
type Method = (typeof ALLOWED_METHODS)[number]
function isMethod(m: any): m is Method {
  return typeof m === 'string' && (ALLOWED_METHODS as readonly string[]).includes(m)
}

// ──────────────────────────────────────────────────────────────────────
// GET — list / search / filter
// ──────────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const url = request.nextUrl
  const vendorId = url.searchParams.get('vendorId') || undefined
  const purchaseOrderId = url.searchParams.get('purchaseOrderId') || undefined
  const method = url.searchParams.get('method') || undefined
  const search = url.searchParams.get('search') || undefined
  const dateFrom = url.searchParams.get('dateFrom') || undefined
  const dateTo = url.searchParams.get('dateTo') || undefined
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'))
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')))
  const skip = (page - 1) * limit

  const where: any = {}
  if (vendorId) where.vendorId = vendorId
  if (purchaseOrderId) where.purchaseOrderId = purchaseOrderId
  if (method) where.method = method
  if (dateFrom || dateTo) {
    where.paidAt = {}
    if (dateFrom) where.paidAt.gte = new Date(dateFrom)
    if (dateTo) where.paidAt.lte = new Date(dateTo)
  }
  if (search) {
    where.OR = [
      { reference: { contains: search, mode: 'insensitive' } },
      { checkNumber: { contains: search, mode: 'insensitive' } },
      { memo: { contains: search, mode: 'insensitive' } },
    ]
  }

  try {
    const [payments, total] = await Promise.all([
      prisma.vendorPayment.findMany({
        where,
        orderBy: { paidAt: 'desc' },
        skip,
        take: limit,
      }),
      prisma.vendorPayment.count({ where }),
    ])

    // Hydrate vendor names + PO numbers in a single batch each — cheaper
    // than a Prisma include since we don't have @relation back-edges.
    const vendorIds = Array.from(new Set(payments.map((p) => p.vendorId)))
    const poIds = Array.from(
      new Set(payments.map((p) => p.purchaseOrderId).filter(Boolean) as string[]),
    )

    const [vendors, pos] = await Promise.all([
      vendorIds.length > 0
        ? prisma.vendor.findMany({
            where: { id: { in: vendorIds } },
            select: { id: true, name: true, code: true },
          })
        : Promise.resolve([]),
      poIds.length > 0
        ? prisma.purchaseOrder.findMany({
            where: { id: { in: poIds } },
            select: { id: true, poNumber: true },
          })
        : Promise.resolve([]),
    ])

    const vendorMap = new Map(vendors.map((v) => [v.id, v]))
    const poMap = new Map(pos.map((p) => [p.id, p]))

    const enriched = payments.map((p) => ({
      ...p,
      vendor: vendorMap.get(p.vendorId) || null,
      purchaseOrder: p.purchaseOrderId ? poMap.get(p.purchaseOrderId) || null : null,
    }))

    return NextResponse.json({
      payments: enriched,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    })
  } catch (err: any) {
    console.error('GET /api/ops/purchasing/payments error:', err)
    return NextResponse.json({ error: 'Failed to fetch payments' }, { status: 500 })
  }
}

// ──────────────────────────────────────────────────────────────────────
// POST — record a new vendor payment
// ──────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const {
      vendorId,
      purchaseOrderId,
      amount,
      method,
      checkNumber,
      reference,
      memo,
      paidAt,
    } = body

    if (!vendorId || typeof vendorId !== 'string') {
      return NextResponse.json({ error: 'vendorId is required' }, { status: 400 })
    }
    if (typeof amount !== 'number' || amount <= 0 || !isFinite(amount)) {
      return NextResponse.json(
        { error: 'amount must be a positive number' },
        { status: 400 },
      )
    }
    if (!isMethod(method)) {
      return NextResponse.json(
        { error: `method must be one of ${ALLOWED_METHODS.join(', ')}` },
        { status: 400 },
      )
    }
    if (method === 'CHECK' && !checkNumber?.trim()) {
      return NextResponse.json(
        { error: 'checkNumber is required when method=CHECK' },
        { status: 400 },
      )
    }

    // Verify vendor exists (cleaner error than waiting for FK violation)
    const vendor = await prisma.vendor.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true },
    })
    if (!vendor) {
      return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })
    }

    // If PO id provided, sanity-check it
    if (purchaseOrderId) {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: purchaseOrderId },
        select: { id: true, vendorId: true, poNumber: true },
      })
      if (!po) {
        return NextResponse.json({ error: 'Purchase order not found' }, { status: 404 })
      }
      if (po.vendorId !== vendorId) {
        return NextResponse.json(
          {
            error: `PO ${po.poNumber} belongs to a different vendor — refusing to record this payment`,
          },
          { status: 400 },
        )
      }
    }

    const createdById = request.headers.get('x-staff-id') || null

    const payment = await prisma.vendorPayment.create({
      data: {
        vendorId,
        purchaseOrderId: purchaseOrderId || null,
        amount,
        method,
        checkNumber: method === 'CHECK' ? checkNumber.trim() : checkNumber || null,
        reference: reference || null,
        memo: memo || null,
        paidAt: paidAt ? new Date(paidAt) : new Date(),
        createdById,
      },
    })

    await audit(request, 'CREATE', 'VendorPayment', payment.id, {
      vendorId,
      vendorName: vendor.name,
      amount,
      method,
      checkNumber: payment.checkNumber,
    }).catch(() => {})

    return NextResponse.json(
      {
        ...payment,
        vendor: { id: vendor.id, name: vendor.name },
      },
      { status: 201 },
    )
  } catch (err: any) {
    console.error('POST /api/ops/purchasing/payments error:', err)
    return NextResponse.json(
      { error: err?.message || 'Failed to record payment' },
      { status: 500 },
    )
  }
}
