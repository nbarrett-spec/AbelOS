# QuickBooks Desktop Web Connector Integration

## Overview

This integration syncs Abel Builder Platform data to QuickBooks Desktop via the Web Connector (QBWC) interface. QBWC is a Windows application that polls a SOAP endpoint for qbXML requests, making it ideal for background sync operations.

**Key Features:**
- Syncs Builders as QB Customers
- Syncs Invoices with line items
- Syncs Purchase Orders as Bills
- Syncs Payments to invoices
- Resilient queue-based processing with retry logic
- Real-time sync status monitoring

## Architecture

### Components

#### 1. Core Library (`src/lib/integrations/quickbooks-desktop.ts`)
The main integration library providing:
- **QBWC SOAP Response Generators** - Format responses for Web Connector
- **qbXML Request Builders** - Create QB transaction XML
- **qbXML Response Parsers** - Extract QB IDs from responses
- **Queue Management** - Handle pending sync items
- **Entity Mapping** - Store QB ListID/TxnID relationships

#### 2. SOAP Endpoint (`src/app/api/ops/integrations/quickbooks/webconnector/route.ts`)
Implements the QBWC Web Connector protocol:
- `authenticate` - Validates QBWC credentials
- `sendRequestXML` - Returns next pending qbXML request
- `receiveResponseXML` - Processes QB responses
- `closeConnection` - Handles disconnect
- `getLastError` - Returns last error message

#### 3. Status & Sync API (`src/app/api/ops/integrations/quickbooks/route.ts`)
Staff-facing endpoints for integration management:
- **GET** - Returns connection status, queue depth, entity counts, sync history
- **POST** - Queue entities for sync (builders, invoices, POs), retry failed items, clear completed queue

#### 4. .QWC Configuration (`src/app/api/ops/integrations/quickbooks/qwc/route.ts`)
Generates the .qwc file for Web Connector configuration:
- Downloads as XML file for opening in QB Web Connector
- Auto-configures the SOAP endpoint URL

### Database Tables

#### QBSyncQueue
Manages pending sync items:
```sql
id              CUID primary key
action          STRING - CUSTOMER_ADD, INVOICE_ADD, PO_ADD, PAYMENT_ADD
entityType      STRING - BUILDER, INVOICE, PO, PAYMENT
entityId        STRING - Platform entity ID
qbTxnId         STRING - QB Transaction ID (populated from response)
qbListId        STRING - QB List ID (populated from response)
requestXml      STRING - qbXML request sent to QB
responseXml     STRING - qbXML response from QB
payload         JSON - Additional sync metadata
status          STRING - pending, processing, completed, failed
attempts        INT - Number of attempts made
maxAttempts     INT - Maximum retry attempts (default: 3)
lastError       STRING - Error message if failed
processedAt     DATETIME - When item was last processed
createdAt       DATETIME - When item was queued
```

#### SyncLog
Audit trail of all sync operations:
```sql
id              CUID primary key
provider        STRING - QUICKBOOKS_DESKTOP, INFLOW, etc.
syncType        STRING - Action type (CUSTOMER_ADD, etc.)
direction       STRING - PUSH, PULL, BIDIRECTIONAL
status          STRING - SUCCESS, PARTIAL, FAILED
recordsProcessed INT
recordsCreated  INT
recordsUpdated  INT
recordsSkipped  INT
recordsFailed   INT
errorMessage    STRING
startedAt       DATETIME
completedAt     DATETIME
durationMs      INT
```

### Model Changes

Added QB integration fields to:

**Builder**
- `qbListId: String?` - QB Customer ListID
- `qbSyncedAt: DateTime?` - Last sync timestamp

**Invoice**
- `qbTxnId: String?` - QB Invoice TxnID
- `qbSyncedAt: DateTime?` - Last sync timestamp
- `qbSyncStatus: String?` - PENDING, SYNCED, FAILED

**PurchaseOrder**
- `qbTxnId: String?` - QB Bill TxnID
- `qbSyncedAt: DateTime?` - Last sync timestamp

## Setup Instructions

### 1. Environment Variables

Set these in your `.env` file:

```bash
# QBWC Authentication
QBWC_USERNAME=your_qbwc_username
QBWC_PASSWORD=your_qbwc_password

# Optional: Override app URL for .qwc file generation
# Defaults to the request host if not set
APP_URL=https://your-domain.com
```

### 2. Database Migration

The integration requires these tables and columns. Run migrations:

```bash
npx prisma migrate dev --name add_qb_desktop_integration
```

This adds:
- QBSyncQueue table
- SyncLog table
- QB fields to Builder, Invoice, PurchaseOrder models

### 3. Download .QWC Configuration

1. Navigate to: `https://your-domain.com/api/ops/integrations/quickbooks/qwc`
2. This downloads `abel-builder-qb-sync.qwc`
3. Open the .qwc file in QuickBooks Web Connector
4. Web Connector will authenticate and begin polling for sync items

### 4. QB Security

QuickBooks Web Connector requires:
- QB file to be open on the Windows machine running QBWC
- User running QBWC to have admin rights in QB
- SSL certificate (if using HTTPS, which is recommended)

## Usage

### API Endpoints

#### Check Integration Status
```bash
GET /api/ops/integrations/quickbooks
Headers: X-Staff-ID, X-Staff-Role (requires staff auth)
```

Response includes:
- Connection status
- Queue statistics (pending, processing, completed, failed)
- Entity sync counts (builders, invoices, POs)
- Recent sync history
- Setup instructions if not configured

#### Queue Builders for Sync
```bash
POST /api/ops/integrations/quickbooks
Content-Type: application/json
Headers: X-Staff-ID, X-Staff-Role

{
  "action": "queue-builders"
}
```

Queues all unsynced active builders.

#### Queue Invoices for Sync
```bash
{
  "action": "queue-invoices"
}
```

Queues all unsynced invoices (only if their customer is synced).

#### Queue Purchase Orders
```bash
{
  "action": "queue-pos"
}
```

Queues all unsynced POs.

#### Retry Failed Items
```bash
{
  "action": "retry-failed"
}
```

Re-queues items that previously failed.

#### Clear Completed Items
```bash
{
  "action": "clear-queue"
}
```

Removes completed items from the queue.

### Sync Flow

1. **Item Added to Queue**
   - Staff triggers sync action (e.g., "queue-invoices")
   - Unsynced entities added to QBSyncQueue with status=pending

2. **Web Connector Polls**
   - QBWC calls `authenticate` endpoint
   - If valid credentials, returns session ticket

3. **Request Building**
   - QBWC calls `sendRequestXML`
   - Endpoint retrieves next pending item
   - Builds appropriate qbXML request
   - Updates queue item status to processing
   - Returns qbXML request to QBWC

4. **QB Processing**
   - QBWC opens QB file and processes qbXML
   - QB executes transaction (CustomerAdd, InvoiceAdd, etc.)
   - Returns qbXML response with QB IDs

5. **Response Processing**
   - QBWC calls `receiveResponseXML`
   - Endpoint parses response
   - Stores QB ListID/TxnID in platform
   - Updates queue item status to completed
   - Logs sync operation

6. **Next Cycle**
   - QBWC calls `sendRequestXML` again
   - Gets next pending item or empty request (signals completion)

## Data Mapping

### Builder → QB Customer
| Abel Field | QB Field |
|-----------|----------|
| companyName | Customer:Name |
| contactName | Customer:FirstName + LastName |
| email | Customer:Email |
| phone | Customer:Phone |
| address | Customer:BillAddress:Addr1 |
| city | Customer:BillAddress:City |
| state | Customer:BillAddress:State |
| zip | Customer:BillAddress:PostalCode |
| taxId | Customer:TaxID |
| paymentTerm | Customer:Terms |
| creditLimit | Customer:CreditLimit |

### Invoice → QB Invoice
| Abel Field | QB Field |
|-----------|----------|
| invoiceNumber | Invoice:RefNumber |
| issuedAt | Invoice:TxnDate |
| dueDate | Invoice:DueDate |
| subtotal | Invoice:SubTotalAmount |
| taxAmount | Invoice:TaxAmount |
| total | Invoice:TotalAmount |
| notes | Invoice:Memo |
| invoice items | Invoice:InvoiceLineAdd |

### PurchaseOrder → QB Bill
| Abel Field | QB Field |
|-----------|----------|
| poNumber | Bill:RefNumber |
| orderedAt | Bill:TxnDate |
| expectedDate | Bill:DueDate |
| subtotal | Bill:SubTotalAmount |
| shippingCost | Bill:ShippingAmount |
| total | Bill:TotalAmount |
| notes | Bill:Memo |
| PO items | Bill:ItemLineAdd |

## Error Handling

### Queue Item Failures

If an item fails to sync:
1. Error logged in QBSyncQueue.lastError
2. Queue item marked as failed
3. Sync logged in SyncLog with status=FAILED
4. Staff can view error and retry via "retry-failed" action

### Max Retries

- Each item can be retried up to maxAttempts (default: 3)
- Failed items stop processing after max attempts
- Use "retry-failed" to re-enable and retry

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| Invalid session ticket | QBWC credentials wrong | Verify QBWC_USERNAME, QBWC_PASSWORD |
| Customer not synced to QB | Invoice queued before builder | Queue builders first, then invoices |
| QB file not open | Web Connector can't access QB | Open QB file on Windows machine |
| Transaction already exists | Duplicate sync attempt | Check queue for duplicate entries |

## Monitoring

### Queue Status
```bash
# Check pending items
GET /api/ops/integrations/quickbooks
Look for: queue.pending, queue.failed
```

### Sync History
```bash
# View recent sync operations
GET /api/ops/integrations/quickbooks
Look for: syncHistory array
```

### Database Queries

Check queue status:
```sql
SELECT status, COUNT(*) FROM "QBSyncQueue"
GROUP BY status;
```

Check sync logs:
```sql
SELECT * FROM "SyncLog"
WHERE provider = 'QUICKBOOKS_DESKTOP'
ORDER BY startedAt DESC
LIMIT 20;
```

Check QB mappings:
```sql
SELECT id, "companyName", "qbListId", "qbSyncedAt"
FROM "Builder"
WHERE "qbListId" IS NOT NULL;
```

## Implementation Notes

### Session Management
- Sessions stored in-memory (Map)
- 1-hour timeout
- **Production Note:** Replace with Redis for multi-instance deployments

### Rate Limiting
- No built-in rate limiting (QBWC manages frequency)
- QBWC polling interval configurable in QB settings (default: every 2 min)

### Transaction Batching
- Each QBWC poll retrieves one item
- Items processed sequentially
- Multiple QBWC instances can run in parallel (each gets different items)

### idempotency
- QB enforces unique RefNumber (invoice/PO numbers)
- Safe to retry failed items
- QB won't create duplicates if same RefNumber re-sent

## Troubleshooting

### Web Connector Won't Connect
1. Verify QBWC_USERNAME and QBWC_PASSWORD are set
2. Check endpoint URL is correct in .qwc file
3. Verify SSL certificate (if HTTPS)
4. Check firewall allows outbound connections from Windows machine

### Items Stay Pending
1. Check QB file is open on Windows machine
2. Check QBWC is running and logged in
3. View SyncLog for error details
4. Check database for processing errors

### QB IDs Not Updating
1. Verify response parsing in qbXML response
2. Check "receiveResponseXML" endpoint logs
3. Manually check QB to confirm transactions created
4. Run "retry-failed" to reprocess

### Performance Issues
1. Monitor QBSyncQueue size
2. Check if QB file has performance issues
3. Increase QBWC polling interval if QB server is slow
4. Consider batching smaller number of items per request

## Security

### Credentials
- QBWC_USERNAME and QBWC_PASSWORD stored in environment
- Transmitted over HTTPS to Web Connector
- SOAP endpoint doesn't require staff authentication (external service call)

### QB Data
- Only minimal required data transmitted (no PII beyond contact info)
- QB controls access via file permissions
- Transaction audit trail maintained in QB

### Future Improvements
- Replace in-memory session store with Redis
- Add request signing/validation
- Implement rate limiting per QBWC client
- Add webhook notifications for sync completion
- Support multi-company QB files

## Dependencies

- `next` - Framework
- `prisma` - ORM for database access
- Built-in Node.js XML parsing (no external library needed)
- Web Connector (Windows application, user-installed)

## API Reference

See `/src/lib/integrations/quickbooks-desktop.ts` for full function documentation:
- Queue management functions
- Request/response builders
- Entity mapping functions
- Helper utilities
