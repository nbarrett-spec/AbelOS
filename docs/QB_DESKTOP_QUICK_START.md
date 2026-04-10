# QuickBooks Desktop Web Connector - Quick Start Guide

## 5-Minute Setup

### 1. Environment Variables
Add to `.env`:
```bash
QBWC_USERNAME=your_qbwc_username
QBWC_PASSWORD=your_qbwc_password
APP_URL=https://your-domain.com  # Optional, defaults to request host
```

### 2. Database Migration
```bash
npx prisma migrate dev --name add_qb_desktop_integration
```

This creates:
- `QBSyncQueue` table
- `SyncLog` table
- QB fields on Builder, Invoice, PurchaseOrder

### 3. Download .QWC File
Navigate to: `https://your-domain.com/api/ops/integrations/quickbooks/qwc`

Downloads: `abel-builder-qb-sync.qwc`

### 4. Open in QB Web Connector
1. Open QuickBooks (make sure QB file is open)
2. Open QB Web Connector
3. File → Add App
4. Select the .qwc file
5. Enter credentials when prompted
6. Enable the app
7. Click "Update Selected"

Web Connector will now poll the SOAP endpoint automatically.

## API Quick Reference

### Check Status
```bash
curl -X GET https://your-domain.com/api/ops/integrations/quickbooks \
  -H "X-Staff-ID: staff123" \
  -H "X-Staff-Role: ADMIN"
```

Returns: connection status, queue stats, entity counts, sync history

### Queue Builders
```bash
curl -X POST https://your-domain.com/api/ops/integrations/quickbooks \
  -H "X-Staff-ID: staff123" \
  -H "X-Staff-Role: ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"action":"queue-builders"}'
```

Queues all unsynced active builders as QB Customers.

### Queue Invoices
```bash
curl -X POST https://your-domain.com/api/ops/integrations/quickbooks \
  -H "X-Staff-ID: staff123" \
  -H "X-Staff-Role: ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"action":"queue-invoices"}'
```

Queues unsynced invoices (only if customer is synced).

### Queue Purchase Orders
```bash
curl -X POST https://your-domain.com/api/ops/integrations/quickbooks \
  -H "X-Staff-ID: staff123" \
  -H "X-Staff-Role: ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"action":"queue-pos"}'
```

Queues unsynced purchase orders as QB Bills.

### Retry Failed Items
```bash
curl -X POST https://your-domain.com/api/ops/integrations/quickbooks \
  -H "X-Staff-ID: staff123" \
  -H "X-Staff-Role: ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"action":"retry-failed"}'
```

Re-queues items that previously failed.

### Clear Completed
```bash
curl -X POST https://your-domain.com/api/ops/integrations/quickbooks \
  -H "X-Staff-ID: staff123" \
  -H "X-Staff-Role: ADMIN" \
  -H "Content-Type: application/json" \
  -d '{"action":"clear-queue"}'
```

Removes completed items from queue.

## Common Workflows

### Sync New Builders
1. Create builders in platform
2. Call `queue-builders` action
3. Watch status for sync completion
4. Verify QB ListIDs appear in status endpoint

### Sync Invoices
1. Make sure builders are synced first (they need QB ListID)
2. Create/update invoices
3. Call `queue-invoices` action
4. Monitor sync completion
5. QB TxnIDs will populate

### Batch Sync
```bash
# Queue all unsynced data types
curl ... -d '{"action":"queue-builders"}'
curl ... -d '{"action":"queue-invoices"}'
curl ... -d '{"action":"queue-pos"}'

# Monitor progress
curl ... # GET endpoint every 30 seconds
```

## Troubleshooting

### Web Connector Won't Connect
1. Check credentials in env vars
2. Verify HTTPS is configured
3. Ensure QB file is open
4. Check firewall allows outbound connections

### Items Stay Pending
1. Verify QB file is open
2. Check Web Connector is running
3. View sync history for errors
4. Check database for error messages

### QB IDs Not Populating
1. Check status endpoint for sync success
2. View SyncLog table for errors
3. Run manual retry: `retry-failed` action

## Monitoring

### Database Queries

Check queue status:
```sql
SELECT status, COUNT(*) FROM "QBSyncQueue" GROUP BY status;
```

View recent syncs:
```sql
SELECT * FROM "SyncLog"
WHERE provider = 'QUICKBOOKS_DESKTOP'
ORDER BY startedAt DESC LIMIT 10;
```

Check QB mappings:
```sql
SELECT "companyName", "qbListId", "qbSyncedAt" FROM "Builder"
WHERE "qbListId" IS NOT NULL;
```

### Dashboard Endpoint

The status API at `/api/ops/integrations/quickbooks` shows:
- Real-time queue depth
- Entity sync counts
- Recent sync history
- Last error messages
- Connection status

## Key Concepts

### Queue Status
- `pending` - Waiting to be processed
- `processing` - Currently being synced
- `completed` - Successfully synced
- `failed` - Failed (can be retried)

### Entity Types
- `BUILDER` - Maps to QB Customer
- `INVOICE` - Maps to QB Invoice
- `PO` - Maps to QB Bill
- `PAYMENT` - Maps to QB Payment

### QB ID Storage
- Builder: `qbListId` (Customer ListID)
- Invoice: `qbTxnId` (Invoice TxnID)
- PO: `qbTxnId` (Bill TxnID)

## Production Checklist

- [ ] Set QBWC_USERNAME and QBWC_PASSWORD
- [ ] Run Prisma migration
- [ ] Download and configure .qwc file
- [ ] Test with sample builders
- [ ] Verify QB file backing
- [ ] Set up monitoring alerts
- [ ] Configure QBWC polling interval
- [ ] Document for support team

## Next Steps

1. See `QUICKBOOKS_DESKTOP_INTEGRATION.md` for full documentation
2. Check `src/lib/integrations/quickbooks-desktop.ts` for function reference
3. Review API endpoint code for advanced customization

## Support

For questions or issues:
1. Check troubleshooting section in main documentation
2. Review sync history in status endpoint
3. Check SyncLog table for detailed error messages
4. Verify QB file has no permission issues
5. Ensure Web Connector credentials are correct
