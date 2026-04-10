import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Validates query parameters against a Zod schema.
 * Returns the parsed params or a 400 error response.
 */
export function validateQuery<T extends z.ZodType>(
  request: NextRequest,
  schema: T
): { data: z.infer<T> } | { error: NextResponse } {
  const { searchParams } = new URL(request.url)
  const params: Record<string, string> = {}
  searchParams.forEach((value, key) => { params[key] = value })

  const result = schema.safeParse(params)
  if (!result.success) {
    return {
      error: NextResponse.json(
        { error: 'Invalid parameters', details: result.error.flatten().fieldErrors },
        { status: 400 }
      )
    }
  }
  return { data: result.data }
}

/**
 * Validates a POST/PATCH body against a Zod schema.
 * Returns the parsed body or a 400 error response.
 */
export async function validateBody<T extends z.ZodType>(
  request: NextRequest,
  schema: T
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
  try {
    const body = await request.json()
    const result = schema.safeParse(body)
    if (!result.success) {
      return {
        error: NextResponse.json(
          { error: 'Invalid request body', details: result.error.flatten().fieldErrors },
          { status: 400 }
        )
      }
    }
    return { data: result.data }
  } catch {
    return {
      error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
  }
}

// Common reusable schemas
export const paginationSchema = z.object({
  page: z.string().optional().transform(v => v ? parseInt(v) : 1),
  limit: z.string().optional().transform(v => v ? Math.min(parseInt(v), 100) : 20),
  search: z.string().optional(),
})

export const reportSchema = z.object({
  report: z.string().optional().default('dashboard'),
})

export const idParamSchema = z.object({
  id: z.string().min(1, 'ID is required'),
})

export const dateRangeSchema = z.object({
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  period: z.enum(['7d', '30d', '90d', '12m', 'all']).optional(),
})
