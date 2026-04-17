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
    const vendorId = searchParams.get('vendorId');

    // Calculate performance metrics from PurchaseOrder data
    let query = `
      SELECT
        v."id" as "vendorId",
        v."name" as "vendorName",
        COUNT(DISTINCT po."id")::int as "totalPOs",
        ROUND(
          CAST(SUM(CASE WHEN po."receivedAt" IS NOT NULL AND po."receivedAt" <= po."expectedDate" THEN 1 ELSE 0 END) AS NUMERIC) /
          CAST(NULLIF(COUNT(DISTINCT CASE WHEN po."receivedAt" IS NOT NULL THEN po."id" END), 0) AS NUMERIC) * 100,
          2
        ) as "onTimeDeliveryRate",
        COALESCE(ROUND(CAST(COALESCE(SUM(qc_pass.pass_count), 0) AS NUMERIC) / CAST(NULLIF(COALESCE(SUM(qc.total_count), 1), 0) AS NUMERIC) * 100, 2), 100) as "qualityScore",
        COALESCE(ROUND(SUM(po."total")::NUMERIC, 2), 0) as "totalSpend",
        MAX(po."createdAt") as "lastOrderDate"
      FROM "Vendor" v
      LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v."id"
      LEFT JOIN (
        SELECT po."vendorId", COUNT(*)::int as total_count
        FROM "PurchaseOrder" po
        WHERE po."receivedAt" IS NOT NULL
        GROUP BY po."vendorId"
      ) qc ON qc."vendorId" = v."id"
      LEFT JOIN (
        SELECT po."vendorId", COUNT(*)::int as pass_count
        FROM "PurchaseOrder" po
        LEFT JOIN "QualityCheck" qch ON po."id"::text LIKE qch."jobId" OR po."id" = qch."jobId"
        WHERE qch."result" = 'PASS'
        GROUP BY po."vendorId"
      ) qc_pass ON qc_pass."vendorId" = v."id"
    `;

    const params: any[] = [];
    let idx = 1;

    if (vendorId) {
      query += ` WHERE v."id" = $${idx}`;
      params.push(vendorId);
      idx++;
    }

    query += `
      GROUP BY v."id", v."name"
      ORDER BY "onTimeDeliveryRate" DESC NULLS LAST, "qualityScore" DESC NULLS LAST, "totalSpend" DESC
    `;

    const performance = await prisma.$queryRawUnsafe(query, ...params);

    return NextResponse.json(performance, { status: 200 });
  } catch (error) {
    console.error('GET /api/ops/vendors/performance error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vendor performance' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Vendor', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json();

    const {
      vendorId,
      month,
      onTimeRate,
      qualityScore,
      responseTime,
      totalOrders,
      lateOrders,
      returnedOrders,
      ytdSpend,
    } = body;

    if (!vendorId || !month) {
      return NextResponse.json(
        { error: 'Missing required fields: vendorId, month' },
        { status: 400 }
      );
    }

    // Create table if it doesn't exist
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "VendorPerformance" (
        id SERIAL PRIMARY KEY,
        "vendorId" TEXT NOT NULL,
        "month" DATE NOT NULL,
        "onTimeRate" NUMERIC(5,2) DEFAULT 0,
        "qualityScore" NUMERIC(5,2) DEFAULT 0,
        "responseTime" NUMERIC(5,2) DEFAULT 0,
        "totalOrders" INTEGER DEFAULT 0,
        "lateOrders" INTEGER DEFAULT 0,
        "returnedOrders" INTEGER DEFAULT 0,
        "ytdSpend" NUMERIC(12,2) DEFAULT 0,
        "createdAt" TIMESTAMP DEFAULT NOW(),
        UNIQUE("vendorId", "month")
      )
    `);

    // Upsert: try to insert, if unique constraint violated, update
    const result = await prisma.$queryRawUnsafe(
      `
      INSERT INTO "VendorPerformance"
        ("vendorId", "month", "onTimeRate", "qualityScore", "responseTime", "totalOrders", "lateOrders", "returnedOrders", "ytdSpend")
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT ("vendorId", "month")
      DO UPDATE SET
        "onTimeRate" = EXCLUDED."onTimeRate",
        "qualityScore" = EXCLUDED."qualityScore",
        "responseTime" = EXCLUDED."responseTime",
        "totalOrders" = EXCLUDED."totalOrders",
        "lateOrders" = EXCLUDED."lateOrders",
        "returnedOrders" = EXCLUDED."returnedOrders",
        "ytdSpend" = EXCLUDED."ytdSpend"
      RETURNING *
      `,
      vendorId,
      month,
      onTimeRate || 0,
      qualityScore || 0,
      responseTime || 0,
      totalOrders || 0,
      lateOrders || 0,
      returnedOrders || 0,
      ytdSpend || 0
    );

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    console.error('POST /api/ops/vendors/performance error:', error);
    return NextResponse.json(
      { error: 'Failed to create/update vendor performance' },
      { status: 500 }
    );
  }
}
