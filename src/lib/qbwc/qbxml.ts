// ──────────────────────────────────────────────────────────────────────────
// qbXML request templates + response parsers
// ──────────────────────────────────────────────────────────────────────────
// Used by /api/v1/qb/qbwc to talk to Abel's QuickBooks Desktop file via the
// Web Connector. We hand-write request strings (small surface area, 4 types)
// and use fast-xml-parser to read responses (verbose, deeply nested).
//
// IMPORTANT: QBWC pins us to qbXML 13.0 (max version supported by current
// QB Desktop releases). All ?qbxml version="13.0"? headers must match.

import { XMLParser } from 'fast-xml-parser'

// ─── Constants ────────────────────────────────────────────────────────────

export const QBXML_VERSION = '13.0'

const XML_PROLOG = `<?xml version="1.0" encoding="utf-8"?>\n<?qbxml version="${QBXML_VERSION}"?>`

// ─── Request builders ─────────────────────────────────────────────────────

export type QbRequestKind =
  | 'CustomerQuery'
  | 'InvoiceQuery'
  | 'BillQuery'
  | 'AccountQuery'
  | 'VendorQuery'
  | 'ItemQuery'

export interface QbRequestSpec {
  kind: QbRequestKind
  // Optional date filter for Invoice/Bill queries (ISO yyyy-mm-dd).
  fromModifiedDate?: string
  // Pagination via iterator. Caller supplies iteratorID on continuations.
  iteratorID?: string
  // Caller-chosen request id used for response correlation.
  requestID: string
}

function customerQuery(spec: QbRequestSpec): string {
  const iter = spec.iteratorID
    ? `iterator="Continue" iteratorID="${spec.iteratorID}"`
    : `iterator="Start"`
  return `${XML_PROLOG}
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <CustomerQueryRq requestID="${spec.requestID}" ${iter}>
      <MaxReturned>500</MaxReturned>
      <ActiveStatus>ActiveOnly</ActiveStatus>
    </CustomerQueryRq>
  </QBXMLMsgsRq>
</QBXML>`
}

function invoiceQuery(spec: QbRequestSpec): string {
  const iter = spec.iteratorID
    ? `iterator="Continue" iteratorID="${spec.iteratorID}"`
    : `iterator="Start"`
  const dateFilter = spec.fromModifiedDate
    ? `<ModifiedDateRangeFilter><FromModifiedDate>${spec.fromModifiedDate}</FromModifiedDate></ModifiedDateRangeFilter>`
    : ''
  return `${XML_PROLOG}
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <InvoiceQueryRq requestID="${spec.requestID}" ${iter}>
      <MaxReturned>200</MaxReturned>
      ${dateFilter}
      <IncludeLineItems>true</IncludeLineItems>
    </InvoiceQueryRq>
  </QBXMLMsgsRq>
</QBXML>`
}

function billQuery(spec: QbRequestSpec): string {
  const iter = spec.iteratorID
    ? `iterator="Continue" iteratorID="${spec.iteratorID}"`
    : `iterator="Start"`
  const dateFilter = spec.fromModifiedDate
    ? `<ModifiedDateRangeFilter><FromModifiedDate>${spec.fromModifiedDate}</FromModifiedDate></ModifiedDateRangeFilter>`
    : ''
  return `${XML_PROLOG}
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <BillQueryRq requestID="${spec.requestID}" ${iter}>
      <MaxReturned>200</MaxReturned>
      ${dateFilter}
      <IncludeLineItems>true</IncludeLineItems>
    </BillQueryRq>
  </QBXMLMsgsRq>
</QBXML>`
}

function accountQuery(spec: QbRequestSpec): string {
  return `${XML_PROLOG}
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <AccountQueryRq requestID="${spec.requestID}">
      <ActiveStatus>ActiveOnly</ActiveStatus>
    </AccountQueryRq>
  </QBXMLMsgsRq>
</QBXML>`
}

function vendorQuery(spec: QbRequestSpec): string {
  const iter = spec.iteratorID
    ? `iterator="Continue" iteratorID="${spec.iteratorID}"`
    : `iterator="Start"`
  return `${XML_PROLOG}
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <VendorQueryRq requestID="${spec.requestID}" ${iter}>
      <MaxReturned>500</MaxReturned>
      <ActiveStatus>ActiveOnly</ActiveStatus>
    </VendorQueryRq>
  </QBXMLMsgsRq>
</QBXML>`
}

function itemQuery(spec: QbRequestSpec): string {
  const iter = spec.iteratorID
    ? `iterator="Continue" iteratorID="${spec.iteratorID}"`
    : `iterator="Start"`
  return `${XML_PROLOG}
<QBXML>
  <QBXMLMsgsRq onError="stopOnError">
    <ItemQueryRq requestID="${spec.requestID}" ${iter}>
      <MaxReturned>500</MaxReturned>
      <ActiveStatus>ActiveOnly</ActiveStatus>
    </ItemQueryRq>
  </QBXMLMsgsRq>
</QBXML>`
}

export function buildQbxmlRequest(spec: QbRequestSpec): string {
  switch (spec.kind) {
    case 'CustomerQuery':
      return customerQuery(spec)
    case 'InvoiceQuery':
      return invoiceQuery(spec)
    case 'BillQuery':
      return billQuery(spec)
    case 'AccountQuery':
      return accountQuery(spec)
    case 'VendorQuery':
      return vendorQuery(spec)
    case 'ItemQuery':
      return itemQuery(spec)
  }
}

// ─── Response parsing ─────────────────────────────────────────────────────

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: true,
  parseAttributeValue: true,
  trimValues: true,
  // Force these to always be arrays so single-record responses don't break
  // downstream code that does `.map(...)`.
  isArray: (name: string) => {
    const arrays = new Set([
      'CustomerRet',
      'InvoiceRet',
      'BillRet',
      'AccountRet',
      'VendorRet',
      'ItemServiceRet',
      'ItemInventoryRet',
      'ItemNonInventoryRet',
      'InvoiceLineRet',
      'ItemLineRet',
      'ExpenseLineRet',
    ])
    return arrays.has(name)
  },
})

export interface ParsedRsHeader {
  requestID?: string
  statusCode: number
  statusSeverity: string
  statusMessage?: string
  iteratorRemainingCount?: number
  iteratorID?: string
}

export interface ParsedCustomer {
  listID: string
  fullName: string
  companyName?: string
  email?: string
  phone?: string
  balance?: number
  isActive: boolean
  raw: any
}

export interface ParsedInvoiceLine {
  itemRef?: { listID?: string; fullName?: string }
  desc?: string
  quantity?: number
  rate?: number
  amount?: number
}

export interface ParsedInvoice {
  txnID: string
  refNumber?: string
  customerRef: { listID?: string; fullName?: string }
  txnDate?: string
  dueDate?: string
  subtotal?: number
  totalAmount?: number
  balanceRemaining?: number
  isPaid?: boolean
  lines: ParsedInvoiceLine[]
  raw: any
}

export interface ParsedBillLine {
  accountRef?: { listID?: string; fullName?: string }
  amount?: number
  memo?: string
}

export interface ParsedBill {
  txnID: string
  refNumber?: string
  vendorRef: { listID?: string; fullName?: string }
  txnDate?: string
  dueDate?: string
  amountDue?: number
  isPaid?: boolean
  expenseLines: ParsedBillLine[]
  raw: any
}

export interface ParsedAccount {
  listID: string
  fullName: string
  accountType: string
  balance?: number
  isActive: boolean
  raw: any
}

export interface ParsedVendor {
  listID: string
  fullName: string
  companyName?: string
  email?: string
  phone?: string
  balance?: number
  isActive: boolean
  raw: any
}

export interface ParsedItem {
  listID: string
  fullName: string
  type: 'Service' | 'Inventory' | 'NonInventory'
  salesPrice?: number
  isActive: boolean
  raw: any
}

function num(v: any): number | undefined {
  if (v === undefined || v === null || v === '') return undefined
  const n = typeof v === 'number' ? v : parseFloat(String(v))
  return Number.isFinite(n) ? n : undefined
}

function refOf(v: any): { listID?: string; fullName?: string } {
  if (!v) return {}
  return { listID: v.ListID, fullName: v.FullName }
}

export interface QbxmlParseResult {
  kind: QbRequestKind | 'Unknown'
  header: ParsedRsHeader
  customers?: ParsedCustomer[]
  invoices?: ParsedInvoice[]
  bills?: ParsedBill[]
  accounts?: ParsedAccount[]
  vendors?: ParsedVendor[]
  items?: ParsedItem[]
  rawResponse: any
}

function pickRs(parsed: any): { node: any; kind: QbRequestKind | 'Unknown' } {
  const msgs = parsed?.QBXML?.QBXMLMsgsRs
  if (!msgs) return { node: null, kind: 'Unknown' }
  if (msgs.CustomerQueryRs) return { node: msgs.CustomerQueryRs, kind: 'CustomerQuery' }
  if (msgs.InvoiceQueryRs) return { node: msgs.InvoiceQueryRs, kind: 'InvoiceQuery' }
  if (msgs.BillQueryRs) return { node: msgs.BillQueryRs, kind: 'BillQuery' }
  if (msgs.AccountQueryRs) return { node: msgs.AccountQueryRs, kind: 'AccountQuery' }
  if (msgs.VendorQueryRs) return { node: msgs.VendorQueryRs, kind: 'VendorQuery' }
  if (msgs.ItemQueryRs) return { node: msgs.ItemQueryRs, kind: 'ItemQuery' }
  return { node: null, kind: 'Unknown' }
}

function readHeader(rs: any): ParsedRsHeader {
  return {
    requestID: rs?.['@_requestID']?.toString(),
    statusCode: Number(rs?.['@_statusCode'] ?? 0),
    statusSeverity: String(rs?.['@_statusSeverity'] ?? 'Unknown'),
    statusMessage: rs?.['@_statusMessage']?.toString(),
    iteratorRemainingCount:
      rs?.['@_iteratorRemainingCount'] !== undefined
        ? Number(rs['@_iteratorRemainingCount'])
        : undefined,
    iteratorID: rs?.['@_iteratorID']?.toString(),
  }
}

export function parseQbxmlResponse(xml: string): QbxmlParseResult {
  const parsed = parser.parse(xml)
  const { node, kind } = pickRs(parsed)
  if (!node) {
    return {
      kind: 'Unknown',
      header: { statusCode: -1, statusSeverity: 'Error', statusMessage: 'No recognised QBXMLMsgsRs node' },
      rawResponse: parsed,
    }
  }

  const header = readHeader(node)
  const result: QbxmlParseResult = { kind, header, rawResponse: parsed }

  if (kind === 'CustomerQuery') {
    const rows: any[] = node.CustomerRet ?? []
    result.customers = rows.map((c) => ({
      listID: String(c.ListID),
      fullName: String(c.FullName ?? c.Name ?? ''),
      companyName: c.CompanyName,
      email: c.Email,
      phone: c.Phone,
      balance: num(c.Balance),
      isActive: c.IsActive !== false && c.IsActive !== 'false',
      raw: c,
    }))
  } else if (kind === 'InvoiceQuery') {
    const rows: any[] = node.InvoiceRet ?? []
    result.invoices = rows.map((inv) => {
      const lineRows: any[] = inv.InvoiceLineRet ?? []
      return {
        txnID: String(inv.TxnID),
        refNumber: inv.RefNumber,
        customerRef: refOf(inv.CustomerRef),
        txnDate: inv.TxnDate,
        dueDate: inv.DueDate,
        subtotal: num(inv.Subtotal),
        totalAmount: num(inv.TotalAmount ?? inv.AppliedAmount),
        balanceRemaining: num(inv.BalanceRemaining),
        isPaid: inv.IsPaid === true || inv.IsPaid === 'true',
        lines: lineRows.map((l) => ({
          itemRef: refOf(l.ItemRef),
          desc: l.Desc,
          quantity: num(l.Quantity),
          rate: num(l.Rate),
          amount: num(l.Amount),
        })),
        raw: inv,
      }
    })
  } else if (kind === 'BillQuery') {
    const rows: any[] = node.BillRet ?? []
    result.bills = rows.map((b) => {
      const expenseRows: any[] = b.ExpenseLineRet ?? []
      return {
        txnID: String(b.TxnID),
        refNumber: b.RefNumber,
        vendorRef: refOf(b.VendorRef),
        txnDate: b.TxnDate,
        dueDate: b.DueDate,
        amountDue: num(b.AmountDue),
        isPaid: b.IsPaid === true || b.IsPaid === 'true',
        expenseLines: expenseRows.map((e) => ({
          accountRef: refOf(e.AccountRef),
          amount: num(e.Amount),
          memo: e.Memo,
        })),
        raw: b,
      }
    })
  } else if (kind === 'AccountQuery') {
    const rows: any[] = node.AccountRet ?? []
    result.accounts = rows.map((a) => ({
      listID: String(a.ListID),
      fullName: String(a.FullName ?? a.Name ?? ''),
      accountType: String(a.AccountType ?? ''),
      balance: num(a.Balance),
      isActive: a.IsActive !== false && a.IsActive !== 'false',
      raw: a,
    }))
  } else if (kind === 'VendorQuery') {
    const rows: any[] = node.VendorRet ?? []
    result.vendors = rows.map((v) => ({
      listID: String(v.ListID),
      fullName: String(v.FullName ?? v.Name ?? ''),
      companyName: v.CompanyName,
      email: v.Email,
      phone: v.Phone,
      balance: num(v.Balance),
      isActive: v.IsActive !== false && v.IsActive !== 'false',
      raw: v,
    }))
  } else if (kind === 'ItemQuery') {
    const services: any[] = node.ItemServiceRet ?? []
    const inventory: any[] = node.ItemInventoryRet ?? []
    const nonInv: any[] = node.ItemNonInventoryRet ?? []
    result.items = [
      ...services.map((i) => ({
        listID: String(i.ListID),
        fullName: String(i.FullName ?? ''),
        type: 'Service' as const,
        salesPrice: num(i?.SalesOrPurchase?.Price ?? i?.SalesAndPurchase?.SalesPrice),
        isActive: i.IsActive !== false && i.IsActive !== 'false',
        raw: i,
      })),
      ...inventory.map((i) => ({
        listID: String(i.ListID),
        fullName: String(i.FullName ?? ''),
        type: 'Inventory' as const,
        salesPrice: num(i?.SalesPrice),
        isActive: i.IsActive !== false && i.IsActive !== 'false',
        raw: i,
      })),
      ...nonInv.map((i) => ({
        listID: String(i.ListID),
        fullName: String(i.FullName ?? ''),
        type: 'NonInventory' as const,
        salesPrice: num(i?.SalesOrPurchase?.Price ?? i?.SalesAndPurchase?.SalesPrice),
        isActive: i.IsActive !== false && i.IsActive !== 'false',
        raw: i,
      })),
    ]
  }

  return result
}
