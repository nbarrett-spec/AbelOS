# Homeowner Portal Guide

The Abel Lumber Homeowner Portal allows homeowners to view their project, browse available door and hardware upgrades, select their preferences, and confirm their selections—all through a simple, consumer-friendly interface.

## Features

- **Token-based access** — Homeowners access the portal via a unique token link (e.g., `/homeowner/abc123token`)
- **Project overview** — View builder name, project name, address, and selection progress
- **Upgrade selection** — Browse available upgrades for each room/location with pricing
- **Selection summary** — Sticky bottom bar showing total cost and completion status
- **Confirmation workflow** — Lock in all selections with one click

## Brand Design

The portal uses Abel Lumber's brand colors:
- **Navy (#1B4F72)** — Headers, primary accents
- **Orange (#E67E22)** — Call-to-action buttons
- **Green (#27AE60)** — Selected/confirmed states
- Clean white background with subtle shadows
- Consumer-friendly typography and spacing

## Architecture

### Pages

#### 1. Token Entry Page (`/app/homeowner/page.tsx`)
Landing page where homeowners enter their access token or use a direct token link.

**Features:**
- Simple form with token input field
- Explains the 4-step process
- Help/contact information
- Validation before redirecting to portal

#### 2. Main Portal (`/app/homeowner/[token]/page.tsx`)
The main portal page showing project details and upgrade selections.

**Sections:**
- **Project Header** — Builder name, project name, address, status badge, progress bar
- **Upgrade Selection Cards** — Grid of upgrade options for each room/location
- **Selection Summary Bar** — Sticky footer with total cost and confirm button

#### 3. Layout (`/app/homeowner/layout.tsx`)
Consumer-friendly layout with:
- Clean header with Abel Lumber branding
- Footer with contact information
- No sidebar navigation (single-page flow)

### Components

#### UpgradeSelectionCard
Displays one room/location's upgrade options.

**Props:**
- `selection` — The HomeownerSelection record with products
- `token` — Access token for API calls
- `onSelectionChange` — Callback when user selects an upgrade
- `isLocked` — Whether selections are confirmed/locked

**Features:**
- Shows base product as "Included" option
- Lists available upgrades with pricing
- Displays currently selected option with checkmark
- "Reset to Included Option" button
- Responsive card layout

#### SelectionSummary
Sticky bottom bar with summary and action buttons.

**Props:**
- `totalCost` — Sum of all upgrade adders
- `completedSelections` — Number of selections made
- `totalSelections` — Total selections needed
- `onConfirm` — Callback to confirm all selections
- `onReset` — Callback to reset all to base
- `confirming` — Loading state
- `allConfirmed` — Whether all selections are made
- `isLocked` — Whether selections are locked
- `error` — Error message if any

**Features:**
- Shows total upgrade cost in green
- Shows "X of Y" selections made
- "Confirm Selections" button (only enabled when all selections made)
- "Reset All" button (disabled when no upgrades selected)
- Status messages for incomplete or locked states

### APIs

#### `GET /api/homeowner/[token]`
Fetches homeowner data, project info, and all selections with product details.

**Response:**
```json
{
  "homeownerAccess": {
    "id": "...",
    "name": "Jane Homeowner",
    "email": "jane@example.com",
    "phone": "..."
  },
  "builder": {
    "id": "...",
    "companyName": "ABC Homes",
    "phone": "...",
    "email": "..."
  },
  "project": {
    "id": "...",
    "name": "Canyon Ridge Model A",
    "jobAddress": "123 Elm Street",
    "city": "Denver",
    "state": "CO"
  },
  "selections": [
    {
      "id": "...",
      "location": "Master Bedroom Door",
      "baseProductId": "...",
      "selectedProductId": "...",
      "adderCost": 0,
      "status": "PENDING",
      "baseProduct": { ... },
      "selectedProduct": { ... }
    },
    ...
  ],
  "progress": {
    "totalSelections": 6,
    "completedSelections": 0,
    "totalUpgradeCost": 0,
    "status": "IN_PROGRESS"
  }
}
```

#### `GET /api/homeowner/[token]/selections`
Fetches all selections for the homeowner with product details.

#### `POST /api/homeowner/[token]/selections`
Updates a selection with a new product choice.

**Request:**
```json
{
  "selectionId": "...",
  "selectedProductId": "...",
  "adderCost": 45
}
```

#### `GET /api/homeowner/[token]/upgrades?baseProductId=...`
Fetches available upgrade paths for a base product.

**Response:**
```json
[
  {
    "id": "...",
    "fromProductId": "...",
    "toProductId": "...",
    "upgradeType": "core",
    "description": "Upgrade from Hollow Core to Solid Core",
    "priceDelta": 45,
    "product": { ... }
  },
  ...
]
```

#### `POST /api/homeowner/[token]/confirm`
Locks all selections to CONFIRMED status. Validates that all selections are made.

**Response:**
```json
{
  "success": true,
  "message": "Confirmed 6 selection(s)",
  "count": 6
}
```

#### `POST /api/homeowner/seed`
**Development only** — Creates demo homeowner data for testing.

**Response:**
```json
{
  "success": true,
  "message": "Demo homeowner portal data created",
  "data": {
    "accessToken": "demo-homeowner-2026",
    "portalUrl": "/homeowner/demo-homeowner-2026",
    "homeowner": { ... },
    "project": { ... },
    "selectionsCreated": 6
  }
}
```

## Testing

### 1. Seed Demo Data

Call the seed endpoint to create demo homeowner records with sample products and upgrade paths:

```bash
curl -X POST http://localhost:3000/api/homeowner/seed
```

This creates:
- 1 HomeownerAccess record with token `demo-homeowner-2026`
- 6 HomeownerSelection records (Master Bedroom, Front Entry, Guest Bath, Pantry, Interior Hardware, Front Door Hardware)
- UpgradePath records for realistic upgrades (Hollow Core → Solid Core, Shaker style, Matte Black finish, etc.)

### 2. Access the Portal

Visit: `http://localhost:3000/homeowner/demo-homeowner-2026`

Or use the landing page: `http://localhost:3000/homeowner` and enter `demo-homeowner-2026`

### 3. Test the Workflow

1. **View project** — Confirm you see the project details and progress bar
2. **Browse upgrades** — Click on available upgrades for each location
3. **See pricing** — Verify upgrade costs are displayed
4. **Select upgrades** — Click to select different options (green highlight)
5. **Track cost** — Watch total cost update in the summary bar
6. **Check progress** — Verify progress bar updates
7. **Confirm selections** — "Confirm Selections" button enables only when all selections are made
8. **Lock down** — After confirming, verify selections are locked and buttons disabled

## Database Schema

The portal uses these Prisma models:

### HomeownerAccess
Represents a homeowner's access to the portal.

```prisma
model HomeownerAccess {
  id            String
  builderId     String
  projectId     String
  name          String
  email         String
  phone         String?
  accessToken   String  @unique
  selections    HomeownerSelection[]
  active        Boolean
  expiresAt     DateTime?
  lastVisitAt   DateTime?
  createdAt     DateTime
}
```

### HomeownerSelection
Represents one room/location's selection (base product + any upgrades).

```prisma
model HomeownerSelection {
  id              String
  homeownerAccessId String
  location        String           // "Master Bedroom Door"
  baseProductId   String           // Default product
  selectedProductId String         // What homeowner picked
  adderCost       Float            // Cost difference
  status          SelectionStatus  // PENDING, CONFIRMED, LOCKED
  confirmedAt     DateTime?
  createdAt       DateTime
  updatedAt       DateTime
}

enum SelectionStatus {
  PENDING
  CONFIRMED
  LOCKED
}
```

### UpgradePath
Represents an upgrade option from one product to another.

```prisma
model UpgradePath {
  fromProductId String
  toProductId   String
  upgradeType   String    // door_style, hardware, core, finish
  costDelta     Float
  priceDelta    Float     // Suggested price adder to homeowner
  description   String?
}
```

## Styling

All styles are in CSS files for consumer-friendly presentation:

- `/src/app/homeowner/homeowner.css` — Layout and header/footer
- `/src/app/homeowner/homeowner-landing.css` — Landing page
- `/src/app/homeowner/homeowner-portal.css` — Main portal page
- `/src/components/homeowner/UpgradeSelectionCard.css` — Card component
- `/src/components/homeowner/SelectionSummary.css` — Summary bar

Key design principles:
- Clean, spacious white cards with subtle shadows
- Large, readable typography
- Orange CTA buttons with hover states
- Green highlights for selected/confirmed states
- Navy accents for headers
- Mobile-responsive grid layouts
- Sticky summary bar at bottom (important on mobile)

## Integration with Builder Workflow

1. **Builder creates project** in the ops module
2. **Builder generates unique token** for each homeowner via admin dashboard (future feature)
3. **Homeowner receives email** with portal link: `https://yoursite.com/homeowner/their-unique-token`
4. **Homeowner logs in**, views project, selects upgrades, confirms
5. **Portal records selections** in HomeownerSelection records
6. **Builder checks portal** in ops dashboard to see homeowner's selections
7. **Selections feed into quote/order** generation (future integration)

## Security Considerations

- **Token-based access** — No password or login required, but token is unique and expires
- **Read-only access** — Homeowners can only view their own project and selections
- **API validation** — All endpoints validate token is active and not expired
- **Email verification** — HomeownerAccess should be created with email verification in future versions
- **HTTPS only** — Token should only be transmitted over HTTPS in production

## Future Enhancements

- Email invitations with token links
- Token expiration and renewal
- Homeowner email notifications when selections confirmed
- Homeowner account dashboard to view order status
- Photo gallery of upgrade options
- Homeowner reviews of products
- Real-time availability checking
- Integration with ECI Bolt for inventory sync
