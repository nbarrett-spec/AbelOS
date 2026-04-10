# Real-Time Notification System for Builder Portal

## Overview

The Abel Lumber builder notification system is a comprehensive, real-time solution for communicating important updates to builders through the platform. The system includes:

1. **In-app notifications** with real-time polling (30s interval)
2. **Notification dropdown** in the navbar with unread count badge
3. **Full notifications page** with filtering and batch actions
4. **Auto-triggered notifications** when quotes are sent
5. **Staff-side API** for sending notifications programmatically

## Architecture

### Database

The system uses a `BuilderNotification` table (created on-demand) with the following schema:

```sql
CREATE TABLE "BuilderNotification" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "builderId" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'GENERAL',
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "link" TEXT,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

### API Endpoints

#### Builder-Side (Public)
- **GET /api/notifications** — List builder's notifications with unread count
  - Query params: `unread=true` (optional) — Return only unread
  - Response: `{ notifications: [], unreadCount: number }`

- **PATCH /api/notifications** — Mark notifications as read
  - Body: `{ notificationIds: string[] }` OR `{ markAllRead: true }`
  - Response: `{ success: true }`

#### Staff-Side (Protected)
- **POST /api/ops/notifications/builder/send** — Create a notification for a builder
  - Auth: Requires staff auth header (x-staff-id)
  - Body: `{ builderId, type, title, message, link? }`
  - Types: `ORDER_STATUS`, `DELIVERY_UPDATE`, `QUOTE_READY`, `INVOICE_CREATED`, `PAYMENT_RECEIVED`, `GENERAL`
  - Response: `{ id, builderId, type, title, message, link, read, createdAt }`

#### Dashboard (Protected)
- **GET /api/ops/notifications/builder** — View builder notification history (ops)
  - Query params: `view=list|stats`, `limit`, `offset`
  - Returns aggregated notification stats and history

## Components

### 1. Notification Bell in Navbar (`src/components/Navbar.tsx`)

The notification bell is already integrated into the navbar and features:

- Bell icon with orange badge showing unread count
- Dropdown panel showing last 50 notifications
- "Mark all read" button
- Click notification to navigate to link and mark as read
- Polls for new notifications every 30 seconds
- Real-time unread count updates

**Icon Types:**
- `order_status` → 📦
- `order_confirmed` → ✅
- `order_shipped` → 🚚
- `delivery_update` → 🚚
- `delivery_scheduled` → 📅
- `delivery_in_transit` → 🚛
- `delivery_complete` → ✅
- `quote_ready` → 📋
- `invoice_created` → 💳
- `invoice_overdue` → ⚠️
- `payment_received` → 💰
- `general` → 🔔

### 2. Notifications Page (`src/app/dashboard/notifications/page.tsx`)

Full-page notifications view with:

- Header showing unread count and "Mark All as Read" button
- Filters: All notifications or Unread only
- Batch actions: Select multiple notifications, mark as read
- Color-coded notification types with icons
- Time-ago formatting (e.g., "2m ago", "Yesterday")
- Click notifications to navigate and mark as read
- Empty states with helpful messaging

### 3. Auto-Triggered Notifications

#### Quote Ready (When status changes to SENT)

**File:** `src/app/api/ops/quotes/route.ts` (PATCH endpoint)

When a quote status is updated to `SENT`:

```typescript
// Create in-app notification for builder
const notifId = `notif_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
await prisma.$executeRawUnsafe(
  `INSERT INTO "BuilderNotification" ("id", "builderId", "type", "title", "message", "link", "read", "createdAt")
   VALUES ($1, $2, 'QUOTE_READY', $3, $4, $5, false, NOW())`,
  notifId,
  updatedQuote.builder_id,
  `Quote ${updatedQuote.quoteNumber} Ready`,
  `Your quote for ${updatedQuote.project_name || 'your project'} is ready for review`,
  `/projects/${updatedQuote.projectId}`
)
```

The notification:
- Is created in addition to the email being sent
- Has type `QUOTE_READY`
- Includes a link directly to the project page
- Shows the quote number and project name

## Usage Examples

### For Staff: Sending a Notification

```bash
curl -X POST http://localhost:3000/api/ops/notifications/builder/send \
  -H "Content-Type: application/json" \
  -H "x-staff-id: staff_123" \
  -H "x-staff-token: token_xyz" \
  -d {
    "builderId": "builder_456",
    "type": "DELIVERY_UPDATE",
    "title": "Your order is on the way",
    "message": "Order #ORD-2024-0001 has been shipped and will arrive tomorrow",
    "link": "/orders/ORD-2024-0001"
  }
```

### For Frontend: Displaying Unread Count

```typescript
const { data } = await fetch('/api/notifications')
const { unreadCount, notifications } = data

// Show badge
<span>{unreadCount > 0 && <Badge>{unreadCount}</Badge>}</span>
```

### For Frontend: Marking as Read

```typescript
// Mark single notification
await fetch('/api/notifications', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ notificationIds: [notifId] })
})

// Mark all as read
await fetch('/api/notifications', {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ markAllRead: true })
})
```

## Notification Types and Icons

| Type | Icon | Use Case |
|------|------|----------|
| `ORDER_STATUS` | 📦 | Order confirmation, status changes |
| `ORDER_CONFIRMED` | ✅ | Order confirmed by ops |
| `ORDER_SHIPPED` | 🚚 | Order has shipped |
| `ORDER_DELIVERED` | 📬 | Order delivered |
| `QUOTE_READY` | 📋 | Quote available for review |
| `DELIVERY_UPDATE` | 🚚 | Delivery schedule changes |
| `DELIVERY_SCHEDULED` | 📅 | Delivery scheduled |
| `DELIVERY_IN_TRANSIT` | 🚛 | Delivery in progress |
| `DELIVERY_COMPLETE` | ✅ | Delivery completed |
| `DELIVERY_RESCHEDULED` | 🔄 | Delivery rescheduled |
| `INVOICE_CREATED` | 💳 | Invoice generated |
| `INVOICE_OVERDUE` | ⚠️ | Invoice payment overdue |
| `PAYMENT_RECEIVED` | 💰 | Payment confirmed |
| `GENERAL` | 🔔 | General announcements |

## Styling

The notification system uses Abel brand colors:

- **Primary (Navy):** `#1B4F72` (bg-abel-navy)
- **Accent (Orange):** `#E67E22` (bg-abel-orange, text-abel-orange)

Color-coded notification types:
- Order-related: Blue, Green, Cyan, Violet
- Quote-related: Amber
- Delivery-related: Orange, Indigo, Purple, Green
- Invoice-related: Slate, Red
- Payment-related: Emerald

## Performance

- **Polling interval:** 30 seconds (configurable in Navbar)
- **Limit per fetch:** 50 notifications
- **Table indices:** builderId, createdAt
- **Lazy loading:** Table created on first access if missing

## Future Enhancements

1. **WebSocket support** — Real-time push instead of polling
2. **Email notifications** — Optional email digest
3. **SMS notifications** — Text message alerts
4. **Notification preferences** — Builder can choose what to receive
5. **Notification archive** — Soft-delete, not shown in lists
6. **Notification categories** — Filter by type in UI
7. **Batch notifications** — Combine multiple related notifications
8. **Read receipts** — Track when builders read notifications

## Testing

### Test Quote Ready Notification

1. Go to `/ops` (Ops Center)
2. Create or edit a quote
3. Change status to "SENT"
4. Builder should receive a "Quote Ready" notification in the bell dropdown
5. Notification should link to the project page

### Test Notification API

```bash
# Get notifications
curl http://localhost:3000/api/notifications

# Create notification (staff only)
curl -X POST http://localhost:3000/api/ops/notifications/builder/send \
  -H "Content-Type: application/json" \
  -d '{"builderId":"b1","type":"GENERAL","title":"Test","message":"This is a test"}'

# Mark as read
curl -X PATCH http://localhost:3000/api/notifications \
  -H "Content-Type: application/json" \
  -d '{"notificationIds":["notif_xxx"]}'
```

## Debugging

### Check table exists
```sql
SELECT * FROM "BuilderNotification" LIMIT 5;
```

### View unread notifications
```sql
SELECT * FROM "BuilderNotification"
WHERE "builderId" = 'builder_id' AND "read" = false
ORDER BY "createdAt" DESC;
```

### Clear test notifications
```sql
DELETE FROM "BuilderNotification"
WHERE "builderId" = 'builder_id';
```

## Files Modified/Created

1. **Created:** `/src/app/api/ops/notifications/builder/send/route.ts` — Staff API to send notifications
2. **Modified:** `/src/app/api/ops/quotes/route.ts` — Added auto-notification on quote send
3. **Created:** `/src/app/dashboard/notifications/page.tsx` — Full notifications page
4. **Already exists:** `/src/app/api/notifications/route.ts` — Builder notification endpoints
5. **Already exists:** `/src/components/Navbar.tsx` — Notification bell UI

## Database Cleanup

If needed to reset notifications (development only):

```sql
DROP TABLE IF EXISTS "BuilderNotification";
```

The system will recreate the table on next access.
