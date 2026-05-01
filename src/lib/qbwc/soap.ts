// ──────────────────────────────────────────────────────────────────────────
// Minimal QBWC SOAP envelope parser + builder
// ──────────────────────────────────────────────────────────────────────────
// QBWC posts SOAP 1.1 envelopes with a single child of <soap:Body>. We
// extract the operation name and named string args, dispatch to a handler,
// and wrap the return value in a matching <opNameResponse><opNameResult>...
// envelope. This is intentionally narrow — we only support the 8 QBWC ops.

import { XMLParser } from 'fast-xml-parser'

export type QbwcOp =
  | 'serverVersion'
  | 'clientVersion'
  | 'authenticate'
  | 'sendRequestXML'
  | 'receiveResponseXML'
  | 'connectionError'
  | 'getLastError'
  | 'closeConnection'

export interface QbwcParsedRequest {
  op: QbwcOp
  args: Record<string, string>
}

const envelopeParser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
})

const KNOWN_OPS: QbwcOp[] = [
  'serverVersion',
  'clientVersion',
  'authenticate',
  'sendRequestXML',
  'receiveResponseXML',
  'connectionError',
  'getLastError',
  'closeConnection',
]

export function parseSoapRequest(xml: string): QbwcParsedRequest | null {
  const parsed = envelopeParser.parse(xml)
  const body = parsed?.Envelope?.Body
  if (!body) return null
  for (const op of KNOWN_OPS) {
    if (body[op] !== undefined) {
      const node = body[op] ?? {}
      const args: Record<string, string> = {}
      if (node && typeof node === 'object') {
        for (const [k, v] of Object.entries(node)) {
          if (typeof v === 'string') args[k] = v
          else if (typeof v === 'number' || typeof v === 'boolean') args[k] = String(v)
          else if (v == null) args[k] = ''
          else args[k] = String(v)
        }
      }
      return { op, args }
    }
  }
  return null
}

// Escape characters that can break either the SOAP envelope or an inner
// CDATA-less string. We CDATA-wrap qbXML payloads too, so this only
// applies to short scalar fields.
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// qbXML payloads must be CDATA-wrapped. fast-xml-parser turns CDATA into
// raw strings, so on the way back out we wrap manually.
function wrapResultValue(op: QbwcOp, value: string): string {
  // sendRequestXML returns a qbXML document — wrap in CDATA.
  if (op === 'sendRequestXML') {
    // Defensive: split any literal "]]>" sequences (legal but rare).
    const safe = value.split(']]>').join(']]]]><![CDATA[>')
    return `<![CDATA[${safe}]]>`
  }
  return xmlEscape(value)
}

export function buildSoapResponse(op: QbwcOp, value: string): string {
  const inner = wrapResultValue(op, value)
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">
  <soap:Body>
    <${op}Response xmlns="http://developer.intuit.com/">
      <${op}Result>${inner}</${op}Result>
    </${op}Response>
  </soap:Body>
</soap:Envelope>`
}

export function buildSoapFault(message: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <soap:Fault>
      <faultcode>soap:Server</faultcode>
      <faultstring>${xmlEscape(message)}</faultstring>
    </soap:Fault>
  </soap:Body>
</soap:Envelope>`
}
