// ──────────────────────────────────────────────────────────────────────────
// QuickBooks Desktop Web Connector Integration
// QBWC is a Windows app that polls a SOAP endpoint for qbXML requests
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'

// ─── Types ────────────────────────────────────────────────────────────────

export interface QBSyncQueueItem {
  id: string
  action: string
  entityType: string
  entityId: string
  qbTxnId: string | null
  qbListId: string | null
  requestXml: string | null
  responseXml: string | null
  payload: any
  status: 'pending' | 'processing' | 'completed' | 'failed'
  attempts: number
  maxAttempts: number
  lastError: string | null
  processedAt: Date | null
  createdAt: Date
}

export interface EntityMapping {
  platformId: string
  qbListId?: string
  qbTxnId?: string
  entityType: 'BUILDER' | 'INVOICE' | 'PO' | 'PAYMENT'
}

// ─── QBWC SOAP Handler Functions ──────────────────────────────────────────

/**
 * SOAP authenticate handler - validates credentials and returns session ticket
 */
export function generateAuthenticationResponse(
  ticket: string,
  nonce: string,
  authenticateResult: 'OK' | 'INVALID_CREDENTIALS'
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://developer.intuit.com/">
  <soap:Body>
    <tns:authenticateResponse>
      <tns:authenticateResult>
        <tns:ticket>${escapeXml(ticket)}</tns:ticket>
        <tns:redirectURL></tns:redirectURL>
        <tns:sessionID>${escapeXml(nonce)}</tns:sessionID>
        <tns:authenticateResult>${authenticateResult}</tns:authenticateResult>
      </tns:authenticateResult>
    </tns:authenticateResponse>
  </soap:Body>
</soap:Envelope>`
}

/**
 * SOAP sendRequestXML handler - returns next qbXML request to process
 */
export function generateSendRequestXmlResponse(
  ticket: string,
  qbXmlRequest: string,
  requestID: string
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://developer.intuit.com/">
  <soap:Body>
    <tns:sendRequestXMLResponse>
      <tns:sendRequestXMLResult>
        <tns:ticket>${escapeXml(ticket)}</tns:ticket>
        <tns:sendRequestXMLResult>${escapeXml(qbXmlRequest)}</tns:sendRequestXMLResult>
        <tns:requestID>${escapeXml(requestID)}</tns:requestID>
      </tns:sendRequestXMLResult>
    </tns:sendRequestXMLResponse>
  </soap:Body>
</soap:Envelope>`
}

/**
 * SOAP receiveResponseXML handler
 */
export function generateReceiveResponseXmlResponse(
  ticket: string,
  receiveResponseXmlResult: number
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://developer.intuit.com/">
  <soap:Body>
    <tns:receiveResponseXMLResponse>
      <tns:receiveResponseXMLResult>${receiveResponseXmlResult}</tns:receiveResponseXMLResult>
      <tns:ticket>${escapeXml(ticket)}</tns:ticket>
    </tns:receiveResponseXMLResponse>
  </soap:Body>
</soap:Envelope>`
}

/**
 * SOAP closeConnection handler
 */
export function generateCloseConnectionResponse(
  closeConnectionResult: string
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://developer.intuit.com/">
  <soap:Body>
    <tns:closeConnectionResponse>
      <tns:closeConnectionResult>${escapeXml(closeConnectionResult)}</tns:closeConnectionResult>
    </tns:closeConnectionResponse>
  </soap:Body>
</soap:Envelope>`
}

/**
 * SOAP getLastError handler
 */
export function generateGetLastErrorResponse(
  error: string
): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:tns="http://developer.intuit.com/">
  <soap:Body>
    <tns:getLastErrorResponse>
      <tns:getLastErrorResult>${escapeXml(error)}</tns:getLastErrorResult>
    </tns:getLastErrorResponse>
  </soap:Body>
</soap:Envelope>`
}

// ─── qbXML Request Builders ──────────────────────────────────────────────

/**
 * Build a CustomerAdd qbXML request from a Builder
 */
export function buildCustomerAddRequest(builder: any): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXMLMsgsRq onError="stopOnError">
  <CustomerAddRq requestID="1">
    <CustomerAdd>
      <Name>${escapeXml(builder.companyName)}</Name>
      <IsActive>true</IsActive>
      <ParentRef>
        <ListID>0</ListID>
      </ParentRef>
      <ClassRef>
        <FullyQualifiedName></FullyQualifiedName>
      </ClassRef>
      <CompanyName>${escapeXml(builder.companyName)}</CompanyName>
      <FirstName>${escapeXml(builder.contactName.split(' ')[0] || 'Unknown')}</FirstName>
      <LastName>${escapeXml(builder.contactName.split(' ').slice(1).join(' ') || '')}</LastName>
      ${builder.email ? `<Email>${escapeXml(builder.email)}</Email>` : ''}
      ${builder.phone ? `<Phone>${escapeXml(builder.phone)}</Phone>` : ''}
      ${builder.address ? `<BillAddress>
        <Addr1>${escapeXml(builder.address)}</Addr1>
        ${builder.city ? `<City>${escapeXml(builder.city)}</City>` : ''}
        ${builder.state ? `<State>${escapeXml(builder.state)}</State>` : ''}
        ${builder.zip ? `<PostalCode>${escapeXml(builder.zip)}</PostalCode>` : ''}
      </BillAddress>` : ''}
      <TaxID>${escapeXml(builder.taxId || '')}</TaxID>
      <PreferredPaymentMethodRef>
        <FullyQualifiedName></FullyQualifiedName>
      </PreferredPaymentMethodRef>
      <Terms>
        <FullyQualifiedName>${escapeXml(builder.paymentTerm || 'Net 15')}</FullyQualifiedName>
      </Terms>
      ${builder.creditLimit ? `<CreditLimit>${builder.creditLimit}</CreditLimit>` : ''}
    </CustomerAdd>
  </CustomerAddRq>
</QBXMLMsgsRq>`
}

/**
 * Build an InvoiceAdd qbXML request from an Invoice
 */
export function buildInvoiceAddRequest(invoice: any, invoiceItems: any[], customerListId: string): string {
  const itemLines = invoiceItems
    .map((item, idx) => `
      <InvoiceLineAdd>
        <ItemRef>
          <FullyQualifiedName>${escapeXml(item.description)}</FullyQualifiedName>
        </ItemRef>
        <Desc>${escapeXml(item.description)}</Desc>
        <Quantity>${item.quantity}</Quantity>
        <UnitPrice>${item.unitPrice}</UnitPrice>
        <Amount>${item.lineTotal}</Amount>
        <ClassRef>
          <FullyQualifiedName></FullyQualifiedName>
        </ClassRef>
      </InvoiceLineAdd>`)
    .join('')

  return `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXMLMsgsRq onError="stopOnError">
  <InvoiceAddRq requestID="1">
    <InvoiceAdd>
      <CustomerRef>
        <ListID>${escapeXml(customerListId)}</ListID>
      </CustomerRef>
      <TxnDate>${formatQbDate(invoice.issuedAt || new Date())}</TxnDate>
      <RefNumber>${escapeXml(invoice.invoiceNumber)}</RefNumber>
      <DueDate>${formatQbDate(invoice.dueDate || new Date())}</DueDate>
      <Memo>${escapeXml(invoice.notes || '')}</Memo>
      <TermsRef>
        <FullyQualifiedName>${escapeXml(mapPaymentTermToQb(invoice.paymentTerm))}</FullyQualifiedName>
      </TermsRef>${itemLines}
      <SubTotalAmount>${invoice.subtotal}</SubTotalAmount>
      <TaxAmount>${invoice.taxAmount}</TaxAmount>
      <TotalAmount>${invoice.total}</TotalAmount>
    </InvoiceAdd>
  </InvoiceAddRq>
</QBXMLMsgsRq>`
}

/**
 * Build a BillAdd qbXML request from a PurchaseOrder
 */
export function buildBillAddRequest(po: any, poItems: any[], vendorListId: string): string {
  const itemLines = poItems
    .map((item) => `
      <ItemLineAdd>
        <ItemRef>
          <FullyQualifiedName>${escapeXml(item.vendorSku)}</FullyQualifiedName>
        </ItemRef>
        <Desc>${escapeXml(item.description)}</Desc>
        <Quantity>${item.quantity}</Quantity>
        <Cost>${item.unitCost}</Cost>
        <Amount>${item.lineTotal}</Amount>
      </ItemLineAdd>`)
    .join('')

  return `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXMLMsgsRq onError="stopOnError">
  <BillAddRq requestID="1">
    <BillAdd>
      <VendorRef>
        <ListID>${escapeXml(vendorListId)}</ListID>
      </VendorRef>
      <TxnDate>${formatQbDate(po.orderedAt || new Date())}</TxnDate>
      <RefNumber>${escapeXml(po.poNumber)}</RefNumber>
      <DueDate>${formatQbDate(po.expectedDate || new Date())}</DueDate>
      <Memo>${escapeXml(po.notes || '')}</Memo>${itemLines}
      <SubTotalAmount>${po.subtotal}</SubTotalAmount>
      <ShippingAmount>${po.shippingCost}</ShippingAmount>
      <TotalAmount>${po.total}</TotalAmount>
    </BillAdd>
  </BillAddRq>
</QBXMLMsgsRq>`
}

/**
 * Build a ReceivePaymentAdd qbXML request from a Payment
 */
export function buildReceivePaymentAddRequest(payment: any, invoice: any, customerListId: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<?qbxml version="13.0"?>
<QBXMLMsgsRq onError="stopOnError">
  <ReceivePaymentAddRq requestID="1">
    <ReceivePaymentAdd>
      <CustomerRef>
        <ListID>${escapeXml(customerListId)}</ListID>
      </CustomerRef>
      <TxnDate>${formatQbDate(payment.receivedAt || new Date())}</TxnDate>
      <RefNumber>${escapeXml(payment.reference || '')}</RefNumber>
      <PaymentMethodRef>
        <FullyQualifiedName>${escapeXml(mapPaymentMethodToQb(payment.method))}</FullyQualifiedName>
      </PaymentMethodRef>
      <DepositToAccountRef>
        <FullyQualifiedName>Undeposited Funds</FullyQualifiedName>
      </DepositToAccountRef>
      <TotalAmount>${payment.amount}</TotalAmount>
      <ReceivePaymentLineAdd>
        <InvoiceRef>
          <TxnID>${escapeXml(invoice.qbTxnId)}</TxnID>
        </InvoiceRef>
        <TxnLineID>1</TxnLineID>
        <AmountReceived>${payment.amount}</AmountReceived>
      </ReceivePaymentLineAdd>
    </ReceivePaymentAdd>
  </ReceivePaymentAddRq>
</QBXMLMsgsRq>`
}

// ─── qbXML Response Parsers ───────────────────────────────────────────────

/**
 * Parse CustomerAddRs response and extract ListID
 */
export function parseCustomerAddResponse(responseXml: string): { listId: string } | null {
  const listIdMatch = responseXml.match(/<ListID>([^<]+)<\/ListID>/)
  if (listIdMatch) {
    return { listId: listIdMatch[1] }
  }
  return null
}

/**
 * Parse InvoiceAddRs response and extract TxnID
 */
export function parseInvoiceAddResponse(responseXml: string): { txnId: string } | null {
  const txnIdMatch = responseXml.match(/<TxnID>([^<]+)<\/TxnID>/)
  if (txnIdMatch) {
    return { txnId: txnIdMatch[1] }
  }
  return null
}

/**
 * Parse BillAddRs response and extract TxnID
 */
export function parseBillAddResponse(responseXml: string): { txnId: string } | null {
  const txnIdMatch = responseXml.match(/<TxnID>([^<]+)<\/TxnID>/)
  if (txnIdMatch) {
    return { txnId: txnIdMatch[1] }
  }
  return null
}

/**
 * Check if response contains an error
 */
export function parseResponseError(responseXml: string): string | null {
  const statusCodeMatch = responseXml.match(/<statusCode>([^<]+)<\/statusCode>/)
  if (statusCodeMatch && statusCodeMatch[1] !== '0') {
    const statusMessageMatch = responseXml.match(/<statusMessage>([^<]+)<\/statusMessage>/)
    return statusMessageMatch ? statusMessageMatch[1] : `Error code: ${statusCodeMatch[1]}`
  }
  return null
}

// ─── Queue Management ─────────────────────────────────────────────────────

/**
 * Queue a sync item to be processed
 */
export async function queueSyncItem(
  action: string,
  entityType: string,
  entityId: string,
  payload: any
): Promise<string> {
  const result = await prisma.$executeRawUnsafe(
    `
    INSERT INTO "QBSyncQueue" (action, "entityType", "entityId", payload, status, attempts, "maxAttempts", "createdAt")
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id
    `,
    action,
    entityType,
    entityId,
    JSON.stringify(payload),
    'pending',
    0,
    3,
    new Date()
  )

  return (result as any)[0]?.id || ''
}

/**
 * Get next pending sync item from queue
 */
export async function getNextQueueItem(): Promise<QBSyncQueueItem | null> {
  const result = await prisma.$queryRawUnsafe(
    `
    SELECT * FROM "QBSyncQueue"
    WHERE status = 'pending' AND attempts < "maxAttempts"
    ORDER BY "createdAt" ASC
    LIMIT 1
    `
  )

  const item = (result as any[])?.[0]
  if (!item) return null

  return {
    id: item.id,
    action: item.action,
    entityType: item.entityType,
    entityId: item.entityId,
    qbTxnId: item.qbTxnId,
    qbListId: item.qbListId,
    requestXml: item.requestXml,
    responseXml: item.responseXml,
    payload: item.payload,
    status: item.status,
    attempts: item.attempts,
    maxAttempts: item.maxAttempts,
    lastError: item.lastError,
    processedAt: item.processedAt,
    createdAt: item.createdAt,
  }
}

/**
 * Mark a queue item as processing and update with request XML
 */
export async function markQueueItemProcessing(queueItemId: string, requestXml: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    UPDATE "QBSyncQueue"
    SET status = 'processing', "requestXml" = $1, attempts = attempts + 1
    WHERE id = $2
    `,
    requestXml,
    queueItemId
  )
}

/**
 * Mark a queue item as completed
 */
export async function markQueueItemCompleted(
  queueItemId: string,
  responseXml: string,
  qbTxnId?: string,
  qbListId?: string
): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    UPDATE "QBSyncQueue"
    SET status = 'completed', "responseXml" = $1, "processedAt" = $2, "qbTxnId" = $3, "qbListId" = $4
    WHERE id = $5
    `,
    responseXml,
    new Date(),
    qbTxnId || null,
    qbListId || null,
    queueItemId
  )
}

/**
 * Mark a queue item as failed
 */
export async function markQueueItemFailed(queueItemId: string, error: string): Promise<void> {
  await prisma.$executeRawUnsafe(
    `
    UPDATE "QBSyncQueue"
    SET status = 'failed', "lastError" = $1, "processedAt" = $2
    WHERE id = $3
    `,
    error,
    new Date(),
    queueItemId
  )
}

/**
 * Clear completed items from queue
 */
export async function clearCompletedQueue(): Promise<number> {
  const result = await prisma.$executeRawUnsafe(
    `
    DELETE FROM "QBSyncQueue"
    WHERE status = 'completed'
    `
  )
  return result
}

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number
  processing: number
  completed: number
  failed: number
  totalAttempts: number
}> {
  const result = await prisma.$queryRawUnsafe(
    `
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
      SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) as processing,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(attempts) as "totalAttempts"
    FROM "QBSyncQueue"
    `
  )

  const stats = (result as any[])[0] || {}
  return {
    pending: Number(stats.pending || 0),
    processing: Number(stats.processing || 0),
    completed: Number(stats.completed || 0),
    failed: Number(stats.failed || 0),
    totalAttempts: Number(stats.totalAttempts || 0),
  }
}

// ─── Entity Mapping Helpers ───────────────────────────────────────────────

/**
 * Store the QB ListID or TxnID for an entity
 */
export async function storeEntityMapping(
  platformId: string,
  entityType: 'BUILDER' | 'INVOICE' | 'PO' | 'PAYMENT',
  qbListId?: string,
  qbTxnId?: string
): Promise<void> {
  if (!qbListId && !qbTxnId) return

  if (entityType === 'BUILDER') {
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Builder"
      SET "qbListId" = $1, "qbSyncedAt" = $2
      WHERE id = $3
      `,
      qbListId || null,
      new Date(),
      platformId
    )
  } else if (entityType === 'INVOICE') {
    await prisma.$executeRawUnsafe(
      `
      UPDATE "Invoice"
      SET "qbTxnId" = $1, "qbSyncedAt" = $2, "qbSyncStatus" = 'SYNCED'
      WHERE id = $3
      `,
      qbTxnId || null,
      new Date(),
      platformId
    )
  } else if (entityType === 'PO') {
    await prisma.$executeRawUnsafe(
      `
      UPDATE "PurchaseOrder"
      SET "qbTxnId" = $1, "qbSyncedAt" = $2
      WHERE id = $3
      `,
      qbTxnId || null,
      new Date(),
      platformId
    )
  }
}

/**
 * Look up QB ListID for a Builder
 */
export async function getBuilderQbListId(builderId: string): Promise<string | null> {
  const result = await prisma.$queryRawUnsafe(
    `
    SELECT "qbListId" FROM "Builder"
    WHERE id = $1
    `,
    builderId
  )
  return (result as any[])?.[0]?.qbListId || null
}

/**
 * Look up QB TxnID for an Invoice
 */
export async function getInvoiceQbTxnId(invoiceId: string): Promise<string | null> {
  const result = await prisma.$queryRawUnsafe(
    `
    SELECT "qbTxnId" FROM "Invoice"
    WHERE id = $1
    `,
    invoiceId
  )
  return (result as any[])?.[0]?.qbTxnId || null
}

/**
 * Look up QB TxnID for a PurchaseOrder
 */
export async function getPoQbTxnId(poId: string): Promise<string | null> {
  const result = await prisma.$queryRawUnsafe(
    `
    SELECT "qbTxnId" FROM "PurchaseOrder"
    WHERE id = $1
    `,
    poId
  )
  return (result as any[])?.[0]?.qbTxnId || null
}

// ─── Helper Functions ────────────────────────────────────────────────────

/**
 * Escape XML special characters
 */
function escapeXml(str: string): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/**
 * Format date for QB (YYYY-MM-DD)
 */
function formatQbDate(date: Date): string {
  const d = new Date(date)
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * Map payment terms to QB format
 */
function mapPaymentTermToQb(term: string): string {
  const termMap: Record<string, string> = {
    PAY_AT_ORDER: 'Net 0',
    PAY_ON_DELIVERY: 'Net 0',
    NET_15: 'Net 15',
    NET_30: 'Net 30',
  }
  return termMap[term] || 'Net 15'
}

/**
 * Map payment method to QB format
 */
function mapPaymentMethodToQb(method: string): string {
  const methodMap: Record<string, string> = {
    CHECK: 'Check',
    ACH: 'Electronic Funds Transfer',
    WIRE: 'Electronic Funds Transfer',
    CREDIT_CARD: 'Credit Card',
    CASH: 'Cash',
    OTHER: 'Other',
  }
  return methodMap[method] || 'Other'
}
