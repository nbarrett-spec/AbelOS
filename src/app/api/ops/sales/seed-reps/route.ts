export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { hashPassword } from '@/lib/staff-auth'
import { requireDevAdmin } from '@/lib/api-auth'

// POST /api/ops/sales/seed-reps — Create SALES_REP staff accounts (DEV ONLY, ADMIN required)
export async function POST(request: NextRequest) {
  try {
    const guard = requireDevAdmin(request)
    if (guard) return guard

    const staffMembers = [
      {
        firstName: 'Dalton',
        lastName: 'Barrett',
        email: 'dalton@abellumber.com',
        password: 'abel2026',
      },
      {
        firstName: 'Josh',
        lastName: 'Barrett',
        email: 'josh@abellumber.com',
        password: 'abel2026',
      },
    ]

    const results: any[] = []

    for (const member of staffMembers) {
      try {
        const hash = await hashPassword(member.password)

        // Generate unique ID
        const id = 'staff_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15)

        // Upsert staff member using raw SQL for consistency with existing pattern
        await prisma.$queryRawUnsafe(`
          INSERT INTO "Staff" ("id", "firstName", "lastName", "email", "passwordHash", "role", "department", "active", "updatedAt")
          VALUES (
            '${id}',
            '${member.firstName.replace(/'/g, "''")}',
            '${member.lastName.replace(/'/g, "''")}',
            '${member.email.toLowerCase().replace(/'/g, "''")}',
            '${hash}',
            'SALES_REP',
            'SALES',
            true,
            CURRENT_TIMESTAMP
          )
          ON CONFLICT ("email") DO UPDATE SET
            "passwordHash" = EXCLUDED."passwordHash",
            "role" = 'SALES_REP',
            "department" = 'SALES',
            "active" = true,
            "updatedAt" = CURRENT_TIMESTAMP
        `)

        results.push({
          firstName: member.firstName,
          lastName: member.lastName,
          email: member.email,
          role: 'SALES_REP',
          department: 'SALES',
          status: 'ok',
        })
      } catch (e: any) {
        results.push({
          email: member.email,
          status: 'error',
          error: e.message?.substring(0, 100),
        })
      }
    }

    return NextResponse.json({ results })
  } catch (error: any) {
    console.error(error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
