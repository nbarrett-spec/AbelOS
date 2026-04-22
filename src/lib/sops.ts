// ──────────────────────────────────────────────────────────────────────────
// System SOPs — Standard Operating Procedures for Abel Builder Platform
// ──────────────────────────────────────────────────────────────────────────
// Dual purpose:
//   1. Powers the in-app help system (contextual how-tos per page/role)
//   2. Fed into the AI agent's system prompt so it can guide users through tasks
// ──────────────────────────────────────────────────────────────────────────

import type { StaffRole } from './permissions'

export interface SOP {
  id: string
  title: string
  /** Which roles can see / are guided through this SOP */
  roles: StaffRole[]
  /** Which app page(s) this SOP is relevant to (route prefixes) */
  pages: string[]
  /** Category for grouping in the help panel */
  category: SOPCategory
  /** Step-by-step instructions */
  steps: string[]
  /** Common mistakes or things to watch for */
  tips?: string[]
  /** What to do if something goes wrong */
  troubleshooting?: string[]
}

export type SOPCategory =
  | 'orders'
  | 'quotes'
  | 'jobs'
  | 'invoicing'
  | 'inventory'
  | 'purchasing'
  | 'delivery'
  | 'manufacturing'
  | 'accounts'
  | 'scheduling'
  | 'ai'
  | 'general'

export const CATEGORY_LABELS: Record<SOPCategory, string> = {
  orders: 'Orders & Fulfillment',
  quotes: 'Quotes & Estimates',
  jobs: 'Job Management',
  invoicing: 'Invoicing & Collections',
  inventory: 'Inventory & Warehouse',
  purchasing: 'Purchasing & Vendors',
  delivery: 'Delivery & Logistics',
  manufacturing: 'Manufacturing & Production',
  accounts: 'Builder Accounts',
  scheduling: 'Scheduling & Crews',
  ai: 'AI Assistant',
  general: 'General',
}

// ──────────────────────────────────────────────────────────────────────────
// SOP Library
// ──────────────────────────────────────────────────────────────────────────

export const SOPS: SOP[] = [
  // ════════════════════════════════════════════════════════════════════════
  // ORDERS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'create-order',
    title: 'Create a New Order',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],
    pages: ['/ops/orders'],
    category: 'orders',
    steps: [
      'Go to Orders page and click "New Order".',
      'Select the builder from the dropdown (or create a new builder account first).',
      'Add line items — search by product name or SKU. Set quantities.',
      'Review pricing. If the builder has a custom price list, it auto-applies.',
      'Set the delivery date if known. Leave blank if TBD.',
      'Add any order notes (site access instructions, special handling).',
      'Click "Create Order". Status starts as RECEIVED.',
      'The warehouse will see it in their queue once you confirm it.',
    ],
    tips: [
      'Double-check the builder selection — orders to the wrong account cause invoicing headaches.',
      'If you need to add products not in the catalog, use "Custom Line Item" (Admin/Manager only).',
      'Orders with delivery dates in the next 48 hours auto-flag as urgent in the warehouse portal.',
    ],
  },
  {
    id: 'process-order',
    title: 'Process an Order (Warehouse Flow)',
    roles: ['ADMIN', 'MANAGER', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
    pages: ['/ops/orders', '/ops/portal/warehouse'],
    category: 'orders',
    steps: [
      'Check the Warehouse Portal for new orders in RECEIVED status.',
      'Open the order and review all line items against available inventory.',
      'If all items are in stock, click "Confirm" to move to IN_PRODUCTION.',
      'Generate the pick list. Print or send to mobile.',
      'Pull items from the warehouse and stage them in the designated zone.',
      'Once all items are staged, mark order as STAGED.',
      'If any items are out of stock, note which ones and notify the PM.',
    ],
    tips: [
      'Always check bin locations first — saves walking time.',
      'If a product substitution is needed, get PM approval before pulling the alternate.',
      'Stage in delivery-date order: closest delivery date gets staged first.',
    ],
    troubleshooting: [
      'Pick list shows 0 on hand but product is on the shelf → check if another order has it committed. Run inventory count on that SKU.',
      'Order stuck in RECEIVED → PM may not have confirmed it yet. Check with the assigned PM.',
    ],
  },
  {
    id: 'track-order-status',
    title: 'Track Order Status',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR', 'WAREHOUSE_LEAD', 'ACCOUNTING'],
    pages: ['/ops/orders'],
    category: 'orders',
    steps: [
      'Go to Orders page. Use the search bar or status filter to find the order.',
      'Click the order to see full details: line items, status history, delivery info.',
      'Status flow: RECEIVED → CONFIRMED → IN_PRODUCTION → READY_TO_SHIP → SHIPPED → DELIVERED → COMPLETE.',
      'Each status change is logged with timestamp and who made the change.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // QUOTES
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'create-quote',
    title: 'Create a Quote from Scratch',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR'],
    pages: ['/ops/quotes'],
    category: 'quotes',
    steps: [
      'Go to Quotes and click "New Quote".',
      "Select the builder. If it's a new builder, create the account first under Accounts.",
      'Add line items with products, quantities, and pricing.',
      'If the builder has a tier pricing agreement, prices auto-populate from their price list.',
      'Set the "Valid Until" date (default is 30 days).',
      'Add any notes or terms (delivery timeline, exclusions).',
      'Save as Draft or click "Send" to email it to the builder contact.',
    ],
    tips: [
      'Check if a similar quote already exists — you can duplicate and modify it.',
      'Quotes expiring in 3 days trigger a warning in the daily briefing.',
      'After a quote is approved, convert it to an order with one click.',
    ],
  },
  {
    id: 'create-quote-from-blueprint',
    title: 'Create a Quote from Blueprint Takeoff',
    roles: ['ADMIN', 'MANAGER', 'ESTIMATOR', 'PROJECT_MANAGER'],
    pages: ['/ops/quotes', '/ops/blueprints/analyze', '/ops/floor-plans'],
    category: 'quotes',
    steps: [
      'Upload the blueprint PDF under Floor Plans or Blueprints.',
      'Run the AI takeoff analysis — it extracts door schedules, trim specs, and hardware.',
      'Review the extracted BOM (Bill of Materials). Correct any misreads.',
      'Click "Generate Quote" from the takeoff results.',
      'Review pricing, adjust if needed, then save or send.',
    ],
    tips: [
      'AI takeoff works best with clean, high-resolution PDFs.',
      'Always double-check door sizes and handing — the most common takeoff errors.',
      'If the builder sends an updated plan, create a new takeoff version rather than editing the old one.',
    ],
  },
  {
    id: 'follow-up-stale-quote',
    title: 'Follow Up on a Stale Quote',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP'],
    pages: ['/ops/quotes', '/ops/ai'],
    category: 'quotes',
    steps: [
      'Check the Quotes page filtered by status "SENT" and sort by date (oldest first).',
      'Quotes older than 5 days without response are flagged as stale.',
      'Open the quote and review what was sent.',
      'Use the AI Assistant to draft a follow-up email: "Draft a follow-up for quote [number]".',
      'Review and send the email from your email client.',
      'Log the follow-up in the communication log.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // JOBS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'manage-job-lifecycle',
    title: 'Manage a Job Through Its Lifecycle',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER'],
    pages: ['/ops/jobs', '/ops/portal/pm'],
    category: 'jobs',
    steps: [
      'Jobs are created when an order is confirmed. Status starts at CREATED.',
      'Run the Readiness Check (T-72 hours): verify materials are available, specs are complete.',
      'Lock materials (T-48 hours): confirm all items are available in InFlow/inventory.',
      'Move to IN_PRODUCTION: warehouse begins picking and staging.',
      'Once staged, schedule delivery and mark as STAGED.',
      'After loading the truck, mark LOADED → IN_TRANSIT when driver departs.',
      'Driver confirms DELIVERED on site.',
      'If installation is needed, crew marks INSTALLING → PUNCH_LIST → COMPLETE.',
      'After completion, create the invoice.',
    ],
    tips: [
      'The PM Portal shows your jobs grouped by status — use it as your daily command center.',
      'T-72 and T-48 are guidelines, not hard deadlines. Adjust for job complexity.',
      'Use decision notes on jobs to document any changes, substitutions, or builder requests.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // INVOICING & COLLECTIONS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'create-invoice',
    title: 'Create an Invoice for a Completed Job',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ACCOUNTING'],
    pages: ['/ops/invoices', '/ops/finance'],
    category: 'invoicing',
    steps: [
      'Go to Invoices and click "New Invoice".',
      'Select the builder and the associated order/job.',
      'Line items auto-populate from the order. Review quantities and pricing.',
      'Set payment terms (Net 15, Net 30, or Pay at Order with 3% discount).',
      'Add any adjustments (credits, change order additions).',
      'Save as Draft for review, or Issue to make it live.',
      'Click "Send" to email the invoice to the builder.',
    ],
    tips: [
      "Always check the builder's payment terms before issuing — they may have negotiated custom terms.",
      'Invoices older than the payment terms auto-flag as OVERDUE.',
      'The Collections page shows all overdue invoices ranked by amount.',
    ],
  },
  {
    id: 'process-payment',
    title: 'Process a Payment',
    roles: ['ADMIN', 'MANAGER', 'ACCOUNTING'],
    pages: ['/ops/payments', '/ops/finance'],
    category: 'invoicing',
    steps: [
      'Go to Payments and click "Record Payment".',
      'Select the builder and the invoice(s) being paid.',
      'Enter the payment amount, method (check, ACH, credit card), and reference number.',
      'If partial payment, the system calculates the remaining balance.',
      'Save the payment. The invoice status updates automatically (PARTIALLY_PAID or PAID).',
    ],
    tips: [
      "Always match payments to specific invoices — don't leave them unallocated.",
      'If a builder pays by check, record the check number for reconciliation.',
      'Payments via Stripe are auto-recorded when the builder pays through the portal.',
    ],
  },
  {
    id: 'collections-workflow',
    title: 'Collections — Follow Up on Overdue Invoices',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'ACCOUNTING', 'SALES_REP'],
    pages: ['/ops/collections', '/ops/ar-aging'],
    category: 'invoicing',
    steps: [
      'Check the Collections page for overdue invoices, sorted by days past due.',
      'AR Aging report groups by 0-30, 31-60, 61-90, 90+ days.',
      'For 1-30 days overdue: send a friendly payment reminder email.',
      'For 31-60 days: escalate — call the builder contact directly.',
      'For 60+ days: flag for management review. Consider placing the account on hold.',
      'Log all collection activities in the communication log.',
      'Use the AI Assistant: "Draft a payment reminder for [builder] invoice [number]".',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // INVENTORY & WAREHOUSE
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'check-inventory',
    title: 'Check Inventory Levels',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
    pages: ['/ops/inventory', '/ops/portal/warehouse'],
    category: 'inventory',
    steps: [
      'Go to Inventory page. Search by product name or SKU.',
      'Key columns: On Hand (physical count), Committed (allocated to orders), Available (on hand minus committed).',
      'Items below the reorder point are highlighted in yellow. Out of stock items are red.',
      'Click any item for details: bin location, supplier, cost, last received date.',
    ],
    tips: [
      'Available quantity is what matters for new orders, not On Hand.',
      '"Days of Supply" tells you how long current stock will last based on usage history.',
      "If On Hand and physical count don't match, report it to the warehouse lead for a cycle count.",
    ],
  },
  {
    id: 'receive-inventory',
    title: 'Receive Incoming Shipment',
    roles: ['ADMIN', 'MANAGER', 'PURCHASING', 'WAREHOUSE_LEAD', 'WAREHOUSE_TECH'],
    pages: ['/ops/receiving', '/ops/portal/warehouse'],
    category: 'inventory',
    steps: [
      'Go to Receiving page. Find the PO being received.',
      'Click "Receive" on the PO.',
      'Count each item against the packing slip. Enter the received quantity per line.',
      'If any items are damaged or missing, note them in the receiving comments.',
      'Submit the receiving record. Inventory on-hand updates automatically.',
      'If partial shipment, the PO stays open until fully received.',
    ],
    troubleshooting: [
      "Received quantity doesn't match PO → mark as partial receive and notify Purchasing.",
      'Wrong product delivered → reject and notify Purchasing to arrange return/replacement.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // PURCHASING
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'create-purchase-order',
    title: 'Create a Purchase Order',
    roles: ['ADMIN', 'MANAGER', 'PURCHASING'],
    pages: ['/ops/purchasing', '/ops/portal/purchasing'],
    category: 'purchasing',
    steps: [
      'Go to Purchasing portal or Purchase Orders page.',
      'Click "New PO". Select the vendor/supplier.',
      'Add line items — search products and set quantities needed.',
      'Unit costs auto-populate from the last PO or vendor price list.',
      'Set the expected delivery date.',
      'Save as Draft for review, or submit for approval if over the threshold.',
      'Once approved (or if under threshold), click "Send to Vendor".',
    ],
    tips: [
      'Check the Reorder Recommendations page — it suggests what to order based on usage and lead times.',
      'POs over $5,000 require manager approval before sending to vendor.',
      'Use the AI Assistant: "What items need reorder?" to get a prioritized list.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // DELIVERY
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'manage-delivery',
    title: 'Schedule and Track a Delivery',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'DRIVER', 'WAREHOUSE_LEAD'],
    pages: ['/ops/delivery', '/ops/schedule', '/ops/portal/delivery'],
    category: 'delivery',
    steps: [
      'Once an order is STAGED, go to Delivery page to schedule it.',
      'Set the delivery date and time window.',
      'Assign a driver and truck.',
      'The driver sees the delivery on their portal with address and access instructions.',
      'Driver marks IN_TRANSIT when departing and DELIVERED on arrival.',
      'If delivery has issues (site not ready, wrong items), driver notes it in the delivery record.',
      'Builder receives an automatic delivery notification.',
    ],
    tips: [
      'Check the route optimizer to batch nearby deliveries on the same truck run.',
      "Delivery notifications go to the builder's primary contact automatically.",
      'If a builder requests a specific time window, note it in the order delivery instructions.',
    ],
  },
  {
    id: 'driver-daily',
    title: 'Driver — Daily Delivery Workflow',
    roles: ['DRIVER'],
    pages: ['/ops/portal/delivery'],
    category: 'delivery',
    steps: [
      'Open your Delivery Portal each morning. Your scheduled deliveries are listed.',
      'Review each stop: address, access instructions, items being delivered.',
      'When you depart the warehouse, mark the first delivery as IN_TRANSIT.',
      'At each site: unload, get signature if required, mark as DELIVERED.',
      "If there's an issue (site locked, wrong address, damaged goods), take a photo and add a note.",
      'After all deliveries, return to the warehouse portal to check for afternoon adds.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // ACCOUNTS & BUILDERS
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'create-builder-account',
    title: 'Set Up a New Builder Account',
    roles: ['ADMIN', 'MANAGER', 'SALES_REP', 'PROJECT_MANAGER'],
    pages: ['/ops/accounts'],
    category: 'accounts',
    steps: [
      'Go to Accounts and click "New Builder".',
      'Enter company name, primary contact name, email, and phone.',
      'Set payment terms (default Net 30 — adjust per agreement).',
      'Set credit limit if applicable (Admin/Manager only).',
      'Add any communities they build in.',
      'Save. The builder can now be selected when creating orders and quotes.',
      'Optional: invite the builder to the Builder Portal for self-service quote requests.',
    ],
    tips: [
      'Check if the builder already exists under a different name before creating a duplicate.',
      'The Sales Rep who creates the account is auto-assigned as the primary contact.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // SCHEDULING
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'schedule-crew',
    title: 'Schedule an Installation Crew',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'WAREHOUSE_LEAD'],
    pages: ['/ops/schedule', '/ops/crews'],
    category: 'scheduling',
    steps: [
      'Go to Schedule page. Select the date you want to schedule.',
      'Click "Add Entry" and select INSTALLATION as the type.',
      'Link the job/order and select the crew.',
      'Set the time window and estimated duration.',
      'Check for crew conflicts — the system warns if the crew is double-booked.',
      'Save the schedule entry. The crew sees it on their portal.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // AI ASSISTANT
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'use-ai-assistant',
    title: 'Using the AI Assistant',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR', 'PURCHASING',
            'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING'],
    pages: ['/ops/ai'],
    category: 'ai',
    steps: [
      'Go to the AI page from the sidebar (or click the AI icon).',
      'Type your question in natural language. Examples:',
      '  - "Show me overdue invoices and total exposure"',
      '  - "What orders are ready to ship?"',
      '  - "Draft a follow-up email for quote Q-1234"',
      '  - "Which builders have the most open orders?"',
      '  - "What items need reorder?"',
      '  - "Daily briefing — what happened today?"',
      'The AI uses your role to determine what data you can access.',
      "If it looks up data, you'll see \"Tools used\" badges below the response.",
      "If it recommends an action, you'll see action cards you can review.",
    ],
    tips: [
      'Be specific: "Overdue invoices for Brookfield" works better than just "invoices".',
      'The AI can draft emails but cannot send them — you copy and send from your email client.',
      "Your data access is limited to your role. If you need data you can't access, ask your manager.",
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // MANUFACTURING / QC
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'qc-inspection',
    title: 'Run a QC Inspection',
    roles: ['ADMIN', 'MANAGER', 'QC_INSPECTOR', 'WAREHOUSE_LEAD'],
    pages: ['/ops/inspections', '/ops/portal/qc'],
    category: 'manufacturing',
    steps: [
      'Go to Inspections page to see items pending QC.',
      'Open the inspection record for the order/job.',
      'Check each item against the spec sheet: correct product, correct dimensions, no damage.',
      'Mark each line as PASS or FAIL with notes.',
      'If any items fail, flag the order and notify the PM.',
      'Once all items pass, the order moves to STAGED status.',
    ],
  },

  // ════════════════════════════════════════════════════════════════════════
  // GENERAL
  // ════════════════════════════════════════════════════════════════════════
  {
    id: 'daily-start',
    title: 'Starting Your Day in Abel OS',
    roles: ['ADMIN', 'MANAGER', 'PROJECT_MANAGER', 'SALES_REP', 'ESTIMATOR', 'PURCHASING',
            'WAREHOUSE_LEAD', 'WAREHOUSE_TECH', 'DRIVER', 'INSTALLER', 'QC_INSPECTOR', 'ACCOUNTING'],
    pages: ['/ops'],
    category: 'general',
    steps: [
      "Log in to app.abellumber.com and go to your role's portal page.",
      'Check the dashboard for any urgent alerts (overdue invoices, out-of-stock items, pending approvals).',
      'Review your notifications for any new assignments or messages.',
      'Use the AI Assistant for a daily briefing: "Daily briefing — what needs my attention?"',
      'Work through your tasks in priority order.',
    ],
    tips: [
      'Bookmark your portal page for faster access.',
      'The sidebar highlights pages with pending items.',
      "If something looks wrong in the data, report it — don't try to fix it manually.",
    ],
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Get SOPs relevant to a specific role.
 */
export function getSOPsForRole(role: StaffRole | StaffRole[]): SOP[] {
  const roles = Array.isArray(role) ? role : [role]
  if (roles.includes('ADMIN')) return SOPS // Admin sees everything
  return SOPS.filter(sop => roles.some(r => sop.roles.includes(r)))
}

/**
 * Get SOPs relevant to a specific page/route.
 */
export function getSOPsForPage(pathname: string, role?: StaffRole | StaffRole[]): SOP[] {
  let sops = SOPS.filter(sop => sop.pages.some(p => pathname.startsWith(p)))
  if (role) {
    const roles = Array.isArray(role) ? role : [role]
    if (!roles.includes('ADMIN')) {
      sops = sops.filter(sop => roles.some(r => sop.roles.includes(r)))
    }
  }
  return sops
}

/**
 * Get SOPs grouped by category for a role.
 */
export function getSOPsByCategory(role: StaffRole | StaffRole[]): Record<SOPCategory, SOP[]> {
  const sops = getSOPsForRole(role)
  const grouped = {} as Record<SOPCategory, SOP[]>
  for (const sop of sops) {
    if (!grouped[sop.category]) grouped[sop.category] = []
    grouped[sop.category].push(sop)
  }
  return grouped
}

/**
 * Build a text summary of SOPs for a role — used in the AI agent's system prompt.
 * Compact format to minimize token usage.
 */
export function buildSOPContextForAgent(roles: string[]): string {
  const typedRoles = roles as StaffRole[]
  const sops = getSOPsForRole(typedRoles)

  if (sops.length === 0) return ''

  const lines = ['AVAILABLE PROCEDURES (guide the user through these when relevant):']
  for (const sop of sops) {
    lines.push(`• ${sop.title}: ${sop.steps.slice(0, 3).join(' → ')}${sop.steps.length > 3 ? ' → ...' : ''}`)
  }
  return lines.join('\n')
}
