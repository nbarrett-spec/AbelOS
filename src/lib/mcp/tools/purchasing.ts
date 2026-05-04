/**
 * MCP tools — Purchasing domain (Vendors + Purchase Orders).
 *
 * Read-only tools:
 *   • search_purchase_orders
 *   • get_purchase_order
 *   • search_vendors
 *   • get_vendor
 *
 * Write tools (audit-logged with staffId='mcp-service'):
 *   • create_purchase_order   — DRAFT, generates PO-YYYY-NNNN
 *   • approve_purchase_order  — DRAFT|PENDING_APPROVAL → APPROVED
 *   • receive_purchase_order  — bumps receivedQty per item, flips status
 *
 * Schema notes (matches prisma/schema.prisma at line 1621+):
 *  • Vendor has `code` (unique), `creditHold`, `creditLimit/creditUsed`,
 *    `avgLeadDays`, `onTimeRate`, `paymentTermDays`.
 *  • PurchaseOrder enums: POStatus { DRAFT, PENDING_APPROVAL, APPROVED,
 *    SENT_TO_VENDOR, PARTIALLY_RECEIVED, RECEIVED, CANCELLED } and
 *    POCategory { EXTERIOR, TRIM_1, TRIM_1_LABOR, TRIM_2, TRIM_2_LABOR,
 *    FINAL_FRONT, PUNCH, GENERAL }.
 *  • PurchaseOrderItem stores received qty as `receivedQty` (NOT
 *    quantityReceived). Also has `lineTotal` and `damagedQty`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { withMcpAudit } from '../wrap'

const PO_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'APPROVED',
  'SENT_TO_VENDOR',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const

const PO_CATEGORIES = [
  'EXTERIOR',
  'TRIM_1',
  'TRIM_1_LABOR',
  'TRIM_2',
  'TRIM_2_LABOR',
  'FINAL_FRONT',
  'PUNCH',
  'GENERAL',
] as const

export function registerPurchasingTools(server: McpServer) {
  // ──────────────────────────────────────────────────────────────────
  // search_purchase_orders  (READ)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'search_purchase_orders',
    {
      description:
        'Search and filter purchase orders. Returns PO number, vendor name, status, category, totals, and dates. Use for "show me Boise POs", "what POs are pending approval", "PARTIALLY_RECEIVED orders this week".',
      inputSchema: {
        q: z
          .string()
          .optional()
          .describe('Search text (matches PO number or vendor name)'),
        status: z.enum(PO_STATUSES).optional().describe('Filter by exact PO status'),
        vendorId: z.string().optional().describe('Filter to a specific vendor by ID'),
        category: z.enum(PO_CATEGORIES).optional().describe('Filter by PO category'),
        dateFrom: z.string().optional().describe('ISO date — POs ordered/created on or after'),
        dateTo: z.string().optional().describe('ISO date — POs ordered/created on or before'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit(
      'search_purchase_orders',
      'READ',
      async (args: {
        q?: string
        status?: (typeof PO_STATUSES)[number]
        vendorId?: string
        category?: (typeof PO_CATEGORIES)[number]
        dateFrom?: string
        dateTo?: string
        page?: number
        limit?: number
      }) => {
        const { q, status, vendorId, category, dateFrom, dateTo, page = 1, limit = 20 } = args
        const where: any = {}
        if (q) {
          where.OR = [
            { poNumber: { contains: q, mode: 'insensitive' } },
            { vendor: { name: { contains: q, mode: 'insensitive' } } },
          ]
        }
        if (status) where.status = status
        if (vendorId) where.vendorId = vendorId
        if (category) where.category = category
        if (dateFrom || dateTo) {
          where.createdAt = {}
          if (dateFrom) where.createdAt.gte = new Date(dateFrom)
          if (dateTo) where.createdAt.lte = new Date(dateTo)
        }

        const [pos, total] = await Promise.all([
          prisma.purchaseOrder.findMany({
            where,
            select: {
              id: true,
              poNumber: true,
              status: true,
              category: true,
              subtotal: true,
              shippingCost: true,
              total: true,
              orderedAt: true,
              expectedDate: true,
              receivedAt: true,
              paidAt: true,
              vendorConfirmedAt: true,
              createdAt: true,
              vendor: { select: { id: true, name: true, code: true } },
            },
            orderBy: { createdAt: 'desc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.purchaseOrder.count({ where }),
        ])

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ purchaseOrders: pos, total, page, pageSize: limit }, null, 2),
            },
          ],
        }
      },
    ),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_purchase_order  (READ)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_purchase_order',
    {
      description:
        'Get full PO detail with line items and vendor info. Use after search_purchase_orders to drill into a specific PO.',
      inputSchema: {
        poId: z.string().describe('Purchase order ID (cuid format)'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit('get_purchase_order', 'READ', async ({ poId }: { poId: string }) => {
      const po = await prisma.purchaseOrder.findUnique({
        where: { id: poId },
        include: {
          vendor: {
            select: {
              id: true,
              name: true,
              code: true,
              email: true,
              phone: true,
              contactName: true,
              paymentTerms: true,
              paymentTermDays: true,
              creditHold: true,
            },
          },
          items: true,
        },
      })

      if (!po) {
        return {
          content: [
            { type: 'text' as const, text: JSON.stringify({ error: 'Purchase order not found', poId }) },
          ],
          isError: true,
        }
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(po, null, 2) }],
      }
    }),
  )

  // ──────────────────────────────────────────────────────────────────
  // create_purchase_order  (WRITE)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'create_purchase_order',
    {
      description:
        'Create a new DRAFT purchase order. Generates PO number as PO-YYYY-NNNN (count of POs this calendar year + 1). Calculates subtotal/total from items. createdBy=mcp-service.',
      inputSchema: {
        vendorId: z.string().describe('Vendor ID this PO is to'),
        items: z
          .array(
            z.object({
              productId: z.string().optional().describe('Abel product ID if applicable'),
              vendorSku: z.string().describe("Vendor's SKU for this line"),
              description: z.string().describe('Line description'),
              quantity: z.number().int().min(1).describe('Units ordered'),
              unitCost: z.number().min(0).describe('Per-unit cost from vendor'),
            }),
          )
          .min(1)
          .describe('Line items on this PO (at least one)'),
        category: z.enum(PO_CATEGORIES).default('GENERAL').describe('PO category'),
        notes: z.string().optional().describe('Internal notes for this PO'),
        expectedDate: z
          .string()
          .optional()
          .describe('ISO date — expected delivery from vendor'),
        shippingCost: z
          .number()
          .min(0)
          .optional()
          .describe('Shipping cost to add to total (defaults to 0)'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit(
      'create_purchase_order',
      'WRITE',
      async (args: {
        vendorId: string
        items: Array<{
          productId?: string
          vendorSku: string
          description: string
          quantity: number
          unitCost: number
        }>
        category?: (typeof PO_CATEGORIES)[number]
        notes?: string
        expectedDate?: string
        shippingCost?: number
      }) => {
        const {
          vendorId,
          items,
          category = 'GENERAL',
          notes,
          expectedDate,
          shippingCost = 0,
        } = args

        // Verify vendor exists
        const vendor = await prisma.vendor.findUnique({
          where: { id: vendorId },
          select: { id: true, name: true, creditHold: true, active: true },
        })
        if (!vendor) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: 'Vendor not found', vendorId }) },
            ],
            isError: true,
          }
        }
        if (vendor.creditHold) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: 'Vendor is on credit hold — cannot create new PO',
                  vendorId,
                  vendorName: vendor.name,
                }),
              },
            ],
            isError: true,
          }
        }

        // Generate PO number: PO-YYYY-NNNN
        const year = new Date().getFullYear()
        const yearStart = new Date(year, 0, 1)
        const yearEnd = new Date(year + 1, 0, 1)
        const countThisYear = await prisma.purchaseOrder.count({
          where: { createdAt: { gte: yearStart, lt: yearEnd } },
        })
        const seq = String(countThisYear + 1).padStart(4, '0')
        const poNumber = `PO-${year}-${seq}`

        // Calculate subtotal/total
        const itemRows = items.map((it) => ({
          productId: it.productId ?? null,
          vendorSku: it.vendorSku,
          description: it.description,
          quantity: it.quantity,
          unitCost: it.unitCost,
          lineTotal: it.quantity * it.unitCost,
        }))
        const subtotal = itemRows.reduce((acc, it) => acc + it.lineTotal, 0)
        const total = subtotal + shippingCost

        const created = await prisma.purchaseOrder.create({
          data: {
            poNumber,
            vendorId,
            createdById: 'mcp-service',
            status: 'DRAFT',
            category,
            subtotal,
            shippingCost,
            total,
            notes: notes ?? null,
            expectedDate: expectedDate ? new Date(expectedDate) : null,
            items: {
              create: itemRows,
            },
          },
          include: {
            vendor: { select: { id: true, name: true, code: true } },
            items: true,
          },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  purchaseOrder: created,
                  message: `Created ${poNumber} for ${vendor.name} — ${itemRows.length} line(s), $${total.toFixed(2)} total`,
                },
                null,
                2,
              ),
            },
          ],
        }
      },
    ),
  )

  // ──────────────────────────────────────────────────────────────────
  // approve_purchase_order  (WRITE)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'approve_purchase_order',
    {
      description:
        'Approve a DRAFT or PENDING_APPROVAL PO. Sets status=APPROVED, approvedBy=mcp-service, orderedAt=now. Errors if PO is in any other status.',
      inputSchema: {
        poId: z.string().describe('Purchase order ID to approve'),
        approverNotes: z
          .string()
          .optional()
          .describe('Optional notes appended to PO notes on approval'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit(
      'approve_purchase_order',
      'WRITE',
      async (args: { poId: string; approverNotes?: string }) => {
        const { poId, approverNotes } = args
        const po = await prisma.purchaseOrder.findUnique({
          where: { id: poId },
          select: { id: true, poNumber: true, status: true, notes: true },
        })

        if (!po) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: 'Purchase order not found', poId }) },
            ],
            isError: true,
          }
        }

        if (po.status !== 'DRAFT' && po.status !== 'PENDING_APPROVAL') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Cannot approve PO in status ${po.status}. Only DRAFT or PENDING_APPROVAL POs can be approved.`,
                  poId,
                  poNumber: po.poNumber,
                  currentStatus: po.status,
                }),
              },
            ],
            isError: true,
          }
        }

        const mergedNotes = approverNotes
          ? `${po.notes ? po.notes + '\n' : ''}[APPROVED via MCP] ${approverNotes}`
          : po.notes

        const updated = await prisma.purchaseOrder.update({
          where: { id: poId },
          data: {
            status: 'APPROVED',
            approvedById: 'mcp-service',
            orderedAt: new Date(),
            notes: mergedNotes,
          },
          include: {
            vendor: { select: { id: true, name: true, code: true } },
          },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  purchaseOrder: updated,
                  message: `Approved ${updated.poNumber} (was ${po.status} → APPROVED)`,
                },
                null,
                2,
              ),
            },
          ],
        }
      },
    ),
  )

  // ──────────────────────────────────────────────────────────────────
  // receive_purchase_order  (WRITE)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'receive_purchase_order',
    {
      description:
        'Mark items as received on a PO. Updates each PurchaseOrderItem.receivedQty. If every line is fully received, sets PO status=RECEIVED + receivedAt=now. Otherwise sets status=PARTIALLY_RECEIVED.',
      inputSchema: {
        poId: z.string().describe('Purchase order ID'),
        receivedItems: z
          .array(
            z.object({
              itemId: z.string().describe('PurchaseOrderItem ID'),
              quantityReceived: z
                .number()
                .int()
                .min(0)
                .describe('Total received qty on this line (NOT delta — overwrites receivedQty)'),
              notes: z.string().optional().describe('Optional notes on this line'),
            }),
          )
          .min(1)
          .describe('One entry per line being received'),
      },
      annotations: { destructiveHint: true },
    },
    withMcpAudit(
      'receive_purchase_order',
      'WRITE',
      async (args: {
        poId: string
        receivedItems: Array<{ itemId: string; quantityReceived: number; notes?: string }>
      }) => {
        const { poId, receivedItems } = args

        const po = await prisma.purchaseOrder.findUnique({
          where: { id: poId },
          include: { items: true },
        })

        if (!po) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: 'Purchase order not found', poId }) },
            ],
            isError: true,
          }
        }

        if (po.status === 'CANCELLED' || po.status === 'DRAFT') {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify({
                  error: `Cannot receive on PO in status ${po.status}`,
                  poId,
                  poNumber: po.poNumber,
                }),
              },
            ],
            isError: true,
          }
        }

        // Validate every itemId belongs to this PO
        const itemMap = new Map(po.items.map((i) => [i.id, i]))
        for (const r of receivedItems) {
          const it = itemMap.get(r.itemId)
          if (!it) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: `Item ${r.itemId} does not belong to PO ${po.poNumber}`,
                    poId,
                    itemId: r.itemId,
                  }),
                },
              ],
              isError: true,
            }
          }
          if (r.quantityReceived > it.quantity) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: JSON.stringify({
                    error: `Cannot receive ${r.quantityReceived} of itemId ${r.itemId} — only ${it.quantity} were ordered`,
                    poId,
                    itemId: r.itemId,
                    ordered: it.quantity,
                    attemptedReceive: r.quantityReceived,
                  }),
                },
              ],
              isError: true,
            }
          }
        }

        // Update receivedQty per item
        await prisma.$transaction(
          receivedItems.map((r) =>
            prisma.purchaseOrderItem.update({
              where: { id: r.itemId },
              data: { receivedQty: r.quantityReceived },
            }),
          ),
        )

        // Re-read items to determine new PO status
        const refreshed = await prisma.purchaseOrderItem.findMany({
          where: { purchaseOrderId: poId },
          select: { id: true, quantity: true, receivedQty: true },
        })

        const allFull = refreshed.every((it) => it.receivedQty >= it.quantity)
        const anyReceived = refreshed.some((it) => it.receivedQty > 0)

        const newStatus: 'RECEIVED' | 'PARTIALLY_RECEIVED' | (typeof po.status) = allFull
          ? 'RECEIVED'
          : anyReceived
            ? 'PARTIALLY_RECEIVED'
            : po.status

        const mergedNotes = receivedItems
          .filter((r) => r.notes)
          .map(
            (r) =>
              `[RCV ${new Date().toISOString().slice(0, 10)} item=${r.itemId} qty=${r.quantityReceived}] ${r.notes}`,
          )
          .join('\n')

        const updated = await prisma.purchaseOrder.update({
          where: { id: poId },
          data: {
            status: newStatus,
            receivedAt: allFull ? new Date() : po.receivedAt,
            notes: mergedNotes
              ? `${po.notes ? po.notes + '\n' : ''}${mergedNotes}`
              : po.notes,
          },
          include: {
            vendor: { select: { id: true, name: true, code: true } },
            items: true,
          },
        })

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  ok: true,
                  purchaseOrder: updated,
                  previousStatus: po.status,
                  newStatus,
                  message: `Updated ${updated.poNumber}: ${receivedItems.length} line(s) received → ${newStatus}`,
                },
                null,
                2,
              ),
            },
          ],
        }
      },
    ),
  )

  // ──────────────────────────────────────────────────────────────────
  // search_vendors  (READ)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'search_vendors',
    {
      description:
        'Search vendors by name/code/email. Returns active by default. Use for "find Boise", "list vendors on credit hold", "what vendors do we use for trim".',
      inputSchema: {
        search: z
          .string()
          .optional()
          .describe('Free text — matches name, code, email, or contactName'),
        status: z
          .enum(['active', 'inactive', 'all'])
          .default('active')
          .describe('Active filter (default: active only)'),
        creditHold: z
          .boolean()
          .optional()
          .describe('If set, filter to vendors with creditHold matching this value'),
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(200).default(20),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit(
      'search_vendors',
      'READ',
      async (args: {
        search?: string
        status?: 'active' | 'inactive' | 'all'
        creditHold?: boolean
        page?: number
        limit?: number
      }) => {
        const { search, status = 'active', creditHold, page = 1, limit = 20 } = args
        const where: any = {}

        if (status === 'active') where.active = true
        else if (status === 'inactive') where.active = false
        // 'all' → no filter

        if (typeof creditHold === 'boolean') where.creditHold = creditHold

        if (search) {
          where.OR = [
            { name: { contains: search, mode: 'insensitive' } },
            { code: { contains: search, mode: 'insensitive' } },
            { email: { contains: search, mode: 'insensitive' } },
            { contactName: { contains: search, mode: 'insensitive' } },
          ]
        }

        const [vendors, total] = await Promise.all([
          prisma.vendor.findMany({
            where,
            select: {
              id: true,
              name: true,
              code: true,
              contactName: true,
              email: true,
              phone: true,
              active: true,
              paymentTerms: true,
              paymentTermDays: true,
              creditLimit: true,
              creditUsed: true,
              creditHold: true,
              avgLeadDays: true,
              onTimeRate: true,
              riskScore: true,
            },
            orderBy: { name: 'asc' },
            skip: (page - 1) * limit,
            take: limit,
          }),
          prisma.vendor.count({ where }),
        ])

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ vendors, total, page, pageSize: limit }, null, 2),
            },
          ],
        }
      },
    ),
  )

  // ──────────────────────────────────────────────────────────────────
  // get_vendor  (READ)
  // ──────────────────────────────────────────────────────────────────
  server.registerTool(
    'get_vendor',
    {
      description:
        'Get full vendor record + recent POs (last 10). With includePerformance=true, also computes 12-month spend and credit utilization. Use for vendor detail pages, scorecard reviews.',
      inputSchema: {
        vendorId: z.string().describe('Vendor ID'),
        includePerformance: z
          .boolean()
          .default(false)
          .describe('If true, include 12-month spend total and credit utilization'),
      },
      annotations: { readOnlyHint: true },
    },
    withMcpAudit(
      'get_vendor',
      'READ',
      async (args: { vendorId: string; includePerformance?: boolean }) => {
        const { vendorId, includePerformance = false } = args

        const vendor = await prisma.vendor.findUnique({
          where: { id: vendorId },
        })

        if (!vendor) {
          return {
            content: [
              { type: 'text' as const, text: JSON.stringify({ error: 'Vendor not found', vendorId }) },
            ],
            isError: true,
          }
        }

        const recentPOs = await prisma.purchaseOrder.findMany({
          where: { vendorId },
          select: {
            id: true,
            poNumber: true,
            status: true,
            category: true,
            subtotal: true,
            total: true,
            orderedAt: true,
            expectedDate: true,
            receivedAt: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        })

        let performance:
          | {
              avgLeadDays: number | null
              onTimeRate: number | null
              riskScore: number | null
              totalSpend12mo: number
              totalSpend12moPoCount: number
              creditUtilization: number | null
            }
          | undefined = undefined

        if (includePerformance) {
          const twelveMoAgo = new Date()
          twelveMoAgo.setFullYear(twelveMoAgo.getFullYear() - 1)
          const recent12 = await prisma.purchaseOrder.findMany({
            where: {
              vendorId,
              createdAt: { gte: twelveMoAgo },
              status: { not: 'CANCELLED' },
            },
            select: { total: true },
          })
          const totalSpend12mo = recent12.reduce((s, p) => s + (p.total ?? 0), 0)
          const limit = vendor.creditLimit ?? 0
          const used = vendor.creditUsed ?? 0
          const creditUtilization = limit > 0 ? used / limit : null

          performance = {
            avgLeadDays: vendor.avgLeadDays ?? null,
            onTimeRate: vendor.onTimeRate ?? null,
            riskScore: vendor.riskScore ?? null,
            totalSpend12mo,
            totalSpend12moPoCount: recent12.length,
            creditUtilization,
          }
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  vendor,
                  recentPurchaseOrders: recentPOs,
                  ...(performance ? { performance } : {}),
                },
                null,
                2,
              ),
            },
          ],
        }
      },
    ),
  )
}
