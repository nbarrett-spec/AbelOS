export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    const crewId = params.id;

    // Get crew details
    const crewResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      crewType: string;
      active: boolean;
      vehiclePlate: string | null;
    }>>(
      `SELECT id, name, "crewType", active, "vehiclePlate" FROM "Crew" WHERE id = $1`,
      crewId
    );

    const crew = crewResult?.[0];

    if (!crew) {
      return NextResponse.json(
        { error: 'Crew not found' },
        { status: 404 }
      );
    }

    // Get crew members
    const membersResult = await prisma.$queryRawUnsafe<Array<{
      staffId: string;
      firstName: string;
      lastName: string;
      email: string;
      phone: string | null;
      role: string;
    }>>(
      `SELECT s.id as "staffId", s."firstName", s."lastName", s.email, s.phone, cm.role
       FROM "CrewMember" cm
       JOIN "Staff" s ON cm."staffId" = s.id
       WHERE cm."crewId" = $1`,
      crewId
    );

    return NextResponse.json({
      id: crew.id,
      name: crew.name,
      crewType: crew.crewType,
      active: crew.active,
      vehiclePlate: crew.vehiclePlate,
      members: membersResult.map((cm) => ({
        id: cm.staffId,
        name: `${cm.firstName} ${cm.lastName}`,
        email: cm.email,
        phone: cm.phone,
        role: cm.role,
      })),
    });
  } catch (error) {
    console.error('Failed to get crew:', error);
    return NextResponse.json(
      { error: 'Failed to get crew' },
      { status: 500 }
    );
  }
}
