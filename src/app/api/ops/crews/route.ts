export const dynamic = 'force-dynamic'
import { prisma } from '@/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';
import { checkStaffAuth } from '@/lib/api-auth'

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ensure missing columns exist (schema drift from incomplete migrations)
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "CrewMember" ADD COLUMN IF NOT EXISTS "createdAt" TIMESTAMPTZ DEFAULT NOW()`)
    } catch (e: any) { console.warn('[Crews] CrewMember.createdAt migration:', e?.message) }
    try {
      await prisma.$executeRawUnsafe(`ALTER TABLE "Crew" ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMPTZ DEFAULT NOW()`)
    } catch (e: any) { console.warn('[Crews] Crew.updatedAt migration:', e?.message) }

    const searchParams = request.nextUrl.searchParams;
    const active = searchParams.get('active');

    let query = `
      SELECT
        c.id,
        c.name,
        c.active,
        c."createdAt",
        c."updatedAt",
        COALESCE(
          json_agg(
            json_build_object(
              'id', cm.id,
              'crewId', cm."crewId",
              'staffId', cm."staffId",
              'role', cm.role,
              'createdAt', cm."createdAt",
              'staff', json_build_object(
                'id', s.id,
                'firstName', s."firstName",
                'lastName', s."lastName",
                'email', s.email,
                'phone', s.phone,
                'role', s.role,
                'department', s.department
              )
            ) ORDER BY cm."createdAt"
          ) FILTER (WHERE cm.id IS NOT NULL),
          '[]'::json
        ) as members
      FROM "Crew" c
      LEFT JOIN "CrewMember" cm ON c.id = cm."crewId"
      LEFT JOIN "Staff" s ON cm."staffId" = s.id
    `;

    const queryParams: any[] = [];
    if (active !== null) {
      const activeValue = active === 'true';
      query += ` WHERE c.active = $1`;
      queryParams.push(activeValue);
    }

    query += ` GROUP BY c.id ORDER BY c.name ASC`;

    const crews = await prisma.$queryRawUnsafe(query, ...queryParams);

    return NextResponse.json(crews, { status: 200 });
  } catch (error: any) {
    console.error('GET /api/ops/crews error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch crews', details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json()
    const { id, name, crewType, vehicleId, vehiclePlate, active, addMemberIds, removeMemberIds } = body

    if (!id) {
      return NextResponse.json({ error: 'Missing crew id' }, { status: 400 })
    }

    const now = new Date().toISOString();
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex++}`);
      values.push(name);
    }
    if (crewType !== undefined) {
      updates.push(`"crewType" = $${paramIndex++}`);
      values.push(crewType);
    }
    if (vehicleId !== undefined) {
      updates.push(`"vehicleId" = $${paramIndex++}`);
      values.push(vehicleId || null);
    }
    if (vehiclePlate !== undefined) {
      updates.push(`"vehiclePlate" = $${paramIndex++}`);
      values.push(vehiclePlate || null);
    }
    if (active !== undefined) {
      updates.push(`active = $${paramIndex++}`);
      values.push(active);
    }

    updates.push(`"updatedAt" = $${paramIndex++}`);
    values.push(now);
    values.push(id);

    if (updates.length > 1) {
      await prisma.$executeRawUnsafe(
        `UPDATE "Crew" SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
        ...values
      );
    }

    // Remove members
    if (removeMemberIds && removeMemberIds.length > 0) {
      const placeholders = removeMemberIds.map((_: any, i: number) => `$${i + 2}`).join(', ');
      await prisma.$executeRawUnsafe(
        `DELETE FROM "CrewMember" WHERE "crewId" = $1 AND "staffId" IN (${placeholders})`,
        id,
        ...removeMemberIds
      );
    }

    // Fetch existing member IDs
    const existingMembers = await prisma.$queryRawUnsafe(
      `SELECT "staffId" FROM "CrewMember" WHERE "crewId" = $1`,
      id
    ) as any[];
    const existingIds = existingMembers.map((m) => m.staffId);

    // Add members
    if (addMemberIds && addMemberIds.length > 0) {
      const newIds = addMemberIds.filter((sid: string) => !existingIds.includes(sid));
      if (newIds.length > 0) {
        for (const staffId of newIds) {
          const memberId = crypto.randomUUID();
          await prisma.$executeRawUnsafe(
            `INSERT INTO "CrewMember" (id, "crewId", "staffId", role, "createdAt")
             VALUES ($1, $2, $3, $4, $5)`,
            memberId,
            id,
            staffId,
            'Member',
            now
          );
        }
      }
    }

    // Re-fetch with updated members
    const updatedCrew = await prisma.$queryRawUnsafe(
      `SELECT
        c.id,
        c.name,
        c.active,
        c."createdAt",
        c."updatedAt",
        COALESCE(
          json_agg(
            json_build_object(
              'id', cm.id,
              'crewId', cm."crewId",
              'staffId', cm."staffId",
              'role', cm.role,
              'createdAt', cm."createdAt",
              'staff', json_build_object(
                'id', s.id,
                'firstName', s."firstName",
                'lastName', s."lastName",
                'email', s.email,
                'phone', s.phone,
                'role', s.role,
                'department', s.department
              )
            ) ORDER BY cm."createdAt"
          ) FILTER (WHERE cm.id IS NOT NULL),
          '[]'::json
        ) as members
      FROM "Crew" c
      LEFT JOIN "CrewMember" cm ON c.id = cm."crewId"
      LEFT JOIN "Staff" s ON cm."staffId" = s.id
      WHERE c.id = $1
      GROUP BY c.id`,
      id
    );

    return NextResponse.json((updatedCrew as any)?.[0] || null, { status: 200 })
  } catch (error) {
    console.error('PATCH /api/ops/crews error:', error)
    return NextResponse.json({ error: 'Failed to update crew' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const body = await request.json();

    const { name, crewType, vehicleId, vehiclePlate, memberIds } = body;

    if (!name || !crewType) {
      return NextResponse.json(
        { error: 'Missing required fields: name, crewType' },
        { status: 400 }
      );
    }

    // Generate crew ID
    const crewId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Insert crew
    await prisma.$executeRawUnsafe(
      `INSERT INTO "Crew" (id, name, "crewType", "vehicleId", "vehiclePlate", active, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, true, $6, $7)`,
      crewId,
      name,
      crewType,
      vehicleId || null,
      vehiclePlate || null,
      now,
      now
    );

    // Insert members if provided
    if (memberIds && memberIds.length > 0) {
      for (const staffId of memberIds) {
        const memberId = crypto.randomUUID();
        await prisma.$executeRawUnsafe(
          `INSERT INTO "CrewMember" (id, "crewId", "staffId", role, "createdAt")
           VALUES ($1, $2, $3, $4, $5)`,
          memberId,
          crewId,
          staffId,
          'Member',
          now
        );
      }
    }

    // Fetch created crew with members
    const crew = await prisma.$queryRawUnsafe(
      `SELECT
        c.id,
        c.name,
        c.active,
        c."createdAt",
        c."updatedAt",
        COALESCE(
          json_agg(
            json_build_object(
              'id', cm.id,
              'crewId', cm."crewId",
              'staffId', cm."staffId",
              'role', cm.role,
              'createdAt', cm."createdAt",
              'staff', json_build_object(
                'id', s.id,
                'firstName', s."firstName",
                'lastName', s."lastName",
                'email', s.email,
                'phone', s.phone,
                'role', s.role,
                'department', s.department
              )
            ) ORDER BY cm."createdAt"
          ) FILTER (WHERE cm.id IS NOT NULL),
          '[]'::json
        ) as members
      FROM "Crew" c
      LEFT JOIN "CrewMember" cm ON c.id = cm."crewId"
      LEFT JOIN "Staff" s ON cm."staffId" = s.id
      WHERE c.id = $1
      GROUP BY c.id`,
      crewId
    );

    return NextResponse.json((crew as any)?.[0] || null, { status: 201 });
  } catch (error) {
    console.error('POST /api/ops/crews error:', error);
    return NextResponse.json(
      { error: 'Failed to create crew' },
      { status: 500 }
    );
  }
}
