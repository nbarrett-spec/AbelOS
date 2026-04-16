export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { checkStaffAuthWithFallback } from '@/lib/api-auth'
import {
  listHyphenCredentials,
  mintHyphenCredential,
  revokeHyphenCredential,
} from '@/lib/hyphen/auth'
import { audit } from '@/lib/audit'

// GET  /api/admin/hyphen/credentials       → list all client credentials
// POST /api/admin/hyphen/credentials       → mint a new credential (returns plaintext secret ONCE)
// DELETE /api/admin/hyphen/credentials?id= → revoke credential + tokens

export async function GET(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  try {
    const credentials = await listHyphenCredentials()
    return NextResponse.json({ credentials })
  } catch (e: any) {
    console.error('[admin/hyphen/credentials] list error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to load credentials' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const label = (body?.label || '').toString().trim()
  if (!label) {
    return NextResponse.json({ error: 'label is required' }, { status: 400 })
  }
  const scope = body?.scope ? body.scope.toString().trim() : undefined

  try {
    const minted = await mintHyphenCredential({
      label,
      scope,
      createdById: request.headers.get('x-staff-id') || undefined,
    })
    await audit(request, 'CREATE', 'HyphenCredential', minted.id, { label, scope }, 'WARN')
    return NextResponse.json({
      credential: {
        id: minted.id,
        clientId: minted.clientId,
        // Plaintext secret returned exactly once. UI must warn the operator.
        clientSecret: minted.clientSecret,
        label: minted.label,
        scope: minted.scope,
      },
    })
  } catch (e: any) {
    console.error('[admin/hyphen/credentials] mint error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to mint credential' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest) {
  const authError = await checkStaffAuthWithFallback(request)
  if (authError) return authError

  const { searchParams } = new URL(request.url)
  const id = searchParams.get('id')
  if (!id) {
    return NextResponse.json({ error: 'id query parameter is required' }, { status: 400 })
  }

  try {
    await revokeHyphenCredential(id)
    await audit(request, 'REVOKE', 'HyphenCredential', id, {}, 'CRITICAL')
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    console.error('[admin/hyphen/credentials] revoke error:', e)
    return NextResponse.json({ error: e?.message || 'Failed to revoke credential' }, { status: 500 })
  }
}
