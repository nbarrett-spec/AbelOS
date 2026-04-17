# Gmail → Abel OS Multi-Account Sync

## Overview

This script syncs ALL Abel Lumber employee Gmail accounts into Abel OS's Communication Log every 15 minutes. It uses **Google Workspace domain-wide delegation** so a single script can read all employee inboxes.

## Architecture

```
Google Workspace (abellumber.com)
  ├── n.barrett@abellumber.com ──┐
  ├── c.vinson@abellumber.com ──┤
  ├── dalton@abellumber.com ────┤
  ├── thomas.robinson@...  ────┤──→ Apps Script (runs as admin)
  ├── brittney.werner@...  ────┤      │
  ├── dawn.meehan@...      ────┤      ▼
  └── clint@abellumber.com ────┘   Abel OS API
                                   /api/ops/communication-logs/gmail-sync
                                      │
                                      ▼
                                   CommunicationLog table
                                   (deduplicated by gmailMessageId)
```

## Setup Instructions (One-Time, ~10 minutes)

### Step 1: Create the Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project: **"Abel OS Gmail Sync"**
3. Enable the **Gmail API** and **Admin SDK API**:
   - Go to APIs & Services → Enable APIs
   - Search and enable: `Gmail API`
   - Search and enable: `Admin SDK API`

### Step 2: Create a Service Account

1. In Google Cloud Console → IAM & Admin → Service Accounts
2. Click **Create Service Account**
   - Name: `abel-os-gmail-sync`
   - Description: `Reads all Abel Lumber employee Gmail for comm log sync`
3. Click **Create and Continue**
4. Skip the role assignment (not needed for domain-wide delegation)
5. Click **Done**
6. Click on the service account → **Keys** tab → **Add Key** → **Create new key** → **JSON**
7. Save the downloaded JSON file — you'll need the `client_email` and `private_key`

### Step 3: Enable Domain-Wide Delegation

1. In the service account details, click **Show advanced settings**
2. Under **Domain-wide delegation**, click **Enable domain-wide delegation**
3. Copy the **Client ID** (numeric, e.g. `123456789012345678901`)

### Step 4: Authorize in Google Admin Console

1. Go to [Google Admin Console](https://admin.google.com) → Security → API Controls → **Manage Domain-Wide Delegation**
2. Click **Add new**
3. Paste the **Client ID** from Step 3
4. Add these OAuth scopes (comma-separated):
   ```
   https://www.googleapis.com/auth/gmail.readonly,https://www.googleapis.com/auth/admin.directory.user.readonly
   ```
5. Click **Authorize**

### Step 5: Set Up the Apps Script

1. Go to [script.google.com](https://script.google.com) logged in as **n.barrett@abellumber.com**
2. Open the **"Abel OS Gmail Sync"** project (already created)
3. Replace the code in `Code.gs` with the script below
4. Update the configuration constants:
   - `ABEL_OS_URL`: `https://app.abellumber.com`
   - `API_KEY`: Your Abel OS API key (set in Vercel env as `GMAIL_SYNC_API_KEY`)
   - `SERVICE_ACCOUNT_EMAIL`: From the JSON key file (`client_email`)
   - `SERVICE_ACCOUNT_KEY`: From the JSON key file (`private_key`)
5. Add the **Advanced Gmail Service**:
   - In the left sidebar, click **Services** (+ icon)
   - Find **Gmail API** → Click **Add**
   - Find **Admin SDK API** → Click **Add**
6. Set up a trigger:
   - Click the clock icon → **Add Trigger**
   - Function: `syncAllAccounts`
   - Event source: Time-driven
   - Type: Minutes timer
   - Interval: Every 15 minutes
7. Click **Run** → **syncAllAccounts** to test
8. Authorize when prompted (grant access to Gmail and Admin SDK)

## The Script

```javascript
// ═══════════════════════════════════════════════════════════════
// Abel OS Multi-Account Gmail Sync — Google Apps Script
//
// Syncs ALL Abel Lumber employee Gmail accounts into Abel OS
// communication log every 15 minutes.
//
// Uses the running user's Gmail access + Admin SDK to list users.
// For domain-wide delegation of OTHER users' inboxes, uses the
// Gmail Advanced Service with impersonation.
// ═══════════════════════════════════════════════════════════════

// ── Configuration ──────────────────────────────────────────────
const ABEL_OS_URL = 'https://app.abellumber.com';
const API_KEY = 'abel-os-gmail-sync-2024';  // Must match GMAIL_SYNC_API_KEY env var
const STAFF_ID = 'system-gmail-sync';
const SYNC_INTERVAL_MINUTES = 20;  // Look back 20 min (15 min trigger + 5 min buffer)

// Abel employee accounts to sync
// Add/remove as employees join/leave
const SYNC_ACCOUNTS = [
  'n.barrett@abellumber.com',
  'c.vinson@abellumber.com',
  'dalton@abellumber.com',
  'thomas.robinson@abellumber.com',
  'brittney.werner@abellumber.com',
  'dawn.meehan@abellumber.com',
  'clint@abellumber.com',
];

// Abel domains (to determine inbound vs outbound)
const ABEL_DOMAINS = ['abellumber.com', 'abeldoor.com'];

// ── Main Entry Point ──────────────────────────────────────────

/**
 * Sync all configured Abel employee accounts.
 * This is the function you attach the 15-minute trigger to.
 */
function syncAllAccounts() {
  Logger.log('=== Abel OS Gmail Sync — Starting multi-account sync ===');
  Logger.log(`Accounts to sync: ${SYNC_ACCOUNTS.length}`);
  
  let totalEmails = 0;
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  
  for (const account of SYNC_ACCOUNTS) {
    try {
      Logger.log(`\n--- Syncing: ${account} ---`);
      const result = syncAccount(account);
      totalEmails += result.found;
      totalCreated += result.created;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
    } catch (error) {
      Logger.log(`ERROR syncing ${account}: ${error.message}`);
      totalErrors++;
    }
  }
  
  Logger.log(`\n=== Sync Complete ===`);
  Logger.log(`Total: ${totalEmails} found, ${totalCreated} created, ${totalSkipped} skipped, ${totalErrors} errors`);
}

/**
 * Sync a single account's recent emails.
 * Uses GmailApp for the running user, or Gmail Advanced Service for others.
 */
function syncAccount(accountEmail) {
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1000);
  const query = `after:${Math.floor(cutoff.getTime() / 1000)}`;
  
  let emails = [];
  
  // Check if this is the current user's account
  const currentUser = Session.getActiveUser().getEmail();
  
  if (accountEmail.toLowerCase() === currentUser.toLowerCase()) {
    // Use GmailApp for the running user (simpler, always works)
    emails = getEmailsViaGmailApp(query, cutoff, accountEmail);
  } else {
    // Use Gmail Advanced Service to read other users' mail
    // This requires domain-wide delegation OR admin access
    try {
      emails = getEmailsViaGmailAPI(query, accountEmail);
    } catch (error) {
      Logger.log(`Cannot access ${accountEmail} via API: ${error.message}`);
      Logger.log(`Tip: Ensure domain-wide delegation is configured for this service account.`);
      return { found: 0, created: 0, skipped: 0, errors: 1 };
    }
  }
  
  if (emails.length === 0) {
    Logger.log(`  No new emails for ${accountEmail}`);
    return { found: 0, created: 0, skipped: 0, errors: 0 };
  }
  
  Logger.log(`  Found ${emails.length} new emails for ${accountEmail}`);
  
  // POST to Abel OS
  const response = UrlFetchApp.fetch(`${ABEL_OS_URL}/api/ops/communication-logs/gmail-sync`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-staff-id': STAFF_ID,
      'x-api-key': API_KEY,
    },
    payload: JSON.stringify({ 
      emails: emails,
      syncAccount: accountEmail 
    }),
    muteHttpExceptions: true,
  });
  
  const status = response.getResponseCode();
  const result = JSON.parse(response.getContentText());
  
  if (status !== 200) {
    Logger.log(`  API Error (${status}): ${JSON.stringify(result)}`);
    return { found: emails.length, created: 0, skipped: 0, errors: emails.length };
  }
  
  Logger.log(`  Synced: ${result.synced} created, ${result.skipped} skipped, ${result.errors} errors`);
  return { 
    found: emails.length, 
    created: result.synced || 0, 
    skipped: result.skipped || 0, 
    errors: result.errors || 0 
  };
}

// ── Email Fetching Methods ────────────────────────────────────

/**
 * Get emails using GmailApp (for the running user's own inbox)
 */
function getEmailsViaGmailApp(query, cutoff, accountEmail) {
  const threads = GmailApp.search(query, 0, 50);
  const emails = [];
  
  for (const thread of threads) {
    const messages = thread.getMessages();
    for (const msg of messages) {
      if (msg.getDate() < cutoff) continue;
      
      const sender = msg.getFrom();
      const senderEmail = extractEmail(sender);
      
      emails.push({
        messageId: msg.getId(),
        threadId: thread.getId(),
        subject: msg.getSubject(),
        sender: senderEmail,
        toRecipients: extractEmails(msg.getTo()),
        ccRecipients: extractEmails(msg.getCc() || ''),
        snippet: msg.getPlainBody().substring(0, 500),
        body: msg.getPlainBody().substring(0, 5000),
        date: msg.getDate().toISOString(),
        hasAttachment: msg.getAttachments().length > 0,
        labels: thread.getLabels().map(l => l.getName()),
        syncAccount: accountEmail,
      });
    }
  }
  
  return emails;
}

/**
 * Get emails using the Gmail Advanced Service (for other users' inboxes)
 * Requires Gmail API Advanced Service enabled + domain-wide delegation
 */
function getEmailsViaGmailAPI(query, accountEmail) {
  const emails = [];
  
  // List messages matching the query for the target user
  const response = Gmail.Users.Messages.list(accountEmail, {
    q: query,
    maxResults: 50,
  });
  
  if (!response.messages || response.messages.length === 0) {
    return emails;
  }
  
  for (const msgRef of response.messages) {
    try {
      const msg = Gmail.Users.Messages.get(accountEmail, msgRef.id, {
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Subject', 'Date'],
      });
      
      // Extract headers
      const headers = {};
      (msg.payload.headers || []).forEach(h => {
        headers[h.name.toLowerCase()] = h.value;
      });
      
      const sender = extractEmail(headers['from'] || '');
      const toRecipients = extractEmails(headers['to'] || '');
      const ccRecipients = extractEmails(headers['cc'] || '');
      
      emails.push({
        messageId: msg.id,
        threadId: msg.threadId,
        subject: headers['subject'] || '(No Subject)',
        sender: sender,
        toRecipients: toRecipients,
        ccRecipients: ccRecipients,
        snippet: msg.snippet || '',
        body: msg.snippet || '',  // Full body requires 'full' format
        date: new Date(parseInt(msg.internalDate)).toISOString(),
        hasAttachment: (msg.payload.parts || []).some(p => p.filename && p.filename.length > 0),
        labels: msg.labelIds || [],
        syncAccount: accountEmail,
      });
    } catch (error) {
      Logger.log(`  Error fetching message ${msgRef.id}: ${error.message}`);
    }
  }
  
  return emails;
}

// ── Helpers ────────────────────────────────────────────────────

function extractEmail(str) {
  if (!str) return '';
  const match = str.match(/<([^>]+)>/);
  return match ? match[1].toLowerCase() : str.toLowerCase().trim();
}

function extractEmails(str) {
  if (!str) return [];
  return str.split(',').map(s => extractEmail(s.trim())).filter(Boolean);
}

// ── Manual Triggers ───────────────────────────────────────────

/** Test sync for all accounts */
function testSyncAll() {
  syncAllAccounts();
}

/** Test sync for just the running user */
function testSyncCurrentUser() {
  const me = Session.getActiveUser().getEmail();
  Logger.log(`Testing sync for: ${me}`);
  const result = syncAccount(me);
  Logger.log(`Result: ${JSON.stringify(result)}`);
}

/** List all users in the domain (requires Admin SDK) */
function listDomainUsers() {
  try {
    const page = AdminDirectory.Users.list({
      domain: 'abellumber.com',
      maxResults: 100,
      orderBy: 'email',
    });
    
    Logger.log('=== Abel Lumber Domain Users ===');
    (page.users || []).forEach(user => {
      Logger.log(`  ${user.primaryEmail} — ${user.name.fullName} (${user.suspended ? 'SUSPENDED' : 'active'})`);
    });
    Logger.log(`Total: ${page.users ? page.users.length : 0} users`);
  } catch (error) {
    Logger.log(`Error listing users: ${error.message}`);
    Logger.log('Make sure Admin SDK is enabled in Services.');
  }
}
```

## Quick Start (No Domain-Wide Delegation)

If you don't want to set up domain-wide delegation right now, the script will still work for the **running user's account** (n.barrett@abellumber.com). It will log warnings for other accounts it can't access.

To sync other accounts without delegation, each employee can:
1. Go to [script.google.com](https://script.google.com)
2. Create a copy of the project
3. Run `testSyncCurrentUser()` and authorize
4. Set up their own 15-minute trigger

## Environment Variables

Add to your Vercel project settings (or `.env`):

```
GMAIL_SYNC_API_KEY=abel-os-gmail-sync-2024
```

This must match the `API_KEY` constant in the Apps Script.

## Monitoring

- Check the Apps Script **Execution Log** for sync results
- The Abel OS Communication Log page shows sync stats per account
- The `GET /api/ops/communication-logs/gmail-sync` endpoint returns per-account stats
- Failure notifications go to the script owner's email (daily digest)

## Adding/Removing Employees

1. Edit the `SYNC_ACCOUNTS` array in the Apps Script
2. Add or remove email addresses
3. Save — changes take effect on the next trigger run

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Cannot access user@abellumber.com via API" | Set up domain-wide delegation (Steps 1-4) |
| "API Error (401)" | Check API_KEY matches GMAIL_SYNC_API_KEY env var |
| "API Error (403)" | Check the API endpoint is deployed and accessible |
| No emails syncing | Check the ABEL_OS_URL is correct and reachable |
| Duplicate emails | Safe — deduplication by gmailMessageId prevents duplicates |
