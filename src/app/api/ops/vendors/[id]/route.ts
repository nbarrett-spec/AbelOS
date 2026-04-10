export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// Type Definitions
// ──────────────────────────────────────────────────────────────────────────

interface VendorDetailRow {
  id: string
  name: string
  code: string
  contactName: string | null
  email: string | null
  phone: string | null
  address: string | null
  website: string | null
  accountNumber: string | null
  creditLimit: number | null
  creditUsed: number | null
  creditHold: boolean
  paymentTerms: string | null
  paymentTermDays: number | null
  earlyPayDiscount: number | null
  earlyPayDays: number | null
  taxId: string | null
  notes: string | null
  avgLeadDays: number | null
  onTimeRate: number | null
  active: boolean
  createdAt: Date
  updatedAt: Date
}

interface VendorProductRow {
  vendorProductId: string
  productId: string
  vendorSku: string
  vendorName: string | null
  vendorCost: number | null
  minOrderQty: number
  leadTimeDays: number | null
  preferred: boolean
}

interface PurchaseOrderRow {
  poId: string
  poNumber: string
  status: string
  subtotal: number
  shippingCost: number
  total: number
  orderedAt: Date | null
  expectedDate: Date | null
  receivedAt: Date | null
  notes: string | null
}

// ──────────────────────────────────────────────────────────────────────────
// GET: Full vendor detail with credit info, metrics, and related data
// ──────────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Fetch vendor details with all credit fields
    const vendorResult = await prisma.$queryRawUnsafe<VendorDetailRow[]>(
      `SELECT
        id, name, code, "contactName", email, phone, address, website,
        "accountNumber", "creditLimit", "creditUsed", "creditHold",
        "paymentTerms", "paymentTermDays", "earlyPayDiscount", "earlyPayDays",
        "taxId", notes, "avgLeadDays", "onTimeRate", active,
        "createdAt", "updatedAt"
      FROM "Vendor"
      WHERE id = $1`,
      id
    )

    const vendor = vendorResult?.[0]

    if (!vendor) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      )
    }

    // Calculate credit utilization percentage
    const creditUtilization = vendor.creditLimit && vendor.creditUsed
      ? Math.round((vendor.creditUsed / vendor.creditLimit) * 100)
      : null

    // Fetch open PO count and total
    const openPoResult = await prisma.$queryRawUnsafe<Array<{
      count: number
      total: number
    }>>(
      `SELECT
        COUNT(*)::int as count,
        COALESCE(SUM(total), 0)::float as total
      FROM "PurchaseOrder"
      WHERE "vendorId" = $1
      AND status NOT IN ('RECEIVED', 'CANCELLED')`,
      id
    )

    const { count: openPoCount = 0, total: openPoTotal = 0 } = openPoResult[0] || {}

    // Fetch recent POs (last 10)
    const recentPosResult = await prisma.$queryRawUnsafe<PurchaseOrderRow[]>(
      `SELECT
        id as "poId", "poNumber", status, subtotal, "shippingCost",
        total, "orderedAt", "expectedDate", "receivedAt", notes
      FROM "PurchaseOrder"
      WHERE "vendorId" = $1
      ORDER BY "createdAt" DESC
      LIMIT 10`,
      id
    )

    // Fetch products supplied by this vendor
    const productsResult = await prisma.$queryRawUnsafe<VendorProductRow[]>(
      `SELECT
        id as "vendorProductId", "productId", "vendorSku", "vendorName",
        "vendorCost", "minOrderQty", "leadTimeDays", preferred
      FROM "VendorProduct"
      WHERE "vendorId" = $1
      ORDER BY preferred DESC, "vendorName" ASC`,
      id
    )

    // Build comprehensive response
    return NextResponse.json({
      vendor: {
        // Basic info
        id: vendor.id,
        name: vendor.name,
        code: vendor.code,
        contactName: vendor.contactName,
        email: vendor.email,
        phone: vendor.phone,
        address: vendor.address,
        website: vendor.website,
        accountNumber: vendor.accountNumber,

        // Credit fields
        creditLimit: vendor.creditLimit,
        creditUsed: vendor.creditUsed,
        creditHold: vendor.creditHold,
        creditUtilizationPercent: creditUtilization,
        creditAvailable: vendor.creditLimit && vendor.creditUsed
          ? Math.max(0, vendor.creditLimit - vendor.creditUsed)
          : null,

        // Payment terms
        paymentTerms: vendor.paymentTerms,
        paymentTermDays: vendor.paymentTermDays,
        earlyPayDiscount: vendor.earlyPayDiscount,
        earlyPayDays: vendor.earlyPayDays,

        // Additional fields
        taxId: vendor.taxId,
        notes: vendor.notes,
        active: vendor.active,

        // Performance metrics
        performanceMetrics: {
          avgLeadDays: vendor.avgLeadDays,
          onTimeRate: vendor.onTimeRate ? (vendor.onTimeRate * 100).toFixed(2) + '%' : null,
        },

        // Timestamps
        createdAt: vendor.createdAt,
        updatedAt: vendor.updatedAt,
      },
      openPOs: {
        count: openPoCount,
        totalAmount: openPoTotal,
      },
      recentPOs: recentPosResult.map(po => ({
        id: po.poId,
        poNumber: po.poNumber,
        status: po.status,
        subtotal: po.subtotal,
        shippingCost: po.shippingCost,
        total: po.total,
        orderedAt: po.orderedAt,
        expectedDate: po.expectedDate,
        receivedAt: po.receivedAt,
        notes: po.notes,
      })),
      products: productsResult.map(p => ({
        vendorProductId: p.vendorProductId,
        productId: p.productId,
        vendorSku: p.vendorSku,
        vendorName: p.vendorName,
        vendorCost: p.vendorCost,
        minOrderQty: p.minOrderQty,
        leadTimeDays: p.leadTimeDays,
        preferred: p.preferred,
      })),
      summary: {
        totalProductsSupplied: productsResult.length,
        openPOCount: openPoCount,
        openPOTotal: openPoTotal,
        creditUtilizationPercent: creditUtilization,
      },
    }, { status: 200 })
  } catch (error) {
    console.error('GET /api/ops/vendors/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch vendor details' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// PATCH: Update vendor including credit fields
// ──────────────────────────────────────────────────────────────────────────

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params
    const body = await request.json()

    const {
      // Basic info
      name,
      code,
      contactName,
      email,
      phone,
      address,
      website,
      accountNumber,

      // Credit fields
      creditLimit,
      creditHold,
      paymentTerms,
      paymentTermDays,
      earlyPayDiscount,
      earlyPayDays,
      taxId,
      notes,

      // Status
      active,
    } = body

    // Validation: if creditHold is being set to true, check that notes exist
    if (creditHold === true) {
      if (!notes || notes.trim() === '') {
        return NextResponse.json(
          { error: 'Notes are required when placing vendor on credit hold' },
          { status: 400 }
        )
      }
    }

    // Validate code uniqueness if being changed
    if (code !== undefined) {
      const existingVendor = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
        `SELECT id FROM "Vendor" WHERE code = $1 AND id != $2`,
        code,
        id
      )
      if (existingVendor.length > 0) {
        return NextResponse.json(
          { error: 'Vendor code already exists' },
          { status: 400 }
        )
      }
    }

    // Build dynamic update query
    const updates: string[] = []
    const values: any[] = [id]
    let paramIndex = 2

    if (name !== undefined) {
      updates.push(`name = $${paramIndex}`)
      values.push(name)
      paramIndex++
    }

    if (code !== undefined) {
      updates.push(`code = $${paramIndex}`)
      values.push(code)
      paramIndex++
    }

    if (contactName !== undefined) {
      updates.push(`"contactName" = $${paramIndex}`)
      values.push(contactName)
      paramIndex++
    }

    if (email !== undefined) {
      updates.push(`email = $${paramIndex}`)
      values.push(email)
      paramIndex++
    }

    if (phone !== undefined) {
      updates.push(`phone = $${paramIndex}`)
      values.push(phone)
      paramIndex++
    }

    if (address !== undefined) {
      updates.push(`address = $${paramIndex}`)
      values.push(address)
      paramIndex++
    }

    if (website !== undefined) {
      updates.push(`website = $${paramIndex}`)
      values.push(website)
      paramIndex++
    }

    if (accountNumber !== undefined) {
      updates.push(`"accountNumber" = $${paramIndex}`)
      values.push(accountNumber)
      paramIndex++
    }

    if (creditLimit !== undefined) {
      updates.push(`"creditLimit" = $${paramIndex}`)
      values.push(creditLimit)
      paramIndex++
    }

    if (creditHold !== undefined) {
      updates.push(`"creditHold" = $${paramIndex}`)
      values.push(creditHold)
      paramIndex++
    }

    if (paymentTerms !== undefined) {
      updates.push(`"paymentTerms" = $${paramIndex}`)
      values.push(paymentTerms)
      paramIndex++
    }

    if (paymentTermDays !== undefined) {
      updates.push(`"paymentTermDays" = $${paramIndex}`)
      values.push(paymentTermDays)
      paramIndex++
    }

    if (earlyPayDiscount !== undefined) {
      updates.push(`"earlyPayDiscount" = $${paramIndex}`)
      values.push(earlyPayDiscount)
      paramIndex++
    }

    if (earlyPayDays !== undefined) {
      updates.push(`"earlyPayDays" = $${paramIndex}`)
      values.push(earlyPayDays)
      paramIndex++
    }

    if (taxId !== undefined) {
      updates.push(`"taxId" = $${paramIndex}`)
      values.push(taxId)
      paramIndex++
    }

    if (notes !== undefined) {
      updates.push(`notes = $${paramIndex}`)
      values.push(notes)
      paramIndex++
    }

    if (active !== undefined) {
      updates.push(`active = $${paramIndex}`)
      values.push(active)
      paramIndex++
    }

    // Always update updatedAt
    updates.push(`"updatedAt" = NOW()`)

    // Only execute if there are changes
    if (updates.length > 1) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Vendor" SET ${updates.join(', ')} WHERE id = $1`,
        ...values
      )
    }

    // Fetch and return updated vendor
    const updatedVendorResult = await prisma.$queryRawUnsafe<VendorDetailRow[]>(
      `SELECT
        id, name, code, "contactName", email, phone, address, website,
        "accountNumber", "creditLimit", "creditUsed", "creditHold",
        "paymentTerms", "paymentTermDays", "earlyPayDiscount", "earlyPayDays",
        "taxId", notes, "avgLeadDays", "onTimeRate", active,
        "createdAt", "updatedAt"
      FROM "Vendor"
      WHERE id = $1`,
      id
    )

    const updatedVendor = updatedVendorResult?.[0]

    if (!updatedVendor) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      )
    }

    // Calculate credit utilization
    const creditUtilization = updatedVendor.creditLimit && updatedVendor.creditUsed
      ? Math.round((updatedVendor.creditUsed / updatedVendor.creditLimit) * 100)
      : null

    return NextResponse.json({
      vendor: {
        id: updatedVendor.id,
        name: updatedVendor.name,
        code: updatedVendor.code,
        contactName: updatedVendor.contactName,
        email: updatedVendor.email,
        phone: updatedVendor.phone,
        address: updatedVendor.address,
        website: updatedVendor.website,
        accountNumber: updatedVendor.accountNumber,
        creditLimit: updatedVendor.creditLimit,
        creditUsed: updatedVendor.creditUsed,
        creditHold: updatedVendor.creditHold,
        creditUtilizationPercent: creditUtilization,
        creditAvailable: updatedVendor.creditLimit && updatedVendor.creditUsed
          ? Math.max(0, updatedVendor.creditLimit - updatedVendor.creditUsed)
          : null,
        paymentTerms: updatedVendor.paymentTerms,
        paymentTermDays: updatedVendor.paymentTermDays,
        earlyPayDiscount: updatedVendor.earlyPayDiscount,
        earlyPayDays: updatedVendor.earlyPayDays,
        taxId: updatedVendor.taxId,
        notes: updatedVendor.notes,
        avgLeadDays: updatedVendor.avgLeadDays,
        onTimeRate: updatedVendor.onTimeRate ? (updatedVendor.onTimeRate * 100).toFixed(2) + '%' : null,
        active: updatedVendor.active,
        createdAt: updatedVendor.createdAt,
        updatedAt: updatedVendor.updatedAt,
      },
    }, { status: 200 })
  } catch (error: any) {
    console.error('PATCH /api/ops/vendors/[id] error:', error)

    // Handle specific database errors
    if (error.message?.includes('duplicate key') && error.message?.includes('code')) {
      return NextResponse.json(
        { error: 'Vendor code already exists' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Failed to update vendor' },
      { status: 500 }
    )
  }
}

// ──────────────────────────────────────────────────────────────────────────
// DELETE: Soft delete vendor (set active = false)
// ──────────────────────────────────────────────────────────────────────────

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id } = params

    // Check if vendor exists
    const vendorResult = await prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM "Vendor" WHERE id = $1`,
      id
    )

    if (vendorResult.length === 0) {
      return NextResponse.json(
        { error: 'Vendor not found' },
        { status: 404 }
      )
    }

    // Soft delete: set active = false and update timestamp
    await prisma.$executeRawUnsafe(
      `UPDATE "Vendor" SET active = false, "updatedAt" = NOW() WHERE id = $1`,
      id
    )

    return NextResponse.json(
      {
        message: 'Vendor deactivated successfully',
        id,
      },
      { status: 200 }
    )
  } catch (error) {
    console.error('DELETE /api/ops/vendors/[id] error:', error)
    return NextResponse.json(
      { error: 'Failed to delete vendor' },
      { status: 500 }
    )
  }
}
