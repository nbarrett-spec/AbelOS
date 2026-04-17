# Gmail → Abel OS Auto-Sync Script

## Setup Instructions

1. Go to [script.google.com](https://script.google.com) logged in as an Abel Lumber admin
2. Create a new project named "Abel OS Gmail Sync"
3. Paste the script below into `Code.gs`
4. Set the `ABEL_OS_URL` and `API_KEY` constants
5. Click **Run** → **syncRecentEmails** to test
6. Go to **Triggers** (clock icon) → **Add Trigger**:
   - Function: `syncRecentEmails`
   - Event source: Time-driven
   - Type: Minutes timer
   - Interval: Every 15 minutes
7. Authorize the script when prompted

## The Script

```javascript
// ═══════════════════════════════════════════════════════════════
// Abel OS Gmail Sync — Google Apps Script
//
// Runs every 15 minutes, finds new emails, pushes to Abel OS
// communication log via the gmail-sync API endpoint.
// ═══════════════════════════════════════════════════════════════

// ── Configuration ──────────────────────────────────────────────
const ABEL_OS_URL = 'https://YOUR_DOMAIN.vercel.app';  // Your Abel OS URL
const API_KEY = 'YOUR_API_KEY';                         // Staff API key or service key
const STAFF_ID = 'system-gmail-sync';                   // Staff ID for audit trail
const SYNC_INTERVAL_MINUTES = 20;                       // Look back this many minutes

// Abel email domains (to determine inbound vs outbound)
const ABEL_DOMAINS = ['abellumber.com', 'abeldoor.com'];

function syncRecentEmails() {
  const cutoff = new Date(Date.now() - SYNC_INTERVAL_MINUTES * 60 * 1000);
  const query = `after:${Math.floor(cutoff.getTime() / 1000)}`;
  
  const threads = GmailApp.search(query, 0, 50);
  const emails = [];
  
  for (const thread of threads) {
    const messages = thread.getMessages();
    
    for (const msg of messages) {
      // Only sync messages newer than our cutoff
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
      });
    }
  }
  
  if (emails.length === 0) {
    Logger.log('No new emails to sync');
    return;
  }
  
  Logger.log(`Found ${emails.length} new emails, syncing to Abel OS...`);
  
  // POST to Abel OS
  const response = UrlFetchApp.fetch(`${ABEL_OS_URL}/api/ops/communication-logs/gmail-sync`, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-staff-id': STAFF_ID,
      'x-api-key': API_KEY,
    },
    payload: JSON.stringify({ emails }),
    muteHttpExceptions: true,
  });
  
  const result = JSON.parse(response.getContentText());
  Logger.log(`Sync complete: ${result.synced} created, ${result.skipped} skipped, ${result.errors} errors`);
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

// ── Manual trigger for testing ────────────────────────────────

function testSync() {
  syncRecentEmails();
}
```

## What This Does

1. Every 15 minutes, searches Gmail for new messages
2. Extracts sender, recipients, subject, body snippet
3. POSTs to Abel OS `/api/ops/communication-logs/gmail-sync`
4. Abel OS deduplicates by `gmailMessageId` and auto-matches builders
5. Emails appear in the Communication Log with "Auto-synced" badge

## Notes

- The script runs under the Google account that creates it
- To sync multiple accounts, deploy one script per account or use domain-wide delegation
- Messages are deduplicated by Gmail message ID — safe to re-run
- The script only looks back 20 minutes by default to stay fast
- Body is truncated to 5000 chars to keep the database lean
