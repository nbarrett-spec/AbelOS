export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'fs'
import { resolve } from 'path'

// ──────────────────────────────────────────────────────────────────────────
// GET /api/ops/handbook — Serve the Abel Lumber Handbook PDF (public)
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const handbookPath = resolve(
      process.cwd(),
      'uploads/handbook/Abel_Lumber_Handbook.pdf'
    )

    const fileBuffer = readFileSync(handbookPath)

    return new NextResponse(fileBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="Abel_Lumber_Handbook.pdf"',
        'Cache-Control': 'public, max-age=86400, immutable',
      },
    })
  } catch (error: any) {
    console.error('Handbook serving error:', error)
    return NextResponse.json(
      { error: 'Failed to serve handbook' },
      { status: 500 }
    )
  }
}
