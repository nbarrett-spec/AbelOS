export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkStaffAuth } from '@/lib/api-auth';

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request);
  if (authError) return authError;

  try {
    // Get all active crews
    const crewsResult = await prisma.$queryRawUnsafe<Array<{
      id: string;
      name: string;
      crewType: string;
      active: boolean;
      vehiclePlate: string | null;
    }>>(
      `SELECT id, name, "crewType", active, "vehiclePlate" FROM "Crew" WHERE active = true ORDER BY name ASC`
    );

    // For each crew, get its members
    const formattedCrews = await Promise.all(
      crewsResult.map(async (crew) => {
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
          crew.id
        );

        return {
          id: crew.id,
          name: crew.name,
          crewType: crew.crewType,
          active: crew.active,
          vehiclePlate: crew.vehiclePlate,
          members: membersResult.map((member) => ({
            id: member.staffId,
            name: `${member.firstName} ${member.lastName}`,
            email: member.email,
            phone: member.phone,
            role: member.role,
          })),
        };
      })
    );

    return NextResponse.json(formattedCrews);
  } catch (error) {
    console.error('Failed to get crews:', error);
    return NextResponse.json(
      { error: 'Failed to get crews' },
      { status: 500 }
    );
  }
}
