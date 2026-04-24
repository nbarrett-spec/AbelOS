// ──────────────────────────────────────────────────────────────────────────
// Role-Based Access Control (RBAC) for Abel Builder Platform
// ──────────────────────────────────────────────────────────────────────────
// Multi-role support: staff can have multiple roles, access = union of all
// ──────────────────────────────────────────────────────────────────────────

export type StaffRole =
  | 'ADMIN'
  | 'MANAGER'
  | 'PROJECT_MANAGER'
  | 'ESTIMATOR'
  | 'SALES_REP'
  | 'PURCHASING'
  | 'WAREHOUSE_LEAD'
  | 'WAREHOUSE_TECH'
  | 'DRIVER'
  | 'INSTALLER'
  | 'QC_INSPECTOR'
  | 'ACCOUNTING'
  | 'VIEWER'

export type Department =
  | 'EXECUTIVE'
  | 'SALES'
  | 'ESTIMATING'
  | 'OPERATIONS'
  | 'MANUFACTURING'
  | 'WAREHOUSE'
  | 'DELIVERY'
  | 'INSTALLATION'
  | 'ACCOUNTING'
  | 'PURCHASING'

// Helper: all roles (for routes open to everyone)
const ALL_ROLES: StaffRole[] = [
  'ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP',
  'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER',
  'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER',
]

// ──────────────────────────────────────────────────────────────────────────
// Route Access Matrix
// ──────────────────────────────────────────────────────────────────────────
// Each key is a route prefix under /ops. Value is array of roles that can
// access it. ADMIN always has access to everything.
//
// PHILOSOPHY (per Nate's direction):
//   - Dashboards, reports, executive overview: ALL roles can see
//   - Sensitive financial data (cash balances, AR/AP totals): ADMIN only
//     (handled at field-level, not route-level)
//   - PM role is fully built out — they schedule crews, track sales pipeline,
//     manage delivery, see manufacturing, inventory, pricing, growth, etc.
// ──────────────────────────────────────────────────────────────────────────

const ROUTE_ACCESS: Record<string, StaffRole[]> = {
  // Dashboard — everyone
  '/ops': ALL_ROLES,

  // Executive dashboards — restricted to leadership + accounting.
  // PMs and floor roles get visibility through /ops, /ops/reports, and their
  // role-specific portals; the CEO Dashboard itself is leadership-only.
  '/ops/executive': ['ADMIN', 'MANAGER', 'ACCOUNTING'],

  // Reports — OPEN TO ALL
  '/ops/reports': ALL_ROLES,

  // Jobs — PMs, estimators, managers, sales, warehouse leads
  '/ops/jobs': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'WAREHOUSE_LEAD'],

  // Accounts & Sales — PMs, sales, estimators, managers, accounting
  '/ops/accounts': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'ACCOUNTING'],
  '/ops/products': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD'],
  '/ops/catalog': ['ADMIN', 'MANAGER', 'PURCHASING'],

  // Manufacturing — PM added (needs to see production status)
  '/ops/manufacturing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'QC_INSPECTOR'],

  // Supply Chain — PM added (needs visibility into materials)
  '/ops/supply-chain': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD'],
  '/ops/inventory': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
  '/ops/vendors': ['ADMIN', 'MANAGER', 'PURCHASING', 'PROJECT_MANAGER'],
  '/ops/vendors/scorecard': ['ADMIN', 'MANAGER', 'PURCHASING'],

  // Finance — restricted to accounting + managerial/executive positions
  '/ops/finance': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/ops/finance/patterns': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/ops/finance/ap-forecast': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PURCHASING'],
  // AR aging dashboard — primary owners: Dawn (ACCOUNTING) + leadership.
  // Matches /ops/ar-aging pattern so every finance-adjacent role keeps visibility.
  '/ops/finance/ar': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/invoices': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],
  '/ops/payments': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER'],
  '/ops/ar-aging': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/financial-reports': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER'],
  '/ops/sync-health': ['ADMIN', 'MANAGER', 'ACCOUNTING'],

  // Warranty — admin, managers, QC, sales, PMs
  '/ops/warranty': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'QC_INSPECTOR'],
  '/ops/warranty/policies': ['ADMIN', 'MANAGER'],

  // Communication — everyone
  '/ops/messages': ALL_ROLES,
  '/ops/notifications': ALL_ROLES,

  // Inbox — triage queue, everyone (scoped server-side by role)
  '/ops/inbox': ALL_ROLES,

  // Department Portals — restricted by role
  '/ops/portal': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP',
    'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER',
    'QC_INSPECTOR', 'ACCOUNTING'],
  '/ops/portal/pm': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],
  '/ops/portal/purchasing': ['ADMIN', 'MANAGER', 'PURCHASING'],
  '/ops/portal/warehouse': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'QC_INSPECTOR'],
  '/ops/portal/delivery': ['ADMIN', 'MANAGER', 'DRIVER', 'INSTALLER', 'WAREHOUSE_LEAD', 'PROJECT_MANAGER'],
  '/ops/portal/installer': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'INSTALLER'],
  '/ops/portal/accounting': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/ops/portal/accounting/close': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/ops/portal/accounting/integrations': ['ADMIN', 'MANAGER', 'ACCOUNTING'],

  // Resources — everyone
  '/ops/documents': ALL_ROLES,

  // Sales Pipeline — PM added (they need to see what's coming)
  '/ops/sales': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],

  // Workload delegation — managers, PMs, admin
  '/ops/delegations': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Staff management — admin and managers
  '/ops/staff': ['ADMIN', 'MANAGER'],

  // Audit log — admin and managers
  '/ops/audit': ['ADMIN', 'MANAGER'],

  // Settings — admin only
  '/ops/settings': ['ADMIN'],

  // System Health dashboard — admin only
  '/ops/admin/system-health': ['ADMIN'],

  // Email queue — admin, managers, sales, PMs
  '/ops/email': ['ADMIN', 'MANAGER', 'SALES_REP', 'PROJECT_MANAGER'],

  // AI Assistant — available to ALL staff (tools are role-filtered per user)
  '/ops/ai': ALL_ROLES,

  // Growth Engine — PM added (needs visibility into pipeline growth)
  '/ops/growth': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/marketing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/outreach': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/revenue-intelligence': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Integrations — admin, managers
  '/ops/integrations': ['ADMIN', 'MANAGER'],
  '/ops/imports': ['ADMIN', 'MANAGER'],

  // Floor Plans — PMs, estimators, sales, managers
  '/ops/floor-plans': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Collections & Cash Flow — finance + admin
  '/ops/collections': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/cash-flow-optimizer': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/ops/procurement-intelligence': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING'],
  '/ops/automations': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'ACCOUNTING', 'SALES_REP'],

  // Delivery & Logistics — PM added (they schedule deliveries)
  '/ops/delivery': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'],

  // Schedule & dispatch — PM is PRIMARY here (they schedule crews)
  '/ops/schedule': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD'],
  '/ops/crews': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
  // Material Calendar — the 30-day shortage visibility lens
  '/ops/material-calendar': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD'],
  // Substitution approval queue (page) — broader access for visibility,
  // actual approve/reject actions are role-gated at the API layer.
  '/ops/substitutions': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD'],
  // SmartPO queue — auto-generated PO recommendations from ATP shortage forecast
  '/ops/purchasing/smart-po': ['ADMIN', 'MANAGER', 'PURCHASING'],
  // PM Material Status dashboard — per-PM green/amber/red job view
  '/ops/portal/pm/material': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
  '/api/ops/portal/pm/material': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
  '/api/ops/purchasing/smart-po': ['ADMIN', 'MANAGER', 'PURCHASING'],

  // Pricing — PM added
  '/ops/pricing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Quotes & Orders
  '/ops/quotes': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],
  '/ops/orders': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'ACCOUNTING', 'WAREHOUSE_LEAD'],
  '/ops/quote-requests': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],
  '/ops/takeoff-inquiries': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR'],
  '/ops/takeoff-review': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR'],
  // AI Takeoff Tool — in-house blueprint → BOM scaffold
  '/ops/takeoff-tool': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR'],

  // Blueprints — upload + AI analysis
  '/ops/blueprints': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Organizations & Communities
  '/ops/organizations': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/communities': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],

  // Purchasing — PM gets view access
  '/ops/purchasing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING'],

  // Communication log & builder messages
  '/ops/communication-log': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ACCOUNTING'],
  '/ops/builder-messages': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],

  // Builder intelligence & proactive accounts
  '/ops/portal/builder-intel': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/ops/accounts/proactive': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],

  // User profile — everyone
  '/ops/profile': ALL_ROLES,

  // Appearance settings — all roles can customize their own experience
  '/ops/settings/appearance': ALL_ROLES,

  // Contracts — PM, sales, estimators, managers (sensitive business docs)
  '/ops/contracts': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],

  // Receiving — warehouse + purchasing + PM (material coordination)
  '/ops/receiving': ['ADMIN', 'MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'PROJECT_MANAGER'],

  // Returns — warehouse + accounting + PM
  '/ops/returns': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'PROJECT_MANAGER', 'ACCOUNTING'],

  // KPIs — office/management roles only
  '/ops/kpis': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'ACCOUNTING'],

  // Homeowner access — admin, managers, PMs only
  '/ops/homeowner-access': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Command center — management roles
  '/ops/command-center': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
  '/ops/portal/pm/performance': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Builder health — PM, sales, managers
  '/ops/builder-health': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ACCOUNTING'],

  // Warehouse operations — restricted to warehouse roles
  '/ops/warehouse': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],

  // Today's Pick Queue — Gunner's warehouse team runs the floor from here
  '/ops/portal/warehouse/picks': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],

  // Fleet management — logistics roles
  '/ops/fleet': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'],

  // Inspections — QC, PMs, warehouse leads, installers
  '/ops/inspections': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'QC_INSPECTOR', 'WAREHOUSE_LEAD', 'INSTALLER'],

  // Lien Releases — accounting, PMs, managers
  '/ops/lien-releases': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ACCOUNTING'],

  // Trade Finder — PMs, sales, managers
  '/ops/trades': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'INSTALLER'],

  // Locations — admin, managers
  '/ops/locations': ['ADMIN', 'MANAGER'],

  // Data Repair — drift review queue (ADMIN + ACCOUNTING only; Dawn reviews,
  // Nate admins). Human-in-the-loop approval of Order header rebuilds flagged
  // by scripts/drift-deep-dive.mjs.
  '/ops/admin/data-repair': ['ADMIN', 'ACCOUNTING'],
}

// ──────────────────────────────────────────────────────────────────────────
// Multi-role route check: returns true if ANY of the user's roles has access
// ──────────────────────────────────────────────────────────────────────────

/**
 * Portal overrides format: { "/ops/jobs": true, "/ops/finance": false }
 * - true  = explicitly GRANT access (even if role doesn't have it)
 * - false = explicitly DENY access (even if role has it)
 * - missing = use role-based default
 */
export type PortalOverrides = Record<string, boolean>

export function canAccessRoute(
  role: StaffRole | StaffRole[],
  pathname: string,
  portalOverrides?: PortalOverrides | null,
): boolean {
  const roles = Array.isArray(role) ? role : [role]

  // ADMIN can access everything (overrides don't apply to admins)
  if (roles.includes('ADMIN')) return true

  // Find the most specific matching route pattern
  const sortedRoutes = Object.keys(ROUTE_ACCESS)
    .filter(route => pathname.startsWith(route) || pathname === route)
    .sort((a, b) => b.length - a.length)

  if (sortedRoutes.length === 0) {
    return false
  }

  const matchedRoute = sortedRoutes[0]

  // Check portal overrides first (per-employee overrides take priority)
  if (portalOverrides && matchedRoute in portalOverrides) {
    return portalOverrides[matchedRoute]
  }

  const allowedRoles = ROUTE_ACCESS[matchedRoute]

  // Check if ANY of the user's roles is in the allowed list
  return roles.some(r => allowedRoles.includes(r))
}

/**
 * Get the full ROUTE_ACCESS map (used by the staff management UI to show all portals)
 */
export function getRouteAccessMap(): Record<string, StaffRole[]> {
  return { ...ROUTE_ACCESS }
}

// ──────────────────────────────────────────────────────────────────────────
// API Route Access — which roles can call which API endpoints
// ──────────────────────────────────────────────────────────────────────────

const API_ACCESS: Record<string, StaffRole[]> = {
  // Staff APIs
  '/api/ops/staff': ['ADMIN', 'MANAGER'],
  '/api/ops/audit': ['ADMIN', 'MANAGER'],
  '/api/ops/seed-workflow': ['ADMIN'],
  '/api/ops/seed-employees': ['ADMIN'],

  // Import APIs
  '/api/ops/import-box': ['ADMIN', 'MANAGER'],
  '/api/ops/import-inflow': ['ADMIN', 'MANAGER'],
  '/api/ops/import-bpw': ['ADMIN', 'MANAGER'],
  '/api/ops/import-bolt': ['ADMIN', 'MANAGER'],
  '/api/ops/import-hyphen': ['ADMIN', 'MANAGER'],

  // Financial APIs — restricted to accounting + managerial/executive
  '/api/ops/finance': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/api/ops/finance/monthly-close': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/api/ops/finance/payment-patterns': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/api/ops/finance/ap-forecast': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PURCHASING'],
  '/api/ops/finance/ar-predict': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP'],
  // AR aging dashboard feed — same audience as the /ops/finance/ar page
  '/api/ops/finance/ar': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP'],
  // Collections action center endpoints — Dawn + leadership
  '/api/ops/collections': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP'],
  '/api/ops/finance/ap-waterfall': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PURCHASING'],
  '/api/ops/sync-health': ['ADMIN', 'MANAGER', 'ACCOUNTING'],
  '/api/ops/invoices': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],
  '/api/ops/payments': ['ADMIN', 'MANAGER', 'ACCOUNTING', 'PROJECT_MANAGER'],

  // Job APIs — PM + warehouse lead added
  '/api/ops/jobs': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'WAREHOUSE_LEAD'],

  // Product/Inventory APIs — PM added
  '/api/ops/products': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD'],
  '/api/ops/product-categories': ['ADMIN', 'MANAGER', 'PURCHASING'],
  '/api/ops/suppliers': ['ADMIN', 'MANAGER', 'PURCHASING'],
  '/api/ops/inventory': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],

  // PO APIs — PM added for visibility
  '/api/ops/purchase-orders': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING'],

  // Manufacturing — PM added
  '/api/ops/manufacturing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'QC_INSPECTOR'],

  // Portal APIs
  '/api/ops/portal': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP',
    'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER',
    'QC_INSPECTOR', 'ACCOUNTING'],
  '/api/ops/portal/installer': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'INSTALLER'],

  // Messaging — everyone
  '/api/ops/messages': ALL_ROLES,
  '/api/ops/builder-chat': ALL_ROLES,
  '/api/ops/notifications': ALL_ROLES,

  // Sales APIs — PM added
  '/api/ops/sales': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],

  // Documents — everyone
  '/api/ops/documents': ALL_ROLES,
  '/api/ops/fleet': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'],

  // Warranty APIs
  '/api/ops/warranty': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'QC_INSPECTOR'],
  '/api/ops/warranty/policies': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'QC_INSPECTOR'],
  '/api/ops/warranty/claims': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'QC_INSPECTOR'],
  '/api/ops/warranty/inspections': ['ADMIN', 'MANAGER', 'QC_INSPECTOR'],

  // Delegation APIs
  '/api/ops/delegations': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Email APIs — PM added
  '/api/ops/email': ['ADMIN', 'MANAGER', 'SALES_REP', 'PROJECT_MANAGER'],

  // Workflow APIs
  '/api/ops/workflows': ['ADMIN', 'MANAGER'],

  // Integration APIs
  '/api/ops/integrations': ['ADMIN', 'MANAGER'],

  // Export APIs — PM added
  '/api/ops/export': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ACCOUNTING'],

  // Floor Plans APIs
  '/api/ops/floor-plans': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Quotes & Orders APIs
  '/api/ops/quotes': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],
  '/api/ops/orders': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'ACCOUNTING', 'WAREHOUSE_LEAD'],
  '/api/ops/quote-requests': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Builder & Account APIs
  '/api/ops/builders': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'ACCOUNTING'],
  '/api/ops/accounts': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'ACCOUNTING'],
  '/api/ops/organizations': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/api/ops/communities': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],

  // Schedule & Crew APIs — PM is primary scheduler
  '/api/ops/schedule': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD'],
  '/api/ops/crews': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],

  // Delivery APIs — PM added
  '/api/ops/delivery': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'],

  // Pricing APIs — PM added
  '/api/ops/pricing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Communication APIs
  '/api/ops/communication-log': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ACCOUNTING'],

  // Executive APIs — open to all (sensitive data filtered at field level)
  '/api/ops/executive': ALL_ROLES,

  // Reports APIs — open to all
  '/api/ops/reports': ALL_ROLES,

  // Growth & Marketing APIs — PM added
  '/api/ops/growth': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
  '/api/ops/marketing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],

  // Takeoff APIs
  '/api/ops/takeoffs': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR'],

  // Blueprint APIs — PMs, estimators, sales need upload + analysis access
  '/api/ops/blueprints': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP'],

  // Purchasing APIs — PM added for visibility
  '/api/ops/purchasing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING'],

  // Revenue intelligence — PM added
  '/api/ops/revenue-intelligence': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Procurement intelligence — PM added
  '/api/ops/procurement-intelligence': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING'],
  '/api/ops/automations': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'ACCOUNTING', 'SALES_REP'],
  '/api/ops/ai/daily-briefing': ALL_ROLES,
  '/api/ops/ai/chat': ALL_ROLES,
  '/api/ops/ai': ALL_ROLES,

  // PM Performance Dashboard
  '/api/ops/pm-dashboard': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
  '/api/ops/pm-briefing': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
  '/api/ops/pm-scorecard': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // PM landing/book endpoints (/api/ops/pm/{roster,book,activity,today,compare,
  // material-confirm-pending,ar}). The roster is the PM directory used by the
  // /ops/pm landing page and a number of filter UIs; the book is the per-PM
  // workload view. Without an explicit entry these paths fell through the
  // default-deny in canAccessAPI() and 403'd for everyone except ADMIN, which
  // broke /ops/pm for MANAGER and PROJECT_MANAGER users.
  '/api/ops/pm': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Change Orders & Punch Items
  '/api/ops/change-orders': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR'],
  '/api/ops/punch-items': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'INSTALLER', 'QC_INSPECTOR'],

  // Material ETA & Crew Conflicts
  '/api/ops/material-eta': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD'],
  '/api/ops/material-calendar': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD'],

  // Substitution approval queue — anyone with product-level sub access can
  // create a request; only PM/MANAGER/ADMIN can approve or reject (the
  // approve/reject endpoints re-check this explicitly).
  '/api/ops/substitutions': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD'],
  '/api/ops/crew-conflicts': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD'],
  '/api/ops/readiness-check': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],

  // Delivery Notifications
  '/api/ops/delivery-notify': ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'],

  // Migrations
  '/api/ops/migrate-change-orders': ['ADMIN'],
  '/api/ops/migrate-punch-items': ['ADMIN'],

  // Vendor APIs — PM added for visibility
  '/api/ops/vendors': ['ADMIN', 'MANAGER', 'PURCHASING', 'PROJECT_MANAGER'],
  '/api/ops/vendors/scorecard': ['ADMIN', 'MANAGER', 'PURCHASING'],

  // Preferences API — all roles can manage their own preferences
  '/api/ops/preferences': ALL_ROLES,

  // Today's Pick Queue — list + mark-picked
  '/api/ops/warehouse/picks/today': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
  '/api/ops/warehouse/picks': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],

  // Weekly Cycle Count — WAREHOUSE_LEAD owns it, techs can record counts
  '/api/ops/warehouse/cycle-count': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],

  // Receiving & Returns
  '/api/ops/receiving': ['ADMIN', 'MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'PROJECT_MANAGER'],
  '/api/ops/returns': ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'PROJECT_MANAGER', 'ACCOUNTING'],

  // Settings APIs — admin only (appearance prefs handled by /api/ops/preferences)
  '/api/ops/settings': ['ADMIN'],

  // Migration endpoint — admin only
  '/api/ops/run-migration': ['ADMIN'],

  // Data Repair APIs — ADMIN + ACCOUNTING only. Endpoints mutate Order
  // headers per reviewer approval; no other role needs access.
  '/api/ops/admin/data-repair': ['ADMIN', 'ACCOUNTING'],

  // System Health metrics — ADMIN only.
  '/api/ops/admin/health-metrics': ['ADMIN'],
}

export function canAccessAPI(role: StaffRole | StaffRole[], pathname: string): boolean {
  const roles = Array.isArray(role) ? role : [role]

  if (roles.includes('ADMIN')) return true

  const sortedRoutes = Object.keys(API_ACCESS)
    .filter(route => pathname.startsWith(route))
    .sort((a, b) => b.length - a.length)

  if (sortedRoutes.length === 0) {
    // Auth endpoints are public, everything else default deny
    if (pathname.startsWith('/api/ops/auth')) return true
    return false
  }

  return roles.some(r => API_ACCESS[sortedRoutes[0]].includes(r))
}

// ──────────────────────────────────────────────────────────────────────────
// Human-readable role labels
// ──────────────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<StaffRole, string> = {
  ADMIN: 'Administrator',
  MANAGER: 'Manager',
  PROJECT_MANAGER: 'Project Manager',
  ESTIMATOR: 'Estimator',
  SALES_REP: 'Sales Representative',
  PURCHASING: 'Purchasing Agent',
  WAREHOUSE_LEAD: 'Warehouse Lead',
  WAREHOUSE_TECH: 'Warehouse Technician',
  DRIVER: 'Driver',
  INSTALLER: 'Installer',
  QC_INSPECTOR: 'QC Inspector',
  ACCOUNTING: 'Accounting',
  VIEWER: 'Viewer (Read-Only)',
}

// ──────────────────────────────────────────────────────────────────────────
// Feature-Level Permissions (granular actions within modules)
// ──────────────────────────────────────────────────────────────────────────

export type Permission =
  | 'deals:view' | 'deals:create' | 'deals:edit' | 'deals:delete' | 'deals:assign' | 'deals:change_stage'
  | 'quotes:view' | 'quotes:create' | 'quotes:edit' | 'quotes:delete' | 'quotes:send'
  | 'contracts:view' | 'contracts:create' | 'contracts:edit' | 'contracts:delete' | 'contracts:sign'
  | 'builders:view' | 'builders:create' | 'builders:edit' | 'builders:delete'
  | 'invoices:view' | 'invoices:create' | 'invoices:edit' | 'invoices:void'
  | 'vendors:view' | 'vendors:create' | 'vendors:edit' | 'vendors:delete'
  | 'crews:view' | 'crews:create' | 'crews:edit' | 'crews:delete'
  | 'reports:view' | 'reports:export'
  | 'staff:view' | 'staff:create' | 'staff:edit' | 'staff:delete'
  | 'audit:view'
  | 'settings:view' | 'settings:edit'
  | 'workflows:view' | 'workflows:trigger'
  | 'email:view' | 'email:send'
  | 'integrations:view' | 'integrations:manage'
  | 'schedule:view' | 'schedule:create' | 'schedule:edit'
  | 'delivery:view' | 'delivery:create' | 'delivery:edit'
  | 'install:view' | 'install:create' | 'install:edit'
  | 'punch_item:view' | 'punch_item:edit'
  | 'manufacturing:view'
  | 'inventory:view'
  | 'purchasing:view'
  | 'executive:view'
  | 'operational_financial:view'
  | 'sensitive_financial:view'
  | 'takeoff:create' | 'takeoff:edit' | 'takeoff:ai_extract'

const ROLE_PERMISSIONS: Record<StaffRole, Permission[]> = {
  ADMIN: [
    'deals:view', 'deals:create', 'deals:edit', 'deals:delete', 'deals:assign', 'deals:change_stage',
    'quotes:view', 'quotes:create', 'quotes:edit', 'quotes:delete', 'quotes:send',
    'contracts:view', 'contracts:create', 'contracts:edit', 'contracts:delete', 'contracts:sign',
    'builders:view', 'builders:create', 'builders:edit', 'builders:delete',
    'invoices:view', 'invoices:create', 'invoices:edit', 'invoices:void',
    'vendors:view', 'vendors:create', 'vendors:edit', 'vendors:delete',
    'crews:view', 'crews:create', 'crews:edit', 'crews:delete',
    'reports:view', 'reports:export',
    'staff:view', 'staff:create', 'staff:edit', 'staff:delete',
    'audit:view', 'settings:view', 'settings:edit',
    'workflows:view', 'workflows:trigger',
    'email:view', 'email:send',
    'integrations:view', 'integrations:manage',
    'schedule:view', 'schedule:create', 'schedule:edit',
    'delivery:view', 'delivery:create', 'delivery:edit',
    'install:view', 'install:create', 'install:edit',
    'punch_item:view', 'punch_item:edit',
    'manufacturing:view', 'inventory:view', 'purchasing:view',
    'executive:view', 'operational_financial:view', 'sensitive_financial:view',
    'takeoff:create', 'takeoff:edit', 'takeoff:ai_extract',
  ],
  MANAGER: [
    'deals:view', 'deals:create', 'deals:edit', 'deals:assign', 'deals:change_stage',
    'quotes:view', 'quotes:create', 'quotes:edit', 'quotes:send',
    'contracts:view', 'contracts:create', 'contracts:edit', 'contracts:sign',
    'builders:view', 'builders:create', 'builders:edit',
    'invoices:view', 'invoices:create', 'invoices:edit',
    'vendors:view', 'vendors:create', 'vendors:edit',
    'crews:view', 'crews:create', 'crews:edit',
    'reports:view', 'reports:export',
    'staff:view', 'staff:create', 'staff:edit',
    'audit:view', 'settings:view',
    'workflows:view', 'workflows:trigger',
    'email:view', 'email:send',
    'integrations:view',
    'schedule:view', 'schedule:create', 'schedule:edit',
    'delivery:view', 'delivery:create', 'delivery:edit',
    'install:view', 'install:create', 'install:edit',
    'punch_item:view', 'punch_item:edit',
    'manufacturing:view', 'inventory:view', 'purchasing:view',
    'executive:view', 'operational_financial:view',
    'takeoff:create', 'takeoff:edit', 'takeoff:ai_extract',
  ],
  PROJECT_MANAGER: [
    // PM is a POWER role — needs almost everything to run jobs effectively
    'deals:view', 'deals:create', 'deals:edit', 'deals:change_stage',
    'quotes:view', 'quotes:create', 'quotes:edit', 'quotes:send',
    'contracts:view', 'contracts:create', 'contracts:edit',
    'builders:view', 'builders:create', 'builders:edit',
    'invoices:view', 'invoices:create',
    'vendors:view',
    'crews:view', 'crews:create', 'crews:edit',    // PMs schedule crews!
    'reports:view', 'reports:export',
    'email:view', 'email:send',
    'schedule:view', 'schedule:create', 'schedule:edit',  // PMs ARE the schedulers
    'delivery:view', 'delivery:create', 'delivery:edit',  // PMs track deliveries
    'install:view', 'install:create', 'install:edit',      // PMs oversee installs
    'punch_item:view', 'punch_item:edit',                  // PMs resolve punch items
    'manufacturing:view',    // PMs need to see production status
    'inventory:view',        // PMs need to see what's in stock
    'purchasing:view',       // PMs need visibility into POs
    'executive:view',        // PMs can see dashboards
    'operational_financial:view', // PMs need revenue, margin, AR/AP visibility
    'takeoff:create', 'takeoff:edit', 'takeoff:ai_extract',
  ],
  ESTIMATOR: [
    'deals:view', 'quotes:view', 'quotes:create', 'quotes:edit', 'quotes:send',
    'builders:view', 'vendors:view', 'reports:view',
    'executive:view', 'operational_financial:view',
    'takeoff:create', 'takeoff:edit', 'takeoff:ai_extract',
  ],
  SALES_REP: [
    'deals:view', 'deals:create', 'deals:edit', 'deals:change_stage',
    'quotes:view', 'quotes:create', 'quotes:edit', 'quotes:send',
    'contracts:view', 'contracts:create',
    'builders:view', 'builders:create', 'builders:edit',
    'reports:view', 'reports:export',
    'email:view', 'email:send',
    'executive:view', 'operational_financial:view',
  ],
  PURCHASING: [
    'vendors:view', 'vendors:create', 'vendors:edit',
    'invoices:view', 'reports:view',
    'purchasing:view', 'inventory:view',
    'executive:view', 'operational_financial:view',
  ],
  WAREHOUSE_LEAD: [
    'crews:view', 'crews:create', 'crews:edit',
    'vendors:view', 'reports:view',
    'manufacturing:view', 'inventory:view',
    'delivery:view', 'delivery:create',
    'schedule:view',
    'executive:view',
  ],
  WAREHOUSE_TECH: [
    'crews:view', 'vendors:view',
    'manufacturing:view', 'inventory:view',
    'executive:view',
  ],
  DRIVER: [
    'crews:view', 'delivery:view',
    'executive:view',
  ],
  INSTALLER: [
    'crews:view',
    'install:view', 'install:create', 'install:edit',
    'punch_item:view', 'punch_item:edit',
    'executive:view',
  ],
  QC_INSPECTOR: [
    'reports:view', 'manufacturing:view',
    'executive:view',
  ],
  ACCOUNTING: [
    'invoices:view', 'invoices:create', 'invoices:edit', 'invoices:void',
    'builders:view', 'vendors:view',
    'reports:view', 'reports:export',
    'contracts:view',
    'executive:view', 'operational_financial:view', 'sensitive_financial:view',
  ],
  VIEWER: [
    // VIEWER: intentionally narrow. Must stay in sync with ROUTE_ACCESS — only
    // include permissions for routes VIEWER can actually reach (see ALL_ROLES).
    'reports:view',
    'executive:view',
  ],
}

/**
 * Multi-role permission check: returns true if ANY of the user's roles
 * has the requested permission.
 */
export function hasPermission(role: StaffRole | StaffRole[], permission: Permission): boolean {
  const roles = Array.isArray(role) ? role : [role]
  if (roles.includes('ADMIN')) return true
  return roles.some(r => ROLE_PERMISSIONS[r]?.includes(permission) ?? false)
}

export function getPermissions(role: StaffRole | StaffRole[]): Permission[] {
  const roles = Array.isArray(role) ? role : [role]
  const allPerms = new Set<Permission>()
  for (const r of roles) {
    for (const p of (ROLE_PERMISSIONS[r] || [])) {
      allPerms.add(p)
    }
  }
  return Array.from(allPerms)
}

// ──────────────────────────────────────────────────────────────────────────
// Field-Level Access Control
// ──────────────────────────────────────────────────────────────────────────
// SENSITIVE FINANCIAL DATA: Only ADMIN can see company cash balances, total
// AR/AP, bank account info. Everything else (deal values, invoice amounts,
// individual order totals) is visible to roles that need it.

export type FieldAccess = 'hidden' | 'readonly' | 'editable'

const FIELD_RESTRICTIONS: Record<string, StaffRole[]> = {
  // Truly sensitive — bank balance hidden from everyone except ADMIN
  'Company.cashBalance': ['MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER'],
  'Company.bankBalance': ['MANAGER', 'PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER'],
  // Operational financials — AR, AP, margin visible to office roles, hidden from field workers
  'Company.totalAR': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'VIEWER'],
  'Company.totalAP': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'VIEWER'],
  'Company.profitMargin': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'VIEWER'],

  // Deal values — hidden from floor/field workers
  'Deal.dealValue': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR'],
  'Deal.probability': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR'],
  'Deal.lostReason': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'VIEWER'],

  // Quote pricing — hidden from floor workers
  'Quote.unitPrice': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER'],
  'Quote.lineTotal': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER'],

  // Invoice amounts — hidden from floor workers
  'Invoice.amount': ['WAREHOUSE_TECH', 'DRIVER', 'INSTALLER'],

  // Credit limits — only admin, manager, accounting see these
  'Builder.creditLimit': ['SALES_REP', 'ESTIMATOR', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR'],

  // Staff salary — admin only
  'Staff.salary': ['PROJECT_MANAGER', 'ESTIMATOR', 'SALES_REP', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING', 'VIEWER'],
}

/**
 * Multi-role field access: if ANY role has access (not restricted), field is visible.
 */
export function getFieldAccess(role: StaffRole | StaffRole[], entityField: string): FieldAccess {
  const roles = Array.isArray(role) ? role : [role]
  if (roles.includes('ADMIN')) return 'editable'

  const restrictedRoles = FIELD_RESTRICTIONS[entityField]
  if (!restrictedRoles) return 'editable'

  // If ANY of the user's roles is NOT restricted, they can see it
  const isRestricted = roles.every(r => restrictedRoles.includes(r))
  if (!isRestricted) return 'editable'

  return 'hidden'
}

export const DEPARTMENT_LABELS: Record<Department, string> = {
  EXECUTIVE: 'Executive',
  SALES: 'Sales',
  ESTIMATING: 'Estimating',
  OPERATIONS: 'Operations',
  MANUFACTURING: 'Manufacturing',
  WAREHOUSE: 'Warehouse',
  DELIVERY: 'Delivery',
  INSTALLATION: 'Installation',
  ACCOUNTING: 'Accounting',
  PURCHASING: 'Purchasing',
}

// ──────────────────────────────────────────────────────────────────────────
// Get accessible sidebar sections for a role (multi-role aware)
// ──────────────────────────────────────────────────────────────────────────

export interface SidebarSection {
  label: string
  items: { label: string; href: string; icon?: string }[]
}

export function getAccessibleSections(role: StaffRole | StaffRole[], portalOverrides?: PortalOverrides | null): string[] {
  const sections: string[] = ['dashboard', 'communication', 'resources']

  if (canAccessRoute(role, '/ops/executive', portalOverrides)) sections.push('executive')
  if (canAccessRoute(role, '/ops/jobs', portalOverrides)) sections.push('jobs')
  if (canAccessRoute(role, '/ops/sales', portalOverrides)) sections.push('sales')
  if (canAccessRoute(role, '/ops/accounts', portalOverrides)) sections.push('accounts')
  if (canAccessRoute(role, '/ops/manufacturing', portalOverrides)) sections.push('manufacturing')
  if (canAccessRoute(role, '/ops/supply-chain', portalOverrides)) sections.push('supply-chain')
  if (canAccessRoute(role, '/ops/finance', portalOverrides)) sections.push('finance')
  if (canAccessRoute(role, '/ops/portal', portalOverrides)) sections.push('portals')
  if (canAccessRoute(role, '/ops/staff', portalOverrides)) sections.push('staff')
  if (canAccessRoute(role, '/ops/ai', portalOverrides)) sections.push('ai')
  if (canAccessRoute(role, '/ops/reports', portalOverrides)) sections.push('reports')
  if (canAccessRoute(role, '/ops/growth', portalOverrides)) sections.push('growth')
  if (canAccessRoute(role, '/ops/delivery', portalOverrides)) sections.push('delivery')
  if (canAccessRoute(role, '/ops/schedule', portalOverrides)) sections.push('schedule')
  if (canAccessRoute(role, '/ops/crews', portalOverrides)) sections.push('crews')
  if (canAccessRoute(role, '/ops/pricing', portalOverrides)) sections.push('pricing')

  return sections
}

// ──────────────────────────────────────────────────────────────────────────
// Helper: parse comma-separated roles string into StaffRole array
// ──────────────────────────────────────────────────────────────────────────

export function parseRoles(rolesStr: string | null | undefined): StaffRole[] {
  if (!rolesStr) return []
  return rolesStr.split(',').filter(r => r.trim()).map(r => r.trim() as StaffRole)
}

/**
 * Check if user can see operational financial data (revenue, margins, AR/AP, PO values).
 * All office-level roles (PM, Sales, Estimator, Purchasing, Accounting, Manager, Admin,
 * Warehouse Lead) can see this — they need it to keep the company healthy.
 */
export function canViewOperationalFinancials(role: StaffRole | StaffRole[]): boolean {
  return hasPermission(role, 'operational_financial:view')
}

/**
 * Check if user can see TRULY sensitive data: company bank balance, employee compensation.
 * Only ADMIN and ACCOUNTING can see this.
 */
export function canViewSensitiveFinancials(role: StaffRole | StaffRole[]): boolean {
  return hasPermission(role, 'sensitive_financial:view')
}
