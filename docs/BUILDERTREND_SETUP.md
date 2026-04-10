# BuilderTrend Integration Setup Guide

## Overview

The BuilderTrend integration enables Abel Builder Platform to sync project schedules, material selections, and specifications from BuilderTrend (a leading construction project management SaaS used by Toll Brothers, Pulte Homes, Brookfield, and other national builders).

**Key Capabilities:**
- Pull active projects and map them to Abel jobs
- Sync schedule items (material delivery, installation, inspections)
- Track material selections and specifications for door/trim products
- Receive real-time webhook notifications for schedule changes
- Calculate T-72/T-48/T-24 milestone warnings

## Architecture

### Components

1. **Core Library** (`/src/lib/integrations/buildertrend.ts`)
   - OAuth2 client credentials authentication
   - Token management (get/refresh, persist to DB)
   - Project, schedule, and material selection sync functions
   - Webhook signature verification and processing
   - Milestone calculation helpers

2. **Main API** (`/api/ops/integrations/buildertrend/route.ts`)
   - GET: Connection status, project count, upcoming schedules
   - POST actions: connect, sync-projects, sync-schedules, sync-materials, disconnect

3. **Webhook Receiver** (`/api/ops/integrations/buildertrend/webhook/route.ts`)
   - Receives and verifies webhook signatures from BuilderTrend
   - Processes schedule and selection change events
   - Updates ScheduleEntry records and creates alerts

4. **Project Mapping Manager** (`/api/ops/integrations/buildertrend/projects/route.ts`)
   - GET: List all synced BT projects with mapping status
   - POST: Map a BT project to an Abel builder/project/job
   - PUT: Update existing mapping
   - DELETE: Unmap a project

### Database Schema

**IntegrationConfig**
- Stores OAuth2 credentials (client_id, client_secret)
- Persists access token and expiration
- Tracks sync status and last sync time

**BTProjectMapping**
- Bridges BuilderTrend projects to Abel entities (Builder, Project, Job)
- Caches BT schedule data as JSON
- Tracks last sync timestamp

**ScheduleEntry**
- Existing table; used to store synced BT schedule items
- Links to Job records for timeline tracking

## Setup Instructions

### 1. Register OAuth2 Application with BuilderTrend

Contact BuilderTrend support to register an OAuth2 application:
- Application Name: "Abel Builder Platform"
- Redirect URI: `https://<your-domain>/api/ops/integrations/buildertrend/callback` (if needed)
- Requested Scopes: `projects:read`, `schedules:read`, `selections:read`, `webhooks:write`

You'll receive:
- **Client ID** (apiKey)
- **Client Secret** (apiSecret)

### 2. Store Credentials in Abel

Make a POST request to `/api/ops/integrations/buildertrend`:

```bash
curl -X POST https://<your-domain>/api/ops/integrations/buildertrend \
  -H "Authorization: Bearer <staff-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "connect",
    "baseUrl": "https://api.buildertrend.com/v1",
    "clientId": "your-client-id",
    "clientSecret": "your-client-secret"
  }'
```

Response:
```json
{
  "success": true,
  "message": "BuilderTrend connected successfully",
  "status": "CONNECTED"
}
```

### 3. Configure Webhook in BuilderTrend

In your BuilderTrend account settings, register a webhook:
- **Webhook URL**: `https://<your-domain>/api/ops/integrations/buildertrend/webhook`
- **Events**: `schedule.created`, `schedule.updated`, `selection.created`, `selection.updated`
- **Signature Secret**: (BuilderTrend will generate this; update IntegrationConfig.webhookSecret)

### 4. Sync Initial Data

Trigger the first project sync:

```bash
curl -X POST https://<your-domain>/api/ops/integrations/buildertrend \
  -H "Authorization: Bearer <staff-token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-projects"}'
```

This will pull all active projects from BuilderTrend and create BTProjectMapping records.

### 5. Map Projects to Jobs

Get the list of synced BT projects:

```bash
curl https://<your-domain>/api/ops/integrations/buildertrend/projects \
  -H "Authorization: Bearer <staff-token>"
```

Map a BuilderTrend project to an Abel Job:

```bash
curl -X POST https://<your-domain>/api/ops/integrations/buildertrend/projects \
  -H "Authorization: Bearer <staff-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "btProjectId": "bt-project-12345",
    "jobId": "abel-job-xyz"
  }'
```

### 6. Enable Scheduled Syncs

Once mapped, you can enable automatic syncs. The sync interval is configurable in IntegrationConfig.syncInterval (default 3600 seconds = 1 hour).

Run the schedule sync:

```bash
curl -X POST https://<your-domain>/api/ops/integrations/buildertrend \
  -H "Authorization: Bearer <staff-token>" \
  -H "Content-Type: application/json" \
  -d '{"action": "sync-schedules"}'
```

## API Reference

### GET /api/ops/integrations/buildertrend

Returns connection status and stats.

**Response:**
```json
{
  "status": "CONNECTED",
  "config": {
    "baseUrl": "https://api.buildertrend.com/v1",
    "clientId": "xxxx***",
    "tokenExpiresAt": "2026-03-26T15:30:00Z"
  },
  "projects": {
    "total": 45,
    "mapped": 12,
    "unmapped": 33
  },
  "upcomingSchedules": [
    {
      "id": "sche-123",
      "jobId": "job-xyz",
      "title": "Material Delivery - Doors",
      "scheduledDate": "2026-03-27T10:00:00Z",
      "entryType": "DELIVERY",
      "status": "TENTATIVE"
    }
  ],
  "recentSyncs": [
    {
      "syncType": "schedules",
      "status": "SUCCESS",
      "recordsProcessed": 23,
      "recordsCreated": 15,
      "recordsUpdated": 8,
      "recordsFailed": 0,
      "startedAt": "2026-03-25T14:30:00Z",
      "durationMs": 1250
    }
  ]
}
```

### POST /api/ops/integrations/buildertrend

Perform actions on the integration.

**Actions:**

#### connect
Authenticate with BuilderTrend and store credentials.

```json
{
  "action": "connect",
  "baseUrl": "https://api.buildertrend.com/v1",
  "clientId": "your-client-id",
  "clientSecret": "your-client-secret"
}
```

#### sync-projects
Pull all active projects from BuilderTrend.

```json
{"action": "sync-projects"}
```

Response includes SyncResult with record counts.

#### sync-schedules
Pull schedule updates for all mapped projects.

```json
{"action": "sync-schedules"}
```

#### sync-materials
Pull material selections for all mapped projects (creates Decision Notes).

```json
{"action": "sync-materials"}
```

#### disconnect
Remove credentials and integration config.

```json
{"action": "disconnect"}
```

### GET /api/ops/integrations/buildertrend/projects

List all mapped BT projects.

**Query Parameters:**
- None (future: `?status=ACTIVE` or `?mapped=true`)

**Response:**
```json
{
  "projects": [
    {
      "id": "map-123",
      "btProjectId": "bt-proj-456",
      "btProjectName": "Aspen Ridge Phase 2",
      "btBuilderName": "Pulte Homes DFW",
      "btCommunity": "Aspen Ridge",
      "btLot": "14",
      "btStatus": "ACTIVE",
      "mapped": {
        "builderId": "builder-xyz",
        "builderCompanyName": "Pulte Homes",
        "jobId": "job-456",
        "jobNumber": "JOB-2026-0042",
        "jobStatus": "READINESS_CHECK"
      },
      "scheduleCount": 7,
      "lastSyncedAt": "2026-03-25T14:30:00Z",
      "createdAt": "2026-03-20T10:00:00Z"
    }
  ],
  "total": 45,
  "mapped": 12,
  "unmapped": 33
}
```

### POST /api/ops/integrations/buildertrend/projects

Map a BT project to an Abel entity.

```json
{
  "btProjectId": "bt-proj-456",
  "builderId": "builder-xyz",
  "projectId": "proj-abc",
  "jobId": "job-456"
}
```

Provide at least one of builderId, projectId, or jobId.

### PUT /api/ops/integrations/buildertrend/projects

Update an existing project mapping.

```json
{
  "id": "map-123",
  "jobId": "job-789"
}
```

### DELETE /api/ops/integrations/buildertrend/projects?id=map-123

Unmap a project (clears builder/project/job links but preserves history).

### POST /api/ops/integrations/buildertrend/webhook

Receive webhook notifications from BuilderTrend (no auth required).

**BuilderTrend Webhook Payload:**
```json
{
  "event": "schedule.updated",
  "timestamp": "2026-03-25T15:30:00Z",
  "projectId": "bt-proj-456",
  "data": {
    "id": "sche-789",
    "title": "Material Delivery",
    "type": "Material Delivery",
    "scheduledDate": "2026-03-27T10:00:00Z",
    "status": "CONFIRMED"
  }
}
```

BuilderTrend includes a signature header:
```
X-BuilderTrend-Signature: sha256=<hmac-sha256(payload, client_secret)>
```

## Data Flow Examples

### Example 1: Sync Schedules from BT

1. User clicks "Sync Schedules" in the UI
2. POST to `/api/ops/integrations/buildertrend?action=sync-schedules`
3. For each mapped BT project:
   - Fetch `/projects/{projectId}/schedules` from BT API
   - Filter for door/trim-related items
   - Create or update ScheduleEntry records in the Job
4. Return SyncResult with counts
5. If schedule within T-72 window, create Task for assigned PM

### Example 2: Webhook Schedule Change

1. Builder changes schedule date in BuilderTrend
2. BT sends POST to `/api/ops/integrations/buildertrend/webhook`
3. Webhook handler verifies signature
4. If event is `schedule.updated`:
   - Find mapped Job
   - Check if within T-72 hours
   - Create alert Task if within window
   - Re-sync schedules for that project
5. Return 202 Accepted

### Example 3: Material Selection Sync

1. Builder selects specific door products in BuilderTrend
2. User triggers "Sync Materials" or webhook fires
3. For each selection:
   - Try to match to Abel Product catalog by SKU/name
   - Create DecisionNote with BT selection details for human review
   - PM reviews and approves/overrides selections
4. Return count of new decision notes

## Error Handling

### OAuth2 Token Errors
- If access token expires, the client automatically requests a new one
- Token refresh is transparent to API callers
- If refresh fails, next API call will return 401 with "BuilderTrend not configured"

### Webhook Signature Verification
- Invalid signatures return 401 Unauthorized
- Ensures webhooks only come from BuilderTrend

### Schedule Sync Errors
- Individual record failures don't halt the entire sync
- Failed records are logged in SyncLog with error details
- Returns PARTIAL status if some records failed

## Monitoring & Troubleshooting

### Check Integration Status
```bash
GET /api/ops/integrations/buildertrend
```

### View Recent Sync Logs
```sql
SELECT * FROM "SyncLog"
WHERE provider = 'BUILDERTREND'
ORDER BY "startedAt" DESC
LIMIT 10;
```

### Check Project Mappings
```sql
SELECT * FROM "BTProjectMapping"
WHERE "jobId" IS NULL;  -- Unmapped projects
```

### Debug Schedule Creation
```sql
SELECT se.* FROM "ScheduleEntry" se
JOIN "Job" j ON se."jobId" = j."id"
JOIN "BTProjectMapping" bpm ON j."id" = bpm."jobId"
WHERE bpm."btProjectId" = 'target-project-id'
ORDER BY se."scheduledDate" DESC;
```

## T-72/T-48/T-24 Milestones

The integration calculates key milestones from the scheduled delivery date:

- **T-72**: 72 hours before delivery (readiness check window)
- **T-48**: 48 hours before delivery (materials must be locked)
- **T-24**: 24 hours before delivery (truck must be loaded)

When a schedule change is received within any of these windows, the system:
1. Creates a Task for the assigned PM
2. Sets priority to HIGH
3. Includes deadline date in task

Use `calculateMilestones(deliveryDate)` in buildertrend.ts to compute dates.

## Deployment Checklist

- [ ] Register OAuth2 app in BuilderTrend account
- [ ] Store client_id and client_secret securely
- [ ] Configure webhook URL in BuilderTrend dashboard
- [ ] Update IntegrationConfig.webhookSecret from BT
- [ ] Run initial `sync-projects`
- [ ] Map key BT projects to Abel jobs
- [ ] Run `sync-schedules` to populate initial data
- [ ] Enable webhook event forwarding in BT
- [ ] Monitor sync logs for errors
- [ ] Test webhook by changing a schedule in BT
- [ ] Set up automated sync job (cron or job queue)
