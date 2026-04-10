export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'

interface VendorRow {
  id: string;
  name: string;
  code: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  accountNumber: string | null;
  avgLeadDays: number | null;
  onTimeRate: number | null;
  active: boolean;
  poCount: number;
  lastOrderDate: Date | null;
}

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const searchParams = request.nextUrl.searchParams;
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const search = searchParams.get('search') || '';
    const status = searchParams.get('status');

    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    // Filter by search term (name or code)
    if (search) {
      conditions.push(`(v."name" ILIKE $${idx} OR v."code" ILIKE $${idx})`);
      params.push(`%${search}%`);
      idx++;
    }

    // Filter by status (active/inactive)
    if (status !== null && status !== '') {
      const activeValue = status === 'true' || status === 'active';
      conditions.push(`v."active" = $${idx}`);
      params.push(activeValue);
      idx++;
    }

    const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

    const query = `
      SELECT
        v."id",
        v."name",
        v."code",
        v."contactName",
        v."email",
        v."phone",
        v."address",
        v."website",
        v."accountNumber",
        v."avgLeadDays",
        v."onTimeRate",
        v."active",
        COUNT(po."id")::int AS "poCount",
        MAX(po."createdAt") AS "lastOrderDate"
      FROM "Vendor" v
      LEFT JOIN "PurchaseOrder" po ON po."vendorId" = v."id"
      ${whereClause}
      GROUP BY v."id"
      ORDER BY "poCount" DESC
      LIMIT $${idx}
    `;

    params.push(limit);

    const vendors = await prisma.$queryRawUnsafe(query, ...params) as VendorRow[];

    return NextResponse.json(vendors, { status: 200 });
  } catch (error) {
    console.error('GET /api/ops/vendors error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch vendors' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();

    const { name, code, contactName, email, phone, address, website, accountNumber, avgLeadDays } = body;

    if (!name || !code) {
      return NextResponse.json(
        { error: 'Missing required fields: name, code' },
        { status: 400 }
      );
    }

    // Generate vendor ID
    const id = `ven_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    const query = `
      INSERT INTO "Vendor" (
        "id",
        "name",
        "code",
        "contactName",
        "email",
        "phone",
        "address",
        "website",
        "accountNumber",
        "avgLeadDays",
        "onTimeRate",
        "active"
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11,
        $12
      )
    `;

    await prisma.$executeRawUnsafe(
      query,
      id,
      name,
      code,
      contactName || null,
      email || null,
      phone || null,
      address || null,
      website || null,
      accountNumber || null,
      avgLeadDays || null,
      null, // onTimeRate
      true  // active
    );

    const createdVendor = await prisma.$queryRawUnsafe(
      'SELECT * FROM "Vendor" WHERE "id" = $1',
      id
    ) as VendorRow[];

    const vendor = {
      ...createdVendor[0],
      poCount: 0,
      lastOrderDate: null,
    };

    return NextResponse.json(vendor, { status: 201 });
  } catch (error) {
    console.error('POST /api/ops/vendors error:', error);
    return NextResponse.json(
      { error: 'Failed to create vendor' },
      { status: 500 }
    );
  }
}
