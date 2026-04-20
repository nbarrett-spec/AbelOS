export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const builderId = searchParams.get('builderId');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
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
    const orders = await prisma.$queryRawUnsafe(ordersQuery, ...params, limit, skip);

    // Get order IDs for batch fetching relationships
    const orderIds = (orders as any[]).map(o => o.id);

    let items: any[] = [];
    let jobs: any[] = [];
    let quotes: any[] = [];

    if (orderIds.length > 0) {
      // Fetch order items with products
      const itemsQuery = `
        SELECT
          oi."id", oi."orderId", oi."productId", oi."description",
          oi."quantity", oi."unitPrice", oi."lineTotal",
          p."id" as "product_id", p."name", p."sku", p."category", p."basePrice"
        FROM "OrderItem" oi
        LEFT JOIN "Product" p ON oi."productId" = p."id"
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

      // Fetch quotes
      const quoteIdsArr = (orders as any[]).map(o => o.quoteId).filter(Boolean);
      if (quoteIdsArr.length > 0) {
        quotes = await prisma.$queryRawUnsafe(
          `SELECT "id", "quoteNumber", "status", "total", "subtotal", "taxAmount", "createdAt", "updatedAt"
           FROM "Quote" WHERE "id" = ANY($1::text[])`,
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
          product: item.product_id ? {
            id: item.product_id,
            name: item.name,
            sku: item.sku,
            category: item.category,
            basePrice: item.basePrice,
          } : null,
        }));

      const orderJobs = jobs.filter(job => job.orderId === order.id);

      const orderQuote = quotes.find(q => q.id === order.quoteId);

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
      };
    });

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
        q."projectId", q."createdAt", q."updatedAt",
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

    // Generate orderNumber: "ORD-YYYY-NNNN"
    const year = new Date().getFullYear();
    const lastOrderQuery = `
      SELECT "orderNumber"
      FROM "Order"
      WHERE "orderNumber" LIKE $1
      ORDER BY "orderNumber" DESC
      LIMIT 1
    `;
    const lastOrderResult = await prisma.$queryRawUnsafe(lastOrderQuery, `ORD-${year}-%`);
    const lastOrder = (lastOrderResult as any[])[0];

    let nextNumber = 1;
    if (lastOrder) {
      const lastNumber = parseInt(lastOrder.orderNumber.split('-')[2]);
      nextNumber = lastNumber + 1;
    }

    const orderNumber = `ORD-${year}-${String(nextNumber).padStart(4, '0')}`;

    // Get builder payment term
    const builderQuery = `
      SELECT "paymentTerm" FROM "Builder" WHERE "id" = $1
    `;
    const builderResult = await prisma.$queryRawUnsafe(builderQuery, finalBuilderId);
    const builder = (builderResult as any[])[0];
    const paymentTerm = builder?.paymentTerm || 'NET_15';

    // Generate order ID
    const orderId = `ord_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Insert order
    const insertOrderQuery = `
      INSERT INTO "Order" (
        "id", "orderNumber", "builderId", "quoteId", "subtotal", "taxAmount",
        "total", "paymentTerm", "paymentStatus", "status", "deliveryDate",
        "deliveryNotes", "createdAt", "updatedAt"
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
    `;
    await prisma.$executeRawUnsafe(
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
      new Date().toISOString(),
      new Date().toISOString()
    );

    // Insert order items
    for (const item of quoteItems as any[]) {
      const itemId = `oi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const insertItemQuery = `
        INSERT INTO "OrderItem" ("id", "orderId", "productId", "description", "quantity", "unitPrice", "lineTotal", "createdAt", "updatedAt")
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `;
      await prisma.$executeRawUnsafe(
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

    // Update quote status to ORDERED
    const updateQuoteQuery = `
      UPDATE "Quote" SET "status" = 'ORDERED'::"QuoteStatus", "updatedAt" = $1 WHERE "id" = $2
    `;
    await prisma.$executeRawUnsafe(updateQuoteQuery, new Date().toISOString(), quoteId);

    // Audit: order created
    await audit(request, 'CREATE', 'Order', orderId, {
      orderNumber, builderId: finalBuilderId, quoteId, total: quote.total, itemCount: (quoteItems as any[]).length,
    });

    // Update project status to ORDERED if it exists
    if (quote.project_id) {
      const updateProjectQuery = `
        UPDATE "Project" SET "status" = 'ORDERED'::"ProjectStatus", "updatedAt" = $1 WHERE "id" = $2
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
        p."id" as "product_id", p."name", p."sku", p."category", p."basePrice"
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
      product: item.product_id ? {
        id: item.product_id,
        name: item.name,
        sku: item.sku,
        category: item.category,
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
  } catch (error) {
    console.error('POST /api/ops/orders error:', error);
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    );
  }
}
