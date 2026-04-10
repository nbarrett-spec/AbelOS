export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function POST() {
  try {
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
