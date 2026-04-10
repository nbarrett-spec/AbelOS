export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'

// GET /api/ops/integrations/quickbooks/qwc — Download .qwc configuration file
// This file is used by QuickBooks Web Connector to configure the sync endpoint
export async function GET(request: NextRequest) {
  try {
    // Get the app URL from environment or derive from request
    const appUrl =
      process.env.APP_URL ||
      `${request.nextUrl.protocol}//${request.nextUrl.host}`

    // Generate .qwc configuration XML
    const qwcContent = generateQwcConfig(appUrl)

    // Return as XML file with proper headers for download
    return new NextResponse(qwcContent, {
      status: 200,
      headers: {
        'Content-Type': 'text/xml; charset=utf-8',
        'Content-Disposition': 'attachment; filename="abel-builder-qb-sync.qwc"',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    })
  } catch (error) {
    console.error('QWC generation error:', error)
    return new NextResponse(`Error generating QWC file: ${String(error)}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain' },
    })
  }
}

/**
 * Generate the .qwc configuration file content
 * QWC format: https://developer.intuit.com/app/developer/qbwc/docs/documentation/web-connector-specification
 */
function generateQwcConfig(appUrl: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<qbwcConfig>
  <AppName>Abel Builder QuickBooks Sync</AppName>
  <AppID></AppID>
  <AppVersion>1.0.0</AppVersion>
  <MinQBVersion>13.0</MinQBVersion>
  <MaxQBVersion>2024.0</MaxQBVersion>
  <AppDescription>Syncs Builders, Invoices, and Purchase Orders to QuickBooks Desktop</AppDescription>
  <AppURL>${escapeXmlAttribute(appUrl)}/api/ops/integrations/quickbooks/webconnector</AppURL>
  <OwnerID></OwnerID>
  <OwnerName>Abel Lumber</OwnerName>
  <Phone></Phone>
  <Email></Email>
  <Contact></Contact>
  <SupportURL></SupportURL>
  <AuthFlags>
    <Busy>false</Busy>
    <Interactive>true</Interactive>
  </AuthFlags>
  <IsAuthorized>true</IsAuthorized>
  <Preferences>
    <Preference name="AuthenticationTokensExpire">false</Preference>
    <Preference name="PromptUserToManuallyAuthorizeApp">false</Preference>
    <Preference name="PreferencesMask">0</Preference>
  </Preferences>
  <NotificationEvents>
    <Event name="QBCertificateExpired" active="false" />
    <Event name="QBCertificateRenewalNeeded" active="false" />
  </NotificationEvents>
</qbwcConfig>`
}

/**
 * Escape XML attribute values
 */
function escapeXmlAttribute(str: string): string {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
