/**
 * Admin Digest Preview API
 *
 * GET /api/ops/admin/digest-preview?staffId=<id>
 *   → { subject, htmlBody, textBody, sections, totalItems }
 *   Previews what the daily digest would look like for a given staff member
 *   RIGHT NOW. Does not send anything. Does not touch EmailSendLog.
 *
 * POST /api/ops/admin/digest-preview  body: { staffId }
 *   → { status, messageId?, error? }
 *   Sends a REAL digest to that staff (bypasses duplicate check so the admin
 *   can re-trigger). Uses the normal send path so opt-out / empty still apply.
 *
 * GET /api/ops/admin/digest-preview?action=staff
 *   → { staff: [{ id, name, email, role, active }] }
 *   Returns the active-staff list so the preview page can populate its picker.
 */

export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import { composeDigestForStaff } from '@/lib/digest-composer'
import { sendDigest } from '@/lib/digest-email'

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'staff') {
    const staff = await prisma.staff.findMany({
      where: { active: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        roles: true,
      },
    })
    return NextResponse.json({
      staff: staff.map((s) => ({
        id: s.id,
        name: `${s.firstName} ${s.lastName}`.trim(),
        email: s.email,
        role: s.role,
        roles: s.roles,
      })),
    })
  }

  const staffId = searchParams.get('staffId')
  if (!staffId) {
    return NextResponse.json({ error: 'staffId is required' }, { status: 400 })
  }

  const digest = await composeDigestForStaff(staffId)
  if (!digest) {
    return NextResponse.json(
      { error: 'No digest (staff inactive, missing, or no email)' },
      { status: 404 },
    )
  }

  return NextResponse.json({
    subject: digest.subject,
    htmlBody: digest.htmlBody,
    textBody: digest.textBody,
    sections: digest.sections.map((s) => ({
      key: s.key,
      title: s.title,
      count: s.count,
      summary: s.summary,
      href: s.href,
    })),
    totalItems: digest.totalItems,
    digestDate: digest.digestDate,
    staffEmail: digest.staffEmail,
    staffFirstName: digest.staffFirstName,
  })
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const body = await request.json().catch(() => null)
  if (!body || typeof body.staffId !== 'string') {
    return NextResponse.json({ error: 'staffId is required' }, { status: 400 })
  }

  // allowDuplicate=true so an admin can test-send multiple times in one day.
  const result = await sendDigest(body.staffId, { allowDuplicate: true })
  return NextResponse.json(result)
}
