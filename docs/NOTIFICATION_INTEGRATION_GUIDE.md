# Notification System Integration Guide

## Quick Start

The real-time notification system for the Abel Lumber builder portal is now fully operational. Here's what's been implemented:

## What's Already Done

### 1. Notification APIs
- ✅ `GET /api/notifications` — Fetch builder notifications
- ✅ `PATCH /api/notifications` — Mark as read
- ✅ `POST /api/ops/notifications/builder/send` — Staff API to trigger notifications
- ✅ `GET /api/ops/notifications/builder` — View history (ops dashboard)

### 2. Frontend Components
- ✅ **Navbar Bell** — Live notification dropdown with polling
- ✅ **Notifications Page** — Full `/dashboard/notifications` page with filtering
- ✅ **Auto-notifications** — Quote ready notifications trigger automatically

### 3. Database
- ✅ Auto-creates `BuilderNotification` table on first access
- ✅ Indexed by builderId for performance

## Testing the System

### Test 1: Auto-triggered Quote Notification

1. Navigate to `/ops` (Ops Center)
2. Find or create a quote
3. Change quote status from "DRAFT" to "SENT"
4. An in-app notification appears in the notification bell
5. Email is sent AND notification is created simultaneously
6. Builder clicks notification → navigates to project and marks as read

**Expected Notification:**
```
Title: Quote ABC-2024-001 Ready
Message: Your quote for XYZ Project is ready for review
Link: /projects/proj_123
Type: QUOTE_READY (📋)
```

### Test 2: Manual Notification (Staff API)

```bash
# From terminal/Postman
curl -X POST "http://localhost:3000/api/ops/notifications/builder/send" \
  -H "Content-Type: application/json" \
  -H "x-staff-id: staff_123" \
  -H "x-staff-token: your_token" \
  -d '{
    "builderId": "builder_abc123",
    "type": "DELIVERY_UPDATE",
    "title": "Your order is on the way",
    "message": "Order #ORD-2024-0001 will arrive tomorrow by 5 PM",
    "link": "/orders/ORD-2024-0001"
  }'
```

**Response (201 Created):**
```json
{
  "id": "notif_1234567890_abcdef",
  "builderId": "builder_abc123",
  "type": "DELIVERY_UPDATE",
  "title": "Your order is on the way",
  "message": "Order #ORD-2024-0001 will arrive tomorrow by 5 PM",
  "link": "/orders/ORD-2024-0001",
  "read": false,
  "createdAt": "2024-03-29T10:15:30.000Z"
}
```

### Test 3: Builder Reads Notification

**In browser console:**
```javascript
// Get all notifications
const res = await fetch('/api/notifications');
const data = await res.json();
console.log(data.unreadCount, data.notifications);

// Mark one as read
await fetch('/api/notifications', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notificationIds: ['notif_123'] })
});

// Mark all as read
await fetch('/api/notifications', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ markAllRead: true })
});
```

## Adding Notifications to Other Events

### Pattern: Order Confirmed

In `/src/app/api/ops/orders/route.ts` (PATCH when status → CONFIRMED):

```typescript
if (status === 'CONFIRMED') {
  try {
    const notifId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
    await prisma.$executeRawUnsafe(
      `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
       VALUES ($1, $2, 'ORDER_STATUS', $3, $4, $5, false, NOW())`,
      notifId,
      builder_id,
      `Order #${order.orderNumber} Confirmed`,
      `Your order has been confirmed and will be processed soon`,
      `/orders/${order.id}`
    )
  } catch (e) {
    console.warn('Failed to create confirmation notification:', e)
  }
}
```

### Pattern: Invoice Created

In `/src/app/api/ops/invoices/route.ts` (POST when creating invoice):

```typescript
try {
  const notifId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
     VALUES ($1, $2, 'INVOICE_CREATED', $3, $4, $5, false, NOW())`,
    notifId,
    builderId,
    `Invoice ${invoice.invoiceNumber} Generated`,
    `Invoice for ${formatCurrency(invoice.total)} is ready`,
    `/account/invoices/${invoice.id}`
  )
} catch (e) {
  console.warn('Failed to create invoice notification:', e)
}
```

### Pattern: Payment Received

In `/src/app/api/ops/payments/route.ts` (POST when payment confirmed):

```typescript
try {
  const notifId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
  await prisma.$executeRawUnsafe(
    `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
     VALUES ($1, $2, 'PAYMENT_RECEIVED', $3, $4, $5, false, NOW())`,
    notifId,
    builderId,
    `Payment Received`,
    `Thank you! We received your payment of ${formatCurrency(amount)}`,
    `/account/payments`
  )
} catch (e) {
  console.warn('Failed to create payment notification:', e)
}
```

## Notification Types Reference

| Type | Icon | Color | Use For |
|------|------|-------|---------|
| `ORDER_STATUS` | 📦 | Blue | Order state changes (received, confirmed, production) |
| `DELIVERY_UPDATE` | 🚚 | Orange | Delivery info changes |
| `QUOTE_READY` | 📋 | Amber | Quotes sent and ready for review |
| `INVOICE_CREATED` | 💳 | Slate | New invoices generated |
| `PAYMENT_RECEIVED` | 💰 | Emerald | Payments confirmed |
| `GENERAL` | 🔔 | Gray | General announcements |

## UI/UX Features

### Notification Bell (Navbar)
- Unread badge with count (max 99+)
- Orange color (#E67E22) for attention
- Dropdown with last 50 notifications
- "Mark all as read" quick action
- 30-second auto-refresh polling
- Click notification → navigate and mark read

### Notifications Page (`/dashboard/notifications`)
- Full-page view of all notifications
- Filter: All or Unread only
- Batch select with "Mark as Read" action
- Color-coded by type
- Emoji icons for quick visual scanning
- Time-ago formatting ("2m ago", "Yesterday")
- Empty state messages
- Back to dashboard link

## Styling Notes

- **Primary**: Abel Navy `#1B4F72` (navigation, headers, buttons)
- **Accent**: Abel Orange `#E67E22` (badges, highlights, CTAs)
- **Notification colors**: Semantic colors per type (blue=order, amber=quote, etc.)
- **Border indicators**: Left 4px border for notification types
- **Unread styling**: Light orange ring + orange dot badge

## Performance Considerations

1. **Polling interval**: 30 seconds (adjust in `Navbar.tsx` if needed)
2. **Fetch limit**: 50 notifications per request
3. **Database indices**: builderId index for fast filtering
4. **Lazy table creation**: Table created on first access (no migration needed)
5. **Unread count**: Separate query for efficiency
6. **Batch operations**: Multiple notifications can be marked read in one request

## Troubleshooting

### Notifications Not Appearing

1. Check browser console for errors
2. Verify builder auth with `getSession()` in `/lib/auth`
3. Check if table exists: `SELECT COUNT(*) FROM "BuilderNotification"`
4. Test API directly: `curl http://localhost:3000/api/notifications`

### Missing Unread Badge

1. Verify unread count query: `SELECT COUNT(*) FROM "BuilderNotification" WHERE "builderId"=$1 AND "read"=false`
2. Check Navbar component is rendering (watch for auth state)
3. Browser cache: Hard refresh (Ctrl+Shift+R)

### Notifications Not Auto-Creating on Quote Send

1. Verify quote PATCH endpoint reaches the notification creation code
2. Check builderId is being passed correctly
3. Look for console.warn logs about notification creation

## Files Modified

1. **Created**: `/src/app/api/ops/notifications/builder/send/route.ts` (75 lines)
2. **Modified**: `/src/app/api/ops/quotes/route.ts` (added notification creation)
3. **Created**: `/src/app/dashboard/notifications/page.tsx` (450+ lines)
4. **Existing**: `/src/app/api/notifications/route.ts` (builder endpoints)
5. **Existing**: `/src/components/Navbar.tsx` (notification bell UI)

## Next Steps (Optional Enhancements)

- [ ] Add WebSocket support for real-time push
- [ ] Email notification preferences
- [ ] SMS alerts
- [ ] Notification categories/tags
- [ ] Archive old notifications
- [ ] Notification scheduling (send at specific time)
- [ ] Bulk notification templates
- [ ] Read/unread analytics

## Questions?

Refer to `NOTIFICATION_SYSTEM.md` for complete technical documentation.
