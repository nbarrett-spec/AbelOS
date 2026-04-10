# Abel Sales Portal

A dedicated sales management portal for the Abel Builder Platform, designed specifically for sales representatives (Dalton and Josh) to track, manage, and close deals.

## Overview

The Sales Portal (`/sales`) is a standalone portal that provides sales reps with a dedicated view into their pipeline, deals, and activities. It uses the same staff authentication system as the operations center but presents a sales-focused interface.

## Features

### 1. **Authentication & Access Control**
- **Login Page** (`/sales/login`): Split-screen design with sales-specific branding
- **Server-side Auth Check**: Layout uses Next.js server-side validation
- **Role-Based Access**: Only SALES_REP, MANAGER, and ADMIN roles can access
- Uses existing `abel_staff_session` cookie and JWT verification

### 2. **Top Navigation Bar**
- Navy blue (#1e3a5f) background with white text
- **Left**: "Abel Sales" logo/branding
- **Center**: Navigation links with icons
  - Dashboard (📊)
  - Pipeline (📈)
  - My Deals (💼)
  - Contracts (📋)
  - Documents (📁)
- **Right**:
  - Today's date
  - User initials avatar (orange #e67e22 background)
  - User info dropdown with role and logout

### 3. **Personal Dashboard** (`/sales`)
Welcome page showing:
- Personalized greeting with first name and today's date
- **4 Stat Cards**:
  - My Active Deals (count)
  - My Pipeline Value (total value)
  - My Win Rate (--Coming soon)
  - Follow-ups Due Today (count)
- **My Pipeline**: Horizontal list of top 5 deals (filter by current rep)
- **My Follow-ups**: Upcoming follow-ups with due dates and types
- **Recent Activity**: Last 10 activities by this rep with timestamps
- **Quick Action Buttons**: New Deal, Log Call, Request Document

### 4. **Pipeline View** (`/sales/pipeline`)
Kanban-style pipeline board showing:
- 8 Pipeline stages: PROSPECT → DISCOVERY → WALKTHROUGH → BID_SUBMITTED → BID_REVIEW → NEGOTIATION → WON → LOST
- **Column Headers**: Stage name, deal count, total stage value
- **Deal Cards**:
  - Company name and contact
  - Stage badge
  - Deal value
  - Expected close date
- **Color-coded columns** for visual distinction
- Click to view deal details

### 5. **My Deals List** (`/sales/deals`)
Sortable table view with:
- **Columns**:
  - Company (sortable)
  - Stage (filterable + sortable)
  - Value (sortable)
  - Expected Close Date (sortable)
  - Last Activity (sortable)
- **Stage Filter**: Quick filter buttons (All, Prospect, Discovery, etc.)
- **Sorting**: Click column headers to sort ascending/descending
- **Deal Links**: Click any deal to view full details
- **Create New Deal** button

### 6. **Deal Detail Page** (`/sales/deals/[id]`)
Comprehensive deal management view:
- **Header Section**:
  - Company name and contact information
  - Phone and email (clickable for quick contact)
  - Address
  - Current stage badge
  - Change Stage dropdown button
  - Deal number

- **Stats Row**:
  - Deal Value
  - Win Probability
  - Expected Close Date
  - Days in Pipeline

- **Activity Timeline** (2/3 width):
  - List of all deal activities
  - Add Activity form:
    - Activity type (CALL, EMAIL, MEETING, SITE_VISIT, NOTE, BID_SENT, CONTRACT_SENT)
    - Subject line
    - Notes/description
    - Outcome
    - Follow-up date (optional)
  - Activity icons and timestamps
  - Staff member attribution

- **Right Sidebar**:
  - Contact information
  - Deal information
  - Sales rep assignment
  - Creation date
  - Associated contracts (if any)

### 7. **Contracts Page** (`/sales/contracts`)
Placeholder for contract management:
- Currently shows empty state with link to deals
- Ready for contract list and detail views

### 8. **Documents Page** (`/sales/documents`)
Placeholder for document management:
- Currently shows empty state with link to deals
- Ready for document upload and management

## Architecture

### File Structure
```
/src/app/sales/
├── layout.tsx                    # Main layout with auth check
├── page.tsx                      # Sales dashboard
├── login/
│   └── page.tsx                 # Login page
├── pipeline/
│   └── page.tsx                 # Pipeline kanban view
├── deals/
│   ├── page.tsx                 # Deals list/table view
│   └── [id]/
│       └── page.tsx             # Deal detail page
├── contracts/
│   └── page.tsx                 # Contracts page (placeholder)
├── documents/
│   └── page.tsx                 # Documents page (placeholder)
└── components/
    └── SalesTopNav.tsx          # Top navigation bar
```

### Key Technologies
- **Framework**: Next.js 14+ (App Router)
- **Authentication**: Server-side JWT verification using `jose`
- **State Management**: React hooks (useState, useEffect)
- **Styling**: Tailwind CSS
- **API Integration**: Fetch from `/api/ops/auth/*` and `/api/ops/sales/*` endpoints
- **Middleware**: Existing staff authentication middleware

## Authentication Flow

1. User navigates to `/sales`
2. `layout.tsx` server component:
   - Reads `abel_staff_session` cookie
   - Verifies JWT token using `verifyStaffToken()`
   - Checks user role (must be SALES_REP, MANAGER, or ADMIN)
   - Redirects to `/sales/login` if not authenticated
   - Shows "Access Denied" if role not permitted
3. On login page, submit credentials to `/api/ops/auth/login`
4. Cookie is set by existing auth endpoint
5. User is redirected to `/sales` dashboard

## Styling Guidelines

### Colors
- **Primary Navy**: `#1e3a5f` (nav background)
- **Orange Accent**: `#e67e22` (buttons, highlights)
- **Background**: White cards on light gray (#f3f4f6) background

### Component Styling
- **Top Nav**: Navy background with white text
- **Cards**: White with rounded-lg, shadow-sm, border
- **Buttons**:
  - Primary: Navy background (#1e3a5f) with white text
  - Secondary: Border with hover bg-gray-50
  - Accent: Orange (#e67e22) for special actions
- **Stage Badges**: Color-coded by stage
- **Tables**: Light gray headers, hover effects on rows
- **Forms**: Standard input styling with orange focus rings

## API Integration

### Authentication Endpoints
- `POST /api/ops/auth/login` - Staff login (existing)
- `GET /api/ops/auth/me` - Current user info
- `POST /api/ops/auth/logout` - Logout

### Sales Endpoints
- `GET /api/ops/sales/deals` - List deals for current rep
- `GET /api/ops/sales/deals/[id]` - Get deal details
- `PUT /api/ops/sales/deals/[id]` - Update deal (stage, etc.)
- `POST /api/ops/sales/deals/[id]/activities` - Add activity
- `PATCH /api/ops/sales/deals/[id]/activities/[activityId]` - Update activity
- `GET /api/ops/sales/stats` - Pipeline statistics

## Data Filtering

The portal automatically filters data by the current authenticated user:
- Deals shown are owned by the logged-in sales rep
- Activities are for their deals
- Stats are calculated only for their pipeline
- Backend uses `x-staff-id` header from middleware for filtering

## Current Limitations & Future Enhancements

### Current Limitations
- Win Rate calculation shows "--Coming soon"
- Contracts and Documents pages are placeholders
- Follow-ups data is mocked
- No drag-and-drop in pipeline (click to view instead)
- No new deal creation UI (button present but page not created)

### Future Enhancements
1. Create new deal form at `/sales/deals/new`
2. Full contract management and signing workflows
3. Document upload and sharing
4. Advanced pipeline analytics
5. Activity templates and quick logging
6. Integration with email and calendar
7. Deal forecasting and probability adjustments
8. Mobile app version
9. Real-time collaboration features
10. Custom pipeline stages per sales manager

## Usage

### For Sales Reps (Dalton & Josh)
1. Navigate to `/sales` to access the portal
2. Sign in with your staff credentials
3. View your dashboard with key metrics
4. Check your pipeline on the Pipeline page
5. Manage deals from the My Deals list
6. Click any deal to see full details and activity history
7. Add activities (calls, emails, meetings) to track progress
8. Update deal stages as you move opportunities through the pipeline

### For Developers
- The portal is ready for backend integration
- All API endpoints are documented and follow existing patterns
- Add new features in `/sales` subdirectories
- Extend the data models as needed
- Styling follows Tailwind conventions throughout

## Testing

To test the sales portal:
1. Create/update staff records with SALES_REP role
2. Create test deals assigned to that staff member
3. Log in as the sales rep
4. Verify dashboard shows only their deals
5. Test stage transitions
6. Add activities and verify they appear in timeline
7. Test responsive design on mobile/tablet

## Security Considerations

- All pages are protected by server-side auth check
- JWT tokens are validated before rendering
- Role-based access prevents unauthorized access
- Cookies are HTTP-only and secure
- Data is filtered server-side by staff ID
- API calls include staff authentication headers

## Support

For questions about the sales portal, refer to:
- `/src/app/sales/` - All portal code
- `/src/lib/staff-auth.ts` - Authentication utilities
- `/src/lib/formatting.ts` - Formatting utilities
- Existing operations center implementation (`/src/app/ops/`)
