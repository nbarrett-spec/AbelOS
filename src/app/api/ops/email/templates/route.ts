export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

interface EmailTemplate {
  id: string
  name: string
  subject: string
  variables: string[]
}

// GET /api/ops/email/templates — Return hardcoded list of email templates
export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    const templates: EmailTemplate[] = [
      {
        id: 'welcome_builder',
        name: 'Welcome New Builder',
        subject: 'Welcome to Abel Lumber - {{companyName}}',
        variables: ['companyName', 'contactName', 'salesRepName'],
      },
      {
        id: 'bid_submitted',
        name: 'Bid Submitted Notification',
        subject: 'Your Bid from Abel Lumber - {{dealNumber}}',
        variables: ['companyName', 'contactName', 'dealNumber', 'dealValue'],
      },
      {
        id: 'quote_follow_up',
        name: 'Quote Follow-Up',
        subject: 'Following Up on Your Quote - {{quoteNumber}}',
        variables: ['companyName', 'contactName', 'quoteNumber', 'salesRepName'],
      },
      {
        id: 'deal_won',
        name: 'Deal Won - Onboarding',
        subject: 'Welcome Aboard! Next Steps for {{companyName}}',
        variables: ['companyName', 'contactName', 'salesRepName', 'accountManagerName'],
      },
      {
        id: 'contract_ready',
        name: 'Contract Ready for Review',
        subject: 'Contract Ready for Your Review - Abel Lumber',
        variables: ['companyName', 'contactName', 'contractType'],
      },
      {
        id: 'document_request',
        name: 'Document Request',
        subject: 'Document Request from Abel Lumber',
        variables: ['companyName', 'contactName', 'documentType', 'dueDate'],
      },
      {
        id: 'payment_reminder',
        name: 'Payment Reminder',
        subject: 'Payment Reminder - Invoice {{invoiceNumber}}',
        variables: ['companyName', 'contactName', 'invoiceNumber', 'amount', 'dueDate'],
      },
      {
        id: 'coi_expiring',
        name: 'COI Expiration Notice',
        subject: 'Certificate of Insurance Expiring Soon',
        variables: ['companyName', 'contactName', 'expirationDate'],
      },
    ]

    return NextResponse.json({
      templates,
      count: templates.length,
    })
  } catch (error) {
    console.error('Email templates retrieval error:', error)
    return NextResponse.json(
      { error: 'Failed to retrieve email templates', templates: [], count: 0 },
      { status: 500 }
    )
  }
}
