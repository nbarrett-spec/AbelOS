export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { hasPermission, parseRoles } from '@/lib/permissions'
import crypto from 'crypto'

/**
 * POST /api/ops/takeoffs/[id]/generate-quote
 *
 * Spin a draft Quote from the current (human-reviewed) takeoff items. Items
 * without a matched productId become custom line items (QuoteItem.productId
 * NULL) so the estimator can price them manually on the quote screen.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const roles = parseRoles(
    request.headers.get('x-staff-roles') || request.headers.get('x-staff-role'),
  )
  if (!hasPermission(roles, 'takeoff:edit')) {
    return NextResponse.json({ error: 'Forbidden — missing takeoff:edit' }, { status: 403 })
  }

  // Schema drift guard — align with /api/ops/quotes runtime migrations.
  await ensureSchema()

  const takeoffRows = await prisma.$queryRawUnsafe<
    { id: string; projectId: string; status: string }[]
  >(
    `SELECT "id","projectId","status" FROM "Takeoff" WHERE "id" = $1 LIMIT 1`,
    params.id,
  )
  if (!takeoffRows || takeoffRows.length === 0) {
    return NextResponse.json({ error: 'Takeoff not found' }, { status: 404 })
  }
  const takeoff = takeoffRows[0]

  const existing = await prisma.$queryRawUnsafe<{ id: string }[]>(
    `SELECT "id" FROM "Quote" WHERE "takeoffId" = $1 LIMIT 1`,
    params.id,
  )
  if (existing.length > 0) {
    return NextResponse.json({
      quoteId: existing[0].id,
      reused: true,
      message: 'Quote already exists for this takeoff',
    })
  }

  const items = await prisma.$queryRawUnsafe<
    {
      id: string
      description: string
      quantity: number
      productId: string | null
      basePrice: number | null
      location: string | null
    }[]
  >(
    `SELECT ti."id", ti."description", ti."quantity", ti."productId",
            ti."location", p."basePrice" AS "basePrice"
     FROM "TakeoffItem" ti
     LEFT JOIN "Product" p ON p."id" = ti."productId"
     WHERE ti."takeoffId" = $1
     ORDER BY ti."category", ti."description"`,
    params.id,
  )

  if (!items || items.length === 0) {
    return NextResponse.json(
      { error: 'Takeoff has no items — extract or add rows first' },
      { status: 400 },
    )
  }

  // Quote number: ABL-YYYY-NNNN, zero-padded per year.
  const year = new Date().getFullYear()
  const countRows = await prisma.$queryRawUnsafe<{ cnt: number }[]>(
    `SELECT COUNT(*)::int AS cnt FROM "Quote" WHERE "quoteNumber" LIKE $1`,
    `ABL-${year}-%`,
  )
  const next = (Number(countRows[0]?.cnt) || 0) + 1
  const quoteNumber = `ABL-${year}-${String(next).padStart(4, '0')}`

  const quoteId = 'q_' + crypto.randomBytes(8).toString('hex')

  let subtotal = 0
  const lineItems: Array<{
    id: string
    productId: string | null
    description: string
    quantity: number
    unitPrice: number
    lineTotal: number
    location: string | null
  }> = []
  for (const item of items) {
    const unitPrice = item.basePrice ?? 0
    const lineTotal = unitPrice * item.quantity
    subtotal += lineTotal
    lineItems.push({
      id: 'qi_' + crypto.randomBytes(6).toString('hex'),
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice,
      lineTotal,
      location: item.location,
    })
  }

  const total = subtotal // tax + term adj applied on quote detail page
  await prisma.$executeRawUnsafe(
    `INSERT INTO "Quote"
       ("id","projectId","takeoffId","quoteNumber","version","subtotal","taxRate",
        "taxAmount","termAdjustment","total","status","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,1,$5,0,0,0,$6,'DRAFT',NOW(),NOW())`,
    quoteId,
    takeoff.projectId,
    params.id,
    quoteNumber,
    subtotal,
    total,
  )

  for (const li of lineItems) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QuoteItem"
         ("id","quoteId","productId","description","quantity","unitPrice","lineTotal","location","sortOrder")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0)`,
      li.id,
      quoteId,
      li.productId,
      li.description,
      li.quantity,
      li.unitPrice,
      li.lineTotal,
      li.location,
    )
  }

  await prisma.$executeRawUnsafe(
    `UPDATE "Takeoff" SET "status" = 'APPROVED', "updatedAt" = NOW() WHERE "id" = $1`,
    params.id,
  )

  await audit(request, 'CREATE', 'Quote', quoteId, {
    via: 'takeoff-tool/generate-quote',
    takeoffId: params.id,
    quoteNumber,
    lineCount: lineItems.length,
    subtotal,
  })

  return NextResponse.json({
    quoteId,
    quoteNumber,
    lineCount: lineItems.length,
    subtotal,
    redirectTo: `/ops/quotes/${quoteId}`,
  })
}

async function ensureSchema() {
  const migrations = [
    `ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "termAdjustment" DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE "Quote" ADD COLUMN IF NOT EXISTS "version" INT DEFAULT 1`,
    `ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "location" TEXT`,
    `ALTER TABLE "QuoteItem" ADD COLUMN IF NOT EXISTS "sortOrder" INT DEFAULT 0`,
    `ALTER TABLE "QuoteItem" ALTER COLUMN "productId" DROP NOT NULL`,
  ]
  for (const sql of migrations) {
    try { await prisma.$executeRawUnsafe(sql) }
    catch (e: any) { console.warn('[takeoff/generate-quote ensureSchema]', sql.slice(0, 60), e?.message) }
  }
}
