/**
 * Abel OS — Seed data importer
 *
 * Reads Abel_OS_Seed_Data.xlsx and imports into the prod Neon Postgres DB
 * in FK-safe order. Idempotent: re-running the same workbook will update
 * existing records rather than duplicate.
 *
 * Usage:
 *   npx tsx prisma/seed-from-xlsx.ts --dry-run
 *   npx tsx prisma/seed-from-xlsx.ts
 *
 * Flags:
 *   --dry-run         Log what would happen, don't write
 *   --file=<path>     Override workbook path (default: ./Abel_OS_Seed_Data.xlsx)
 *   --only=<sheet>    Import only one sheet (e.g. --only=Staff)
 *
 * Output:
 *   prisma/seed-log-<YYYY-MM-DD>.json — per-row action log
 */

import { PrismaClient } from '@prisma/client'
import * as XLSX from 'xlsx'
import * as bcrypt from 'bcryptjs'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

const prisma = new PrismaClient()

// ----------------------------------------------------------------------------
// CLI args
// ----------------------------------------------------------------------------
const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const FILE_ARG = args.find(a => a.startsWith('--file='))
const ONLY_ARG = args.find(a => a.startsWith('--only='))
const WORKBOOK_PATH = FILE_ARG
  ? FILE_ARG.split('=')[1]
  : path.join(process.cwd(), 'Abel_OS_Seed_Data.xlsx')
const ONLY_SHEET = ONLY_ARG ? ONLY_ARG.split('=')[1] : null

// ----------------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------------
type LogEntry = {
  sheet: string
  row: number
  action: 'created' | 'updated' | 'skipped' | 'failed'
  id?: string
  key?: string
  reason?: string
}
const logEntries: LogEntry[] = []
const summary: Record<string, { created: number; updated: number; skipped: number; failed: number }> = {}

function record(entry: LogEntry) {
  logEntries.push(entry)
  if (!summary[entry.sheet]) {
    summary[entry.sheet] = { created: 0, updated: 0, skipped: 0, failed: 0 }
  }
  summary[entry.sheet][entry.action]++
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------
function loadSheet(wb: XLSX.WorkBook, sheetName: string): Record<string, any>[] {
  if (!wb.SheetNames.includes(sheetName)) {
    console.warn(`  ⚠  Sheet '${sheetName}' not found in workbook, skipping`)
    return []
  }
  const ws = wb.Sheets[sheetName]
  // range starts from header row — find the first row that looks like headers (not the title)
  const raw: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null })
  // find the row containing the expected first column header (we'll detect by scanning for a known pattern)
  // Our workbook has title in row 1 (merged), optional note rows, then header row.
  // Simplest approach: find the row where column A is a non-empty string that's NOT the title.
  // We know the title starts with "Staff —" / "Vendors —" etc. Let's find the first row where >2 columns are populated.
  let headerIdx = -1
  for (let i = 0; i < raw.length; i++) {
    const nonNull = raw[i].filter((c: any) => c !== null && c !== '').length
    if (nonNull >= 3) {
      // verify it's not the title by checking if the first cell contains '—'
      const first = String(raw[i][0] ?? '')
      if (!first.includes('—') && !first.startsWith('Enum')) {
        headerIdx = i
        break
      }
    }
  }
  if (headerIdx === -1) return []
  const headers: string[] = raw[headerIdx].map((h: any) => String(h ?? '').trim())
  const data: Record<string, any>[] = []
  for (let i = headerIdx + 1; i < raw.length; i++) {
    const row = raw[i]
    if (!row || row.every((c: any) => c === null || c === '')) continue
    const obj: Record<string, any> = {}
    headers.forEach((h, idx) => {
      if (h) obj[h] = row[idx] ?? null
    })
    data.push(obj)
  }
  return data
}

function boolish(v: any, dflt = false): boolean {
  if (v === null || v === undefined || v === '') return dflt
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toUpperCase()
  return s === 'TRUE' || s === 'YES' || s === '1' || s === 'Y'
}

function numOrNull(v: any): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return isNaN(n) ? null : n
}

function intOrNull(v: any): number | null {
  const n = numOrNull(v)
  return n === null ? null : Math.trunc(n)
}

function dateOrNull(v: any): Date | null {
  if (v === null || v === undefined || v === '') return null
  // Excel sometimes returns Date objects, sometimes strings
  if (v instanceof Date) return v
  const s = String(v).trim()
  if (!s) return null
  const d = new Date(s)
  return isNaN(d.getTime()) ? null : d
}

function strOrNull(v: any): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s === '' ? null : s
}

async function hashOrResetToken(initialPassword: string | null): Promise<{ passwordHash: string; resetToken: string | null; resetTokenExpiry: Date | null }> {
  if (initialPassword && initialPassword.length >= 8) {
    return { passwordHash: await bcrypt.hash(initialPassword, 10), resetToken: null, resetTokenExpiry: null }
  }
  // Generate a placeholder hash the user can never log in with, plus a reset token
  const placeholder = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10)
  const resetToken = crypto.randomBytes(32).toString('hex')
  const resetTokenExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000)
  return { passwordHash: placeholder, resetToken, resetTokenExpiry }
}

let dealCounter = 0
let contractCounter = 0
async function nextDealNumber(): Promise<string> {
  if (dealCounter === 0) {
    const last = await prisma.deal.findFirst({
      where: { dealNumber: { startsWith: 'DEAL-2026-' } },
      orderBy: { dealNumber: 'desc' },
    })
    dealCounter = last ? parseInt(last.dealNumber.split('-')[2], 10) : 0
  }
  dealCounter++
  return `DEAL-2026-${String(dealCounter).padStart(4, '0')}`
}
async function nextContractNumber(): Promise<string> {
  if (contractCounter === 0) {
    const last = await prisma.contract.findFirst({
      where: { contractNumber: { startsWith: 'CTR-2026-' } },
      orderBy: { contractNumber: 'desc' },
    })
    contractCounter = last ? parseInt(last.contractNumber.split('-')[2], 10) : 0
  }
  contractCounter++
  return `CTR-2026-${String(contractCounter).padStart(4, '0')}`
}

function shouldRun(sheet: string): boolean {
  return !ONLY_SHEET || ONLY_SHEET === sheet
}

// ----------------------------------------------------------------------------
// Importers
// ----------------------------------------------------------------------------

async function importStaff(rows: Record<string, any>[]) {
  console.log(`\n→ Staff (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const email = strOrNull(r.email)?.toLowerCase()
    if (!email) {
      record({ sheet: 'Staff', row: i + 2, action: 'failed', reason: 'missing email' })
      continue
    }
    try {
      const existing = await prisma.staff.findUnique({ where: { email } })
      const data = {
        firstName: strOrNull(r.firstName) ?? '',
        lastName: strOrNull(r.lastName) ?? '',
        email,
        phone: strOrNull(r.phone),
        role: strOrNull(r.role) as any,
        roles: strOrNull(r.roles),
        department: strOrNull(r.department) as any,
        title: strOrNull(r.title),
        hireDate: dateOrNull(r.hireDate),
        hourlyRate: numOrNull(r.hourlyRate),
        active: boolish(r.active, true),
      }
      if (DRY_RUN) {
        record({ sheet: 'Staff', row: i + 2, action: existing ? 'updated' : 'created', key: email, id: existing?.id })
        continue
      }
      if (existing) {
        const updated = await prisma.staff.update({ where: { email }, data })
        record({ sheet: 'Staff', row: i + 2, action: 'updated', id: updated.id, key: email })
      } else {
        const { passwordHash, resetToken, resetTokenExpiry } = await hashOrResetToken(null)
        const created = await prisma.staff.create({
          data: { ...data, passwordHash /* Staff schema has no resetToken fields; token flow handled separately */ },
        })
        record({ sheet: 'Staff', row: i + 2, action: 'created', id: created.id, key: email })
      }
    } catch (e: any) {
      record({ sheet: 'Staff', row: i + 2, action: 'failed', key: email, reason: e.message })
    }
  }
}

async function importVendors(rows: Record<string, any>[]) {
  console.log(`\n→ Vendors (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const code = strOrNull(r.code)
    if (!code) {
      record({ sheet: 'Vendors', row: i + 2, action: 'failed', reason: 'missing code' })
      continue
    }
    try {
      const data = {
        code,
        name: strOrNull(r.name) ?? '',
        contactName: strOrNull(r.contactName),
        email: strOrNull(r.email),
        phone: strOrNull(r.phone),
        address: strOrNull(r.address),
        website: strOrNull(r.website),
        accountNumber: strOrNull(r.accountNumber),
        avgLeadDays: intOrNull(r.avgLeadDays),
        onTimeRate: numOrNull(r.onTimeRate),
        active: boolish(r.active, true),
      }
      const existing = await prisma.vendor.findUnique({ where: { code } })
      if (DRY_RUN) {
        record({ sheet: 'Vendors', row: i + 2, action: existing ? 'updated' : 'created', key: code })
        continue
      }
      const result = existing
        ? await prisma.vendor.update({ where: { code }, data })
        : await prisma.vendor.create({ data })
      record({ sheet: 'Vendors', row: i + 2, action: existing ? 'updated' : 'created', id: result.id, key: code })
    } catch (e: any) {
      record({ sheet: 'Vendors', row: i + 2, action: 'failed', key: code, reason: e.message })
    }
  }
}

async function importProducts(rows: Record<string, any>[]) {
  console.log(`\n→ Products (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const sku = strOrNull(r.sku)
    if (!sku) {
      record({ sheet: 'Products', row: i + 2, action: 'failed', reason: 'missing sku' })
      continue
    }
    try {
      const data = {
        sku,
        name: strOrNull(r.name) ?? '',
        displayName: strOrNull(r.displayName),
        description: strOrNull(r.description),
        category: strOrNull(r.category) ?? 'Uncategorized',
        subcategory: strOrNull(r.subcategory),
        cost: numOrNull(r.cost) ?? 0,
        basePrice: numOrNull(r.basePrice) ?? 0,
        minMargin: numOrNull(r.minMargin) ?? 0.25,
        doorSize: strOrNull(r.doorSize),
        handing: strOrNull(r.handing),
        coreType: strOrNull(r.coreType),
        panelStyle: strOrNull(r.panelStyle),
        jambSize: strOrNull(r.jambSize),
        casingCode: strOrNull(r.casingCode),
        hardwareFinish: strOrNull(r.hardwareFinish),
        material: strOrNull(r.material),
        fireRating: strOrNull(r.fireRating),
        leadTimeDays: intOrNull(r.leadTimeDays),
        active: boolish(r.active, true),
        inStock: boolish(r.inStock, true),
        inflowId: strOrNull(r.inflowId),
      }
      const existing = await prisma.product.findUnique({ where: { sku } })
      if (DRY_RUN) {
        record({ sheet: 'Products', row: i + 2, action: existing ? 'updated' : 'created', key: sku })
        continue
      }
      const result = existing
        ? await prisma.product.update({ where: { sku }, data })
        : await prisma.product.create({ data })
      record({ sheet: 'Products', row: i + 2, action: existing ? 'updated' : 'created', id: result.id, key: sku })
    } catch (e: any) {
      record({ sheet: 'Products', row: i + 2, action: 'failed', key: sku, reason: e.message })
    }
  }
}

async function importBuilders(rows: Record<string, any>[]) {
  console.log(`\n→ Builders (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const email = strOrNull(r.email)?.toLowerCase()
    if (!email) {
      record({ sheet: 'Builders', row: i + 2, action: 'failed', reason: 'missing email' })
      continue
    }
    try {
      const initialPassword = strOrNull(r.initialPassword)
      const existing = await prisma.builder.findUnique({ where: { email } })
      const baseData = {
        companyName: strOrNull(r.companyName) ?? '',
        contactName: strOrNull(r.contactName) ?? '',
        email,
        phone: strOrNull(r.phone),
        address: strOrNull(r.address),
        city: strOrNull(r.city),
        state: strOrNull(r.state),
        zip: strOrNull(r.zip),
        licenseNumber: strOrNull(r.licenseNumber),
        paymentTerm: (strOrNull(r.paymentTerm) ?? 'NET_15') as any,
        creditLimit: numOrNull(r.creditLimit),
        taxExempt: boolish(r.taxExempt, false),
        taxId: strOrNull(r.taxId),
        status: (strOrNull(r.status) ?? 'ACTIVE') as any,
        qbListId: strOrNull(r.qbListId),
      }
      if (DRY_RUN) {
        record({ sheet: 'Builders', row: i + 2, action: existing ? 'updated' : 'created', key: email })
        continue
      }
      if (existing) {
        const updated = await prisma.builder.update({ where: { email }, data: baseData })
        record({ sheet: 'Builders', row: i + 2, action: 'updated', id: updated.id, key: email })
      } else {
        const { passwordHash, resetToken, resetTokenExpiry } = await hashOrResetToken(initialPassword)
        const created = await prisma.builder.create({
          data: { ...baseData, passwordHash, resetToken, resetTokenExpiry, emailVerified: !!initialPassword },
        })
        record({ sheet: 'Builders', row: i + 2, action: 'created', id: created.id, key: email })
      }
    } catch (e: any) {
      record({ sheet: 'Builders', row: i + 2, action: 'failed', key: email, reason: e.message })
    }
  }
}

async function importBuilderPricing(rows: Record<string, any>[]) {
  console.log(`\n→ BuilderPricing (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const builderEmail = strOrNull(r.builderEmail)?.toLowerCase()
    const sku = strOrNull(r.productSku)
    const price = numOrNull(r.customPrice)
    if (!builderEmail || !sku || price === null) {
      record({ sheet: 'BuilderPricing', row: i + 2, action: 'failed', reason: 'missing builderEmail, productSku, or customPrice' })
      continue
    }
    try {
      const builder = await prisma.builder.findUnique({ where: { email: builderEmail } })
      const product = await prisma.product.findUnique({ where: { sku } })
      if (!builder) { record({ sheet: 'BuilderPricing', row: i + 2, action: 'failed', reason: `builder not found: ${builderEmail}` }); continue }
      if (!product) { record({ sheet: 'BuilderPricing', row: i + 2, action: 'failed', reason: `product not found: ${sku}` }); continue }

      const margin = product.cost > 0 ? (price - product.cost) / price : null
      const existing = await prisma.builderPricing.findFirst({
        where: { builderId: builder.id, productId: product.id },
      })
      if (DRY_RUN) {
        record({ sheet: 'BuilderPricing', row: i + 2, action: existing ? 'updated' : 'created', key: `${builderEmail}|${sku}` })
        continue
      }
      const result = existing
        ? await prisma.builderPricing.update({ where: { id: existing.id }, data: { customPrice: price, margin } })
        : await prisma.builderPricing.create({ data: { builderId: builder.id, productId: product.id, customPrice: price, margin } })
      record({ sheet: 'BuilderPricing', row: i + 2, action: existing ? 'updated' : 'created', id: result.id, key: `${builderEmail}|${sku}` })
    } catch (e: any) {
      record({ sheet: 'BuilderPricing', row: i + 2, action: 'failed', key: `${builderEmail}|${sku}`, reason: e.message })
    }
  }
}

async function importOrderTemplates(rows: Record<string, any>[]) {
  console.log(`\n→ OrderTemplates (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    const builderEmail = strOrNull(r.builderEmail)?.toLowerCase()
    const name = strOrNull(r.templateName)
    const itemsStr = strOrNull(r.items)
    if (!builderEmail || !name || !itemsStr) {
      record({ sheet: 'OrderTemplates', row: i + 2, action: 'failed', reason: 'missing builderEmail, templateName, or items' })
      continue
    }
    try {
      const builder = await prisma.builder.findUnique({ where: { email: builderEmail } })
      if (!builder) { record({ sheet: 'OrderTemplates', row: i + 2, action: 'failed', reason: `builder not found: ${builderEmail}` }); continue }

      // Parse "SKU:qty;SKU:qty"
      const itemSpecs = itemsStr.split(';').map(s => s.trim()).filter(Boolean).map(pair => {
        const [sku, qty] = pair.split(':').map(s => s.trim())
        return { sku, quantity: parseInt(qty, 10) }
      })

      // Resolve all SKUs
      const products = await prisma.product.findMany({ where: { sku: { in: itemSpecs.map(i => i.sku) } } })
      const skuToId = Object.fromEntries(products.map(p => [p.sku, p.id]))
      const missing = itemSpecs.filter(s => !skuToId[s.sku])
      if (missing.length) {
        record({ sheet: 'OrderTemplates', row: i + 2, action: 'failed', reason: `unknown SKUs: ${missing.map(m => m.sku).join(', ')}` })
        continue
      }

      const existing = await prisma.orderTemplate.findFirst({ where: { builderId: builder.id, name } })
      if (DRY_RUN) {
        record({ sheet: 'OrderTemplates', row: i + 2, action: existing ? 'updated' : 'created', key: `${builderEmail}|${name}` })
        continue
      }
      if (existing) {
        // Replace items
        await prisma.orderTemplateItem.deleteMany({ where: { templateId: existing.id } })
        await prisma.orderTemplate.update({
          where: { id: existing.id },
          data: {
            description: strOrNull(r.description),
            items: { create: itemSpecs.map(s => ({ productId: skuToId[s.sku], quantity: s.quantity })) },
          },
        })
        record({ sheet: 'OrderTemplates', row: i + 2, action: 'updated', id: existing.id, key: `${builderEmail}|${name}` })
      } else {
        const created = await prisma.orderTemplate.create({
          data: {
            builderId: builder.id,
            name,
            description: strOrNull(r.description),
            items: { create: itemSpecs.map(s => ({ productId: skuToId[s.sku], quantity: s.quantity })) },
          },
        })
        record({ sheet: 'OrderTemplates', row: i + 2, action: 'created', id: created.id, key: `${builderEmail}|${name}` })
      }
    } catch (e: any) {
      record({ sheet: 'OrderTemplates', row: i + 2, action: 'failed', key: `${builderEmail}|${name}`, reason: e.message })
    }
  }
}

async function importDeals(rows: Record<string, any>[]) {
  console.log(`\n→ Deals (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    try {
      const ownerEmail = strOrNull(r.ownerEmail)?.toLowerCase()
      if (!ownerEmail) {
        record({ sheet: 'Deals', row: i + 2, action: 'failed', reason: 'missing ownerEmail' })
        continue
      }
      const owner = await prisma.staff.findUnique({ where: { email: ownerEmail } })
      if (!owner) {
        record({ sheet: 'Deals', row: i + 2, action: 'failed', reason: `staff owner not found: ${ownerEmail}` })
        continue
      }
      let builderId: string | null = null
      const builderEmail = strOrNull(r.builderEmail)?.toLowerCase()
      if (builderEmail) {
        const b = await prisma.builder.findUnique({ where: { email: builderEmail } })
        builderId = b?.id ?? null
      }

      let dealNumber = strOrNull(r.dealNumber)
      if (!dealNumber) dealNumber = await nextDealNumber()

      const data = {
        dealNumber,
        companyName: strOrNull(r.companyName) ?? '',
        contactName: strOrNull(r.contactName) ?? '',
        contactEmail: strOrNull(r.contactEmail),
        contactPhone: strOrNull(r.contactPhone),
        address: strOrNull(r.address),
        city: strOrNull(r.city),
        state: strOrNull(r.state),
        zip: strOrNull(r.zip),
        stage: (strOrNull(r.stage) ?? 'PROSPECT') as any,
        probability: intOrNull(r.probability) ?? 10,
        dealValue: numOrNull(r.dealValue) ?? 0,
        source: (strOrNull(r.source) ?? 'OUTBOUND') as any,
        expectedCloseDate: dateOrNull(r.expectedCloseDate),
        ownerId: owner.id,
        builderId,
        description: strOrNull(r.description),
        notes: strOrNull(r.notes),
      }
      const existing = await prisma.deal.findUnique({ where: { dealNumber } })
      if (DRY_RUN) {
        record({ sheet: 'Deals', row: i + 2, action: existing ? 'updated' : 'created', key: dealNumber })
        continue
      }
      const result = existing
        ? await prisma.deal.update({ where: { dealNumber }, data })
        : await prisma.deal.create({ data })
      record({ sheet: 'Deals', row: i + 2, action: existing ? 'updated' : 'created', id: result.id, key: dealNumber })
    } catch (e: any) {
      record({ sheet: 'Deals', row: i + 2, action: 'failed', reason: e.message })
    }
  }
}

async function importContracts(rows: Record<string, any>[]) {
  console.log(`\n→ Contracts (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    try {
      let dealId: string | null = null
      const dealCompany = strOrNull(r.dealCompanyName)
      if (dealCompany) {
        const d = await prisma.deal.findFirst({ where: { companyName: dealCompany } })
        dealId = d?.id ?? null
      }
      let builderId: string | null = null
      const builderEmail = strOrNull(r.builderEmail)?.toLowerCase()
      if (builderEmail) {
        const b = await prisma.builder.findUnique({ where: { email: builderEmail } })
        builderId = b?.id ?? null
      }
      let createdById: string | null = null
      const createdByEmail = strOrNull(r.createdByEmail)?.toLowerCase()
      if (createdByEmail) {
        const s = await prisma.staff.findUnique({ where: { email: createdByEmail } })
        createdById = s?.id ?? null
      }

      let contractNumber = strOrNull(r.contractNumber)
      if (!contractNumber) contractNumber = await nextContractNumber()

      const data = {
        contractNumber,
        dealId,
        builderId,
        title: strOrNull(r.title) ?? '',
        type: (strOrNull(r.type) ?? 'SUPPLY_AGREEMENT') as any,
        status: (strOrNull(r.status) ?? 'DRAFT') as any,
        paymentTerm: strOrNull(r.paymentTerm) as any,
        creditLimit: numOrNull(r.creditLimit),
        estimatedAnnual: numOrNull(r.estimatedAnnual),
        discountPercent: numOrNull(r.discountPercent),
        startDate: dateOrNull(r.startDate),
        endDate: dateOrNull(r.endDate),
        signedDate: dateOrNull(r.signedDate),
        expiresDate: dateOrNull(r.expiresDate),
        createdById,
        documentUrl: strOrNull(r.documentUrl),
        terms: strOrNull(r.terms),
        specialClauses: strOrNull(r.specialClauses),
      }
      const existing = await prisma.contract.findUnique({ where: { contractNumber } })
      if (DRY_RUN) {
        record({ sheet: 'Contracts', row: i + 2, action: existing ? 'updated' : 'created', key: contractNumber })
        continue
      }
      const result = existing
        ? await prisma.contract.update({ where: { contractNumber }, data: data as any })
        : await prisma.contract.create({ data: data as any })
      record({ sheet: 'Contracts', row: i + 2, action: existing ? 'updated' : 'created', id: result.id, key: contractNumber })
    } catch (e: any) {
      record({ sheet: 'Contracts', row: i + 2, action: 'failed', reason: e.message })
    }
  }
}

async function importProjects(rows: Record<string, any>[]) {
  console.log(`\n→ Projects (${rows.length} rows)`)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    try {
      const builderEmail = strOrNull(r.builderEmail)?.toLowerCase()
      const name = strOrNull(r.name)
      if (!builderEmail || !name) {
        record({ sheet: 'Projects', row: i + 2, action: 'failed', reason: 'missing builderEmail or name' })
        continue
      }
      const builder = await prisma.builder.findUnique({ where: { email: builderEmail } })
      if (!builder) { record({ sheet: 'Projects', row: i + 2, action: 'failed', reason: `builder not found: ${builderEmail}` }); continue }

      const data = {
        builderId: builder.id,
        name,
        jobAddress: strOrNull(r.jobAddress),
        city: strOrNull(r.city),
        state: strOrNull(r.state),
        lotNumber: strOrNull(r.lotNumber),
        subdivision: strOrNull(r.subdivision),
        planName: strOrNull(r.planName),
        sqFootage: intOrNull(r.sqFootage),
        status: (strOrNull(r.status) ?? 'ACTIVE') as any,
      }
      const existing = await prisma.project.findFirst({ where: { builderId: builder.id, name } })
      if (DRY_RUN) {
        record({ sheet: 'Projects', row: i + 2, action: existing ? 'updated' : 'created', key: `${builderEmail}|${name}` })
        continue
      }
      const result = existing
        ? await prisma.project.update({ where: { id: existing.id }, data })
        : await prisma.project.create({ data })
      record({ sheet: 'Projects', row: i + 2, action: existing ? 'updated' : 'created', id: result.id, key: `${builderEmail}|${name}` })
    } catch (e: any) {
      record({ sheet: 'Projects', row: i + 2, action: 'failed', reason: e.message })
    }
  }
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  console.log('═══════════════════════════════════════════════════════════')
  console.log('  Abel OS — Seed Data Importer')
  console.log(`  Mode: ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE WRITE'}`)
  console.log(`  File: ${WORKBOOK_PATH}`)
  if (ONLY_SHEET) console.log(`  Only: ${ONLY_SHEET}`)
  console.log('═══════════════════════════════════════════════════════════')

  if (!fs.existsSync(WORKBOOK_PATH)) {
    console.error(`✗ Workbook not found: ${WORKBOOK_PATH}`)
    process.exit(1)
  }

  const wb = XLSX.readFile(WORKBOOK_PATH)

  if (shouldRun('Staff')) await importStaff(loadSheet(wb, 'Staff'))
  if (shouldRun('Vendors')) await importVendors(loadSheet(wb, 'Vendors'))
  if (shouldRun('Products')) await importProducts(loadSheet(wb, 'Products'))
  if (shouldRun('Builders')) await importBuilders(loadSheet(wb, 'Builders'))
  if (shouldRun('BuilderPricing')) await importBuilderPricing(loadSheet(wb, 'BuilderPricing'))
  if (shouldRun('OrderTemplates')) await importOrderTemplates(loadSheet(wb, 'OrderTemplates'))
  if (shouldRun('Deals')) await importDeals(loadSheet(wb, 'Deals'))
  if (shouldRun('Contracts')) await importContracts(loadSheet(wb, 'Contracts'))
  if (shouldRun('Projects')) await importProjects(loadSheet(wb, 'Projects'))

  // Summary
  console.log('\n═══════════════════════════════════════════════════════════')
  console.log('  Summary')
  console.log('═══════════════════════════════════════════════════════════')
  const headers = ['Sheet', 'Created', 'Updated', 'Skipped', 'Failed']
  console.log(headers.map(h => h.padEnd(16)).join(''))
  for (const [sheet, counts] of Object.entries(summary)) {
    console.log([sheet, counts.created, counts.updated, counts.skipped, counts.failed].map(v => String(v).padEnd(16)).join(''))
  }

  // Save log
  const today = new Date().toISOString().slice(0, 10)
  const logPath = path.join(process.cwd(), 'prisma', `seed-log-${today}.json`)
  fs.writeFileSync(logPath, JSON.stringify({ dryRun: DRY_RUN, summary, entries: logEntries }, null, 2))
  console.log(`\n✓ Log written: ${logPath}`)

  const failures = logEntries.filter(e => e.action === 'failed')
  if (failures.length) {
    console.log(`\n⚠  ${failures.length} failures:`)
    failures.forEach(f => console.log(`   ${f.sheet} row ${f.row}: ${f.reason}`))
    process.exit(1)
  }

  if (DRY_RUN) {
    console.log('\n→ DRY RUN complete. Re-run without --dry-run to commit.')
  } else {
    console.log('\n✓ Import complete.')
  }
}

main()
  .catch(async (e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
