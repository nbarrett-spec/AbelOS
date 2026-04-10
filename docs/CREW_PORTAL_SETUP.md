# Field Crew Portal - Setup Guide

The Field Crew Portal is a mobile-first interface for delivery and installation crews to manage their daily assignments, track job status, and complete deliveries/installations.

## Quick Start

### 1. Seed Test Data

Before using the crew portal, seed the database with test data:

```bash
npx ts-node scripts/seed-crew-portal.ts
```

This creates:
- 4 staff members (2 drivers, 2 installers)
- 2 crews (Delivery Team A, Install Crew - North)
- 1 test job with delivery and installation tasks
- Schedule entries for today

### 2. Access the Portal

The crew portal is available at: `http://localhost:3000/crew`

The portal requires staff authentication. Staff members can log in with their email addresses.

## Architecture

### Pages

#### `/crew` — Home / Today's Schedule
- Crew selection dropdown (persists via localStorage)
- Today's schedule view (deliveries + installations)
- Color-coded cards: blue for deliveries, green for installations
- Quick status buttons for rapid workflow updates
- Pagination/endless scroll for many items

#### `/crew/route` — Daily Route View
- Ordered list of deliveries by route sequence
- Stop numbers, addresses, item counts
- Route progress indicator
- Navigation to delivery details

#### `/crew/delivery/[id]` — Delivery Detail & Workflow
- Job information (builder, address, community/lot, contact)
- Multi-step status workflow:
  - Scheduled → Load Confirmed → Departed → Arrived → Unloading → Complete
- Materials list (what's being delivered)
- Signature field for delivery recipient
- Notes field for damage/issues
- Timestamp tracking for each status change

#### `/crew/install/[id]` — Installation Detail & Workflow
- Job information header
- Installation workflow:
  - Scheduled → In Progress → Complete
- Scope of work notes
- Punch list section (for items needing rework)
- QC self-check (pass/fail toggle before marking complete)
- Before/after photo placeholders
- Notes field

#### `/crew/profile` — Profile & Crew Info
- Crew name and type
- Vehicle plate (if delivery crew)
- Team member list with roles
- Quick links to today's schedule and route
- Help/support information
- Logout button

### API Routes

All crew API routes are under `/api/crew/`:

#### `GET /api/crew/crews`
Get all active crews with member information

**Response:**
```json
[
  {
    "id": "crew_1",
    "name": "Delivery Team A",
    "crewType": "DELIVERY",
    "vehiclePlate": "ABL-DEL-01",
    "members": [
      {
        "id": "staff_1",
        "name": "John Driver",
        "email": "john@abel.com",
        "phone": "(555) 123-4567",
        "role": "Driver"
      }
    ]
  }
]
```

#### `GET /api/crew/crews/[id]`
Get detailed crew information by ID

#### `GET /api/crew/schedule?crewId=X&date=YYYY-MM-DD`
Get today's schedule for a specific crew

**Response:**
```json
[
  {
    "id": "sched_1",
    "jobId": "job_1",
    "title": "Smith Construction - Delivery",
    "jobNumber": "JOB-2026-0142",
    "builderName": "Smith Construction Co",
    "address": "1234 Main Street, Springfield, IL 62701",
    "scheduledTime": "9:00 AM",
    "status": "SCHEDULED",
    "type": "DELIVERY",
    "community": "Canyon Ridge",
    "lotBlock": "Lot 14 Block 3"
  }
]
```

#### `GET /api/crew/route?crewId=X&date=YYYY-MM-DD`
Get ordered delivery route for the day

**Response:**
```json
[
  {
    "id": "del_1",
    "jobId": "job_1",
    "deliveryNumber": "DEL-2026-0089",
    "jobNumber": "JOB-2026-0142",
    "builder": "Smith Construction Co",
    "address": "1234 Main Street",
    "itemCount": 5,
    "routeOrder": 1,
    "status": "SCHEDULED"
  }
]
```

#### `GET /api/crew/delivery/[jobId]`
Get delivery details for a specific job

**Response:**
```json
{
  "id": "del_1",
  "jobId": "job_1",
  "deliveryNumber": "DEL-2026-0089",
  "status": "SCHEDULED",
  "address": "1234 Main Street",
  "job": {
    "jobNumber": "JOB-2026-0142",
    "builderName": "Smith Construction Co",
    "builderContact": "(555) 999-0001",
    "community": "Canyon Ridge",
    "lotBlock": "Lot 14 Block 3"
  },
  "departedAt": null,
  "arrivedAt": null,
  "completedAt": null,
  "signedBy": null,
  "notes": null,
  "damageNotes": null,
  "materialPicks": [
    {
      "id": "pick_1",
      "sku": "DOR-2068-2P-HC-LH",
      "description": "2068 2-Panel Hollow Core Left Hand",
      "quantity": 3
    }
  ]
}
```

#### `PATCH /api/crew/delivery/[jobId]`
Update delivery status and details

**Request Body:**
```json
{
  "status": "IN_TRANSIT",
  "notes": "Left warehouse at 8:45 AM",
  "signedBy": "John Smith",
  "damageNotes": "One unit had minor scratch on corner",
  "departedAt": "2026-03-21T08:45:00Z",
  "arrivedAt": "2026-03-21T10:15:00Z",
  "completedAt": "2026-03-21T10:45:00Z"
}
```

#### `GET /api/crew/install/[jobId]`
Get installation details for a specific job

#### `PATCH /api/crew/install/[jobId]`
Update installation status and details

**Request Body:**
```json
{
  "status": "COMPLETE",
  "notes": "All doors and trim installed successfully",
  "punchItems": "- Touch up paint on master bedroom door frame\n- Caulk gaps on hallway trim",
  "passedQC": true,
  "startedAt": "2026-03-21T08:00:00Z",
  "completedAt": "2026-03-21T15:30:00Z"
}
```

## Design & UX

### Mobile-First Approach
- All layouts designed for 375px mobile width first
- Responsive scaling up to desktop (max-width: 768px)
- Touch-friendly buttons (minimum 48px height)
- Large text (16px minimum for body)
- Bottom navigation bar for intuitive navigation

### Color Scheme
- **Navy**: #1B4F72 (primary header/branding)
- **Orange**: #E67E22 (accents, active states)
- **Green**: #27AE60 (installation/success indicators)
- **Blue**: #3498DB (delivery indicators)

### Layout Strategy
- No sidebar navigation (bottom nav bar instead)
- Card-based layouts for jobs/assignments
- Single-column design optimized for mobile scrolling
- Large touch targets throughout
- Clear visual hierarchy with status badges

## Status Workflows

### Delivery Workflow
1. **SCHEDULED** — Initial state
2. **LOADING** — Load confirmed with truck
3. **IN_TRANSIT** — Vehicle has departed
4. **ARRIVED** — Crew at delivery location
5. **UNLOADING** — Materials being unloaded
6. **COMPLETE** — Delivery signed off

### Installation Workflow
1. **SCHEDULED** — Initial state
2. **IN_PROGRESS** — Crew has started
3. **COMPLETE** — All work finished and QC passed

## Storage & Persistence

### Crew Selection
- Selected crew persists in localStorage as `selectedCrewId`
- Automatically restored when page reloads
- Can be overridden via URL parameter: `/crew?crewId=crew_123`

### Timestamps
- All timestamps are ISO 8601 format
- Server stores UTC timestamps
- Client displays in local time
- Automatic timestamp capture when status changes

## Testing Checklist

- [ ] Crew selection dropdown works and persists
- [ ] Today's schedule loads for selected crew
- [ ] Delivery cards show correct details
- [ ] Installation cards show correct details
- [ ] Route view displays deliveries in order
- [ ] Status progression buttons work
- [ ] Timestamps capture on status change
- [ ] Signature field accepts input
- [ ] Notes fields work
- [ ] QC checkbox required for install completion
- [ ] Profile page shows crew members
- [ ] Bottom navigation highlights active tab
- [ ] Responsive on mobile and desktop
- [ ] No console errors

## Database Schema References

### Key Models

**Crew**
- `id` (String) — unique identifier
- `name` (String) — crew name
- `crewType` (Enum) — DELIVERY, INSTALLATION, or DELIVERY_AND_INSTALL
- `active` (Boolean)
- `vehiclePlate` (String) — vehicle plate for delivery crews

**ScheduleEntry**
- `id` (String)
- `jobId` (String) — linked job
- `crewId` (String) — assigned crew
- `entryType` (Enum) — DELIVERY, INSTALLATION, etc.
- `scheduledDate` (DateTime) — date of assignment
- `scheduledTime` (String) — time string like "9:00 AM"
- `status` (Enum) — TENTATIVE, FIRM, IN_PROGRESS, COMPLETED, etc.

**Delivery**
- `jobId` (String) — linked job
- `crewId` (String) — assigned crew
- `deliveryNumber` (String) — unique identifier
- `address` (String)
- `status` (Enum) — DeliveryStatus
- `routeOrder` (Int) — sequence in daily route
- `departedAt`, `arrivedAt`, `completedAt` (DateTime) — timestamps
- `signedBy` (String) — recipient name
- `notes` (String)
- `damageNotes` (String)

**Installation**
- `jobId` (String) — linked job
- `crewId` (String) — assigned crew
- `installNumber` (String) — unique identifier
- `scopeNotes` (String) — work scope
- `status` (Enum) — InstallationStatus
- `startedAt`, `completedAt` (DateTime) — timestamps
- `passedQC` (Boolean)
- `punchItems` (String) — punch list if issues found
- `notes` (String)

**Job**
- `jobNumber` (String) — unique job identifier
- `builderName` (String)
- `jobAddress` (String)
- `community` (String)
- `lotBlock` (String)
- `builderContact` (String)
- `scopeType` (Enum)
- `status` (Enum) — JobStatus
- `materialPicks` (MaterialPick[]) — items to deliver/install

**MaterialPick**
- `jobId` (String)
- `sku` (String)
- `description` (String)
- `quantity` (Int)
- `status` (Enum) — PickStatus

## Future Enhancements

- Photo capture (before/after for installations, load/site photos for deliveries)
- Real-time GPS tracking of delivery routes
- Offline mode for areas with poor connectivity
- Push notifications for schedule changes
- Digital signature capture
- Punch list photo documentation
- Performance metrics/KPIs per crew
- Customer communication (text/email notifications)

## Support

For issues or questions about the crew portal:
1. Check database connections in `.env`
2. Verify all migrations have run: `npx prisma migrate deploy`
3. Check server logs for API errors
4. Verify crew/staff data was seeded properly
