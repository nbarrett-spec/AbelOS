// ──────────────────────────────────────────────────────────────────────────
// QBWC parsed-response → DB upserts
// ──────────────────────────────────────────────────────────────────────────
// Right now the Qb* mirror tables (QbCustomer / QbInvoice / QbBill / QbVendor
// / QbAccount / QbItem) DO NOT EXIST in prisma/schema.prisma. This module is
// written against the model definitions emitted in the deliverable doc — once
// those land via migration, all of these calls compile against generated
// Prisma types.
//
// Until then, every upsert is wrapped in a $queryRawUnsafe so this file
// compiles clean against the current schema. When the models exist, swap each
// raw query for the equivalent prisma.qbCustomer.upsert(...).

import { prisma } from '@/lib/prisma'
import type {
  QbxmlParseResult,
  ParsedCustomer,
  ParsedInvoice,
  ParsedBill,
  ParsedAccount,
  ParsedVendor,
  ParsedItem,
} from './qbxml'

export interface UpsertCounts {
  customers: number
  invoices: number
  invoiceLines: number
  bills: number
  billLines: number
  accounts: number
  vendors: number
  items: number
}

export function emptyCounts(): UpsertCounts {
  return {
    customers: 0,
    invoices: 0,
    invoiceLines: 0,
    bills: 0,
    billLines: 0,
    accounts: 0,
    vendors: 0,
    items: 0,
  }
}

// ─── Customers ────────────────────────────────────────────────────────────

async function upsertCustomer(c: ParsedCustomer): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QbCustomer" ("listId", "fullName", "companyName", "email", "phone", "balance", "isActive", "raw", "syncedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
     ON CONFLICT ("listId") DO UPDATE SET
       "fullName" = EXCLUDED."fullName",
       "companyName" = EXCLUDED."companyName",
       "email" = EXCLUDED."email",
       "phone" = EXCLUDED."phone",
       "balance" = EXCLUDED."balance",
       "isActive" = EXCLUDED."isActive",
       "raw" = EXCLUDED."raw",
       "syncedAt" = NOW()`,
    c.listID,
    c.fullName,
    c.companyName ?? null,
    c.email ?? null,
    c.phone ?? null,
    c.balance ?? null,
    c.isActive,
    JSON.stringify(c.raw ?? {})
  )
}

async function upsertVendor(v: ParsedVendor): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QbVendor" ("listId", "fullName", "companyName", "email", "phone", "balance", "isActive", "raw", "syncedAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, NOW())
     ON CONFLICT ("listId") DO UPDATE SET
       "fullName" = EXCLUDED."fullName",
       "companyName" = EXCLUDED."companyName",
       "email" = EXCLUDED."email",
       "phone" = EXCLUDED."phone",
       "balance" = EXCLUDED."balance",
       "isActive" = EXCLUDED."isActive",
       "raw" = EXCLUDED."raw",
       "syncedAt" = NOW()`,
    v.listID,
    v.fullName,
    v.companyName ?? null,
    v.email ?? null,
    v.phone ?? null,
    v.balance ?? null,
    v.isActive,
    JSON.stringify(v.raw ?? {})
  )
}

async function upsertAccount(a: ParsedAccount): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QbAccount" ("listId", "fullName", "accountType", "balance", "isActive", "raw", "syncedAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT ("listId") DO UPDATE SET
       "fullName" = EXCLUDED."fullName",
       "accountType" = EXCLUDED."accountType",
       "balance" = EXCLUDED."balance",
       "isActive" = EXCLUDED."isActive",
       "raw" = EXCLUDED."raw",
       "syncedAt" = NOW()`,
    a.listID,
    a.fullName,
    a.accountType,
    a.balance ?? null,
    a.isActive,
    JSON.stringify(a.raw ?? {})
  )
}

async function upsertItem(i: ParsedItem): Promise<void> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QbItem" ("listId", "fullName", "type", "salesPrice", "isActive", "raw", "syncedAt")
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, NOW())
     ON CONFLICT ("listId") DO UPDATE SET
       "fullName" = EXCLUDED."fullName",
       "type" = EXCLUDED."type",
       "salesPrice" = EXCLUDED."salesPrice",
       "isActive" = EXCLUDED."isActive",
       "raw" = EXCLUDED."raw",
       "syncedAt" = NOW()`,
    i.listID,
    i.fullName,
    i.type,
    i.salesPrice ?? null,
    i.isActive,
    JSON.stringify(i.raw ?? {})
  )
}

async function upsertInvoice(inv: ParsedInvoice): Promise<number> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QbInvoice" ("txnId", "refNumber", "customerListId", "customerName", "txnDate", "dueDate", "subtotal", "totalAmount", "balanceRemaining", "isPaid", "raw", "syncedAt")
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9, $10, $11::jsonb, NOW())
     ON CONFLICT ("txnId") DO UPDATE SET
       "refNumber" = EXCLUDED."refNumber",
       "customerListId" = EXCLUDED."customerListId",
       "customerName" = EXCLUDED."customerName",
       "txnDate" = EXCLUDED."txnDate",
       "dueDate" = EXCLUDED."dueDate",
       "subtotal" = EXCLUDED."subtotal",
       "totalAmount" = EXCLUDED."totalAmount",
       "balanceRemaining" = EXCLUDED."balanceRemaining",
       "isPaid" = EXCLUDED."isPaid",
       "raw" = EXCLUDED."raw",
       "syncedAt" = NOW()`,
    inv.txnID,
    inv.refNumber ?? null,
    inv.customerRef.listID ?? null,
    inv.customerRef.fullName ?? null,
    inv.txnDate ?? null,
    inv.dueDate ?? null,
    inv.subtotal ?? null,
    inv.totalAmount ?? null,
    inv.balanceRemaining ?? null,
    inv.isPaid ?? false,
    JSON.stringify(inv.raw ?? {})
  )

  // Replace lines on every sync (small N per invoice, simpler than diffing).
  await prisma.$executeRawUnsafe(`DELETE FROM "QbInvoiceLine" WHERE "invoiceTxnId" = $1`, inv.txnID)
  let lineCount = 0
  for (const l of inv.lines) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QbInvoiceLine" ("invoiceTxnId", "itemListId", "itemName", "description", "quantity", "rate", "amount")
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      inv.txnID,
      l.itemRef?.listID ?? null,
      l.itemRef?.fullName ?? null,
      l.desc ?? null,
      l.quantity ?? null,
      l.rate ?? null,
      l.amount ?? null
    )
    lineCount++
  }
  return lineCount
}

async function upsertBill(b: ParsedBill): Promise<number> {
  await prisma.$executeRawUnsafe(
    `INSERT INTO "QbBill" ("txnId", "refNumber", "vendorListId", "vendorName", "txnDate", "dueDate", "amountDue", "isPaid", "raw", "syncedAt")
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, $9::jsonb, NOW())
     ON CONFLICT ("txnId") DO UPDATE SET
       "refNumber" = EXCLUDED."refNumber",
       "vendorListId" = EXCLUDED."vendorListId",
       "vendorName" = EXCLUDED."vendorName",
       "txnDate" = EXCLUDED."txnDate",
       "dueDate" = EXCLUDED."dueDate",
       "amountDue" = EXCLUDED."amountDue",
       "isPaid" = EXCLUDED."isPaid",
       "raw" = EXCLUDED."raw",
       "syncedAt" = NOW()`,
    b.txnID,
    b.refNumber ?? null,
    b.vendorRef.listID ?? null,
    b.vendorRef.fullName ?? null,
    b.txnDate ?? null,
    b.dueDate ?? null,
    b.amountDue ?? null,
    b.isPaid ?? false,
    JSON.stringify(b.raw ?? {})
  )

  await prisma.$executeRawUnsafe(`DELETE FROM "QbBillExpenseLine" WHERE "billTxnId" = $1`, b.txnID)
  let lineCount = 0
  for (const l of b.expenseLines) {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "QbBillExpenseLine" ("billTxnId", "accountListId", "accountName", "amount", "memo")
       VALUES ($1, $2, $3, $4, $5)`,
      b.txnID,
      l.accountRef?.listID ?? null,
      l.accountRef?.fullName ?? null,
      l.amount ?? null,
      l.memo ?? null
    )
    lineCount++
  }
  return lineCount
}

export async function upsertParsedResponse(
  result: QbxmlParseResult
): Promise<UpsertCounts> {
  const counts = emptyCounts()
  if (result.customers) {
    for (const c of result.customers) {
      await upsertCustomer(c)
      counts.customers++
    }
  }
  if (result.vendors) {
    for (const v of result.vendors) {
      await upsertVendor(v)
      counts.vendors++
    }
  }
  if (result.accounts) {
    for (const a of result.accounts) {
      await upsertAccount(a)
      counts.accounts++
    }
  }
  if (result.items) {
    for (const i of result.items) {
      await upsertItem(i)
      counts.items++
    }
  }
  if (result.invoices) {
    for (const inv of result.invoices) {
      counts.invoiceLines += await upsertInvoice(inv)
      counts.invoices++
    }
  }
  if (result.bills) {
    for (const b of result.bills) {
      counts.billLines += await upsertBill(b)
      counts.bills++
    }
  }
  return counts
}

// Exported for the smoke test — lets us assert "would-upsert" rows without
// hitting the DB.
export function describePlannedWrites(result: QbxmlParseResult): string[] {
  const lines: string[] = []
  for (const c of result.customers ?? []) lines.push(`UPSERT QbCustomer listId=${c.listID} name=${c.fullName}`)
  for (const v of result.vendors ?? []) lines.push(`UPSERT QbVendor listId=${v.listID} name=${v.fullName}`)
  for (const a of result.accounts ?? []) lines.push(`UPSERT QbAccount listId=${a.listID} type=${a.accountType}`)
  for (const i of result.items ?? []) lines.push(`UPSERT QbItem listId=${i.listID} type=${i.type}`)
  for (const inv of result.invoices ?? []) {
    lines.push(`UPSERT QbInvoice txnId=${inv.txnID} customer=${inv.customerRef.fullName} total=${inv.totalAmount}`)
    for (const l of inv.lines) lines.push(`  └─ line item=${l.itemRef?.fullName} qty=${l.quantity} amt=${l.amount}`)
  }
  for (const b of result.bills ?? []) {
    lines.push(`UPSERT QbBill txnId=${b.txnID} vendor=${b.vendorRef.fullName} due=${b.amountDue}`)
    for (const l of b.expenseLines) lines.push(`  └─ exp acct=${l.accountRef?.fullName} amt=${l.amount}`)
  }
  return lines
}
