export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'
import { syncAllAccounts, listDomainUsers } from '@/lib/integrations/gmail'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/communication-logs/gmail-fetch
//
// GET  — Check service account status and list domain users
// POST — Trigger a full sync of all domain mailboxes
//
// Uses Google Service Account with domain-wide delegation.
// Set GOOGLE_SERVICE_ACCOUNT_KEY (JSON string) or
// GOOGLE_SERVICE_ACCOUNT_KEY_PATH (file path) in env.
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const hasKey = !!(process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)

  if (!hasKey) {
    return NextResponse.json({
      status: 'not_configured',
      message: 'Set GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_SERVICE_ACCOUNT_KEY_PATH env var',
      setupSteps: [
        '1. Service account created: gmail-sync@abel-os-gmail-sync.iam.gserviceaccount.com',
        '2. Domain-wide delegation authorized in Google Admin Console',
        '3. Set GOOGLE_SERVICE_ACCOUNT_KEY to the JSON key contents in Vercel env vars',
        '4. POST to this endpoint to trigger a sync',
      ],
    })
  }

  // List discoverable users
  const users = await listDomainUsers()

  return NextResponse.json({
    status: 'configured',
    serviceAccount: 'gmail-sync@abel-os-gmail-sync.iam.gserviceaccount.com',
    domainUsers: users,
    userCount: users.length,
    message: users.length > 0
      ? `Ready to sync ${users.length} mailboxes. POST to trigger sync.`
      : 'Service account key found but could not list users — check Admin SDK scope.',
  })
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  audit(request, 'CREATE', 'Integration', undefined, { action: 'gmail-sync-all' }).catch(() => {})

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || 'newer_than:1d'
  const maxPerAccount = parseInt(searchParams.get('max') || '100')

  const result = await syncAllAccounts(maxPerAccount, query)

  return NextResponse.json({
    ...result,
    query,
    maxPerAccount,
  }, { status: result.status === 'FAILED' ? 500 : 200 })
}
