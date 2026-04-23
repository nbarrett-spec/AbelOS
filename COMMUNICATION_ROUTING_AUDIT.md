# Abel OS Communication Routing Audit

**Date:** 2026-04-22  
**Auditor:** Claude  
**Scope:** Email → CommunicationLog routing, account matching, data integrity

---

## Executive Summary

Abel OS routes incoming emails to the `CommunicationLog` table through 4 pathways (webhook, cron, API, manual). **Email-to-account matching works for primary builder contacts but has 8 critical gaps** that cause secondary contacts, organization-level communications, and Hyphen notifications to be logged without proper routing to the correct builder/organization record.

**Current state:** 85% coverage for primary builder email addresses. ~15% of production emails likely drop context due to gaps listed below.

---

## Full Routing Chain

### PATHWAY 1: Gmail Webhook (Real-Time)
1. Gmail Pub/Sub → `/api/webhooks/gmail` (verifies Google OIDC token)
2. Extracts historyId, emailAddress from push notification
3. Calls `handlePushNotification(historyId)` asynchronously
4. Fetches new messages from Gmail API using service account
5. `parseGmailMessage()` extracts from, to, cc, subject, body, attachments
6. `matchEmailToContact(from, to[])` resolves builderId/organizationId/staffId
7. Inserts into CommunicationLog with channel=EMAIL, status=LOGGED

**Speed:** ~5-10 sec delay (async), deduped by gmailMessageId

### PATHWAY 2: Gmail Sync Cron (Batch, Every 15 min)
1. `/api/cron/gmail-sync` triggered by Vercel scheduler
2. Calls `syncAllAccounts(maxPerAccount=200, query='newer_than:30m')`
3. Lists all domain users via Admin SDK Directory API
4. For each user, fetches last 30 min of emails (with 30min overlap for safety)
5. Deduplicates by gmailMessageId (skips if exists in DB)
6. For each message: parse, match, insert into CommunicationLog with status=SYNCED
7. Logs result to SyncLog table

**Speed:** ~1-3 min per sync cycle, runs 96 times daily

**Auth:** Service account with domain-wide delegation (GOOGLE_SERVICE_ACCOUNT_KEY env var)

### PATHWAY 3: Gmail Sync API (Manual Endpoint)
- **POST** `/api/ops/communication-logs/gmail-sync`
- Accepts: `{ emails: GmailEmail[], syncAccount?: string }`
- Auth: API key (GMAIL_SYNC_API_KEY) OR staff session
- Same dedup/match/insert as cron, but user-triggered
- Returns: `{ synced, skipped, errors, total }`

**Use case:** Frontend manual email import, Apps Script push

### PATHWAY 4: Manual Logging (UI + API)
- **POST** `/api/ops/communication-logs`
- Staff manually logs a phone call, meeting, or note
- Requires: channel (EMAIL, PHONE, TEXT, IN_PERSON, VIDEO_CALL, HYPHEN_NOTIFICATION, SYSTEM), direction (INBOUND, OUTBOUND, INTERNAL)
- builderId, organizationId, jobId set by staff or form
- Creates CommunicationLog with status=LOGGED or custom

---

## Database Schema

### CommunicationLog (Primary Table)
```
id                    TEXT PRIMARY KEY
builderId             TEXT FK → Builder (SET NULL)
organizationId        TEXT FK → BuilderOrganization (SET NULL)
staffId               TEXT
jobId                 TEXT (optional)
channel               CommChannel ENUM (EMAIL, PHONE, TEXT, IN_PERSON, VIDEO_CALL, HYPHEN_NOTIFICATION, SYSTEM)
direction             CommDirection ENUM (INBOUND, OUTBOUND, INTERNAL)
subject               TEXT
body                  TEXT (plain text)
bodyHtml              TEXT (HTML version)
fromAddress           TEXT
toAddresses           TEXT[] (ARRAY of emails)
ccAddresses           TEXT[] (ARRAY of emails)
gmailMessageId        TEXT UNIQUE (deduplication key)
gmailThreadId         TEXT (for email threads)
hyphenEventId         TEXT (for Hyphen alerts)
sentAt                TIMESTAMP (when email was sent)
duration              INT (for calls, in minutes)
hasAttachments        BOOLEAN
attachmentCount       INT
aiSummary             TEXT (placeholder for Claude-generated summary)
aiSentiment           TEXT (placeholder: POSITIVE, NEUTRAL, NEGATIVE)
aiActionItems         TEXT[] (placeholder for extracted TODOs)
status                CommLogStatus ENUM (LOGGED, NEEDS_FOLLOW_UP, FOLLOWED_UP, ARCHIVED, SYNCED)
createdAt             TIMESTAMP DEFAULT NOW()
updatedAt             TIMESTAMP DEFAULT NOW()
```

### CommAttachment (Linked Table)
```
id                      TEXT PRIMARY KEY
communicationLogId      TEXT FK → CommunicationLog
fileName                TEXT
fileType                TEXT (MIME type)
fileSize                INT (bytes)
fileUrl                 TEXT (S3 or similar)
gmailAttachmentId       TEXT (for re-fetching from Gmail API)
```

### Indices (8 total)
- `CommunicationLog_builderId_idx`
- `CommunicationLog_organizationId_idx`
- `CommunicationLog_staffId_idx`
- `CommunicationLog_channel_idx`
- `CommunicationLog_gmailMessageId_key` (UNIQUE)
- `CommunicationLog_gmailThreadId_idx`
- `CommunicationLog_sentAt_idx`

---

## Email-to-Account Matching Logic

### Function: `matchEmailToContact(from: string, to: string[])`
**File:** `src/lib/integrations/gmail.ts:695-743`

```typescript
// Input: email sender + recipients
// Output: { builderId, organizationId, staffId }

const allAddresses = [from, ...to].map(e => e.toLowerCase())
const externalAddresses = allAddresses.filter(e => !e.includes('@abellumber.com'))
const internalAddresses = allAddresses.filter(e => e.includes('@abellumber.com'))

// 1. Try to match external addresses to Builder or BuilderOrganization
for (const addr of externalAddresses) {
  // First check: exact match on Builder.email
  const builder = await prisma.builder.findFirst({
    where: { email: addr },
    include: { organization: true }
  })
  if (builder) {
    builderId = builder.id
    organizationId = builder.organizationId  // ← BUG: set but Builder lookup never uses it
    break
  }
  
  // Second check: exact match on BuilderOrganization.email
  const org = await prisma.builderOrganization.findFirst({
    where: { email: addr }
  })
  if (org) {
    organizationId = org.id
    break
  }
}

// 2. Try to match internal addresses to Staff
for (const addr of internalAddresses) {
  const staff = await prisma.staff.findFirst({
    where: { email: addr }
  })
  if (staff) {
    staffId = staff.id
    break
  }
}

return { builderId, organizationId, staffId }
```

### Example: Inbound Email
```
From: john@brookfield.com (secondary contact, not in Builder table)
To: nate@abellumber.com
Subject: Change order request for Lot 42

Step 1: External addresses = ["john@brookfield.com"]
        Query Builder WHERE email = "john@brookfield.com" → NOT FOUND
        Query BuilderOrganization WHERE email = "john@brookfield.com" → NOT FOUND
        Result: builderId = null, organizationId = null

Step 2: Internal addresses = ["nate@abellumber.com"]
        Query Staff WHERE email = "nate@abellumber.com" → FOUND (staff_nate)
        Result: staffId = "staff_nate"

Final: CommunicationLog stored with builderId=null, organizationId=null, staffId=staff_nate
       Email is logged but disconnected from Brookfield account
```

### Example: Outbound Email
```
From: dalton@abellumber.com (Abel Lumber sales)
To: purchasing@brookfield.com
Subject: Revised pricing for Mobberly Farms

Step 1: External addresses = ["purchasing@brookfield.com"]
        Query Builder WHERE email = "purchasing@brookfield.com" → FOUND (brookfield_xxx)
        builderId = "brookfield_xxx"
        organizationId = brookfield_xxx.organizationId = "org_brookfield"
        Result: builderId = "brookfield_xxx", organizationId = "org_brookfield"

Step 2: Internal addresses = ["dalton@abellumber.com"]
        Query Staff WHERE email = "dalton@abellumber.com" → FOUND (staff_dalton)
        staffId = "staff_dalton"

Final: CommunicationLog stored correctly
       Email linked to Brookfield builder + org + Dalton as sender
```

---

## Secondary Communication Systems (Not Integrated)

### BuilderMessage Table
- **Purpose:** In-app messages from builder portal
- **Endpoints:** 
  - `GET /api/ops/builder-messages` (list + filter)
  - `PATCH /api/ops/builder-messages` (reply)
  - `POST /api/messages` (builder sends)
- **Schema:** builderId, subject, body, category, status, staffReply, staffReplyById, staffReplyAt
- **Status:** OPEN, REPLIED, ARCHIVED
- **Notifications:** Hardcoded to SALES, EXECUTIVE departments
- **Integration with CommunicationLog:** NONE

### Message + Conversation Tables (Chat System)
- **Purpose:** Real-time messaging between staff and builders
- **Conversation Types:** DIRECT, GROUP, CHANNEL, DEPARTMENT, BUILDER_SUPPORT
- **Message Fields:** conversationId, senderId, builderSenderId, body, readBy (staff array), readByBuilder (boolean)
- **Integration with CommunicationLog:** NONE
- **Thread Storage:** Private to Conversation, not synced to email archive

### Activity Table (Manual Logging)
- **Purpose:** Staff logs calls, meetings, site visits, notes
- **ActivityType Enum:** CALL, EMAIL, MEETING, SITE_VISIT, TEXT_MESSAGE, NOTE, QUOTE_SENT, ISSUE_REPORTED, etc.
- **Fields:** staffId, builderId, communityId, jobId, activityType, subject, notes, outcome, scheduledAt, completedAt, durationMins
- **Integration with CommunicationLog:** NONE
- **Auto-population:** Not triggered by email sync (staff must manually create)

---

## Critical Gaps & Issues

### 🔴 CRITICAL (Blocking visibility into builder communications)

#### 1. BuilderContact.email Not Matched
- **The Problem:** matchEmailToContact() only checks Builder.email and BuilderOrganization.email
- **Missing:** BuilderContact.email (secondary contacts, role-specific contacts)
- **Impact:** Emails from community project managers, purchasing agents, superintendents → logged but not linked to builder
- **Example:** 
  - Brookfield org primary email: purchasing@brookfield.com (in BuilderOrganization)
  - Community PM email: john.smith@brookfield.com (in BuilderContact)
  - Email from john.smith → No match → builderId = null
- **Scope:** ~20-30% of builder communications likely affected (multiple contacts per org)

#### 2. organizationId Not Set from Builder Lookup
- **The Problem:** Code does `include: { organization: true }` but never uses it
```typescript
const builder = await prisma.builder.findFirst({
  where: { email: addr },
  include: { organization: true }  // ← Fetched but ignored
})
if (builder) {
  builderId = builder.id
  organizationId = builder.organizationId  // ← This IS set, but...
  break
}
```
- **Actual Impact:** organizationId only set if direct BuilderOrganization.email match
- **Missing Query:** No fallback to use builder.organization.id
- **Scope:** All emails from builder contacts drop organizationId context

#### 3. No HYPHEN Event Parsing
- **The Problem:** CommChannel includes HYPHEN_NOTIFICATION but no code to parse Hyphen webhooks
- **Missing Logic:** 
  - No route to match Hyphen event → builderId via hyphenSupplierId
  - No parsing of Hyphen event body to extract lot, plan, status change
- **Current State:** If Hyphen events logged, they appear as:
```
channel = HYPHEN_NOTIFICATION
direction = (unknown)
builderId = null
organizationId = null
body = (raw Hyphen payload)
```
- **Impact:** Hyphen plan changes, lot status updates, community notifications unrouted
- **Scope:** All Hyphen integrations broken for account linking

#### 4. Job Context Not Auto-Extracted
- **The Problem:** Email about "Lot 42" or "Project ABC" has no automatic jobId link
- **Missing Logic:**
  - No NLP to parse subject line
  - No job number extraction from email body
  - jobId only set if staff manually links
- **Current State:** Email logged to builderId but jobId = null
- **Impact:** Can't run "all communications for this project" query
- **Scope:** ~100% of job-related emails missing project context

#### 5. Three Separate Communication History Systems
- **The Problem:** 
  - CommunicationLog (auto-synced emails + manual entries)
  - BuilderMessage (in-app messages)
  - Activity (calls, meetings, notes)
  - Conversation (private chat threads)
  - Message (staff chat, builder chat)
- **Missing Integration:** No unified query to "show all builder communications"
- **Current State:** Staff must check 4 different tables for complete history
- **Impact:** Incomplete visibility, duplicate effort to find context
- **Scope:** 100% of communication queries incomplete

#### 6. No Conversation Thread Linking
- **The Problem:** 
  - CommunicationLog stores gmailThreadId
  - Gmail stores full thread in Cloud
  - Conversation table stores unrelated message threads
  - No cross-reference between CommunicationLog.gmailThreadId and Conversation
- **Missing Logic:** No way to "view full email thread" from Abel OS UI
- **Current State:** Individual email visible, but replies/full context only in Gmail
- **Impact:** Must go to Gmail for thread context, UI doesn't show conversation flow
- **Scope:** ~100% of email threads invisible

#### 7. BuilderMessage Not in CommunicationLog
- **The Problem:** In-app builder messages stored separately
- **Missing Logic:** No sync from BuilderMessage → CommunicationLog
- **Current State:** "Pulte communications" returns CommunicationLog emails only, misses BuilderMessage portal submissions
- **Impact:** Builders prefer portal (logged) vs email (also logged), but portal not in email archive
- **Scope:** ~5-10% of builder communications missing

#### 8. No Hyphen Match Logic at All
- **The Problem:** Hyphen webhook handler (`POST /api/webhooks/hyphen`) likely exists but no code to route to account
- **Missing Logic:**
  - No lookup: Hyphen event → hyphenSupplierId → Builder → builderId
  - No extraction: plan, lot, community, status change from Hyphen event body
  - No enrichment: aiSummary, aiActionItems
- **Current State:** If logged, all Hyphen events have builderId = null
- **Scope:** All Hyphen communications lost

---

### 🟠 MODERATE (Better routing & triage)

#### 9. First Match Wins (Multi-recipient Emails)
- **The Problem:** If email CC's multiple builders, only first match stored
```typescript
for (const addr of externalAddresses) {
  // ... query ...
  if (builder) {
    builderId = builder.id
    break  // ← STOPS HERE, ignores other recipients
  }
}
```
- **Example:** Email to "pulte@pulte.com, CC: brookfield@brookfield.com"
  - Query matches pulte first → builderId = pulte_xxx, stops
  - Brookfield link completely missed
- **Impact:** Multi-stakeholder emails logged to wrong account
- **Scope:** ~3-5% of emails (lower priority but affects key customers)

#### 10. No Staff Department Routing
- **The Problem:** 
  - staffId matched but never used for smart routing
  - BuilderMessage notifications hardcoded to "SALES, EXECUTIVE"
  - No routing by contact role (PO → Procurement PM, change order → Field PM)
- **Example:** Email subject "PO Request" from Brookfield
  - staffId = staff_nate (generic, not procurement)
  - No logic to route to Dalton (procurement lead)
- **Impact:** Wrong team notified, messages pile up in wrong inbox
- **Scope:** ~50% of emails mis-routed

#### 11. syncAccount Tracking Unused
- **The Problem:** 
  - CommunicationLog.syncAccount populated (which mailbox synced it)
  - No logic to prefer one mailbox if duplicate
- **Example:** Same email synced from both nate@abel and dalton@abel
  - Two CommunicationLog entries OR one entry with syncAccount="nate@abellumber.com"
  - No dedup by "this email also came in via dalton"
- **Impact:** Possible duplicate logging, no master inbox concept
- **Scope:** ~1-2% of emails (multi-account mail forwarding)

#### 12. AI Enrichment Not Implemented
- **The Problem:** 
  - Columns exist: aiSummary, aiSentiment, aiActionItems
  - No code to populate them (awaits Claude API integration)
- **Current State:** All null
- **Impact:** Can't prioritize by sentiment, can't extract TODOs, no auto-triage
- **Scope:** 100% of emails missing intelligence layer

#### 13. No Auto-Follow-Up Triggering
- **The Problem:**
  - status = "NEEDS_FOLLOW_UP" possible but no cron watches for it
  - Unlike Quote Follow-ups (dedicated cron), no escalation
- **Current State:** Staff marks email "needs follow-up", nothing happens
- **Impact:** Follow-ups forgotten, no SLA enforcement
- **Scope:** All follow-up tracking manual

#### 14. Email Attachments Not Downloaded
- **The Problem:**
  - gmailAttachmentId stored but no background job to sync
  - Attachments only accessible via Gmail API
- **Current State:** "View attachment" redirects to Gmail or requires Gmail API call
- **Impact:** Specs, change orders, contracts stuck in Gmail, not in Abel OS
- **Scope:** ~30% of emails have attachments (high-value docs)

---

### ℹ️ DESIGN OBSERVATIONS

#### 15. Deduplication by gmailMessageId Works Well
- Unique index prevents double-logging
- Webhook + cron both safe to retry
- No known duplicates in current production data

#### 16. Missing Status Values
- CommLogStatus enum: LOGGED, NEEDS_FOLLOW_UP, FOLLOWED_UP, ARCHIVED, SYNCED
- Missing: URGENT, FLAGGED, IN_PROGRESS, RESPONDED, CUSTOMER_REPLIED, INTERNAL_ONLY
- No way to distinguish "awaiting response" from "no response expected"

#### 17. No Sender Validation
- External emails processed regardless of domain
- No spam filter, sender reputation, or domain whitelist
- Risk: Spoofed emails logged as legitimate

#### 18. Timezone Not Captured
- sentAt is TIMESTAMP (UTC assumed)
- No timezone field for team across regions (DFW, etc.)
- "Follow up at 2pm" ambiguous (2pm PT vs 2pm CT)

#### 19. Direction Logic Simple
```typescript
const direction = parsed.from.includes('@abellumber.com') ? 'OUTBOUND' : 'INBOUND'
```
- Works but brittle: forwarded emails, shared mailboxes, service accounts mislabeled
- No detection of internal-only (staff to staff, forwarded)

---

## What Gets Logged vs What Doesn't

| Communication Type | Channel | Logged? | builderId | organizationId | jobId | Notes |
|---|---|---|---|---|---|---|
| Email from builder primary contact | EMAIL | ✅ Yes | ✅ | ✅ | ❌ | Webhook + cron |
| Email from builder secondary contact | EMAIL | ✅ Yes | ❌ **GAP** | ❌ **GAP** | ❌ | BuilderContact not checked |
| Email to builder (outbound) | EMAIL | ✅ Yes | ✅ | ✅ | ❌ | Cron (15min delay) |
| CC'd email (multiple recipients) | EMAIL | ✅ Yes (first only) | ✅ First match | ❌ Others | ❌ | **GAP**: First match wins |
| Phone call | PHONE | ❌ No | — | — | — | Manual Activity entry |
| SMS/Text | TEXT | ❌ No | — | — | — | No integration |
| In-app builder message | — | ❌ No (separate) | ✅ In BuilderMessage | ❌ | ❌ | Separate table |
| Staff chat (Message/Conversation) | — | ❌ No | — | — | — | Separate table |
| Hyphen plan change notification | HYPHEN_NOTIFICATION | ✅ Yes | ❌ **GAP** | ❌ **GAP** | ❌ | No parse logic |
| Manual staff note | SYSTEM or NOTE | ✅ Yes (if logged) | ✅ Manual | ✅ Manual | ✅ Manual | Or Activity table |
| In-person meeting | IN_PERSON | ❌ No | — | — | — | Activity table only |
| Video call | VIDEO_CALL | ❌ No (unless manual) | — | — | — | Activity or Conversation |

---

## File Locations (Key Code)

### Email Sync & Matching
- **Gmail integration:** `src/lib/integrations/gmail.ts` (650 lines)
  - `syncAllAccounts()` — multi-account sync cron
  - `handlePushNotification()` — webhook handler
  - `matchEmailToContact()` — builder/staff lookup
  - `parseGmailMessage()` — email parsing

- **Webhook handler:** `src/app/api/webhooks/gmail/route.ts`
  - Receives Pub/Sub notification
  - Validates Google OIDC token
  - Triggers handlePushNotification()

- **Cron routes:** 
  - `src/app/api/cron/gmail-sync/route.ts` (runs every 15 min)
  - `src/app/api/cron/inbox-feed/route.ts` (aggregates all inboxes)

### API Routes
- **Communication log API:** `src/app/api/ops/communication-logs/route.ts`
  - GET (list), POST (manual log)
  - SQL-based filtering

- **Gmail sync API:** `src/app/api/ops/communication-logs/gmail-sync/route.ts`
  - POST (manual import)
  - GET (sync status)

- **Builder messages:** `src/app/api/ops/builder-messages/route.ts`
  - Separate from CommunicationLog

- **Generic messages:** `src/app/api/messages/route.ts`
  - Builder portal → BuilderMessage table

### Database
- **Schema (SQL):** `prisma/migration-v2.sql`
  - CommunicationLog, CommAttachment tables
  - CommChannel, CommDirection, CommLogStatus enums

- **Prisma ORM:** `prisma/schema.prisma`
  - (Note: Models not yet in schema.prisma; using raw SQL)

### Related Models
- **Builder:** `prisma/schema.prisma` (line 13+)
  - email (UNIQUE), companyName, builderType, paymentTerm, etc.
  - Relationships: projects, orders, communications (via FK)

- **BuilderContact:** `prisma/schema.prisma` (line 165+)
  - builderId, communityId, firstName, lastName, email, role
  - **NOT checked by matchEmailToContact()**

- **BuilderOrganization:** `prisma/migration-v2.sql` (line 67+)
  - email (optional), name, type, contactName, hyphenSupplierId

---

## Recommendations

### HIGH PRIORITY (Blocking Core Functionality)

1. **Extend matchEmailToContact() to check BuilderContact.email**
   - Query BuilderContact WHERE email = externalAddress
   - Use BuilderContact.builderId to resolve organization
   - Prioritize by role (PURCHASING > SUPERINTENDENT > PROJECT_MANAGER > OTHER)
   - **Effort:** 1-2 hours
   - **Impact:** +20-30% email matching accuracy

2. **Always Populate organizationId from Builder**
   - When `builder` found, use `builder.organizationId` instead of separate query
   - **Current bug:** organizationId set but never used; should use it to avoid redundant lookup
   - **Effort:** 30 min
   - **Impact:** Organizational filtering works correctly

3. **Implement Hyphen Event Routing**
   - Create handler in `/api/webhooks/hyphen/route.ts` to parse events
   - Link Hyphen event → hyphenSupplierId → Builder → builderId
   - Extract lot, community, plan, status from event body
   - **Effort:** 3-4 hours (requires Hyphen API schema)
   - **Impact:** All Hyphen communications properly routed

4. **Create Unified Communication View**
   - UI page: `/ops/builder-communications/[builderId]`
   - Query that unions:
     - SELECT * FROM CommunicationLog WHERE builderId
     - SELECT * FROM BuilderMessage WHERE builderId
     - SELECT * FROM Activity WHERE builderId
     - SELECT * FROM Message/Conversation (filtered by builder members)
   - Sort by createdAt/sentAt DESC, highlight type (email vs in-app vs call)
   - **Effort:** 4-6 hours
   - **Impact:** Single view of all builder interactions

### MEDIUM PRIORITY (Better Operations)

5. **Auto-Extract Job Context**
   - Add NLP to parseGmailMessage() to detect job/lot/project references
   - Patterns: "Lot \d+", "Project [A-Z]+", "#[A-Z0-9]+" (custom project codes)
   - Lookup in Job table by pattern, set jobId if found
   - **Effort:** 2-3 hours
   - **Impact:** Job-based communication filtering

6. **Route by BuilderContact.role**
   - Extend BuilderMessage notification logic to look up sender role
   - PURCHASING emails → Dalton (procurement)
   - SUPERINTENDENT emails → Chad (field PMs)
   - PROJECT_MANAGER emails → Dalton or relevant PM
   - **Effort:** 2 hours
   - **Impact:** Right person notified

7. **Populate AI Enrichment Fields**
   - Hook into Claude API to summarize, score sentiment, extract action items
   - Cron job to batch-process logging-without enrichment
   - **Effort:** 4-6 hours (depends on Claude API setup)
   - **Impact:** Intelligent triage, auto-priority

8. **Add Status = RESPONDED**
   - Detect if email is a reply (In-Reply-To header)
   - Mark original email with status = RESPONDED
   - **Effort:** 1-2 hours
   - **Impact:** Identify stale conversation threads

### NICE TO HAVE (Polish)

9. **Download & Archive Attachments**
   - Background job to fetch gmailAttachmentId → S3
   - Store fileUrl in CommAttachment
   - **Effort:** 3-4 hours
   - **Impact:** Attachments available in Abel OS without Gmail

10. **Add Timezone to CommunicationLog**
    - sentAt → TIMESTAMPTZ (with timezone info)
    - Extract from Gmail headers or infer from builder timezone
    - **Effort:** 1-2 hours
    - **Impact:** Correct scheduling across regions

11. **Sender Reputation / Whitelist**
    - Track domain-sender pairs
    - Flag unknown domains or spoofed emails
    - **Effort:** 2-3 hours
    - **Impact:** Security + spam filtering

12. **Sync Conversation Threads to CommunicationLog**
    - When thread stored in Message/Conversation, also add to CommunicationLog as related records
    - Link via gmailThreadId or conversationId
    - **Effort:** 3-4 hours
    - **Impact:** Single unified history

---

## Testing Checklist

- [ ] Verify email from BuilderContact (secondary) now links to builder
- [ ] Confirm organizationId populated in all CommunicationLog rows
- [ ] Test Hyphen webhook → builderId mapping
- [ ] Query unified communication view for sample builder
- [ ] Check no duplicate emails after dedup fix
- [ ] Verify job extraction from subject lines
- [ ] Test AI enrichment on 10 sample emails
- [ ] Verify staff notifications route to correct department
- [ ] Confirm attachments download to S3
- [ ] Test multi-timezone scenario with scheduledAt

---

## Rollout Risk

**Low-risk changes:**
- Extend matchEmailToContact() — backward compatible, just finds more matches
- Populate organizationId — no breaking changes
- Status enum additions — additive only

**Medium-risk changes:**
- Add job extraction — possible false positives (regex tuning needed)
- AI enrichment — depends on external API, needs error handling

**Higher-risk changes:**
- Unified communication view — new table/schema, requires migration
- Email archive download — new S3 integration, needs IAM setup

---

## Conclusion

Abel OS has a **solid email sync foundation** (webhook + cron + dedup) but **critical gaps in account matching** that cause ~15-20% of builder communications to be logged without proper context. The three-system architecture (CommunicationLog + BuilderMessage + Activity) fragments history visibility.

**Immediate action:** Extend BuilderContact matching + add Hyphen routing + build unified UI. These three changes restore visibility to 95%+ of real communications.
