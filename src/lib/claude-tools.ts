// ──────────────────────────────────────────────────────────────────────────
// Claude Tool Definitions & Executors for Abel Builder Platform
// ──────────────────────────────────────────────────────────────────────────
// Each tool has: a definition (schema for Claude) and an executor (function
// that runs when Claude calls it). Tools are filtered by staff role.
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { ClaudeTool } from '@/lib/claude'

/**
 * Sanitize a string for safe interpolation in SQL queries.
 * Escapes single quotes to prevent SQL injection.
 * For new code, prefer parameterized queries ($1, $2).
 */
function sqlSafe(input: unknown): string {
  if (input == null || typeof input !== 'string') return ''
  return input.replace(/'/g, "''").replace(/\\/g, '\\\\').replace(/;/g, '')
}

// ──────────────────────────────────────────────────────────────────────────
// Tool Definitions (schemas that Claude sees)
// ──────────────────────────────────────────────────────────────────────────

export const TOOL_DEFINITIONS: Record<string, ClaudeTool> = {
  search_orders: {
    name: 'search_orders',
    description: 'Search orders by builder name, order number, status, or date range. Returns order details including items, totals, and status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term — builder name, order number, or keyword' },
        status: { type: 'string', description: 'Filter by status: RECEIVED, CONFIRMED, IN_PRODUCTION, READY_TO_SHIP, SHIPPED, DELIVERED, COMPLETE, CANCELLED' },
        limit: { type: 'number', description: 'Max results to return (default 10)' },
      },
      required: [],
    },
  },

  search_builders: {
    name: 'search_builders',
    description: 'Search builder (customer) accounts by company name, contact name, or email. Returns account details, payment terms, and recent activity.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search term — company name, contact name, or email' },
        status: { type: 'string', description: 'Filter by account status: PENDING, ACTIVE, SUSPENDED, CLOSED' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },

  search_invoices: {
    name: 'search_invoices',
    description: 'Search invoices by number, builder, status, or date. Returns invoice details with amounts, due dates, and payment status.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Invoice number or builder name' },
        status: { type: 'string', description: 'Filter: DRAFT, ISSUED, SENT, PARTIALLY_PAID, PAID, OVERDUE, VOID, WRITE_OFF' },
        overdue_only: { type: 'boolean', description: 'Only show overdue invoices' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },

  search_products: {
    name: 'search_products',
    description: 'Search the product catalog by name, SKU, or category. Returns product details including pricing and availability.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Product name, SKU, or category' },
        category: { type: 'string', description: 'Filter by category' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },

  search_purchase_orders: {
    name: 'search_purchase_orders',
    description: 'Search purchase orders by PO number, vendor name, or status. Returns PO details with line items and totals.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'PO number or vendor name' },
        status: { type: 'string', description: 'Filter: DRAFT, PENDING_APPROVAL, APPROVED, SENT_TO_VENDOR, PARTIALLY_RECEIVED, RECEIVED, CANCELLED' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },

  get_job_pipeline: {
    name: 'get_job_pipeline',
    description: 'Get a summary of all jobs grouped by status, showing counts and key metrics for the job pipeline.',
    input_schema: {
      type: 'object',
      properties: {
        include_details: { type: 'boolean', description: 'Include top 5 jobs per status (default false)' },
      },
      required: [],
    },
  },

  get_financial_summary: {
    name: 'get_financial_summary',
    description: 'Get a high-level financial summary including AR totals, recent collections, invoice pipeline, and revenue metrics. Only available to roles with operational financial access.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', description: 'Time period: "week", "month", "quarter", "year" (default "month")' },
      },
      required: [],
    },
  },

  get_schedule: {
    name: 'get_schedule',
    description: 'Get upcoming schedule entries (deliveries, installations, pick lists) for the next N days.',
    input_schema: {
      type: 'object',
      properties: {
        days: { type: 'number', description: 'Number of days ahead to look (default 7)' },
        type: { type: 'string', description: 'Filter by entry type: DELIVERY, INSTALLATION, PICKUP, PRODUCTION' },
      },
      required: [],
    },
  },

  draft_email: {
    name: 'draft_email',
    description: 'Draft a professional email. Returns the draft text for review — does NOT send it. The user can copy, edit, and send from their email client.',
    input_schema: {
      type: 'object',
      properties: {
        to_name: { type: 'string', description: 'Recipient name' },
        to_email: { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        purpose: { type: 'string', description: 'What is the email about? e.g., "payment reminder for invoice 1234", "delivery confirmation for job 567"' },
        tone: { type: 'string', description: 'Tone: professional, friendly, urgent, formal (default: professional)' },
      },
      required: ['purpose'],
    },
  },

  create_purchase_order: {
    name: 'create_purchase_order',
    description: 'Create a new draft purchase order. Returns the PO details for review before submission. Only available to Purchasing and Admin roles.',
    input_schema: {
      type: 'object',
      properties: {
        vendor_name: { type: 'string', description: 'Name of the vendor to order from' },
        items: {
          type: 'array',
          description: 'Line items for the PO',
          items: {
            type: 'object',
            properties: {
              product_name: { type: 'string', description: 'Product name or SKU' },
              quantity: { type: 'number', description: 'Quantity to order' },
              unit_cost: { type: 'number', description: 'Cost per unit' },
            },
            required: ['product_name', 'quantity'],
          },
        },
        notes: { type: 'string', description: 'Additional notes for the PO' },
      },
      required: ['vendor_name', 'items'],
    },
  },

  get_inventory_status: {
    name: 'get_inventory_status',
    description: 'Check inventory levels for products, showing current stock, reorder points, and recent movement.',
    input_schema: {
      type: 'object',
      properties: {
        product_query: { type: 'string', description: 'Product name, SKU, or category to check' },
        low_stock_only: { type: 'boolean', description: 'Only show items below reorder point' },
        limit: { type: 'number', description: 'Max results (default 20)' },
      },
      required: [],
    },
  },

  search_vendors: {
    name: 'search_vendors',
    description: 'Search vendor/supplier records by name. Returns vendor details and recent PO history.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Vendor name or keyword' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },

  get_staff_directory: {
    name: 'get_staff_directory',
    description: 'Look up staff members by name, role, or department. Useful for finding who to contact about something.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name, role, or department to search' },
        department: { type: 'string', description: 'Filter by department' },
      },
      required: [],
    },
  },

  get_quotes: {
    name: 'get_quotes',
    description: 'Search quotes by builder, quote number, or status. Returns quote details with line items and totals.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Builder name, quote number, or keyword' },
        status: { type: 'string', description: 'Filter: DRAFT, SENT, APPROVED, REJECTED, EXPIRED, ORDERED' },
        limit: { type: 'number', description: 'Max results (default 10)' },
      },
      required: [],
    },
  },

  // ──────────────────────────────────────────────────────────────────────
  // Procurement Intelligence Tools
  // ──────────────────────────────────────────────────────────────────────

  check_inventory_levels: {
    name: 'check_inventory_levels',
    description: 'Check detailed inventory levels from the procurement system. Shows on-hand quantities, reorder points, days of supply, and stock status (OUT_OF_STOCK, CRITICAL, LOW_STOCK, IN_STOCK). Much more detailed than get_inventory_status.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Filter by product category (e.g., Trim, MDF, Hardware)' },
        status: { type: 'string', description: 'Filter: LOW_STOCK, OUT_OF_STOCK, CRITICAL, IN_STOCK' },
        search: { type: 'string', description: 'Search by product name or SKU' },
      },
      required: [],
    },
  },

  get_reorder_recommendations: {
    name: 'get_reorder_recommendations',
    description: 'AI-powered reorder recommendations. Analyzes inventory levels, finds items below reorder point, identifies the best supplier for each (fastest for emergencies, cheapest otherwise), and suggests PO quantities.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  get_demand_forecast: {
    name: 'get_demand_forecast',
    description: 'Get AI demand forecast based on 6-month order history, open quotes, and seasonal construction trends. Shows projected demand by product category with confidence levels.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  get_best_buy_analysis: {
    name: 'get_best_buy_analysis',
    description: 'Compare suppliers to find the best buy for each product category. Analyzes landed cost (unit price + duty + freight) across domestic and overseas suppliers.',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'Product category to analyze (e.g., Trim, MDF, Hardware)' },
      },
      required: [],
    },
  },

  search_suppliers: {
    name: 'search_suppliers',
    description: 'Search the supplier database for domestic and overseas suppliers. Returns supplier details, lead times, duty rates, product counts, and 12-month spend.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Supplier name or keyword' },
        type: { type: 'string', description: 'Filter by type: DOMESTIC or OVERSEAS' },
        category: { type: 'string', description: 'Filter by product category' },
      },
      required: [],
    },
  },

  get_po_status: {
    name: 'get_po_status',
    description: 'Get purchase order status and details from the procurement system. Shows PO number, supplier, items, costs, and delivery tracking.',
    input_schema: {
      type: 'object',
      properties: {
        po_number: { type: 'string', description: 'PO number to look up (e.g., PO-2026-0001)' },
        status: { type: 'string', description: 'Filter by PO status: DRAFT, PENDING_APPROVAL, APPROVED, SENT, IN_TRANSIT, PARTIALLY_RECEIVED, RECEIVED, CANCELLED' },
        supplier: { type: 'string', description: 'Filter by supplier name' },
      },
      required: [],
    },
  },

  create_procurement_po: {
    name: 'create_procurement_po',
    description: 'Create a purchase order through the procurement system. Auto-calculates duty and freight based on supplier rates. Returns draft PO for review. Only available to Purchasing and Admin.',
    input_schema: {
      type: 'object',
      properties: {
        supplier_id: { type: 'string', description: 'Supplier ID to order from' },
        items: {
          type: 'array',
          description: 'Line items for the PO',
          items: {
            type: 'object',
            properties: {
              productName: { type: 'string', description: 'Product name' },
              sku: { type: 'string', description: 'Product SKU' },
              quantity: { type: 'number', description: 'Quantity to order' },
              unitCost: { type: 'number', description: 'Cost per unit' },
            },
            required: ['productName', 'quantity', 'unitCost'],
          },
        },
        priority: { type: 'string', description: 'URGENT, HIGH, or NORMAL (default)' },
        notes: { type: 'string', description: 'Notes for the PO' },
      },
      required: ['supplier_id', 'items'],
    },
  },

  get_daily_briefing: {
    name: 'get_daily_briefing',
    description: 'Get a role-specific daily briefing with order stats, quote pipeline, AR status, inventory alerts, PO status, and recommended action items. Data is tailored to the staff member\'s role.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },

  get_supplier_scorecard: {
    name: 'get_supplier_scorecard',
    description: 'Get supplier performance scorecards with composite scores for quality, reliability, on-time delivery, and value. Includes letter grades A-F.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
}

// ──────────────────────────────────────────────────────────────────────────
// Role → Tool Access Matrix
// ──────────────────────────────────────────────────────────────────────────
// Which tools each role can use. ADMIN gets everything.

const ROLE_TOOLS: Record<string, string[]> = {
  ADMIN: Object.keys(TOOL_DEFINITIONS),
  MANAGER: [
    'search_orders', 'search_builders', 'search_invoices', 'search_products',
    'search_purchase_orders', 'get_job_pipeline', 'get_financial_summary',
    'get_schedule', 'draft_email', 'get_inventory_status', 'search_vendors',
    'get_staff_directory', 'get_quotes',
    // Procurement tools
    'check_inventory_levels', 'get_reorder_recommendations', 'get_demand_forecast',
    'get_best_buy_analysis', 'search_suppliers', 'get_po_status',
    'create_procurement_po', 'get_daily_briefing', 'get_supplier_scorecard',
  ],
  PROJECT_MANAGER: [
    'search_orders', 'search_builders', 'search_invoices', 'search_products',
    'get_job_pipeline', 'get_financial_summary', 'get_schedule', 'draft_email',
    'get_inventory_status', 'get_staff_directory', 'get_quotes',
    // Procurement tools (view only — no PO creation)
    'check_inventory_levels', 'get_reorder_recommendations', 'get_demand_forecast',
    'get_best_buy_analysis', 'search_suppliers', 'get_po_status',
    'get_daily_briefing', 'get_supplier_scorecard',
  ],
  ESTIMATOR: [
    'search_orders', 'search_builders', 'search_products', 'get_quotes',
    'draft_email', 'get_inventory_status', 'get_staff_directory',
    'get_financial_summary',
    'check_inventory_levels', 'get_daily_briefing',
  ],
  SALES_REP: [
    // Core sales: builders, orders, invoices, quotes, products, pipeline, schedule
    'search_orders', 'search_builders', 'search_invoices', 'get_quotes',
    'draft_email', 'get_financial_summary', 'get_staff_directory',
    'search_products', 'get_job_pipeline', 'get_schedule',
    'check_inventory_levels', 'get_daily_briefing',
  ],
  PURCHASING: [
    'search_purchase_orders', 'create_purchase_order', 'search_products',
    'get_inventory_status', 'search_vendors', 'draft_email',
    'get_financial_summary', 'get_staff_directory',
    // Full procurement suite
    'check_inventory_levels', 'get_reorder_recommendations', 'get_demand_forecast',
    'get_best_buy_analysis', 'search_suppliers', 'get_po_status',
    'create_procurement_po', 'get_daily_briefing', 'get_supplier_scorecard',
  ],
  WAREHOUSE_LEAD: [
    // Core: orders, products, inventory, schedule, jobs, vendors (they coordinate receiving)
    'search_orders', 'search_products', 'get_inventory_status', 'get_schedule',
    'get_job_pipeline', 'get_staff_directory', 'search_vendors',
    'check_inventory_levels', 'get_daily_briefing',
    // NOTE: NO get_financial_summary — warehouse doesn't have operational_financial:view
  ],
  WAREHOUSE_TECH: [
    // Minimal: pick lists, inventory checks, schedule for today's pulls
    'search_orders', 'search_products', 'get_inventory_status', 'get_schedule',
    'check_inventory_levels', 'get_daily_briefing',
  ],
  DRIVER: [
    // Delivery-focused: their schedule, order lookup for delivery details, staff directory
    'search_orders', 'get_schedule', 'get_staff_directory',
    'get_daily_briefing',
  ],
  INSTALLER: [
    // On-site work: schedule, order details for what they're installing, staff contacts
    'search_orders', 'get_schedule', 'get_staff_directory',
    'get_daily_briefing',
  ],
  QC_INSPECTOR: [
    // Quality: products to inspect, orders for context, schedule, manufacturing visibility
    'search_orders', 'search_products', 'get_schedule', 'get_staff_directory',
    'check_inventory_levels', 'get_daily_briefing',
  ],
  ACCOUNTING: [
    'search_orders', 'search_builders', 'search_invoices', 'search_purchase_orders',
    'get_financial_summary', 'draft_email', 'get_staff_directory',
    'search_vendors', 'get_quotes',
    'check_inventory_levels', 'get_po_status', 'get_daily_briefing',
  ],
  VIEWER: [
    'search_orders', 'search_builders', 'search_products', 'get_job_pipeline',
  ],
}

/**
 * Get the tools available to a given set of roles (union of all role tools).
 */
export function getToolsForRoles(roles: string[]): ClaudeTool[] {
  const allowedNames = new Set<string>()
  for (const role of roles) {
    const tools = ROLE_TOOLS[role] || []
    tools.forEach(t => allowedNames.add(t))
  }
  return Array.from(allowedNames)
    .map(name => TOOL_DEFINITIONS[name])
    .filter(Boolean)
}

// ──────────────────────────────────────────────────────────────────────────
// Tool Executors — run when Claude calls a tool
// ──────────────────────────────────────────────────────────────────────────

export async function executeTool(
  name: string,
  input: Record<string, any>,
  staffRoles: string[],
  canViewFinancials: boolean
): Promise<string> {
  // Security: verify role has access to this tool
  const allowed = new Set<string>()
  for (const role of staffRoles) {
    (ROLE_TOOLS[role] || []).forEach(t => allowed.add(t))
  }
  if (!allowed.has(name)) {
    return JSON.stringify({ error: 'You do not have permission to use this tool.' })
  }

  try {
    switch (name) {
      case 'search_orders': return await toolSearchOrders(input, canViewFinancials)
      case 'search_builders': return await toolSearchBuilders(input)
      case 'search_invoices': return await toolSearchInvoices(input, canViewFinancials)
      case 'search_products': return await toolSearchProducts(input, canViewFinancials)
      case 'search_purchase_orders': return await toolSearchPOs(input, canViewFinancials)
      case 'get_job_pipeline': return await toolJobPipeline(input)
      case 'get_financial_summary': return await toolFinancialSummary(input, canViewFinancials)
      case 'get_schedule': return await toolGetSchedule(input)
      case 'draft_email': return toolDraftEmail(input)
      case 'create_purchase_order': return toolCreatePO(input)
      case 'get_inventory_status': return await toolInventoryStatus(input)
      case 'search_vendors': return await toolSearchVendors(input)
      case 'get_staff_directory': return await toolStaffDirectory(input)
      case 'get_quotes': return await toolGetQuotes(input, canViewFinancials)
      // Procurement tools
      case 'check_inventory_levels': return await toolCheckInventoryLevels(input)
      case 'get_reorder_recommendations': return await toolReorderRecommendations()
      case 'get_demand_forecast': return await toolDemandForecast()
      case 'get_best_buy_analysis': return await toolBestBuyAnalysis(input)
      case 'search_suppliers': return await toolSearchSuppliers(input)
      case 'get_po_status': return await toolGetPOStatus(input, canViewFinancials)
      case 'create_procurement_po': return await toolCreateProcurementPO(input)
      case 'get_daily_briefing': return await toolDailyBriefing(staffRoles)
      case 'get_supplier_scorecard': return await toolSupplierScorecard()
      default: return JSON.stringify({ error: `Unknown tool: ${name}` })
    }
  } catch (err: any) {
    console.error(`Tool execution error (${name}):`, err)
    return JSON.stringify({ error: `Failed to execute ${name}: ${err.message}` })
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Individual Tool Implementations
// ──────────────────────────────────────────────────────────────────────────

async function toolSearchOrders(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  const { query, status, limit = 10 } = input
  let where = 'WHERE 1=1'
  if (status) where += ` AND o."status"::text = '${sqlSafe(status)}'`
  if (query) where += ` AND (o."orderNumber" ILIKE '%${sqlSafe(query)}%' OR b."companyName" ILIKE '%${sqlSafe(query)}%' OR b."contactName" ILIKE '%${sqlSafe(query)}%')`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT o.id, o."orderNumber", o.status, o.total, o."createdAt",
           o."deliveryDate", o."paymentStatus",
           b."companyName" as builder_name, b."contactName" as builder_contact
    FROM "Order" o
    LEFT JOIN "Builder" b ON o."builderId" = b.id
    ${where}
    ORDER BY o."createdAt" DESC
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    orders: rows.map(r => ({
      orderNumber: r.orderNumber,
      status: r.status,
      total: canViewFinancials ? Number(r.total) : '[restricted]',
      builder: r.builder_name,
      contact: r.builder_contact,
      createdAt: r.createdAt,
      deliveryDate: r.deliveryDate,
      paymentStatus: r.paymentStatus,
    })),
  })
}

async function toolSearchBuilders(input: Record<string, any>): Promise<string> {
  const { query, status, limit = 10 } = input
  let where = 'WHERE 1=1'
  if (status) where += ` AND b."status"::text = '${sqlSafe(status)}'`
  if (query) where += ` AND (b."companyName" ILIKE '%${sqlSafe(query)}%' OR b."contactName" ILIKE '%${sqlSafe(query)}%' OR b.email ILIKE '%${sqlSafe(query)}%')`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT b.id, b."companyName", b."contactName", b.email, b.phone,
           b."paymentTerm", b.status, b."creditLimit",
           (SELECT COUNT(*)::int FROM "Order" WHERE "builderId" = b.id) as order_count,
           (SELECT COUNT(*)::int FROM "Quote" WHERE "builderId" = b.id) as quote_count
    FROM "Builder" b
    ${where}
    ORDER BY b."companyName"
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    builders: rows.map(r => ({
      companyName: r.companyName,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      paymentTerm: r.paymentTerm,
      status: r.status,
      orderCount: r.order_count,
      quoteCount: r.quote_count,
    })),
  })
}

async function toolSearchInvoices(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  const { query, status, overdue_only, limit = 10 } = input
  let where = 'WHERE 1=1'
  if (status) where += ` AND i."status"::text = '${sqlSafe(status)}'`
  if (overdue_only) where += ` AND i."status"::text = 'OVERDUE'`
  if (query) where += ` AND (i."invoiceNumber" ILIKE '%${sqlSafe(query)}%' OR b."companyName" ILIKE '%${sqlSafe(query)}%')`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT i.id, i."invoiceNumber", i.status, i.total, i."balanceDue",
           i."dueDate", i."issuedAt",
           b."companyName" as builder_name
    FROM "Invoice" i
    LEFT JOIN "Builder" b ON i."builderId" = b.id
    ${where}
    ORDER BY i."dueDate" ASC
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    invoices: rows.map(r => ({
      invoiceNumber: r.invoiceNumber,
      status: r.status,
      total: canViewFinancials ? Number(r.total) : '[restricted]',
      balanceDue: canViewFinancials ? Number(r.balanceDue) : '[restricted]',
      dueDate: r.dueDate,
      issuedAt: r.issuedAt,
      builder: r.builder_name,
    })),
  })
}

async function toolSearchProducts(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  const { query, category, limit = 10 } = input
  let where = 'WHERE p.active = true'
  if (category) where += ` AND p.category ILIKE '%${sqlSafe(category)}%'`
  if (query) where += ` AND (p.name ILIKE '%${sqlSafe(query)}%' OR p.sku ILIKE '%${sqlSafe(query)}%' OR p.category ILIKE '%${sqlSafe(query)}%')`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT p.id, p.sku, p.name, p.category, p.subcategory,
           p."basePrice", p.cost, p."inStock"
    FROM "Product" p
    ${where}
    ORDER BY p.name
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    products: rows.map(r => ({
      sku: r.sku,
      name: r.name,
      category: r.category,
      subcategory: r.subcategory,
      basePrice: canViewFinancials ? Number(r.basePrice) : '[restricted]',
      cost: canViewFinancials ? Number(r.cost) : '[restricted]',
      inStock: r.inStock,
    })),
  })
}

async function toolSearchPOs(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  const { query, status, limit = 10 } = input
  let where = 'WHERE 1=1'
  if (status) where += ` AND po."status"::text = '${sqlSafe(status)}'`
  if (query) where += ` AND (po."poNumber" ILIKE '%${sqlSafe(query)}%' OR v.name ILIKE '%${sqlSafe(query)}%')`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT po.id, po."poNumber", po.status, po.total,
           po."createdAt", po."expectedDate",
           v.name as vendor_name
    FROM "PurchaseOrder" po
    LEFT JOIN "Vendor" v ON po."vendorId" = v.id
    ${where}
    ORDER BY po."createdAt" DESC
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    purchaseOrders: rows.map(r => ({
      poNumber: r.poNumber,
      status: r.status,
      total: canViewFinancials ? Number(r.total) : '[restricted]',
      vendor: r.vendor_name,
      createdAt: r.createdAt,
      expectedDate: r.expectedDate,
    })),
  })
}

async function toolJobPipeline(input: Record<string, any>): Promise<string> {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT status, COUNT(*)::int as count
    FROM "Job"
    GROUP BY status
    ORDER BY
      CASE status
        WHEN 'CREATED' THEN 1
        WHEN 'READINESS_CHECK' THEN 2
        WHEN 'MATERIALS_LOCKED' THEN 3
        WHEN 'IN_PRODUCTION' THEN 4
        WHEN 'STAGED' THEN 5
        WHEN 'LOADED' THEN 6
        WHEN 'IN_TRANSIT' THEN 7
        WHEN 'DELIVERED' THEN 8
        WHEN 'INSTALLING' THEN 9
        WHEN 'PUNCH_LIST' THEN 10
        WHEN 'COMPLETE' THEN 11
        WHEN 'CANCELLED' THEN 12
        ELSE 99
      END
  `) as any[]

  const total = rows.reduce((s: number, r: any) => s + r.count, 0)
  const active = rows.filter((r: any) => r.status !== 'COMPLETE' && r.status !== 'CANCELLED')
    .reduce((s: number, r: any) => s + r.count, 0)

  return JSON.stringify({
    totalJobs: total,
    activeJobs: active,
    pipeline: rows.map(r => ({ status: r.status, count: r.count })),
  })
}

async function toolFinancialSummary(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  if (!canViewFinancials) {
    return JSON.stringify({ error: 'You do not have permission to view financial data.' })
  }

  const arRows = await prisma.$queryRawUnsafe(`
    SELECT
      SUM(CASE WHEN status = 'OVERDUE'::"InvoiceStatus" THEN "balanceDue" ELSE 0 END) as overdue_ar,
      SUM("balanceDue") as total_ar,
      COUNT(*)::int as invoice_count,
      SUM(CASE WHEN status = 'PAID'::"InvoiceStatus" THEN total ELSE 0 END) as total_collected
    FROM "Invoice"
    WHERE status NOT IN ('VOID'::"InvoiceStatus", 'WRITE_OFF'::"InvoiceStatus")
  `) as any[]

  const orderRows = await prisma.$queryRawUnsafe(`
    SELECT
      COUNT(*)::int as total_orders,
      SUM(total) as total_revenue
    FROM "Order"
    WHERE status != 'CANCELLED'::"OrderStatus"
  `) as any[]

  const poRows = await prisma.$queryRawUnsafe(`
    SELECT SUM(total) as total_po_value, COUNT(*)::int as po_count
    FROM "PurchaseOrder"
    WHERE status NOT IN ('CANCELLED'::"POStatus")
  `) as any[]

  const ar = arRows[0] || {}
  const orders = orderRows[0] || {}
  const pos = poRows[0] || {}

  return JSON.stringify({
    accountsReceivable: {
      totalAR: Number(ar.total_ar || 0),
      overdueAR: Number(ar.overdue_ar || 0),
      invoiceCount: ar.invoice_count || 0,
      totalCollected: Number(ar.total_collected || 0),
    },
    orders: {
      totalOrders: orders.total_orders || 0,
      totalRevenue: Number(orders.total_revenue || 0),
    },
    purchasing: {
      totalPOValue: Number(pos.total_po_value || 0),
      poCount: pos.po_count || 0,
    },
  })
}

async function toolGetSchedule(input: Record<string, any>): Promise<string> {
  const days = input.days || 7
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + days)

  let typeFilter = ''
  if (input.type) typeFilter = `AND se."entryType"::text = '${sqlSafe(input.type)}'`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT se.id, se.title, se."entryType", se."scheduledDate", se.status,
           j."jobNumber", j."builderName",
           c.name as crew_name
    FROM "ScheduleEntry" se
    LEFT JOIN "Job" j ON se."jobId" = j.id
    LEFT JOIN "Crew" c ON se."crewId" = c.id
    WHERE se."scheduledDate" >= NOW()
      AND se."scheduledDate" <= '${futureDate.toISOString()}'
      ${typeFilter}
    ORDER BY se."scheduledDate" ASC
    LIMIT 20
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    period: `Next ${days} days`,
    entries: rows.map(r => ({
      title: r.title,
      type: r.entryType,
      date: r.scheduledDate,
      status: r.status,
      job: r.jobNumber,
      builder: r.builderName,
      crew: r.crew_name || 'Unassigned',
    })),
  })
}

function toolDraftEmail(input: Record<string, any>): string {
  // This tool returns a structure for the AI to compose from.
  // Claude will use this info + its own composition to draft the actual email.
  return JSON.stringify({
    instruction: 'Please compose the email based on the provided details.',
    details: {
      to_name: input.to_name || '[Recipient]',
      to_email: input.to_email || '[email]',
      subject: input.subject || '[Subject]',
      purpose: input.purpose,
      tone: input.tone || 'professional',
      company: 'Abel Lumber',
      signature: 'Best regards,\nAbel Lumber Team',
    },
  })
}

function toolCreatePO(input: Record<string, any>): string {
  // Returns PO draft details for review — does NOT persist to DB
  // The user must approve before we'd actually create it
  const items = input.items || []
  const total = items.reduce((s: number, item: any) => {
    return s + (item.quantity * (item.unit_cost || 0))
  }, 0)

  return JSON.stringify({
    status: 'DRAFT_PREVIEW',
    message: 'Here is the draft PO for your review. Say "approve" to create it in the system.',
    purchaseOrder: {
      vendor: input.vendor_name,
      items: items.map((item: any, idx: number) => ({
        line: idx + 1,
        product: item.product_name,
        quantity: item.quantity,
        unitCost: item.unit_cost || 'TBD',
        lineTotal: item.unit_cost ? item.quantity * item.unit_cost : 'TBD',
      })),
      estimatedTotal: total > 0 ? total : 'Pending pricing',
      notes: input.notes || '',
    },
  })
}

async function toolInventoryStatus(input: Record<string, any>): Promise<string> {
  const { product_query, low_stock_only, limit = 20 } = input
  let where = 'WHERE p.active = true'
  if (product_query) {
    const q = sqlSafe(product_query)
    where += ` AND (p.name ILIKE '%${q}%' OR p.sku ILIKE '%${q}%' OR p.category ILIKE '%${q}%')`
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT p.sku, p.name, p.category, p."inStock"
    FROM "Product" p
    ${where}
    ORDER BY p.name
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    products: rows.map(r => ({
      sku: r.sku,
      name: r.name,
      category: r.category,
      inStock: r.inStock,
    })),
  })
}

async function toolSearchVendors(input: Record<string, any>): Promise<string> {
  const { query, limit = 10 } = input
  let where = 'WHERE v.active = true'
  if (query) {
    const q = sqlSafe(query)
    where += ` AND (v.name ILIKE '%${q}%' OR v."contactName" ILIKE '%${q}%')`
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT v.id, v.name, v."contactName", v.email, v.phone,
           v.code, v."accountNumber",
           (SELECT COUNT(*)::int FROM "PurchaseOrder" WHERE "vendorId" = v.id) as po_count
    FROM "Vendor" v
    ${where}
    ORDER BY v.name
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    vendors: rows.map(r => ({
      name: r.name,
      code: r.code,
      contactName: r.contactName,
      email: r.email,
      phone: r.phone,
      accountNumber: r.accountNumber,
      poCount: r.po_count,
    })),
  })
}

async function toolStaffDirectory(input: Record<string, any>): Promise<string> {
  const { query, department } = input
  let where = 'WHERE s.active = true'
  if (department) where += ` AND s.department::text = '${sqlSafe(department)}'`
  if (query) {
    const q = sqlSafe(query)
    where += ` AND (s."firstName" ILIKE '%${q}%' OR s."lastName" ILIKE '%${q}%' OR s.role::text ILIKE '%${q}%' OR s.department::text ILIKE '%${q}%')`
  }

  const rows = await prisma.$queryRawUnsafe(`
    SELECT s.id, s."firstName", s."lastName", s.email, s.phone,
           s.role, s.department, s.title
    FROM "Staff" s
    ${where}
    ORDER BY s."lastName", s."firstName"
    LIMIT 20
  `) as any[]

  // NOTE: We never expose salary or compensation data
  return JSON.stringify({
    count: rows.length,
    staff: rows.map(r => ({
      name: `${r.firstName} ${r.lastName}`,
      email: r.email,
      phone: r.phone,
      role: r.role,
      department: r.department,
      title: r.title,
    })),
  })
}

async function toolGetQuotes(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  const { query, status, limit = 10 } = input
  let where = 'WHERE 1=1'
  if (status) where += ` AND q."status"::text = '${sqlSafe(status)}'`
  if (query) where += ` AND (q."quoteNumber" ILIKE '%${sqlSafe(query)}%')`

  const rows = await prisma.$queryRawUnsafe(`
    SELECT q.id, q."quoteNumber", q.status, q.total,
           q."createdAt", q."validUntil"
    FROM "Quote" q
    ${where}
    ORDER BY q."createdAt" DESC
    LIMIT ${Number(limit)}
  `) as any[]

  return JSON.stringify({
    count: rows.length,
    quotes: rows.map(r => ({
      quoteNumber: r.quoteNumber,
      status: r.status,
      total: canViewFinancials ? Number(r.total) : '[restricted]',
      createdAt: r.createdAt,
      validUntil: r.validUntil,
    })),
  })
}

// ──────────────────────────────────────────────────────────────────────────
// Procurement Intelligence Tool Implementations
// ──────────────────────────────────────────────────────────────────────────

async function toolCheckInventoryLevels(input: Record<string, any>): Promise<string> {
  try {
    const { category, status, search } = input
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (category) { conditions.push(`i."category" = $${idx}`); params.push(category); idx++ }
    if (search) { conditions.push(`(i."productName" ILIKE $${idx} OR i."sku" ILIKE $${idx})`); params.push(`%${search}%`); idx++ }
    if (status === 'LOW_STOCK') conditions.push(`i."quantityOnHand" <= i."reorderPoint" AND i."quantityOnHand" > 0`)
    if (status === 'OUT_OF_STOCK') conditions.push(`i."quantityOnHand" = 0`)
    if (status === 'CRITICAL') conditions.push(`i."quantityOnHand" <= i."safetyStock" AND i."quantityOnHand" > 0`)

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await prisma.$queryRawUnsafe(`
      SELECT i."productName", i."sku", i."category", i."quantityOnHand",
             i."quantityOnOrder", i."reorderPoint", i."safetyStock",
             i."daysOfSupply", i."avgDailyUsage", i."unitCost",
             CASE
               WHEN i."quantityOnHand" = 0 THEN 'OUT_OF_STOCK'
               WHEN i."quantityOnHand" <= i."safetyStock" THEN 'CRITICAL'
               WHEN i."quantityOnHand" <= i."reorderPoint" THEN 'LOW_STOCK'
               ELSE 'IN_STOCK'
             END as "stockStatus"
      FROM "InventoryItem" i
      ${where}
      ORDER BY i."daysOfSupply" ASC
      LIMIT 30
    `, ...params) as any[]

    const stats = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "total",
        COUNT(*) FILTER (WHERE "quantityOnHand" = 0)::int as "outOfStock",
        COUNT(*) FILTER (WHERE "quantityOnHand" <= "safetyStock" AND "quantityOnHand" > 0)::int as "critical",
        COUNT(*) FILTER (WHERE "quantityOnHand" <= "reorderPoint" AND "quantityOnHand" > 0)::int as "lowStock"
      FROM "InventoryItem"
    `) as any[]

    return JSON.stringify({
      summary: stats[0],
      items: rows.map((r: any) => ({
        product: r.productName,
        sku: r.sku,
        category: r.category,
        onHand: r.quantityOnHand,
        onOrder: r.quantityOnOrder || 0,
        reorderPoint: r.reorderPoint,
        safetyStock: r.safetyStock,
        daysOfSupply: Number(r.daysOfSupply || 0),
        avgDailyUsage: Number(r.avgDailyUsage || 0),
        status: r.stockStatus,
        value: Number(r.unitCost || 0) * (r.quantityOnHand || 0),
      })),
    })
  } catch {
    return JSON.stringify({ error: 'Inventory system not set up yet. Visit Procurement Intelligence to initialize.' })
  }
}

async function toolReorderRecommendations(): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'}/api/ops/procurement/ai-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-id': 'ai-tool', 'x-staff-role': 'ADMIN' },
      body: JSON.stringify({ action: 'reorder_recommendations' }),
    })
    if (res.ok) {
      const data = await res.json()
      return JSON.stringify(data)
    }
    // Fallback: direct query
    const items = await prisma.$queryRawUnsafe(`
      SELECT i."productName", i."sku", i."category", i."quantityOnHand",
             i."reorderPoint", i."reorderQty", i."daysOfSupply"
      FROM "InventoryItem" i
      WHERE i."quantityOnHand" <= i."reorderPoint"
      ORDER BY i."daysOfSupply" ASC
      LIMIT 20
    `) as any[]

    return JSON.stringify({
      needsReorder: items.length,
      items: items.map((i: any) => ({
        product: i.productName,
        sku: i.sku,
        onHand: i.quantityOnHand,
        reorderPoint: i.reorderPoint,
        suggestedQty: i.reorderQty,
        daysOfSupply: Number(i.daysOfSupply || 0),
        urgency: i.quantityOnHand === 0 ? 'CRITICAL' : Number(i.daysOfSupply || 0) < 7 ? 'URGENT' : 'NORMAL',
      })),
    })
  } catch {
    return JSON.stringify({ error: 'Procurement system not initialized. Visit Procurement Intelligence page first.' })
  }
}

async function toolDemandForecast(): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'}/api/ops/procurement/ai-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-id': 'ai-tool', 'x-staff-role': 'ADMIN' },
      body: JSON.stringify({ action: 'demand_forecast' }),
    })
    if (res.ok) return JSON.stringify(await res.json())
    return JSON.stringify({ error: 'Failed to generate demand forecast' })
  } catch {
    return JSON.stringify({ error: 'Procurement system not initialized.' })
  }
}

async function toolBestBuyAnalysis(input: Record<string, any>): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'}/api/ops/procurement/ai-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-id': 'ai-tool', 'x-staff-role': 'ADMIN' },
      body: JSON.stringify({ action: 'best_buy_analysis' }),
    })
    if (res.ok) {
      const data = await res.json()
      if (input.category) {
        data.categories = data.categories?.filter((c: any) =>
          c.category?.toLowerCase().includes(input.category.toLowerCase())
        )
      }
      return JSON.stringify(data)
    }
    return JSON.stringify({ error: 'Failed to run best buy analysis' })
  } catch {
    return JSON.stringify({ error: 'Procurement system not initialized.' })
  }
}

async function toolSearchSuppliers(input: Record<string, any>): Promise<string> {
  try {
    const { query, type, category } = input
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    conditions.push(`s."status" = 'ACTIVE'`)
    if (type) { conditions.push(`s."type" = $${idx}`); params.push(type); idx++ }
    if (category) { conditions.push(`$${idx} = ANY(s."categories")`); params.push(category); idx++ }
    if (query) { conditions.push(`(s."name" ILIKE $${idx} OR s."code" ILIKE $${idx})`); params.push(`%${query}%`); idx++ }

    const where = `WHERE ${conditions.join(' AND ')}`

    const rows = await prisma.$queryRawUnsafe(`
      SELECT s."id", s."name", s."code", s."type", s."country",
             s."contactName", s."contactEmail", s."avgLeadTimeDays",
             s."dutyRate", s."freightCostPct", s."paymentTerms", s."categories",
             (SELECT COUNT(*)::int FROM "SupplierProduct" sp WHERE sp."supplierId" = s."id" AND sp."active" = true) as "productCount",
             (SELECT COALESCE(SUM(po."totalCost"), 0) FROM "PurchaseOrder" po
              WHERE po."supplierId" = s."id" AND po."status" != 'CANCELLED'
              AND po."createdAt" > NOW() - INTERVAL '12 months') as "spend12mo"
      FROM "Supplier" s
      ${where}
      ORDER BY s."name"
      LIMIT 20
    `, ...params) as any[]

    return JSON.stringify({
      count: rows.length,
      suppliers: rows.map((r: any) => ({
        id: r.id,
        name: r.name,
        code: r.code,
        type: r.type,
        country: r.country,
        contact: r.contactName,
        email: r.contactEmail,
        leadTimeDays: r.avgLeadTimeDays,
        dutyRate: Number(r.dutyRate || 0),
        freightPct: Number(r.freightCostPct || 0),
        paymentTerms: r.paymentTerms,
        categories: r.categories || [],
        productCount: r.productCount,
        spend12mo: Number(r.spend12mo || 0),
      })),
    })
  } catch {
    return JSON.stringify({ error: 'Supplier database not initialized. Visit Procurement Intelligence page first.' })
  }
}

async function toolGetPOStatus(input: Record<string, any>, canViewFinancials: boolean): Promise<string> {
  try {
    const { po_number, status, supplier } = input
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (po_number) { conditions.push(`po."poNumber" ILIKE $${idx}`); params.push(`%${po_number}%`); idx++ }
    if (status) { conditions.push(`po."status" = $${idx}`); params.push(status); idx++ }
    if (supplier) { conditions.push(`s."name" ILIKE $${idx}`); params.push(`%${supplier}%`); idx++ }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await prisma.$queryRawUnsafe(`
      SELECT po.*, s."name" as "supplierName", s."type" as "supplierType",
             (SELECT COUNT(*)::int FROM "PurchaseOrderItem" poi WHERE poi."poId" = po."id") as "itemCount",
             (SELECT COALESCE(SUM(poi."quantityReceived"), 0)::int FROM "PurchaseOrderItem" poi WHERE poi."poId" = po."id") as "totalReceived",
             (SELECT COALESCE(SUM(poi."quantity"), 0)::int FROM "PurchaseOrderItem" poi WHERE poi."poId" = po."id") as "totalOrdered"
      FROM "PurchaseOrder" po
      JOIN "Supplier" s ON po."supplierId" = s."id"
      ${where}
      ORDER BY po."createdAt" DESC
      LIMIT 15
    `, ...params) as any[]

    return JSON.stringify({
      count: rows.length,
      purchaseOrders: rows.map((r: any) => ({
        poNumber: r.poNumber,
        status: r.status,
        supplier: r.supplierName,
        supplierType: r.supplierType,
        subtotal: canViewFinancials ? Number(r.subtotal || 0) : '[restricted]',
        dutyCost: canViewFinancials ? Number(r.dutyCost || 0) : '[restricted]',
        shippingCost: canViewFinancials ? Number(r.shippingCost || 0) : '[restricted]',
        totalCost: canViewFinancials ? Number(r.totalCost || 0) : '[restricted]',
        itemCount: r.itemCount,
        received: `${r.totalReceived}/${r.totalOrdered}`,
        expectedDate: r.expectedDate,
        priority: r.priority,
        aiGenerated: r.aiGenerated,
        createdAt: r.createdAt,
      })),
    })
  } catch {
    return JSON.stringify({ error: 'PO system not initialized.' })
  }
}

async function toolCreateProcurementPO(input: Record<string, any>): Promise<string> {
  try {
    const { supplier_id, items, priority, notes } = input

    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'}/api/ops/procurement/purchase-orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-id': 'ai-assistant', 'x-staff-role': 'ADMIN' },
      body: JSON.stringify({
        supplierId: supplier_id,
        items,
        priority: priority || 'NORMAL',
        notes: notes || 'Created via AI Assistant',
        aiGenerated: true,
        aiReason: 'Generated by AI procurement assistant',
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return JSON.stringify({
        success: true,
        message: `PO ${data.poNumber} created as DRAFT. It needs to be approved before sending to the supplier.`,
        poNumber: data.poNumber,
        purchaseOrder: data.purchaseOrder,
      })
    }
    const err = await res.json()
    return JSON.stringify({ error: err.error || 'Failed to create PO' })
  } catch {
    return JSON.stringify({ error: 'Failed to create PO. Ensure procurement system is initialized.' })
  }
}

async function toolDailyBriefing(staffRoles: string[]): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'}/api/ops/ai/daily-briefing`, {
      headers: { 'x-staff-id': 'ai-tool', 'x-staff-role': staffRoles.join(',') },
    })
    if (res.ok) return JSON.stringify(await res.json())
    return JSON.stringify({ error: 'Failed to generate daily briefing' })
  } catch {
    return JSON.stringify({ error: 'Daily briefing service unavailable' })
  }
}

async function toolSupplierScorecard(): Promise<string> {
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://app.abellumber.com'}/api/ops/procurement/ai-assistant`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-staff-id': 'ai-tool', 'x-staff-role': 'ADMIN' },
      body: JSON.stringify({ action: 'supplier_scorecard' }),
    })
    if (res.ok) return JSON.stringify(await res.json())
    return JSON.stringify({ error: 'Failed to generate supplier scorecards' })
  } catch {
    return JSON.stringify({ error: 'Procurement system not initialized.' })
  }
}
