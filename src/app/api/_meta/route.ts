import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

/**
 * GET /api/_meta — Build and version metadata for debugging and observability.
 */
export async function GET() {
  return NextResponse.json({
    app: 'abel-os',
    version: process.env.npm_package_version ?? '0.0.0',
    gitSha: process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GIT_SHA ?? 'unknown',
    env: process.env.NODE_ENV ?? 'unknown',
    builtAt: process.env.BUILD_TIMESTAMP ?? null,
    region: process.env.VERCEL_REGION ?? null,
  })
}
