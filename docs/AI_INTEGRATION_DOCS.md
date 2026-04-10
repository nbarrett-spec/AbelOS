# AI Integration Features - Abel Lumber Platform

This document outlines the AI-powered features built into the Abel Lumber Operations Center, designed to assist staff with scheduling, communications, and workflow optimization.

## Overview

The AI integration provides a smart assistant interface that helps Abel Lumber staff with:
- Job scheduling and crew assignment optimization
- Communication template generation
- Invoice aging analysis
- Job status reporting
- Inventory availability checks
- Performance KPI insights
- Workflow alerts for bottleneck identification

## Architecture

### Frontend Components

#### 1. AI Assistant Chat Interface
**Location:** `/src/app/ops/ai/page.tsx`

A full-screen chat-style interface where staff interact with the AI assistant.

**Features:**
- Real-time message exchange with typing indicators
- 5 quick-action buttons for common queries:
  - Draft email to builder
  - Suggest schedule for next week
  - Analyze overdue invoices
  - Generate job status report
  - Check material availability
- User messages: right-aligned, navy blue (#1B4F72) background
- AI responses: left-aligned, light gray background
- Responsive design with smooth scrolling
- Context-aware message routing to appropriate API handlers

**UI Elements:**
- Header with gradient background (navy to dark blue)
- Scrollable message area with auto-scroll to newest message
- Quick actions panel (shown on initial load)
- Input bar with send button
- Helper text about data accuracy

#### 2. Workflow Alerts Widget
**Location:** `/src/app/ops/components/WorkflowAlerts.tsx`

A reusable component that displays critical workflow alerts on the Operations Dashboard.

**Features:**
- Automatic alert fetching from `/api/ops/ai/alerts`
- Color-coded severity indicators:
  - **HIGH:** Red (#E74C3C) - Immediate action required
  - **MEDIUM:** Orange (#E67E22) - Should be addressed soon
  - **LOW:** Blue (#3498DB) - Informational
- Contextual action links to relevant pages
- Loading state with spinner
- "All clear" message when no alerts present
- Scrollable container for multiple alerts (max 5 displayed)

**Alert Types Detected:**
1. Jobs stuck in readiness check (48+ hours)
2. Overdue invoices
3. Jobs without PM assignment
4. Schedule entries without crew assignment
5. Purchase orders in draft (7+ days)

### Backend API Routes

#### 1. Main AI Assistant Endpoint
**Path:** `/api/ops/ai`
**Method:** POST
**Content-Type:** application/json

**Request:**
```json
{
  "message": "When should we schedule the next delivery?",
  "context": "optional context about the job"
}
```

**Response:**
```json
{
  "text": "Here's your upcoming schedule...",
  "data": {
    "type": "schedule_summary",
    "content": "..."
  },
  "suggestions": ["Ask about optimization", "View full calendar"]
}
```

**Intelligence Routing:**
- **Schedule queries:** Contains "schedule", "week", "when"
  - Fetches next 7 days of schedule entries
  - Groups by entry type
  - Suggests optimizations

- **Invoice queries:** Contains "overdue", "invoice", "payment"
  - Identifies overdue invoices
  - Calculates total aging
  - Shows top 5 oldest invoices

- **Email/Communication:** Contains "email", "draft", "builder"
  - Returns professional email templates
  - 3 template types: delivery, readiness, invoice reminder, completion, schedule change
  - Customizable with real data when jobId provided

- **Job reports:** Contains "status", "report", "job"
  - Queries job counts by status
  - Calculates active vs. complete
  - Provides pipeline insights

- **Inventory:** Contains "material", "stock", "inventory"
  - Shows in-stock vs. out-of-stock counts
  - Lists top categories
  - Suggests reorder actions

- **Performance/KPIs:** Contains "performance", "kpi"
  - Calculates average job completion time
  - Completion rate analysis
  - Efficiency trends

#### 2. Schedule Optimization
**Path:** `/api/ops/ai/schedule-suggest`
**Method:** GET

**Response:**
```json
{
  "suggestions": [
    {
      "jobId": "clx...",
      "jobNumber": "JOB-2026-0142",
      "builderName": "Acme Homes",
      "suggestedDate": "2026-03-24T00:00:00.000Z",
      "suggestedCrew": "Delivery Team A",
      "reason": "Materials staged and ready...",
      "confidence": 0.92
    }
  ],
  "summary": "Found 8 jobs ready to schedule..."
}
```

**Algorithm:**
- Identifies jobs in MATERIALS_LOCKED or STAGED status
- Analyzes crew availability over next 7 days
- Assigns to least-busy crew
- Suggests delivery dates 1-3 days out based on workload
- Confidence score based on crew availability

#### 3. Communication Templates
**Path:** `/api/ops/ai/templates`
**Method:** GET
**Query Parameters:** `?type=DELIVERY_CONFIRMATION&jobId=clx...`

**Available Templates:**
1. **DELIVERY_CONFIRMATION** - Schedules delivery notification
2. **READINESS_CHECK** - T-72 check completion notice
3. **INVOICE_REMINDER** - Payment reminder
4. **COMPLETION_NOTICE** - Job completion confirmation
5. **SCHEDULE_CHANGE** - Reschedule notification

**Response:**
```json
{
  "template": {
    "type": "DELIVERY_CONFIRMATION",
    "subject": "Your Delivery is Scheduled",
    "body": "Dear [Builder Name]...",
    "variables": ["Builder Name", "Job", "Delivery Date", ...]
  }
}
```

**Features:**
- Parameterized templates with clear variables
- Auto-population with real data when jobId provided
- Professional formatting using BLUF (Bottom Line Up Front) style

#### 4. Workflow Alerts
**Path:** `/api/ops/ai/alerts`
**Method:** GET

**Response:**
```json
{
  "alerts": [
    {
      "id": "stuck-readiness",
      "severity": "HIGH",
      "title": "3 Jobs Stuck in Readiness Check",
      "description": "3 jobs have been in T-72 readiness check for more than 48 hours...",
      "actionHref": "/ops/jobs",
      "actionLabel": "Review Jobs",
      "count": 3,
      "timeframe": "48+ hours"
    }
  ],
  "totalAlerts": 5,
  "criticalCount": 2
}
```

**Alert Detection Logic:**

| Alert Type | Condition | Severity | Data Source |
|-----------|-----------|----------|------------|
| Stuck Readiness | Status=READINESS_CHECK + updatedAt < 48hrs ago | HIGH | Job.status, Job.updatedAt |
| Overdue Invoices | Status=OVERDUE + dueDate <= today | HIGH | Invoice.status, Invoice.dueDate |
| No PM Assigned | assignedPMId IS NULL + active status | MEDIUM | Job.assignedPMId, Job.status |
| Unassigned Crew | crewId IS NULL + next 7 days | MEDIUM | ScheduleEntry.crewId, ScheduleEntry.scheduledDate |
| Stale POs | Status=DRAFT + createdAt < 7 days ago | LOW | PurchaseOrder.status, PurchaseOrder.createdAt |

### Integration with Dashboard

The Workflow Alerts widget is integrated into `/src/app/ops/page.tsx` as a key dashboard component:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
  {/* Workflow Alerts Panel */}
  <div className="bg-white rounded-xl border p-5">
    <h3>Workflow Alerts</h3>
    <WorkflowAlerts />
  </div>

  {/* Accounts Receivable */}
  {/* Quick Actions */}
</div>
```

Replaces the previous "Inventory Alerts" panel with AI-driven intelligent alerts.

## Data Models Used

### Primary Models

```prisma
model Job {
  id: String
  status: JobStatus  // READINESS_CHECK, MATERIALS_LOCKED, etc.
  assignedPMId: String?  // Project manager assignment
  updatedAt: DateTime
}

model Invoice {
  id: String
  status: InvoiceStatus  // OVERDUE, PAID, etc.
  dueDate: DateTime
  balanceDue: Float
}

model ScheduleEntry {
  id: String
  scheduledDate: DateTime
  crewId: String?  // Crew assignment
  job: Job
  crew: Crew?
}

model PurchaseOrder {
  id: String
  status: POStatus  // DRAFT, APPROVED, etc.
  createdAt: DateTime
}

model Product {
  id: String
  active: Boolean
  inStock: Boolean
  category: String
}
```

## Navigation

The AI Assistant is accessible via the sidebar navigation:

1. Click **"AI Tools"** section in the sidebar
2. Select **"AI Assistant"** (🤖 icon)
3. Alternatively, link from Workflow Alerts panel → "AI Tools →"

**Navigation Structure:**
```
ABEL OPS (sidebar)
├── Overview
│   └── Dashboard
├── Executive
├── Jobs & Projects
├── Accounts & Sales
├── Manufacturing
├── Supply Chain
├── Finance
│   └── Invoicing & AR
└── AI Tools
    └── AI Assistant 🤖  [NEW]
```

## Brand Colors

All components use the official Abel Lumber brand palette:

| Element | Color | Hex |
|---------|-------|-----|
| Primary (Navy) | Navy Blue | #1B4F72 |
| Accent | Orange | #E67E22 |
| Success | Green | #27AE60 |
| Warning | Red | #E74C3C |
| Info | Blue | #3498DB |

- **Chat user messages:** Navy (#1B4F72) background, white text
- **Chat AI messages:** Light gray background, dark text
- **Quick action buttons:** Light blue background with navy text
- **Alert severity colors:** Red (HIGH), Orange (MEDIUM), Blue (LOW)

## How It Works

### User Flow: AI Assistant Chat

1. **User navigates to AI Assistant**
   - Sidebar → AI Tools → AI Assistant
   - Page loads with greeting message and 5 quick action buttons

2. **User sends message**
   - Types question or clicks quick action button
   - Input is sent to `/api/ops/ai` endpoint
   - UI shows typing indicator while processing

3. **AI routes message**
   - Analyzes message content for keywords
   - Routes to appropriate handler function
   - Handler queries database for relevant data

4. **Response is generated**
   - Formatted as readable text with data insights
   - Displayed in chat bubble (left-aligned, gray)
   - May include suggestions for follow-up questions

5. **User can follow up**
   - Continue conversation in same chat
   - Ask clarifying questions
   - Request specific data analysis

### User Flow: Workflow Alerts

1. **Dashboard loads**
   - Operations Center → Dashboard
   - Workflow Alerts widget automatically fetches alerts from `/api/ops/ai/alerts`

2. **Alerts are displayed**
   - Color-coded by severity
   - Shows count, description, and action link
   - Multiple alerts stacked vertically

3. **User takes action**
   - Clicks "Handle" button on alert
   - Navigates to relevant page (jobs, invoices, etc.)
   - Can address issue directly

4. **Alert data refreshes**
   - Component re-queries every 30 seconds
   - Alerts update as conditions change
   - Critical alerts move to top

## Performance Considerations

- **AI responses:** Database queries limited to last 7 days for schedule, top 10 results
- **Alert scanning:** Checks all active jobs but returns top 10 by severity
- **Template rendering:** Minimal overhead, uses pre-built templates
- **Dashboard widget:** Auto-fetches on component mount, no polling by default

## Security

- All endpoints require authenticated session (inherits from Next.js app auth)
- API routes use PrismaClient for database access (parameterized queries)
- No sensitive financial data in response suggestions
- Templates contain placeholder variables, not real account info

## Future Enhancements

Potential expansions to AI capabilities:

1. **Predictive Analytics**
   - Job completion time forecasts
   - Risk detection for overdue patterns
   - Crew utilization optimization

2. **Natural Language Processing**
   - Extract intent from complex queries
   - Generate dynamic SQL queries
   - Multi-turn conversation context

3. **Integration with External Systems**
   - InFlow inventory sync
   - ECI Bolt job data
   - Automated email sending

4. **Learning & Personalization**
   - Remember user preferences
   - Learn from past decisions
   - Suggest optimizations based on historical patterns

5. **Real-time Notifications**
   - WebSocket alerts for critical events
   - SMS/email integration
   - Custom alert thresholds per user

## File Locations Summary

```
src/app/
├── ops/
│   ├── ai/
│   │   └── page.tsx                    # AI Assistant chat interface
│   ├── components/
│   │   └── WorkflowAlerts.tsx          # Alert widget component
│   ├── layout.tsx                      # Updated with AI Tools nav
│   └── page.tsx                        # Updated dashboard with alerts
├── api/
│   └── ops/
│       └── ai/
│           ├── route.ts                # Main AI endpoint
│           ├── schedule-suggest/
│           │   └── route.ts            # Scheduling optimization
│           ├── templates/
│           │   └── route.ts            # Communication templates
│           └── alerts/
│               └── route.ts            # Workflow alerts
```

## Testing the Features

### Test Chat Interface
1. Navigate to `/ops/ai`
2. Click "Suggest schedule for next week" quick action
3. Verify schedule data appears in response

### Test Alerts
1. Go to `/ops`
2. Check "Workflow Alerts" panel on dashboard
3. Click any alert action link
4. Verify navigation to correct section

### Test API Endpoints
```bash
# Test main AI endpoint
curl -X POST http://localhost:3000/api/ops/ai \
  -H "Content-Type: application/json" \
  -d '{"message": "What jobs need scheduling?"}'

# Test alerts
curl http://localhost:3000/api/ops/ai/alerts

# Test templates
curl "http://localhost:3000/api/ops/ai/templates?type=DELIVERY_CONFIRMATION"

# Test schedule suggestions
curl http://localhost:3000/api/ops/ai/schedule-suggest
```

## Troubleshooting

**Issue:** Chat shows "Failed to process request"
- Check browser console for errors
- Verify `/api/ops/ai` endpoint is accessible
- Check PrismaClient connection in server logs

**Issue:** No alerts displayed
- Verify PurchaseOrder model exists in schema
- Check query conditions match your data
- Try refreshing page to re-fetch

**Issue:** Templates show placeholder variables
- This is expected behavior - templates need jobId to populate
- Click action link first to load job context

## Support

For questions or issues with AI features:
1. Check browser console (F12) for errors
2. Review server logs in terminal
3. Verify Prisma client configuration
4. Check database connectivity
