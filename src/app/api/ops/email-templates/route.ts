export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import {
  EMAIL_TEMPLATE_REGISTRY,
  getTemplatesByCategory,
  previewTemplate,
} from '@/lib/email'

/**
 * GET /api/ops/email-templates
 * List all email templates or preview one.
 *
 * Query params:
 *   ?preview=password_reset  — render a preview of the template (returns HTML)
 *   (no params)              — list all templates grouped by category
 */
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const preview = request.nextUrl.searchParams.get('preview')

  if (preview) {
    const html = previewTemplate(preview)
    if (!html) {
      return NextResponse.json(
        { error: `Template "${preview}" not found or has no preview` },
        { status: 404 }
      )
    }
    return new NextResponse(html, {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  return NextResponse.json({
    templates: EMAIL_TEMPLATE_REGISTRY,
    byCategory: getTemplatesByCategory(),
    totalCount: EMAIL_TEMPLATE_REGISTRY.length,
  })
}
