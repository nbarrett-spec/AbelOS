// B-FEAT-6 / A-API-14 — bulk import run endpoint
//
// POST /api/ops/import/run
//   JSON body: {
//     importType: 'INVENTORY_COUNT' | 'PRICE_LIST' | 'BUILDER_LIST',
//     fileName:   string,
//     mapping:    Record<targetField, sourceColumn>,
//     rows:       Record<string, string>[]   // raw rows with original header keys
//   }
//
// Returns: { importLogId, rowsTotal, rowsCreated, rowsUpdated, rowsErrored, errors[] }
//
// Writes:
//   - INVENTORY_COUNT  → InventoryItem.onHand (+ warehouseZone, binLocation)
//                        Match by Product.sku → upsert InventoryItem.
//   - PRICE_LIST       → Product.basePrice and/or Product.cost (by SKU; existing only)
//   - BUILDER_LIST     → Builder by companyName (case-insensitive). Update or create.
//
// PRODUCT_CATALOG is intentionally deferred — bulk-creating Product rows is
// risky given the BoM/pricing/inventory cascades.

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit, getStaffFromHeaders } from '@/lib/audit'
import { maybeCreatePriceChangeRequest } from '@/lib/price-change-detector'
import {
  getImportTypeDef,
  toInt,
  toNum,
  generateBuilderEmail,
  type ImportType,
} from '@/lib/bulk-import'
import * as crypto from 'crypto'

interface RunBody {
  importType: ImportType
  fileName?: string
  mapping: Record<string, string>
  rows: Record<string, string>[]
}

interface RowError {
  row: number // 1-indexed (matches what users see in their CSV viewer + header line)
  message: string
}

interface RunResult {
  rowsTotal: number
  rowsCreated: number
  rowsUpdated: number
  rowsErrored: number
  errors: RowError[]
}

const MAX_ROWS = 50_000
const MAX_ERRORS_RETURNED = 200

// Hash a default password for newly-created builders. Mirrors the helper
// in import-inflow so password format stays consistent.
function hashDefaultPassword(): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const buf = crypto.scryptSync('Abel2026!', salt, 64)
  return `${salt}:${buf.toString('hex')}`
}

/** Pull a mapped value out of a row. Returns '' (not undefined) when unmapped. */
function pull(row: Record<string, string>, mapping: Record<string, string>, key: string): string {
  const src = mapping[key]
  if (!src) return ''
  return (row[src] ?? '').toString().trim()
}

// ─── INVENTORY_COUNT ────────────────────────────────────────────────
async function runInventoryCount(body: RunBody): Promise<RunResult> {
  const errors: RowError[] = []
  let created = 0
  let updated = 0
  const total = body.rows.length

  // Build SKU → product map once (covers entire run; 50k rows × 1 query = NG).
  const products = await prisma.product.findMany({ select: { id: true, sku: true } })
  const skuMap = new Map(products.map(p => [p.sku, p.id]))

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i]
    const rowNum = i + 2 // header is row 1
    try {
      const sku = pull(row, body.mapping, 'sku')
      if (!sku) {
        errors.push({ row: rowNum, message: 'Missing SKU' })
        continue
      }
      const productId = skuMap.get(sku)
      if (!productId) {
        errors.push({ row: rowNum, message: `SKU "${sku}" not found in product catalog` })
        continue
      }
      const onHand = toInt(pull(row, body.mapping, 'onHand'))
      if (onHand == null) {
        errors.push({ row: rowNum, message: 'Missing or invalid On-Hand quantity' })
        continue
      }
      const warehouseZone = pull(row, body.mapping, 'warehouseZone') || undefined
      const binLocation = pull(row, body.mapping, 'binLocation') || undefined

      const existing = await prisma.inventoryItem.findUnique({ where: { productId } })
      if (existing) {
        // Recalculate available based on new onHand.
        const available = Math.max(0, onHand - (existing.committed || 0))
        await prisma.inventoryItem.update({
          where: { productId },
          data: {
            onHand,
            available,
            warehouseZone,
            binLocation,
            lastCountedAt: new Date(),
          },
        })
        updated++
      } else {
        await prisma.inventoryItem.create({
          data: {
            productId,
            onHand,
            available: onHand,
            warehouseZone,
            binLocation,
            lastCountedAt: new Date(),
          },
        })
        created++
      }
    } catch (err: any) {
      errors.push({ row: rowNum, message: err.message?.substring(0, 200) || 'Unknown error' })
    }
  }

  return {
    rowsTotal: total,
    rowsCreated: created,
    rowsUpdated: updated,
    rowsErrored: errors.length,
    errors: errors.slice(0, MAX_ERRORS_RETURNED),
  }
}

// ─── PRICE_LIST ─────────────────────────────────────────────────────
async function runPriceList(body: RunBody): Promise<RunResult> {
  const errors: RowError[] = []
  let updated = 0
  const total = body.rows.length

  const hasPriceMapping = !!body.mapping.basePrice
  const hasCostMapping = !!body.mapping.cost
  if (!hasPriceMapping && !hasCostMapping) {
    return {
      rowsTotal: total,
      rowsCreated: 0,
      rowsUpdated: 0,
      rowsErrored: total,
      errors: [{ row: 0, message: 'Map at least one of basePrice or cost' }],
    }
  }

  // Pull current cost alongside id so the detector can compare before/after
  // without an extra round-trip per row.
  const products = await prisma.product.findMany({
    select: { id: true, sku: true, cost: true },
  })
  const skuMap = new Map(products.map(p => [p.sku, { id: p.id, cost: p.cost }]))

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i]
    const rowNum = i + 2
    try {
      const sku = pull(row, body.mapping, 'sku')
      if (!sku) {
        errors.push({ row: rowNum, message: 'Missing SKU' })
        continue
      }
      const productInfo = skuMap.get(sku)
      if (!productInfo) {
        errors.push({ row: rowNum, message: `SKU "${sku}" not found in product catalog` })
        continue
      }
      const productId = productInfo.id

      const data: { basePrice?: number; cost?: number } = {}
      if (hasPriceMapping) {
        const v = toNum(pull(row, body.mapping, 'basePrice'))
        if (v != null && v >= 0) data.basePrice = v
      }
      if (hasCostMapping) {
        const v = toNum(pull(row, body.mapping, 'cost'))
        if (v != null && v >= 0) data.cost = v
      }

      if (Object.keys(data).length === 0) {
        errors.push({ row: rowNum, message: 'No valid price/cost value' })
        continue
      }

      await prisma.product.update({ where: { id: productId }, data })
      updated++

      // Cost moved? Drop a review-queue entry. Fire-and-forget — never block
      // the bulk import on detector logic.
      if (data.cost != null) {
        maybeCreatePriceChangeRequest({
          productId,
          oldCost: productInfo.cost ?? 0,
          newCost: data.cost,
          source: 'price-list-import',
        }).catch(() => {})
      }
    } catch (err: any) {
      errors.push({ row: rowNum, message: err.message?.substring(0, 200) || 'Unknown error' })
    }
  }

  return {
    rowsTotal: total,
    rowsCreated: 0,
    rowsUpdated: updated,
    rowsErrored: errors.length,
    errors: errors.slice(0, MAX_ERRORS_RETURNED),
  }
}

// ─── BUILDER_LIST ───────────────────────────────────────────────────
async function runBuilderList(body: RunBody): Promise<RunResult> {
  const errors: RowError[] = []
  let created = 0
  let updated = 0
  const total = body.rows.length

  // Existing builder lookup by lowercased companyName.
  const existing = await prisma.builder.findMany({
    select: { id: true, companyName: true, email: true },
  })
  const byName = new Map<string, string>()
  for (const b of existing) byName.set(b.companyName.trim().toLowerCase(), b.id)

  const defaultHash = hashDefaultPassword()

  for (let i = 0; i < body.rows.length; i++) {
    const row = body.rows[i]
    const rowNum = i + 2
    try {
      const companyName = pull(row, body.mapping, 'companyName')
      if (!companyName) {
        errors.push({ row: rowNum, message: 'Missing company name' })
        continue
      }

      const contactName = pull(row, body.mapping, 'contactName') || companyName
      const phone = pull(row, body.mapping, 'phone') || ''
      const address = pull(row, body.mapping, 'address') || null
      const city = pull(row, body.mapping, 'city') || null
      const state = pull(row, body.mapping, 'state') || null
      const zip = pull(row, body.mapping, 'zip') || null
      const email = pull(row, body.mapping, 'email') || generateBuilderEmail(companyName)

      const matchKey = companyName.trim().toLowerCase()
      const existingId = byName.get(matchKey)

      if (existingId) {
        // Update — only set fields that have values; preserve untouched fields.
        const updateData: Record<string, unknown> = { companyName }
        if (contactName) updateData.contactName = contactName
        if (phone) updateData.phone = phone
        if (address) updateData.address = address
        if (city) updateData.city = city
        if (state) updateData.state = state
        if (zip) updateData.zip = zip
        await prisma.builder.update({ where: { id: existingId }, data: updateData })
        updated++
      } else {
        // Email collision check — email is @unique.
        const existingByEmail = await prisma.builder.findUnique({ where: { email } })
        if (existingByEmail) {
          errors.push({ row: rowNum, message: `Builder with email "${email}" already exists (different name)` })
          continue
        }
        const createdRow = await prisma.builder.create({
          data: {
            companyName,
            contactName,
            email,
            phone,
            address,
            city,
            state,
            zip,
            passwordHash: defaultHash,
            status: 'PENDING',
          },
        })
        byName.set(matchKey, createdRow.id)
        created++
      }
    } catch (err: any) {
      errors.push({ row: rowNum, message: err.message?.substring(0, 200) || 'Unknown error' })
    }
  }

  return {
    rowsTotal: total,
    rowsCreated: created,
    rowsUpdated: updated,
    rowsErrored: errors.length,
    errors: errors.slice(0, MAX_ERRORS_RETURNED),
  }
}

// ─── HANDLER ────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  let body: RunBody
  try {
    body = (await request.json()) as RunBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const def = getImportTypeDef(body.importType)
  if (!def) {
    return NextResponse.json({ error: `Unknown importType "${body.importType}"` }, { status: 400 })
  }

  if (!body.mapping || typeof body.mapping !== 'object') {
    return NextResponse.json({ error: 'mapping is required' }, { status: 400 })
  }

  // Required-field gate: every required target field must have a mapping.
  for (const f of def.fields) {
    if (f.required && !body.mapping[f.key]) {
      return NextResponse.json(
        { error: `Required field "${f.label}" is not mapped` },
        { status: 400 },
      )
    }
  }

  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: 'rows must be an array' }, { status: 400 })
  }
  if (body.rows.length === 0) {
    return NextResponse.json({ error: 'No rows to import' }, { status: 400 })
  }
  if (body.rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: `Too many rows (${body.rows.length}). Max ${MAX_ROWS} per run.` },
      { status: 413 },
    )
  }

  // Audit BEFORE running so a partial / crashed run still leaves a
  // breadcrumb. Severity WARN — bulk writes are sensitive.
  audit(
    request,
    `IMPORT_RUN_${body.importType}`,
    'ImportLog',
    undefined,
    { fileName: body.fileName, rowsTotal: body.rows.length, mapping: body.mapping },
    'WARN',
  ).catch(() => {})

  let result: RunResult
  try {
    if (body.importType === 'INVENTORY_COUNT') {
      result = await runInventoryCount(body)
    } else if (body.importType === 'PRICE_LIST') {
      result = await runPriceList(body)
    } else if (body.importType === 'BUILDER_LIST') {
      result = await runBuilderList(body)
    } else {
      return NextResponse.json({ error: `Unsupported importType "${body.importType}"` }, { status: 400 })
    }
  } catch (err: any) {
    console.error('[/api/ops/import/run] dispatcher error:', err)
    return NextResponse.json({ error: 'Import failed', detail: err.message }, { status: 500 })
  }

  // Persist ImportLog. createdById is the staff who ran it (nullable when
  // unknown, mirroring AuditLog convention).
  const staff = getStaffFromHeaders(request.headers)
  let importLogId: string | null = null
  try {
    const log = await prisma.importLog.create({
      data: {
        importType: body.importType,
        fileName: body.fileName?.toString().slice(0, 255) || 'upload.csv',
        rowsTotal: result.rowsTotal,
        rowsCreated: result.rowsCreated,
        rowsUpdated: result.rowsUpdated,
        rowsErrored: result.rowsErrored,
        errors: result.errors as object,
        createdById: staff.staffId !== 'unknown' ? staff.staffId : null,
      },
    })
    importLogId = log.id
  } catch (err: any) {
    // Don't fail the import on log-write failure — just surface it.
    console.error('[/api/ops/import/run] ImportLog write failed:', err)
  }

  return NextResponse.json({
    success: true,
    importLogId,
    ...result,
  })
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  // Recent runs — useful for the page's history strip and the post-mortem
  // workflow. Capped at 25.
  const recent = await prisma.importLog.findMany({
    orderBy: { createdAt: 'desc' },
    take: 25,
  })
  return NextResponse.json({ recent })
}
