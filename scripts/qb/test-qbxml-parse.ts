// scripts/qb/test-qbxml-parse.ts
//
// Smoke test for the QBWC qbXML response parser. Hardcodes a sample Customer
// response and a sample Invoice response (with line items), runs them through
// parseQbxmlResponse, and prints the rows we WOULD upsert. No DB writes.
//
// Run: npx tsx scripts/qb/test-qbxml-parse.ts

import { parseQbxmlResponse } from '../../src/lib/qbwc/qbxml'
import { describePlannedWrites } from '../../src/lib/qbwc/upserts'

const CUSTOMER_RESPONSE = `<?xml version="1.0" ?>
<QBXML>
  <QBXMLMsgsRs>
    <CustomerQueryRs requestID="seq-customer-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK" iteratorRemainingCount="0" iteratorID="{abc}">
      <CustomerRet>
        <ListID>80000001-1700000000</ListID>
        <FullName>Brookfield Residential</FullName>
        <CompanyName>Brookfield Residential Properties</CompanyName>
        <Email>amanda.barham@brookfieldrp.com</Email>
        <Phone>(214) 555-1212</Phone>
        <Balance>148237.42</Balance>
        <IsActive>true</IsActive>
      </CustomerRet>
      <CustomerRet>
        <ListID>80000002-1700000000</ListID>
        <FullName>Bloomfield Homes</FullName>
        <CompanyName>Bloomfield Homes LP</CompanyName>
        <Phone>(817) 555-9090</Phone>
        <Balance>72104.10</Balance>
        <IsActive>true</IsActive>
      </CustomerRet>
    </CustomerQueryRs>
  </QBXMLMsgsRs>
</QBXML>`

const INVOICE_RESPONSE = `<?xml version="1.0" ?>
<QBXML>
  <QBXMLMsgsRs>
    <InvoiceQueryRs requestID="seq-invoice-1" statusCode="0" statusSeverity="Info" statusMessage="Status OK" iteratorRemainingCount="0">
      <InvoiceRet>
        <TxnID>9F1A-1714000000</TxnID>
        <RefNumber>INV-104221</RefNumber>
        <CustomerRef>
          <ListID>80000001-1700000000</ListID>
          <FullName>Brookfield Residential</FullName>
        </CustomerRef>
        <TxnDate>2026-04-12</TxnDate>
        <DueDate>2026-05-12</DueDate>
        <Subtotal>4218.00</Subtotal>
        <TotalAmount>4218.00</TotalAmount>
        <BalanceRemaining>4218.00</BalanceRemaining>
        <IsPaid>false</IsPaid>
        <InvoiceLineRet>
          <ItemRef>
            <ListID>20000001</ListID>
            <FullName>Door:Therma-Tru S204</FullName>
          </ItemRef>
          <Desc>S204 fiberglass entry, 36x80, RH inswing</Desc>
          <Quantity>2</Quantity>
          <Rate>1289.00</Rate>
          <Amount>2578.00</Amount>
        </InvoiceLineRet>
        <InvoiceLineRet>
          <ItemRef>
            <ListID>20000002</ListID>
            <FullName>Hardware:Emtek Madison</FullName>
          </ItemRef>
          <Desc>Emtek Madison knob set, satin nickel</Desc>
          <Quantity>4</Quantity>
          <Rate>410.00</Rate>
          <Amount>1640.00</Amount>
        </InvoiceLineRet>
      </InvoiceRet>
    </InvoiceQueryRs>
  </QBXMLMsgsRs>
</QBXML>`

function runOne(label: string, xml: string): void {
  console.log(`\n=== ${label} ===`)
  const parsed = parseQbxmlResponse(xml)
  console.log(`kind=${parsed.kind} status=${parsed.header.statusSeverity} requestID=${parsed.header.requestID}`)
  if (parsed.customers) console.log(`parsed customers: ${parsed.customers.length}`)
  if (parsed.invoices) {
    console.log(`parsed invoices: ${parsed.invoices.length}`)
    for (const inv of parsed.invoices) {
      console.log(`  invoice ${inv.refNumber} → ${inv.lines.length} line items`)
    }
  }
  console.log('--- planned writes ---')
  for (const line of describePlannedWrites(parsed)) console.log(line)
}

function main(): void {
  console.log('QBWC qbXML smoke test (no DB writes)')
  runOne('CustomerQueryRs sample', CUSTOMER_RESPONSE)
  runOne('InvoiceQueryRs sample', INVOICE_RESPONSE)
  console.log('\nDone. If both sections show planned writes above, the parser is wired correctly.')
}

main()
