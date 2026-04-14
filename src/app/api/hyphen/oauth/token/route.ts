export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { issueHyphenAccessToken, parseBasicAuth, HYPHEN_TOKEN_TTL_SECONDS } from '@/lib/hyphen/auth'

// ──────────────────────────────────────────────────────────────────────────
// POST /api/hyphen/oauth/token
//
// Implements the OAuth 2.0 Client Credentials grant (RFC 6749 §4.4) for
// Hyphen SPConnect. Hyphen calls this endpoint to exchange their client
// credentials for a short-lived Bearer access token.
//
// Per Hyphen's OAuth 2.0 Client Credentials Request spec, they will send
// EITHER application/json OR application/x-www-form-urlencoded, with
// client credentials EITHER as Basic auth in the Authorization header OR
// as client_id / client_secret in the body. We accept all combinations.
//
// Successful response shape (Hyphen looks for token_type, access_token,
// and optionally expires_in):
//
//   {
//     "token_type": "Bearer",
//     "access_token": "<opaque hex string>",
//     "expires_in": 3600,
//     "scope": "spconnect"
//   }
//
// Error response shape (RFC 6749 §5.2):
//
//   { "error": "invalid_client", "error_description": "..." }
// ──────────────────────────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  const contentType = request.headers.get('content-type') || ''
  let grantType: string | undefined
  let scope: string | undefined
  let bodyClientId: string | undefined
  let bodyClientSecret: string | undefined

  try {
    if (contentType.includes('application/json')) {
      const body = await request.json().catch(() => ({} as any))
      grantType = body.grant_type
      scope = body.scope
      bodyClientId = body.client_id
      bodyClientSecret = body.client_secret
    } else if (
      contentType.includes('application/x-www-form-urlencoded') ||
      contentType.includes('multipart/form-data')
    ) {
      const form = await request.formData()
      grantType = form.get('grant_type')?.toString()
      scope = form.get('scope')?.toString()
      bodyClientId = form.get('client_id')?.toString()
      bodyClientSecret = form.get('client_secret')?.toString()
    } else {
      // Try JSON first, fall back to form parsing — some clients send no
      // content-type header at all.
      const raw = await request.text()
      if (raw) {
        try {
          const body = JSON.parse(raw)
          grantType = body.grant_type
          scope = body.scope
          bodyClientId = body.client_id
          bodyClientSecret = body.client_secret
        } catch {
          const params = new URLSearchParams(raw)
          grantType = params.get('grant_type') || undefined
          scope = params.get('scope') || undefined
          bodyClientId = params.get('client_id') || undefined
          bodyClientSecret = params.get('client_secret') || undefined
        }
      }
    }
  } catch (e) {
    return errorResponse(400, 'invalid_request', 'Malformed request body')
  }

  if (grantType !== 'client_credentials') {
    return errorResponse(400, 'unsupported_grant_type', 'Only client_credentials is supported')
  }

  // Prefer Basic auth header, fall back to body-supplied credentials.
  const basic = parseBasicAuth(request.headers.get('authorization'))
  const clientId = basic?.clientId || bodyClientId
  const clientSecret = basic?.clientSecret || bodyClientSecret

  if (!clientId || !clientSecret) {
    return errorResponse(401, 'invalid_client', 'Client credentials missing')
  }

  const result = await issueHyphenAccessToken({ clientId, clientSecret, scope })

  if (!result.ok) {
    const status = result.error === 'invalid_client' ? 401 : result.error === 'invalid_request' ? 400 : 500
    return errorResponse(status, result.error, result.description)
  }

  return NextResponse.json(
    {
      token_type: 'Bearer',
      access_token: result.accessToken,
      expires_in: result.expiresInSeconds || HYPHEN_TOKEN_TTL_SECONDS,
      scope: result.scope || undefined,
    },
    {
      status: 200,
      // OAuth 2.0 spec requires no-store on token responses (RFC 6749 §5.1).
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
      },
    }
  )
}

// Hyphen may probe with a GET before sending real traffic.
export async function GET() {
  return NextResponse.json(
    {
      service: 'Abel OS — Hyphen SPConnect OAuth 2.0',
      grant_types_supported: ['client_credentials'],
      token_endpoint: '/api/hyphen/oauth/token',
    },
    { status: 200 }
  )
}

function errorResponse(status: number, error: string, description: string) {
  return NextResponse.json(
    { error, error_description: description },
    {
      status,
      headers: {
        'Cache-Control': 'no-store',
        Pragma: 'no-cache',
        // RFC 6750 §3 — populate WWW-Authenticate on 401 token errors.
        ...(status === 401
          ? { 'WWW-Authenticate': `Basic realm="hyphen-spconnect", error="${error}"` }
          : {}),
      },
    }
  )
}
