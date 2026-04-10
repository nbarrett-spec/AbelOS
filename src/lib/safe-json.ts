import { NextResponse } from 'next/server'

/**
 * JSON response that safely serializes BigInt values from Prisma raw queries.
 * PostgreSQL COUNT() returns BigInt which JSON.stringify() cannot handle.
 * Use this instead of NextResponse.json() when returning raw query results.
 */
export function safeJson(data: any, init?: { status?: number; headers?: Record<string, string> }): NextResponse {
  const json = JSON.stringify(data, (_key, value) =>
    typeof value === 'bigint' ? Number(value) : value
  )
  return new NextResponse(json, {
    status: init?.status || 200,
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  })
}
