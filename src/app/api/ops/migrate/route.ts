import { audit } from '@/lib/audit'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    audit(request, 'RUN_MIGRATE', 'Database', undefined, { migration: 'RUN_MIGRATE' }, 'CRITICAL').catch(() => {})
    // Add displayName column if it doesn't exist
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "displayName" TEXT;
    `)

    return NextResponse.json({
      success: true,
      message: 'Migration complete: displayName column added',
    })
  } catch (error) {
    console.error('Migration failed:', error)
    return NextResponse.json(
      { error: 'Migration failed', details: String(error) },
      { status: 500 }
    )
  }
}
