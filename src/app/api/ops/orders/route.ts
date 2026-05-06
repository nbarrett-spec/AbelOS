export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { runOrderStatusCascades, onOrderConfirmed } from '@/lib/cascades/order-lifecycle'
import { enforceCreditHold } from '@/lib/credit-hold'
import { createTaskForOrderReceived } from '@/lib/events/task'
import { requireValidTransition, transitionErrorResponse } from '@/lib/status-guard'
import { toCsv } from '@/lib/csv'
import { fireAutomationEvent } from '@/lib/automation-executor'
import { fireStaffNotifications } from '@/lib/order-staff-notifications'
import { orderIdsWithBomItems } from '@/lib/orders'
import { reserveForOrder, type ReserveResult } from '@/lib/allocation'
import { notifyBackorder } from '@/lib/allocation/backorder-notify'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams;
    const format = searchParams.get('format');
    const isCsv = format === 'csv';
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const builderId = searchParams.get('builderId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const pmId = searchParams.get('pmId');
    const sortBy = searchParams.get('sortBy') || 'orderDate';
    const includeForecast = searchParams.get('includeForecast') === 'true';
    const sortDir = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';

    const skip = (page - 1) * limit;

    // Build WHERE conditions
    const whereConditions: string[] = [];
    const params: any[] = [];

    if (builderId) {
      whereConditions.push(`o."builderId" = $${params.length + 1}`);
      params.push(builderId);
    }

    if (status) {
      whereConditions.push(`o."status" = $${params.length + 1}::"OrderStatus"`);
      params.push(status);
    }

    if (dateFrom) {
      whereConditions.push(`o."orderDate" >= $${params.length + 1}::timestamptz`);
      params.push(new Date(dateFrom).toISOString());
    }

    if (dateTo) {
      whereConditions.push(`o."orderDate" <= $${params.length + 1}::timestamptz`);
      params.push(new Date(dateTo + 'T23:59:59.999Z').toISOString());
    }

    // By default, hide forecast (future-dated scheduled) orders from operational lists
    if (!includeForecast) {
      whereConditions.push(`o."isForecast" = false`);
    }

    if (search) {
      const searchParam = `%${search}%`;
      whereConditions.push(
        `(o."orderNumber" ILIKE $${params.length + 1} OR o."poNumber" ILIKE $${params.length + 2} OR b."companyName" ILIKE $${params.length + 3})`
      );
      params.push(searchParam, searchParam, searchParam);
    }

    // PM filter: orders with at least one Job assigned to this PM.
    if (pmId) {
      whereConditions.push(
        `EXISTS (SELECT 1 FROM "Job" j WHERE j."orderId" = o."id" AND j."assignedPMId" = $${params.length + 1})`
      );
      params.push(pmId);
    }

    const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

    // Determine order clause (whitelist approach)
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC';
    const orderSortMap: Record<string, string> = {
      builder: `b."companyName" ${dir}`,
      orderNumber: `o."orderNumber" ${dir}`,
      status: `o."status" ${dir}`,
      total: `o."total" ${dir}`,
      createdAt: `o."createdAt" ${dir}`,
      deliveryDate: `o."deliveryDate" ${dir}`,
    };
    const orderClause = 'ORDER BY ' + (orderSortMap[sortBy] || `o."createdAt" ${dir}`);

    // Fetch total count
    const countQuery = `
      SELECT COUNT(*)::int as "total"
      FROM "Order" o
      LEFT JOIN "Builder" b ON o."builderId" = b."id"
      ${whereClause}
    `;
    const countResult = await prisma.$queryRawUnsafe(countQuery, ...params);
    const total = (countResult as any[])[0]?.total || 0;

    // CSV exports skip pagination — but cap at a sane upper bound so a
    // runaway export can't OOM the worker. 5000 rows is well above any
    // realistic filtered-orders set.
    const effectiveLimit = isCsv ? 5000 : limit;
    const effectiveSkip = isCsv ? 0 : skip;

    // Fetch paginated orders with builder data
    const ordersQuery = `
      SELECT
        o."id", o."orderNumber", o."builderId", o."quoteId", o."subtotal",
        o."taxAmount", o."shippingCost", o."total", o."paymentTerm",
        o."paymentStatus", o."status", o."deliveryDate", o."deliveryNotes",
        o."poNumber", o."paidAt", o."dueDate", o."createdAt",
        b."id" as "builder_id", b."companyName", b."contactName", b."email", b."phone",
        b."paymentTerm" as "builder_paymentTerm", b."createdAt" as "builder_createdAt",
        b."updatedAt" as "builder_updatedAt"
      FROM "Order" o
      LEFT JOIN "Builder" b ON o."builderId" = b."id"
      ${whereClause}
      ${orderClause}
      LIMIT $${params.length + 1} OFFSET $${params.length + 2}
    `;
    const orders = await prisma.$queryRawUnsafe(ordersQuery, ...params, effectiveLimit, effectiveSkip);

    // Get order IDs for batch fetching relationships
    const orderIds = (orders as any[]).map(o => o.id);

    let items: any[] = [];
    let jobs: any[] = [];
    let quotes: any[] = [];
    let bomOrderIdSet: Set<string> = new Set();

    if (orderIds.length > 0) {
      // Pre-compute which orders have any manufactured-in-house items.
      // Orders without BOM-parent items are "stock only" and bypass the
      // manufacturing queue / build-sheet flow. Surfaced in the UI as a
      // "STOCK ONLY" badge so PMs know at a glance.
      bomOrderIdSet = await orderIdsWithBomItems(orderIds);

      // Fetch order items with products. A-BIZ-6: pull the new backorder
      // columns + the fulfilling PO number so the UI can render the badge
      // without a second query.
      const itemsQuery = `
        SELECT
          oi."id", oi."orderId", oi."productId", oi."description",
          oi."quantity", oi."unitPrice", oi."lineTotal",
          oi."doorMaterial"::text as "doorMaterial",
          oi."backorderedQty", oi."backorderedAt", oi."expectedDate",
          oi."fulfillingPoId",
          po."poNumber" as "fulfillingPoNumber",
          p."id" as "product_id", p."name", p."sku", p."category",
          p."subcategory", p."basePrice"
        FROM "OrderItem" oi
        LEFT JOIN "Product" p ON oi."productId" = p."id"
        LEFT JOIN "PurchaseOrder" po ON po."id" = oi."fulfillingPoId"
        WHERE oi."orderId" = ANY($1::text[])
        ORDER BY oi."orderId", oi."id"
      `;
      items = await prisma.$queryRawUnsafe(itemsQuery, orderIds);

      // Fetch jobs
      const jobsQuery = `
        SELECT "id", "jobNumber", "status", "orderId", "createdAt", "updatedAt"
        FROM "Job"
        WHERE "orderId" = ANY($1::text[])
        ORDER BY "orderId", "id"
      `;
      jobs = await prisma.$queryRawUnsafe(jobsQuery, orderIds);

      // Fetch quotes — pull project fields too so the orders page can display
      // project name/address without a second round-trip.
      const quoteIdsArr = (orders as any[]).map(o => o.quoteId).filter(Boolean);
      if (quoteIdsArr.length > 0) {
        quotes = await prisma.$queryRawUnsafe(
          `SELECT q."id", q."quoteNumber", q."status", q."total", q."subtotal", q."taxAmount",
                  q."projectId", q."createdAt", q."updatedAt",
                  p."id" as "project_id", p."name" as "project_name",
                  p."jobAddress" as "project_jobAddress", p."city" as "project_city",
                  p."state" as "project_state"
           FROM "Quote" q
           LEFT JOIN "Project" p ON q."projectId" = p."id"
           WHERE q."id" = ANY($1::text[])`,
          quoteIdsArr
        );
      }
    }

    // Assemble response data
    const data = (orders as any[]).map(order => {
      const orderBuilder = order.builder_id ? {
        id: order.builder_id,
        companyName: order.companyName,
        contactName: order.contactName,
        email: order.email,
        phone: order.phone,
        paymentTerm: order.builder_paymentTerm,
        createdAt: order.builder_createdAt,
        updatedAt: order.builder_updatedAt,
      } : null;

      const orderItems = items
        .filter(item => item.orderId === order.id)
        .map(item => ({
          id: item.id,
          orderId: item.orderId,
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          doorMaterial: item.doorMaterial || null,
          // A-BIZ-6: backorder state stamped at reserveForOrder time
          backorderedQty: Number(item.backorderedQty || 0),
          backorderedAt: item.backorderedAt || null,
          expectedDate: item.expectedDate || null,
          fulfillingPoId: item.fulfillingPoId || null,
          fulfillingPoNumber: item.fulfillingPoNumber || null,
          product: item.product_id ? {
            id: item.product_id,
            name: item.name,
            sku: item.sku,
            category: item.category,
            subcategory: item.subcategory,
            basePrice: item.basePrice,
          } : null,
        }));

      const orderJobs = jobs.filter(job => job.orderId === order.id);

      const matchedQuote = quotes.find(q => q.id === order.quoteId);
      const orderQuote = matchedQuote
        ? {
            id: matchedQuote.id,
            quoteNumber: matchedQuote.quoteNumber,
            status: matchedQuote.status,
            total: matchedQuote.total,
            subtotal: matchedQuote.subtotal,
            taxAmount: matchedQuote.taxAmount,
            createdAt: matchedQuote.createdAt,
            updatedAt: matchedQuote.updatedAt,
            project: matchedQuote.project_id
              ? {
                  id: matchedQuote.project_id,
                  name: matchedQuote.project_name,
                  jobAddress: matchedQuote.project_jobAddress,
                  city: matchedQuote.project_city,
                  state: matchedQuote.project_state,
                }
              : null,
          }
        : undefined;

      return {
        id: order.id,
        orderNumber: order.orderNumber,
        builderId: order.builderId,
        quoteId: order.quoteId,
        subtotal: order.subtotal,
        taxAmount: order.taxAmount,
        shippingCost: order.shippingCost,
        total: order.total,
        paymentTerm: order.paymentTerm,
        paymentStatus: order.paymentStatus,
        status: order.status,
        deliveryDate: order.deliveryDate,
        deliveryNotes: order.deliveryNotes,
        poNumber: order.poNumber,
        paidAt: order.paidAt,
        dueDate: order.dueDate,
        createdAt: order.createdAt,
        builder: orderBuilder,
        items: orderItems,
        jobs: orderJobs,
        quote: orderQuote,
        hasBomItems: bomOrderIdSet.has(order.id),
      };
    });

    if (isCsv) {
      const rows = data.map((o: any) => {
        const project = o.quote?.project;
        const community = project?.name || '';
        const addressParts = [project?.jobAddress, project?.city, project?.state]
          .filter(Boolean)
          .join(', ');
        const linkedJobs = (o.jobs || [])
          .map((j: any) => j.jobNumber)
          .filter(Boolean)
          .join(', ');
        return {
          orderNumber: o.orderNumber,
          builder: o.builder?.companyName || '',
          community,
          address: addressParts,
          status: o.status,
          total: typeof o.total === 'number' ? o.total.toFixed(2) : o.total,
          createdAt: o.createdAt ? new Date(o.createdAt).toISOString() : '',
          scheduledDelivery: o.deliveryDate ? new Date(o.deliveryDate).toISOString() : '',
          linkedJobs,
        };
      });
      const csv = toCsv(rows, [
        { key: 'orderNumber', label: 'Order Number' },
        { key: 'builder', label: 'Builder' },
        { key: 'community', label: 'Community' },
        { key: 'address', label: 'Address' },
        { key: 'status', label: 'Status' },
        { key: 'total', label: 'Total' },
        { key: 'createdAt', label: 'Created At' },
        { key: 'scheduledDelivery', label: 'Scheduled Delivery' },
        { key: 'linkedJobs', label: 'Linked Jobs' },
      ]);
      const today = new Date().toISOString().split('T')[0];
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="orders-${today}.csv"`,
        },
      });
    }

    return NextResponse.json(
      {
        data,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/ops/orders error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch orders' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();

    const {
      quoteId,
      builderId,
      deliveryDate,
      deliveryNotes,
      orderDate,
      acknowledgeExpired,
    } = body;

    if (!quoteId) {
      return NextResponse.json(
        { error: 'Missing required field: quoteId' },
        { status: 400 }
      );
    }

    // Fetch the quote with all its items and project
    const quoteQuery = `
      SELECT
        q."id", q."quoteNumber", q."status", q."total", q."subtotal", q."taxAmount",
        q."projectId", q."validUntil", q."createdAt", q."updatedAt",
        p."id" as "project_id", p."builderId"
      FROM "Quote" q
      LEFT JOIN "Project" p ON q."projectId" = p."id"
      WHERE q."id" = $1
    `;
    const quoteResult = await prisma.$queryRawUnsafe(quoteQuery, quoteId);
    const quote = (quoteResult as any[])[0];

    if (!quote) {
      return NextResponse.json(
        { error: 'Quote not found' },
        { status: 404 }
      );
    }

    // Stale-quote guard (A-BIZ-1). The conversion endpoint used to happily
    // turn a quote priced six months ago into a fresh order at six-month-old
    // pricing; that's how we ate margin. Block by default, but accept an
    // explicit acknowledgeExpired:true so staff can deliberately convert a
    // stale quote when they've checked the pricing themselves (or the
    // builder is honoring the original).
    const isExpiredStatus = String(quote.status) === 'EXPIRED';
    const isPastValidUntil =
      !!quote.validUntil && new Date(quote.validUntil) < new Date();
    if ((isExpiredStatus || isPastValidUntil) && !acknowledgeExpired) {
      const daysAgo = quote.validUntil
        ? Math.round((Date.now() - new Date(quote.validUntil).getTime()) / 86400000)
        : 0;
      return NextResponse.json(
        {
          error: 'Quote is expired',
          code: 'QUOTE_EXPIRED',
          quoteNumber: quote.quoteNumber,
          status: quote.status,
          validUntil: quote.validUntil,
          warning: isExpiredStatus
            ? `Quote ${quote.quoteNumber} is marked EXPIRED - pricing may be stale.`
            : `Quote ${quote.quoteNumber} expired ${daysAgo} days ago - pricing may be stale.`,
          remediation:
            'Re-quote at current pricing, or pass { acknowledgeExpired: true } in the request body to convert anyway.',
        },
        { status: 400 }
      );
    }

    // Fetch quote items
    const quoteItemsQuery = `
      SELECT "id", "quoteId", "productId", "description", "quantity", "unitPrice", "lineTotal"
      FROM "QuoteItem"
      WHERE "quoteId" = $1
    `;
    const quoteItems = await prisma.$queryRawUnsafe(quoteItemsQuery, quoteId);

    // Use provided builderId or fall back to getting from quote's project
    let finalBuilderId = builderId;
    if (!finalBuilderId && quote.project_id) {
      finalBuilderId = quote.builderId;
    }

    if (!finalBuilderId) {
      return NextResponse.json(
        { error: 'builderId is required or must be inferred from quote' },
        { status: 400 }
      );
    }

    // Generate orderNumber: "ORD-YYYY-NNNN". Regex-anchor the WHERE so malformed
    // or non-numeric legacy orderNumbers (e.g. "SO-..." or addresses) can't poison
    // the max-lookup. Extract the numeric suffix in SQL so we don't rely on parseInt
    // of a string that could contain letters.
    const year = new Date().getFullYear();
    const lastOrderQuery = `
      SELECT CAST(SUBSTRING("orderNumber" FROM $2) AS INTEGER) AS seq
      FROM "Order"
      WHERE "orderNumber" ~ $1
      ORDER BY seq DESC
      LIMIT 1
    `;
    const pattern = `^ORD-${year}-\\d+$`;
    const captureStart = `ORD-${year}-`.length + 1; // SQL SUBSTRING is 1-indexed
    const lastOrderResult = await prisma.$queryRawUnsafe(lastOrderQuery, pattern, captureStart);
    const lastOrder = (lastOrderResult as any[])[0];

    const lastSeq = lastOrder && Number.isFinite(Number(lastOrder.seq)) ? Number(lastOrder.seq) : 0;
    const nextNumber = lastSeq + 1;

    const orderNumber = `ORD-${year}-${String(nextNumber).padStart(4, '0')}`;

    // Get builder payment term
    const builderQuery = `
      SELECT "paymentTerm" FROM "Builder" WHERE "id" = $1
    `;
    const builderResult = await prisma.$queryRawUnsafe(builderQuery, finalBuilderId);
    const builder = (builderResult as any[])[0];
    const paymentTerm = builder?.paymentTerm || 'NET_15';

    // ── Credit hold enforcement ──────────────────────────────────
    // Single source of truth in @/lib/credit-hold. Hard-blocks SUSPENDED/CLOSED
    // and overdue AR; credit-limit breaches only block when STRICT_CREDIT_LIMIT=true.
    const blockedByCredit = await enforceCreditHold(
      finalBuilderId,
      Number(quote.total || 0),
      request,
      { source: 'POST /api/ops/orders', quoteId }
    );
    if (blockedByCredit) return blockedByCredit;

    // Generate order ID
    const orderId = `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Insert order — cast enum strings, always populate orderDate.
    // Raw SQL via $executeRawUnsafe requires explicit ::timestamp casts on
    // text-serialized dates (Prisma raw doesn't coerce ISO strings like the
    // Prisma client does — hit bug 42804 "type text vs timestamp" without it).
    const resolvedOrderDate = orderDate
      ? new Date(orderDate).toISOString()
      : new Date().toISOString();

    // ── A-BIZ-3: Order + items + inventory reservation in one transaction ──
    // Why a transaction: two simultaneous orders for the same stock would
    // each see InventoryItem.available before either wrote a reservation,
    // both pass any availability check, and end up with -committed +
    // double-claimed inventory. Wrapping the insert + reserveForOrder in a
    // single tx with row-level locking on InventoryItem (inside reserveForOrder)
    // forces them to serialize.
    // Held outside the tx so post-commit code (inbox + builder email) can
    // see whether anything went on backorder (A-BIZ-6). Single-element
    // array because TS strict-null-check doesn't see the reassignment of a
    // `let null` from inside the async callback as a type-narrow.
    const reserveBox: ReserveResult[] = [];
    await prisma.$transaction(async (tx) => {
      const insertOrderQuery = `
        INSERT INTO "Order" (
          "id", "orderNumber", "builderId", "quoteId", "subtotal", "taxAmount",
          "total", "paymentTerm", "paymentStatus", "status", "deliveryDate",
          "deliveryNotes", "orderDate", "createdAt", "updatedAt"
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8::"PaymentTerm", $9::"PaymentStatus", $10::"OrderStatus",
          $11::timestamp, $12, $13::timestamptz, $14::timestamp, $15::timestamp
        )
      `;
      await tx.$executeRawUnsafe(
        insertOrderQuery,
        orderId,
        orderNumber,
        finalBuilderId,
        quoteId,
        quote.subtotal,
        quote.taxAmount,
        quote.total,
        paymentTerm,
        'PENDING',
        'RECEIVED',
        deliveryDate ? new Date(deliveryDate).toISOString() : null,
        deliveryNotes || null,
        resolvedOrderDate,
        new Date().toISOString(),
        new Date().toISOString()
      );

      // Insert order items — collect generated ids so reserveForOrder can
      // stamp backorder state per-line (A-BIZ-6).
      const orderItemIdByIndex: string[] = [];
      for (const item of quoteItems as any[]) {
        const itemId = `oi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
        orderItemIdByIndex.push(itemId);
        const insertItemQuery = `
          INSERT INTO "OrderItem" ("id", "orderId", "productId", "description", "quantity", "unitPrice", "lineTotal", "createdAt", "updatedAt")
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::timestamp, $9::timestamp)
        `;
        await tx.$executeRawUnsafe(
          insertItemQuery,
          itemId,
          orderId,
          item.productId,
          item.description,
          item.quantity,
          item.unitPrice,
          item.lineTotal,
          new Date().toISOString(),
          new Date().toISOString()
        );
      }

      // Reserve inventory at OrderItem grain. Shortfalls become BACKORDERED
      // ledger rows (not a hard reject) — production already accepts orders
      // with backordered material; the fix here is preventing the same
      // physical units from being claimed twice by concurrent calls.
      // A-BIZ-6: passing `id` lets reserveForOrder stamp backorderedQty,
      // backorderedAt, fulfillingPoId, expectedDate on the OrderItem row
      // for shortfall lines so the UI can render an ETA badge directly.
      reserveBox.push(await reserveForOrder(
        tx,
        orderId,
        (quoteItems as any[]).map((qi, idx) => ({
          id: orderItemIdByIndex[idx],
          productId: qi.productId,
          quantity: Number(qi.quantity || 0),
        })),
      ));
    }, {
      // Conservative timeout — InventoryAllocation insert + recompute is fast
      // but the row-lock contention under concurrent orders can stretch it.
      timeout: 15000,
    });

    // Update quote status to ORDERED — guard the transition against QuoteStatus state machine.
    try {
      requireValidTransition('quote', quote.status, 'ORDERED');
    } catch (e) {
      const res = transitionErrorResponse(e);
      if (res) return res;
      throw e;
    }
    const updateQuoteQuery = `
      UPDATE "Quote" SET "status" = 'ORDERED'::"QuoteStatus", "updatedAt" = $1::timestamp WHERE "id" = $2
    `;
    await prisma.$executeRawUnsafe(updateQuoteQuery, new Date().toISOString(), quoteId);

    // Audit: order created
    await audit(request, 'CREATE', 'Order', orderId, {
      orderNumber, builderId: finalBuilderId, quoteId, total: quote.total, itemCount: (quoteItems as any[]).length,
    });

    // Event: new order lands at RECEIVED — create a PM task to confirm it.
    // Fire-and-forget; task failure must never roll back the order.
    createTaskForOrderReceived(orderId).catch(() => {})

    // ── A-BIZ-6: backorder fan-out ────────────────────────────────
    // Fire-and-forget: InboxItem for the assigned PM + optional builder
    // email gated by BACKORDER_BUILDER_EMAIL_ENABLED. No-op when nothing
    // went on backorder.
    const rr = reserveBox[0]
    if (rr && rr.backordered.length > 0) {
      notifyBackorder({
        orderId,
        orderNumber,
        builderId: finalBuilderId,
        builderEmail: builder?.email || null,
        builderName: builder?.companyName || null,
        reserveResult: rr,
      }).catch(() => {})
    }

    // Fire user-defined automation rules (AutomationRule table) for ORDER_CREATED.
    // Fire-and-forget; automation failures must never block order creation.
    fireAutomationEvent('ORDER_CREATED', orderId, {
      orderId,
      orderNumber,
      builderId: finalBuilderId,
      status: 'RECEIVED',
      createdBy: request.headers.get('x-staff-id') || 'system',
    }).catch(() => {})

    // Fire staff notifications for the RECEIVED status (Phase 3). PATCH
    // route is the canonical entry for status changes, but RECEIVED is
    // only reached via order CREATION — so the broadcast lives here.
    // The corresponding cascade-side staff notifications for CONFIRMED
    // and beyond fire from runOrderStatusCascades / fireStaffNotifications
    // in the PATCH handler.
    fireStaffNotifications({
      orderId,
      orderNumber,
      newStatus: 'RECEIVED',
      builderId: finalBuilderId,
      builderName: builder?.companyName || 'Builder',
      total: Number(quote.total || 0),
      staffId: request.headers.get('x-staff-id') || 'system',
    }).catch(() => {})

    // Update project status to ORDERED if it exists
    if (quote.project_id) {
      const updateProjectQuery = `
        UPDATE "Project" SET "status" = 'ORDERED'::"ProjectStatus", "updatedAt" = $1::timestamp WHERE "id" = $2
      `;
      await prisma.$executeRawUnsafe(updateProjectQuery, new Date().toISOString(), quote.project_id);
    }

    // Re-fetch and return created order with all relationships
    const createdOrderQuery = `
      SELECT
        o."id", o."orderNumber", o."builderId", o."quoteId", o."subtotal",
        o."taxAmount", o."shippingCost", o."total", o."paymentTerm",
        o."paymentStatus", o."status", o."deliveryDate", o."deliveryNotes",
        o."poNumber", o."paidAt", o."dueDate", o."createdAt",
        b."id" as "builder_id", b."companyName", b."contactName", b."email", b."phone",
        b."paymentTerm" as "builder_paymentTerm", b."createdAt" as "builder_createdAt",
        b."updatedAt" as "builder_updatedAt"
      FROM "Order" o
      LEFT JOIN "Builder" b ON o."builderId" = b."id"
      WHERE o."id" = $1
    `;
    const createdOrderResult = await prisma.$queryRawUnsafe(createdOrderQuery, orderId);
    const createdOrder = (createdOrderResult as any[])[0];

    // Fetch order items with products
    const createdItemsQuery = `
      SELECT
        oi."id", oi."orderId", oi."productId", oi."description",
        oi."quantity", oi."unitPrice", oi."lineTotal",
        oi."doorMaterial"::text as "doorMaterial",
        p."id" as "product_id", p."name", p."sku", p."category",
        p."subcategory", p."basePrice"
      FROM "OrderItem" oi
      LEFT JOIN "Product" p ON oi."productId" = p."id"
      WHERE oi."orderId" = $1
    `;
    const createdItems = await prisma.$queryRawUnsafe(createdItemsQuery, orderId);

    // Fetch quote data
    const createdQuoteQuery = `
      SELECT "id", "quoteNumber", "status", "total", "subtotal", "taxAmount", "createdAt", "updatedAt"
      FROM "Quote"
      WHERE "id" = $1
    `;
    const createdQuoteResult = await prisma.$queryRawUnsafe(createdQuoteQuery, quoteId);
    const createdQuote = (createdQuoteResult as any[])[0];

    // Build response
    const orderBuilder = createdOrder?.builder_id ? {
      id: createdOrder.builder_id,
      companyName: createdOrder.companyName,
      contactName: createdOrder.contactName,
      email: createdOrder.email,
      phone: createdOrder.phone,
      paymentTerm: createdOrder.builder_paymentTerm,
      createdAt: createdOrder.builder_createdAt,
      updatedAt: createdOrder.builder_updatedAt,
    } : null;

    const orderItems = (createdItems as any[]).map(item => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      description: item.description,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal,
      doorMaterial: item.doorMaterial || null,
      product: item.product_id ? {
        id: item.product_id,
        name: item.name,
        sku: item.sku,
        category: item.category,
        subcategory: item.subcategory,
        basePrice: item.basePrice,
      } : null,
    }));

    const response = {
      id: createdOrder.id,
      orderNumber: createdOrder.orderNumber,
      builderId: createdOrder.builderId,
      quoteId: createdOrder.quoteId,
      subtotal: createdOrder.subtotal,
      taxAmount: createdOrder.taxAmount,
      shippingCost: createdOrder.shippingCost,
      total: createdOrder.total,
      paymentTerm: createdOrder.paymentTerm,
      paymentStatus: createdOrder.paymentStatus,
      status: createdOrder.status,
      deliveryDate: createdOrder.deliveryDate,
      deliveryNotes: createdOrder.deliveryNotes,
      poNumber: createdOrder.poNumber,
      shippedAt: createdOrder.shippedAt,
      deliveryConfirmedAt: createdOrder.deliveryConfirmedAt,
      createdAt: createdOrder.createdAt,
      updatedAt: createdOrder.updatedAt,
      builder: orderBuilder,
      items: orderItems,
      jobs: [],
      quote: createdQuote,
    };

    return NextResponse.json(response, { status: 201 });
  } catch (err: any) {
    console.error('POST /api/ops/orders error:', JSON.stringify({
      msg: err?.message,
      code: err?.code,
      meta: err?.meta,
      stack: err?.stack?.split('\n').slice(0, 10).join('\n'),
    }, null, 2))
    return NextResponse.json(
      { error: 'Failed to create order', detail: err?.message?.slice(0, 500), code: err?.code },
      { status: 500 }
    );
  }
}
