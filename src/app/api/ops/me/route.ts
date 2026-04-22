export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { prisma } from '@/lib/prisma'

// GET: Return logged-in staff member's ID and basic info
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Extract staff ID from the JWT cookie
    const cookie = request.cookies.get('abel_staff_session')
    if (!cookie) {
      return NextResponse.json({ error: 'No session' }, { status: 401 })
    }

    // Decode the JWT payload (the middleware already verified it)
    const parts = cookie.value.split('.')
    if (parts.length !== 3) {
      return NextResponse.json({ error: 'Invalid token' }, { status: 401 })
    }
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString())
    const staffId = payload.staffId || payload.id

    if (!staffId) {
      return NextResponse.json({ error: 'No staff ID in token' }, { status: 401 })
    }

    // Fetch staff details
    const staff: any[] = await prisma.$queryRawUnsafe(
      `SELECT id, "firstName", "lastName", email, role, department FROM "Staff" WHERE id = $1`,
      staffId
    )

    if (staff.length === 0) {
      return NextResponse.json({ error: 'Staff not found' }, { status: 404 })
    }

    return NextResponse.json({
      staffId: staff[0].id,
      name: `${staff[0].firstName} ${staff[0].lastName}`,
      email: staff[0].email,
      role: staff[0].role,
      department: staff[0].department,
    })
  } catch (error: any) {
    return NextResponse.json({ error: 'Internal server error'}, { status: 500 })
  }
}
