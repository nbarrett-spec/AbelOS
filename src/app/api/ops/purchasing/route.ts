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
    const status = searchParams.get('status');
    const vendorId = searchParams.get('vendorId');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortDir = (searchParams.get('sortDir') || 'desc') as 'asc' | 'desc';

    const skip = (page - 1) * limit;

    // Build WHERE clause with parameterized queries
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (status) {
      const validStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']
      if (validStatuses.includes(status)) {
        conditions.push(`po."status" = $${idx}::"POStatus"`)
        params.push(status)
        idx++
      }
    }
    if (vendorId) {
      conditions.push(`po."vendorId" = $${idx}`)
      params.push(vendorId)
      idx++
    }
    if (dateFrom) {
      conditions.push(`po."createdAt" >= $${idx}::timestamptz`)
      params.push(dateFrom)
      idx++
    }
    if (dateTo) {
      conditions.push(`po."createdAt" <= $${idx}::timestamptz`)
      params.push(dateTo + 'T23:59:59.999Z')
      idx++
    }

    const whereClause = conditions.length > 0 ? ' AND ' + conditions.join(' AND ') : ''

    // Determine ORDER BY clause (whitelist approach)
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC'
    const sortMap: Record<string, string> = {
      vendor: `v."name" ${dir}`,
      poNumber: `po."poNumber" ${dir}`,
      status: `po."status" ${dir}`,
      total: `po."total" ${dir}`,
      createdAt: `po."createdAt" ${dir}`,
      expectedDate: `po."expectedDate" ${dir}`,
    }
    const orderByClause = 'ORDER BY ' + (sortMap[sortBy] || `po."createdAt" ${dir}`);

    // Main query for purchase orders with vendor and createdBy staff
    const mainQuery = `
      SELECT
        po."id",
        po."poNumber",
        po."vendorId",
        po."createdById",
        po."approvedById",
        po."status",
        po."subtotal",
        po."shippingCost",
        po."total",
        po."orderedAt",
        po."expectedDate",
        po."receivedAt",
        po."notes",
        po."createdAt",
        po."updatedAt",
        json_build_object(
          'id', v."id",
          'name', v."name",
          'code', v."code",
          'contactName', v."contactName",
          'email', v."email",
          'phone', v."phone"
        ) as "vendor",
        json_build_object(
          'id', s."id",
          'firstName', s."firstName",
          'lastName', s."lastName",
          'email', s."email"
        ) as "createdBy"
      FROM "PurchaseOrder" po
      LEFT JOIN "Vendor" v ON po."vendorId" = v."id"
      LEFT JOIN "Staff" s ON po."createdById" = s."id"
      WHERE 1=1 ${whereClause}
      ${orderByClause}
      LIMIT $${idx} OFFSET $${idx + 1}
    `;

    // Count query for total
    const countQuery = `
      SELECT COUNT(*)::int as "total"
      FROM "PurchaseOrder" po
      WHERE 1=1 ${whereClause}
    `;

    // Status counts query
    const statusCountsQuery = `
      SELECT "status"::text, COUNT(*)::int
      FROM "PurchaseOrder"
      GROUP BY "status"
    `;

    const [purchaseOrderRows, countResult, statusCountsResult] = await Promise.all([
      prisma.$queryRawUnsafe(mainQuery, ...params, limit, skip),
      prisma.$queryRawUnsafe<{ total: number }[]>(countQuery, ...params),
      prisma.$queryRawUnsafe<{ status: string; count: number }[]>(statusCountsQuery),
    ]);

    const total = countResult[0]?.total || 0;

    // Fetch all items for the returned POs
    const poIds = (purchaseOrderRows as any[]).map((po) => po.id);
    let items: any[] = [];

    if (poIds.length > 0) {
      const itemsQuery = `
        SELECT "id", "purchaseOrderId", "vendorSku", "description", "quantity", "unitCost", "lineTotal"
        FROM "PurchaseOrderItem"
        WHERE "purchaseOrderId" = ANY($1::text[])
      `;
      items = await prisma.$queryRawUnsafe(itemsQuery, poIds);
    }

    // Map items to their parent POs
    const itemsByPoId: Record<string, any[]> = {};
    items.forEach((item: any) => {
      if (!itemsByPoId[item.purchaseOrderId]) {
        itemsByPoId[item.purchaseOrderId] = [];
      }
      itemsByPoId[item.purchaseOrderId].push(item);
    });

    // Attach items to purchase orders
    const purchaseOrders = (purchaseOrderRows as any[]).map((po) => ({
      ...po,
      items: itemsByPoId[po.id] || [],
    }));

    // Build summaryCounts from status counts
    const summaryCounts: Record<string, number> = {};
    (statusCountsResult as any[]).forEach((row) => {
      summaryCounts[row.status] = row.count;
    });

    return NextResponse.json(
      {
        data: purchaseOrders,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        summaryCounts,
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('GET /api/ops/purchasing error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch purchase orders' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();

    const { vendorId, createdById, items, notes, expectedDate } = body;

    if (!vendorId || !createdById || !items || !Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: vendorId, createdById, items (non-empty array)' },
        { status: 400 }
      );
    }

    // Generate PO number using MAX query
    const now = new Date();
    const year = now.getFullYear();
    const poNumberQuery = `
      SELECT COALESCE(MAX(CAST(SUBSTRING("poNumber" FROM '[0-9]+$') AS INT)), 0) as "maxNumber"
      FROM "PurchaseOrder"
      WHERE "poNumber" LIKE 'PO-${year}-%'
    `;
    const poNumberResult = await prisma.$queryRawUnsafe<{ maxNumber: number }[]>(poNumberQuery);
    const nextNumber = (poNumberResult[0]?.maxNumber || 0) + 1;
    const poNumber = `PO-${year}-${String(nextNumber).padStart(4, '0')}`;

    // Calculate totals
    const subtotal = items.reduce((sum: number, item: any) => {
      return sum + (item.quantity * item.unitCost);
    }, 0);

    const total = subtotal; // No tax for now

    // Generate PO ID
    const poId = `po_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Insert PO using parameterized SQL
    await prisma.$executeRawUnsafe(
      `INSERT INTO "PurchaseOrder" ("id", "poNumber", "vendorId", "createdById", "status", "subtotal", "shippingCost", "total", "notes", "expectedDate", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, 'DRAFT'::"POStatus", $5, 0, $6, $7, $8::timestamptz, NOW(), NOW())`,
      poId, poNumber, vendorId, createdById, subtotal, total, notes || null, expectedDate || null
    );

    // Insert items
    for (const item of items) {
      const itemId = `poi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      const lineTotal = item.quantity * item.unitCost;
      await prisma.$executeRawUnsafe(
        `INSERT INTO "PurchaseOrderItem" ("id", "purchaseOrderId", "vendorSku", "description", "quantity", "unitCost", "lineTotal")
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        itemId, poId, item.vendorSku, item.description, item.quantity, item.unitCost, lineTotal
      );
    }

    // Fetch created PO with items, vendor, and createdBy
    const poResult = await prisma.$queryRawUnsafe<any[]>(
      `SELECT po.*, json_build_object('id', v."id", 'name', v."name", 'code', v."code", 'contactName', v."contactName", 'email', v."email", 'phone', v."phone") as "vendor",
              json_build_object('id', s."id", 'firstName', s."firstName", 'lastName', s."lastName", 'email', s."email") as "createdBy"
       FROM "PurchaseOrder" po LEFT JOIN "Vendor" v ON po."vendorId" = v."id" LEFT JOIN "Staff" s ON po."createdById" = s."id"
       WHERE po."id" = $1`, poId
    );
    const purchaseOrder = poResult[0];

    const poItems = await prisma.$queryRawUnsafe(
      `SELECT "id", "purchaseOrderId", "vendorSku", "description", "quantity", "unitCost", "lineTotal"
       FROM "PurchaseOrderItem" WHERE "purchaseOrderId" = $1`, poId
    );

    await audit(request, 'CREATE', 'PurchaseOrder', poId, { vendorId, total })

    return NextResponse.json(
      {
        ...purchaseOrder,
        items: poItems,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('POST /api/ops/purchasing error:', error);
    return NextResponse.json(
      { error: 'Failed to create purchase order' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: id, status' },
        { status: 400 }
      );
    }

    // Validate status
    const validStatuses = ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENT_TO_VENDOR', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      );
    }

    // Update the purchase order status
    const updateQuery = `
      UPDATE "PurchaseOrder"
      SET "status" = $1::"POStatus", "updatedAt" = NOW()
      WHERE "id" = $2
      RETURNING *
    `;

    const updatedRows = await prisma.$queryRawUnsafe<any[]>(
      updateQuery,
      status,
      id
    );

    if (!updatedRows || updatedRows.length === 0) {
      return NextResponse.json(
        { error: 'Purchase order not found' },
        { status: 404 }
      );
    }

    const updatedPO = updatedRows[0];

    // Fetch vendor info
    const vendorQuery = `
      SELECT id, name, code, contactName, email, phone
      FROM "Vendor"
      WHERE "id" = $1
    `;
    const vendors = await prisma.$queryRawUnsafe<any[]>(vendorQuery, updatedPO.vendorId);

    // Fetch items
    const itemsQuery = `
      SELECT "id", "purchaseOrderId", "vendorSku", "description", "quantity", "unitCost", "lineTotal"
      FROM "PurchaseOrderItem"
      WHERE "purchaseOrderId" = $1
    `;
    const items = await prisma.$queryRawUnsafe(itemsQuery, id);

    await audit(request, 'UPDATE', 'PurchaseOrder', id, { status })

    return NextResponse.json(
      {
        ...updatedPO,
        vendor: vendors[0] || null,
        items: items || [],
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('PATCH /api/ops/purchasing error:', error);
    return NextResponse.json(
      { error: 'Failed to update purchase order' },
      { status: 500 }
    );
  }
}
