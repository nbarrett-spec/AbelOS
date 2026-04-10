# Field Crew Portal - Files Created

## Pages

### `/src/app/crew/layout.tsx`
Main layout for the crew portal. Includes:
- Header with Abel branding (navy #1B4F72)
- Main content area with padding for bottom nav
- Bottom navigation bar with 3 tabs (Today, Route, Profile)
- Mobile-first responsive design
- Large touch targets (44px+ for nav items)

### `/src/app/crew/page.tsx`
Home page - Today's Schedule view. Features:
- Crew selector dropdown
- Date display with assignment count
- Schedule cards for today's deliveries and installations
- Color-coded cards (blue for delivery, green for installation)
- Quick action buttons on each card
- Empty state messaging
- localStorage persistence of selected crew

### `/src/app/crew/delivery/[id]/page.tsx`
Delivery detail and workflow page. Includes:
- Job information header (builder, address, community/lot, contact)
- Multi-step workflow buttons:
  - Scheduled → Load Confirmed → Departed → Arrived → Unloading → Complete
- Materials list showing what's being delivered
- Signature field for recipient
- Notes field for damage/issues
- Timestamp tracking for status changes
- Status validation to prevent invalid progressions

### `/src/app/crew/install/[id]/page.tsx`
Installation detail and workflow page. Includes:
- Job information header
- Scope of work display
- Installation workflow buttons:
  - Scheduled → In Progress → Complete
- Punch list section for rework items
- QC self-check toggle (required to complete)
- General notes field
- Status progression validation

### `/src/app/crew/route/page.tsx`
Route view page - shows day's delivery stops. Features:
- Ordered list of deliveries by route sequence
- Stop numbers (1, 2, 3, etc.)
- Builder name, address, item count per stop
- Progress indicator bar
- Status badges for each stop
- Navigation links to delivery details
- Empty state handling

### `/src/app/crew/profile/page.tsx`
Profile page - crew information and settings. Includes:
- Crew name and type display
- Vehicle plate info (if delivery crew)
- List of crew members with roles
- Quick links to today's schedule and route
- Support/help information
- Logout button
- Version info

## API Routes

### `/src/app/api/crew/schedule/route.ts`
GET endpoint for crew schedule

**Parameters:**
- `crewId` (required) - Crew ID
- `date` (required) - Date in YYYY-MM-DD format

**Returns:**
- Array of schedule entries with job details for the day
- Sorted by scheduled time
- Includes type (DELIVERY/INSTALLATION), status, address, community, lotBlock

### `/src/app/api/crew/delivery/[id]/route.ts`
GET and PATCH endpoints for delivery management

**GET Parameters:**
- `id` (URL param) - Job ID

**GET Returns:**
- Full delivery object with job details and material picks
- Status, timestamps, signature, notes, damage notes

**PATCH Body:**
- `status` - New delivery status
- `notes` - General notes
- `signedBy` - Recipient name
- `damageNotes` - Damage/issue notes
- `departedAt`, `arrivedAt`, `completedAt` - ISO timestamps

**PATCH Returns:**
- Updated delivery object

### `/src/app/api/crew/install/[id]/route.ts`
GET and PATCH endpoints for installation management

**GET Parameters:**
- `id` (URL param) - Job ID

**GET Returns:**
- Full installation object with job details
- Status, timestamps, scope notes, punch items, QC status

**PATCH Body:**
- `status` - New installation status
- `notes` - General notes
- `punchItems` - Punch list items
- `passedQC` - Boolean QC status
- `startedAt`, `completedAt` - ISO timestamps

**PATCH Returns:**
- Updated installation object

### `/src/app/api/crew/route/route.ts`
GET endpoint for day's delivery route

**Parameters:**
- `crewId` (required) - Crew ID
- `date` (required) - Date in YYYY-MM-DD format

**Returns:**
- Array of deliveries sorted by route order
- Includes delivery number, builder, address, item count, status
- Only includes deliveries scheduled for the crew on that date

### `/src/app/api/crew/crews/route.ts`
GET endpoint for all active crews

**Returns:**
- Array of all active crews
- Each crew includes: id, name, crewType, vehiclePlate, members[]
- Members include: id, name, email, phone, role

### `/src/app/api/crew/crews/[id]/route.ts`
GET endpoint for specific crew details

**Parameters:**
- `id` (URL param) - Crew ID

**Returns:**
- Single crew object with full member details
- Includes all crew metadata and team composition

## Utilities

### `/src/lib/crew-utils.ts`
Utility functions for the crew portal:

**Status & Display Functions:**
- `getStatusColor()` - Get CSS classes for status card colors
- `getStatusBadgeColor()` - Get CSS classes for status badges
- `getStatusLabel()` - Format status string for display
- `getTypeEmoji()` - Get emoji for delivery/installation type
- `getCrewTypeLabel()` - Format crew type for display

**Validation Functions:**
- `isValidStatusProgression()` - Check if status change is allowed
- `validateDeliveryCompletion()` - Validate delivery before marking complete
- `validateInstallationCompletion()` - Validate installation before marking complete

**Time/Date Functions:**
- `formatScheduledTime()` - Format time strings
- `formatTimestamp()` - Format timestamps for display
- `formatDate()` - Format dates for display

**Storage Functions:**
- `setSelectedCrew()` - Store selected crew ID in localStorage
- `getSelectedCrew()` - Retrieve selected crew ID from localStorage
- `clearSelectedCrew()` - Clear stored crew ID

**Helper Functions:**
- `getMapUrl()` - Generate Google Maps URL from address
- `getPhoneLink()` - Generate tel: link from phone number
- `calculateRouteProgress()` - Calculate percentage for progress bar

## Documentation

### `/CREW_PORTAL_SETUP.md`
Complete setup and reference guide including:
- Quick start instructions
- Architecture overview
- Page descriptions and workflows
- API endpoint documentation with examples
- Design guidelines and color scheme
- Status workflows (delivery and installation)
- Storage and persistence strategy
- Testing checklist
- Database schema references
- Future enhancement ideas

### `/CREW_PORTAL_FILES.md`
This file - index of all created files and their purposes

## Seed Script

### `/scripts/seed-crew-portal.ts`
TypeScript seed script to populate test data:

**Creates:**
- 4 staff members (2 drivers, 2 installers)
- 2 crews (Delivery Team A, Install Crew - North)
- Crew member assignments
- 1 test job with full details
- 3 material picks for the job
- 1 delivery with route assignment
- 1 installation with crew assignment
- Schedule entries for delivery and installation

**Run with:**
```bash
npx ts-node scripts/seed-crew-portal.ts
```

## Key Features by Page

### Home Page (`/crew`)
✅ Crew selection dropdown with localStorage persistence
✅ URL parameter support for crew ID (`?crewId=...`)
✅ Today's schedule with color-coded cards
✅ Quick action buttons for status updates
✅ Mobile-optimized card layout
✅ Empty state for no assignments
✅ Schedule loading states

### Delivery Page (`/crew/delivery/[id]`)
✅ Complete job information display
✅ Step-by-step workflow with timestamp capture
✅ Material list from job picks
✅ Signature field for delivery recipient
✅ Damage/notes documentation
✅ Status validation to prevent skipped steps
✅ Back navigation

### Installation Page (`/crew/install/[id]`)
✅ Job information header
✅ Scope of work display
✅ Installation workflow progression
✅ Punch list for quality issues
✅ QC pass/fail requirement
✅ General notes field
✅ Status validation

### Route Page (`/crew/route`)
✅ Ordered delivery list by route sequence
✅ Stop number indicators
✅ Address and item counts
✅ Progress bar showing completion
✅ Status tracking per stop
✅ Navigation to delivery details
✅ Route summary statistics

### Profile Page (`/crew/profile`)
✅ Crew name and type display
✅ Vehicle plate for delivery crews
✅ Team member list with roles
✅ Contact information for team members
✅ Quick links to other sections
✅ Support information
✅ Logout functionality

## Design Specifications

### Colors
- **Primary Navy**: #1B4F72 (headers, main branding)
- **Secondary Blue**: #0D2438 (darker navy)
- **Accent Orange**: #E67E22 (buttons, highlights, active states)
- **Success Green**: #27AE60 (installation, completion)
- **Delivery Blue**: #3498DB (delivery indicators)

### Typography
- Minimum body text: 16px
- Large buttons: 48px height minimum
- Bottom nav items: 44px height minimum
- Heading hierarchy for clear visual structure

### Responsive Design
- Mobile-first (375px minimum width)
- Single column layout
- Bottom navigation (no sidebar)
- Card-based content organization
- Large touch targets throughout
- Scales up to desktop (max ~768px)

## Integration Notes

### Authentication
- Pages require logged-in staff member
- Staff role should be DRIVER, INSTALLER, or related field role
- Authentication handled by existing Abel platform auth

### Database Relationships
- Schedule entries link crew to job
- Deliveries/installations link job to crew
- Material picks are part of job
- Staff members belong to crews via CrewMember junction table

### State Management
- Crew selection stored in localStorage (client-side only)
- All data persistence via database APIs
- Timestamps captured server-side when status changes
- URL parameters used for crew navigation (`?crewId=...`)

### Error Handling
- API errors return 400/404/500 with messages
- Client shows error states for missing data
- Graceful fallbacks for optional fields
- Empty states for no data

## Testing Data

The seed script creates sufficient test data to verify all features:
- 2 crews (different types)
- 4 team members (different roles)
- 1 job with all fields populated
- 3 material picks (varied quantities)
- 1 delivery assignment
- 1 installation assignment
- Both entries scheduled for today

This allows testing:
- Crew selection and switching
- Schedule loading for both crews
- Route view with deliveries
- Delivery workflow progression
- Installation workflow progression
- Team member list display
- Back navigation
- Empty state (by changing date)
