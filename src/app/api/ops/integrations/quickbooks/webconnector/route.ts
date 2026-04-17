export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { audit } from '@/lib/audit'
import {
  generateAuthenticationResponse,
  generateSendRequestXmlResponse,
  generateReceiveResponseXmlResponse,
  generateCloseConnectionResponse,
  generateGetLastErrorResponse,
  getNextQueueItem,
  markQueueItemProcessing,
  markQueueItemCompleted,
  markQueueItemFailed,
  buildCustomerAddRequest,
  buildInvoiceAddRequest,
  buildBillAddRequest,
  buildReceivePaymentAddRequest,
  parseCustomerAddResponse,
  parseInvoiceAddResponse,
  parseBillAddResponse,
  parseResponseError,
  storeEntityMapping,
  getBuilderQbListId,
} from '@/lib/integrations/quickbooks-desktop'

// Store session data in memory (should be replaced with Redis in production)
const sessions = new Map<string, { nonce: string; createdAt: number }>()
const lastErrors = new Map<string, string>()

const SESSION_TIMEOUT_MS = 3600000 // 1 hour
const QBWC_USERNAME = process.env.QBWC_USERNAME || ''
const QBWC_PASSWORD = process.env.QBWC_PASSWORD || ''

// ─── Main SOAP Handler ───────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Audit log
    audit(request, 'CREATE', 'Integration', undefined, { method: 'POST' }).catch(() => {})

    const soapBody = await request.text()

    // Extract SOAP method from body
    const methodMatch = soapBody.match(/<tns:(\w+)>/)
    if (!methodMatch) {
      return sendSoapFault('Unable to determine SOAP method')
    }

    const method = methodMatch[1]

    let response: string | NextResponse

    switch (method) {
      case 'authenticate':
        response = await handleAuthenticate(soapBody)
        break

      case 'sendRequestXML':
        response = await handleSendRequestXml(soapBody)
        break

      case 'receiveResponseXML':
        response = await handleReceiveResponseXml(soapBody)
        break

      case 'closeConnection':
        response = handleCloseConnection()
        break

      case 'getLastError':
        response = handleGetLastError()
        break

      default:
        return sendSoapFault(`Unknown method: ${method}`)
    }

    if (response instanceof NextResponse) {
      return response
    }

    return new NextResponse(response, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
      },
    })
  } catch (error) {
    console.error('QBWC SOAP error:', error)
    return sendSoapFault(String(error))
  }
}

// ─── SOAP Method Handlers ────────────────────────────────────────────────

async function handleAuthenticate(soapBody: string): Promise<string> {
  // Extract username and password
  const userMatch = soapBody.match(/<tns:strUserID>([^<]+)<\/tns:strUserID>/)
  const passMatch = soapBody.match(/<tns:strPassword>([^<]+)<\/tns:strPassword>/)

  const user = userMatch ? userMatch[1] : ''
  const pass = passMatch ? passMatch[1] : ''

  // Validate credentials
  if (user === QBWC_USERNAME && pass === QBWC_PASSWORD) {
    const ticket = generateTicket()
    const nonce = generateNonce()

    // Store session
    sessions.set(ticket, {
      nonce,
      createdAt: Date.now(),
    })

    return generateAuthenticationResponse(ticket, nonce, 'OK')
  } else {
    return generateAuthenticationResponse('', '', 'INVALID_CREDENTIALS')
  }
}

async function handleSendRequestXml(soapBody: string): Promise<string | NextResponse> {
  const ticket = extractTicket(soapBody)
  if (!validateSession(ticket)) {
    recordError('Invalid or expired ticket')
    return sendSoapFault('Invalid session ticket')
  }

  try {
    // Get next item from queue
    const queueItem = await getNextQueueItem()

    if (!queueItem) {
      // No items in queue - return empty request to signal done
      return generateSendRequestXmlResponse(
        ticket,
        '<?xml version="1.0"?><?qbxml version="13.0"?><QBXMLMsgsRq onError="stopOnError"></QBXMLMsgsRq>',
        '0'
      )
    }

    let requestXml = ''
    let requestId = '1'

    try {
      // Build request based on action
      if (queueItem.action === 'CUSTOMER_ADD') {
        const builder = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Builder" WHERE id = $1`,
          queueItem.entityId
        )
        const builderData = (builder as any[])?.[0]
        if (builderData) {
          requestXml = buildCustomerAddRequest(builderData)
        }
      } else if (queueItem.action === 'INVOICE_ADD') {
        const invoice = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Invoice" WHERE id = $1`,
          queueItem.entityId
        )
        const invoiceData = (invoice as any[])?.[0]

        if (invoiceData) {
          const items = await prisma.$queryRawUnsafe(
            `SELECT * FROM "InvoiceItem" WHERE "invoiceId" = $1`,
            queueItem.entityId
          )

          const customerListId = await getBuilderQbListId(invoiceData.builderId)
          if (customerListId) {
            requestXml = buildInvoiceAddRequest(invoiceData, items as any[], customerListId)
          } else {
            throw new Error('Customer not synced to QB')
          }
        }
      } else if (queueItem.action === 'PO_ADD') {
        const po = await prisma.$queryRawUnsafe(
          `SELECT * FROM "PurchaseOrder" WHERE id = $1`,
          queueItem.entityId
        )
        const poData = (po as any[])?.[0]

        if (poData) {
          const items = await prisma.$queryRawUnsafe(
            `SELECT * FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = $1`,
            queueItem.entityId
          )

          // For now, use a placeholder vendor ListID - in production, look up from Vendor table
          const vendorListId = queueItem.payload?.vendorListId || '0'
          requestXml = buildBillAddRequest(poData, items as any[], vendorListId)
        }
      } else if (queueItem.action === 'PAYMENT_ADD') {
        const payment = await prisma.$queryRawUnsafe(
          `SELECT * FROM "Payment" WHERE id = $1`,
          queueItem.entityId
        )
        const paymentData = (payment as any[])?.[0]

        if (paymentData) {
          const invoice = await prisma.$queryRawUnsafe(
            `SELECT * FROM "Invoice" WHERE id = $1`,
            paymentData.invoiceId
          )
          const invoiceData = (invoice as any[])?.[0]

          const customerListId = await getBuilderQbListId(invoiceData.builderId)
          if (customerListId) {
            requestXml = buildReceivePaymentAddRequest(paymentData, invoiceData, customerListId)
          }
        }
      }

      if (!requestXml) {
        throw new Error(`Cannot build request for action: ${queueItem.action}`)
      }

      // Mark as processing and store request
      await markQueueItemProcessing(queueItem.id, requestXml)

      return generateSendRequestXmlResponse(ticket, requestXml, queueItem.id)
    } catch (error) {
      const errorMsg = String(error)
      await markQueueItemFailed(queueItem.id, errorMsg)
      recordError(errorMsg)
      throw error
    }
  } catch (error) {
    const errorMsg = String(error)
    recordError(errorMsg)
    return sendSoapFault(errorMsg)
  }
}

async function handleReceiveResponseXml(soapBody: string): Promise<string | NextResponse> {
  const ticket = extractTicket(soapBody)
  if (!validateSession(ticket)) {
    recordError('Invalid or expired ticket')
    return sendSoapFault('Invalid session ticket')
  }

  try {
    // Extract response XML and request ID
    const responseMatch = soapBody.match(/<tns:response>([^<]+)<\/tns:response>/)
    const requestIdMatch = soapBody.match(/<tns:strRequestID>([^<]+)<\/tns:strRequestID>/)

    const responseXml = responseMatch ? Buffer.from(responseMatch[1], 'base64').toString('utf-8') : ''
    const requestId = requestIdMatch ? requestIdMatch[1] : ''

    if (!requestId || !responseXml) {
      recordError('Missing response or request ID')
      return generateReceiveResponseXmlResponse(ticket, 0)
    }

    // Parse response and handle errors
    const error = parseResponseError(responseXml)
    if (error) {
      await markQueueItemFailed(requestId, error)
      recordError(error)
      return generateReceiveResponseXmlResponse(ticket, 0)
    }

    // Get the queue item to determine how to parse
    const queueItemResult = await prisma.$queryRawUnsafe(
      `SELECT * FROM "QBSyncQueue" WHERE id = $1`,
      requestId
    )
    const queueItem = (queueItemResult as any[])?.[0]

    if (!queueItem) {
      recordError(`Queue item not found: ${requestId}`)
      return generateReceiveResponseXmlResponse(ticket, 0)
    }

    // Parse response based on action
    let qbTxnId: string | undefined
    let qbListId: string | undefined

    if (queueItem.action === 'CUSTOMER_ADD') {
      const parsed = parseCustomerAddResponse(responseXml)
      if (parsed) {
        qbListId = parsed.listId
      }
    } else if (queueItem.action === 'INVOICE_ADD') {
      const parsed = parseInvoiceAddResponse(responseXml)
      if (parsed) {
        qbTxnId = parsed.txnId
      }
    } else if (queueItem.action === 'PO_ADD') {
      const parsed = parseBillAddResponse(responseXml)
      if (parsed) {
        qbTxnId = parsed.txnId
      }
    }

    // Store mapping and mark complete
    await storeEntityMapping(
      queueItem.entityId,
      queueItem.entityType as 'BUILDER' | 'INVOICE' | 'PO' | 'PAYMENT',
      qbListId,
      qbTxnId
    )

    await markQueueItemCompleted(requestId, responseXml, qbTxnId, qbListId)

    // Log to SyncLog
    await prisma.$executeRawUnsafe(
      `
      INSERT INTO "SyncLog" (provider, "syncType", direction, status, "recordsProcessed", "recordsCreated", "recordsUpdated", "recordsSkipped", "recordsFailed", "startedAt", "completedAt", "durationMs")
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `,
      'QUICKBOOKS_DESKTOP',
      queueItem.action,
      'PUSH',
      'SUCCESS',
      1,
      1,
      0,
      0,
      0,
      new Date(),
      new Date(),
      0
    )

    return generateReceiveResponseXmlResponse(ticket, 0)
  } catch (error) {
    const errorMsg = String(error)
    recordError(errorMsg)
    return sendSoapFault(errorMsg)
  }
}

function handleCloseConnection(): string {
  // Clean up any session data if needed
  return generateCloseConnectionResponse('Connection closed')
}

function handleGetLastError(): string {
  const error = lastErrors.get('current') || 'No error'
  return generateGetLastErrorResponse(error)
}

// ─── Helper Functions ────────────────────────────────────────────────────

function generateTicket(): string {
  return `ticket_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

function generateNonce(): string {
  return Math.random().toString(36).substr(2, 9)
}

function extractTicket(soapBody: string): string {
  const match = soapBody.match(/<tns:ticket>([^<]+)<\/tns:ticket>/)
  return match ? match[1] : ''
}

function validateSession(ticket: string): boolean {
  const session = sessions.get(ticket)
  if (!session) return false

  // Check if session has expired
  if (Date.now() - session.createdAt > SESSION_TIMEOUT_MS) {
    sessions.delete(ticket)
    return false
  }

  return true
}

function recordError(error: string): void {
  lastErrors.set('current', error)
}

function sendSoapFault(fault: string): NextResponse {
  const response = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>Server</faultcode>
      <faultstring>${escapeXml(fault)}</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`

  return new NextResponse(response, {
    status: 500,
    headers: {
      'Content-Type': 'text/xml; charset=utf-8',
    },
  })
}

function escapeXml(str: string): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
