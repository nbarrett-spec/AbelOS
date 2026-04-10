export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/ops/import-bpw/intake — Raw data intake from BPW scraper
// ──────────────────────────────────────────────────────────────────────────
// Accepts chunked data from the browser-side scraper.
// Stores raw JSON into a staging table for later processing by import-bpw.
// This avoids the Chrome tool's character-limit bottleneck.
//
// Body: { dataType: "jobs"|"invoices"|"checks"|"fpos"|"communities",
//         chunk: number, totalChunks: number, data: any[] }
// ──────────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Ensure staging table
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BpwStagingData" (
        "id" TEXT PRIMARY KEY,
        "dataType" TEXT NOT NULL,
        "chunk" INT NOT NULL,
        "totalChunks" INT NOT NULL,
        "recordCount" INT DEFAULT 0,
        "data" JSONB NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_bpw_staging_type" ON "BpwStagingData" ("dataType")
    `)

    const body = await request.json()
    const { dataType, chunk, totalChunks, data } = body

    if (!dataType || chunk === undefined || !data) {
      return NextResponse.json({ error: 'Missing dataType, chunk, or data' }, { status: 400 })
    }

    const id = `bpws_${dataType}_${chunk}_${Date.now().toString(36)}`

    await prisma.$executeRawUnsafe(`
      INSERT INTO "BpwStagingData" ("id", "dataType", "chunk", "totalChunks", "recordCount", "data")
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
      ON CONFLICT ("id") DO NOTHING
    `, id, dataType, chunk, totalChunks, Array.isArray(data) ? data.length : 0, JSON.stringify(data))

    // Check completeness
    const received: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(DISTINCT "chunk")::int as chunks, SUM("recordCount")::int as records
       FROM "BpwStagingData" WHERE "dataType" = $1`,
      dataType
    )
    const { chunks: receivedChunks, records } = received[0]

    return NextResponse.json({
      success: true,
      dataType,
      chunk,
      receivedChunks,
      totalChunks,
      totalRecords: records,
      complete: receivedChunks >= totalChunks,
    }, { status: 200 })

  } catch (error: any) {
    console.error('BPW intake error:', error)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}

// GET — Check staging data status
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "BpwStagingData" (
        "id" TEXT PRIMARY KEY,
        "dataType" TEXT NOT NULL,
        "chunk" INT NOT NULL,
        "totalChunks" INT NOT NULL,
        "recordCount" INT DEFAULT 0,
        "data" JSONB NOT NULL,
        "createdAt" TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    const status: any[] = await prisma.$queryRawUnsafe(`
      SELECT "dataType", COUNT(DISTINCT "chunk")::int as chunks,
        MAX("totalChunks")::int as "totalChunks",
        SUM("recordCount")::int as records,
        MAX("createdAt") as "lastReceived"
      FROM "BpwStagingData"
      GROUP BY "dataType"
      ORDER BY "dataType"
    `)

    return NextResponse.json({ staging: status }, { status: 200 })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
