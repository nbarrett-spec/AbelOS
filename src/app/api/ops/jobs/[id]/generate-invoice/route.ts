export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'
import { autoGenerateInvoice } from '@/lib/invoicing/auto-invoice'

interface RouteParams {
  params: { id: string }
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const { id: jobId } = params

    const result = await autoGenerateInvoice(jobId)

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || 'Failed to generate invoice' },
        { status: 400 }
      )
    }

    await audit(request, 'CREATE', 'Invoice', result.invoiceId!, {
      invoiceNumber: result.invoiceNumber,
      jobId,
      source: 'auto-generated',
    })

    return NextResponse.json(
      {
        success: true,
        invoiceId: result.invoiceId,
        invoiceNumber: result.invoiceNumber,
      },
      { status: 201 }
    )
  } catch (error) {
    console.error('POST /api/ops/jobs/[id]/generate-invoice error:', error)
    return NextResponse.json(
      { error: 'Failed to generate invoice' },
      { status: 500 }
    )
  }
}
