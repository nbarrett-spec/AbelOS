export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuth } from '@/lib/api-auth'

// ──────────────────────────────────────────────────────────────────────────
// /api/ops/communication-logs/gmail-fetch
//
// GET — Proxy to fetch emails from Gmail via Google API
//
// This endpoint is called by the frontend Gmail Sync panel.
// In the full production version, this would use OAuth2 credentials
// stored in IntegrationConfig to call the Gmail API directly.
//
// For now, it provides the shape that the gmail-sync POST endpoint
// expects, and can be populated by the MCP Gmail connector or by
// a Google Apps Script webhook.
//
// Query params:
//   ?query=newer_than:7d — Gmail search query
//   ?account=n.barrett@abellumber.com — Specific account (optional)
//   ?pageSize=50 — Max results
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('query') || 'newer_than:1d'
  const pageSize = parseInt(searchParams.get('pageSize') || '50')

  // In production, this would call the Gmail API using stored OAuth tokens.
  // For now, return instructions on how to set up the integration.
  //
  // The Gmail MCP connector is already wired in at the Cowork level.
  // To make this work server-side, we need either:
  //   1. Google Service Account with domain-wide delegation
  //   2. OAuth2 refresh tokens stored per user in IntegrationConfig
  //   3. Google Apps Script webhook that pushes emails to our sync endpoint
  //
  // Option 3 is the fastest to set up:
  //   1. Create a Google Apps Script in the Abel Google Workspace
  //   2. Set up a time-driven trigger (every 15 min)
  //   3. Script reads new emails → POSTs to /api/ops/communication-logs/gmail-sync
  //   4. Uses a shared API key for auth

  return NextResponse.json({
    status: 'setup_required',
    query,
    pageSize,
    emails: [],
    setupInstructions: {
      method: 'Google Apps Script (Recommended)',
      steps: [
        '1. Go to script.google.com and create a new project',
        '2. Copy the Gmail-to-AbelOS sync script (see /docs/gmail-sync-script.md)',
        '3. Set the ABEL_OS_URL and API_KEY variables',
        '4. Add a time-driven trigger to run every 15 minutes',
        '5. The script will push new emails to /api/ops/communication-logs/gmail-sync',
      ],
      alternativeMethods: [
        'OAuth2 flow with stored refresh tokens (requires Google Cloud project)',
        'Gmail push notifications via Pub/Sub (real-time, most complex)',
        'Manual sync via the Gmail Sync panel on the Communication Log page',
      ],
    },
  })
}
