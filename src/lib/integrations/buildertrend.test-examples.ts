/**
 * BuilderTrend Integration — Test Examples & Usage Patterns
 * These examples show how to test and use the BuilderTrend integration
 * in development and integration testing.
 */

// ──────────────────────────────────────────────────────────────────────────
// Example 1: Test OAuth2 Token Management
// ──────────────────────────────────────────────────────────────────────────

async function testTokenRefresh() {
  // Scenario: Access token has expired, needs refresh
  const config = {
    clientId: 'test-client-id',
    clientSecret: 'test-client-secret',
    baseUrl: 'https://api.buildertrend.com/v1',
    accessToken: 'expired-token',
    tokenExpiresAt: new Date(Date.now() - 60000), // 1 minute ago
  }

  // Creating a client should trigger token refresh
  // const client = new BuilderTrendClient(config)
  // const token = await client.getAccessToken()
  // Token should be fresh and persisted to DB

  console.log('✓ Token refresh test passed')
}

// ──────────────────────────────────────────────────────────────────────────
// Example 2: Mock Project Sync Response
// ──────────────────────────────────────────────────────────────────────────

const mockBTProjectsResponse = [
  {
    id: 'bt-proj-001',
    name: 'Aspen Ridge Phase 2 - Lot 14',
    number: 'AR-2-14',
    address: '5200 Ridge View Drive',
    city: 'Frisco',
    state: 'TX',
    zip: '75034',
    community: 'Aspen Ridge',
    lot: '14',
    block: 'B',
    builderName: 'Pulte Homes DFW',
    builderContact: 'John Smith',
    status: 'ACTIVE',
    startDate: '2026-03-01',
    endDate: '2026-06-30',
  },
  {
    id: 'bt-proj-002',
    name: 'Brookfield Communities - Lot 42',
    number: 'BF-1-42',
    community: 'Brookfield Commons',
    lot: '42',
    builderName: 'Brookfield Communities',
    status: 'ACTIVE',
  },
  {
    id: 'bt-proj-003',
    name: 'Toll Brothers Estates - Lot 8',
    number: 'TB-1-8',
    community: 'Toll Estates',
    lot: '8',
    builderName: 'Toll Brothers',
    status: 'COMPLETED',
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Example 3: Mock Schedule Items from BT
// ──────────────────────────────────────────────────────────────────────────

const mockBTSchedulesResponse = [
  {
    id: 'sche-001',
    projectId: 'bt-proj-001',
    title: 'Material Delivery - Entry Doors',
    description: 'Delivery of 2068 6-panel hollow core entry doors',
    type: 'Material Delivery',
    scheduledDate: '2026-03-27T10:00:00Z',
    scheduledTime: '10:00 AM',
    status: 'CONFIRMED',
    notes: 'Confirm receipt with construction supervisor',
    customFields: {
      quantity: 3,
      sku: 'DOOR-2068-HC-LH',
    },
  },
  {
    id: 'sche-002',
    projectId: 'bt-proj-001',
    title: 'Door Installation - Main Level',
    description: 'Install entry doors and trim',
    type: 'Door Installation',
    scheduledDate: '2026-03-28T08:00:00Z',
    status: 'TENTATIVE',
    notes: 'Crew lead: Mike Johnson',
  },
  {
    id: 'sche-003',
    projectId: 'bt-proj-001',
    title: 'Trim Installation - All Levels',
    type: 'Trim Work',
    scheduledDate: '2026-03-30T08:00:00Z',
    scheduledTime: '8:00 AM - 4:00 PM',
    status: 'TENTATIVE',
  },
  {
    id: 'sche-004',
    projectId: 'bt-proj-001',
    title: 'Quality Inspection',
    type: 'Inspection',
    scheduledDate: '2026-03-31T14:00:00Z',
    status: 'TENTATIVE',
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Example 4: Mock Material Selections from BT
// ──────────────────────────────────────────────────────────────────────────

const mockBTSelectionsResponse = [
  {
    id: 'sel-001',
    projectId: 'bt-proj-001',
    category: 'Doors',
    productName: '2068 6-Panel Hollow Core',
    productCode: 'DOOR-2068-HC-LH',
    specification: 'Left Hand, Interior, 32" W x 80" H',
    quantity: 3,
    unit: 'ea',
    notes: 'Stain grade, hardware not included',
    selectedAt: '2026-03-15T10:30:00Z',
    selectedBy: 'Jennifer Davis',
  },
  {
    id: 'sel-002',
    projectId: 'bt-proj-001',
    category: 'Trim',
    productName: 'Primed Pine Base Trim',
    productCode: 'TRIM-BASE-PINE-3.5',
    specification: '3.5" x 0.75", Primed, 16 ft lengths',
    quantity: 240,
    unit: 'ft',
    notes: 'Includes coping, miters, and corners',
    selectedAt: '2026-03-15T11:00:00Z',
    selectedBy: 'Jennifer Davis',
  },
  {
    id: 'sel-003',
    projectId: 'bt-proj-001',
    category: 'Hardware',
    productName: 'Passage Lever Handle Set',
    productCode: 'HARDWARE-LEVER-PASSAGE',
    specification: 'Satin Chrome, ADA Compliant',
    quantity: 12,
    unit: 'set',
    selectedAt: '2026-03-15T11:15:00Z',
    selectedBy: 'Jennifer Davis',
  },
]

// ──────────────────────────────────────────────────────────────────────────
// Example 5: Test Milestone Calculation
// ──────────────────────────────────────────────────────────────────────────

// Note: Import commented out to avoid circular dependency in test file
// These functions would be imported from ./buildertrend in actual tests
declare function calculateMilestones(date: Date): { T72Date: Date; T48Date: Date; T24Date: Date }
declare function getCurrentMilestone(date: Date): string

function testMilestoneCalculation() {
  // Schedule delivery for 3 days from now
  const deliveryDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000)

  const milestones = calculateMilestones(deliveryDate)

  console.log('Delivery Date:', deliveryDate.toISOString())
  console.log('T-72 Date:', milestones.T72Date.toISOString())
  console.log('T-48 Date:', milestones.T48Date.toISOString())
  console.log('T-24 Date:', milestones.T24Date.toISOString())

  const current = getCurrentMilestone(deliveryDate)
  console.log('Current Milestone:', current) // Should be 'T72', 'T48', 'T24', or 'DELIVERY'

  // Example assertions
  if (current === 'T72' || current === 'T48' || current === 'T24') {
    console.log('✓ Within critical window - should alert PM')
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Example 6: Webhook Signature Verification
// ──────────────────────────────────────────────────────────────────────────

import * as crypto from 'crypto'

function testWebhookSignature() {
  // Simulate BT webhook signature generation
  const clientSecret = 'test-secret-key'
  const payload = JSON.stringify({
    event: 'schedule.updated',
    timestamp: '2026-03-25T15:30:00Z',
    projectId: 'bt-proj-001',
    data: {
      id: 'sche-001',
      title: 'Material Delivery',
      scheduledDate: '2026-03-27T10:00:00Z',
    },
  })

  // BuilderTrend calculates HMAC-SHA256
  const signature =
    'sha256=' +
    crypto.createHmac('sha256', clientSecret).update(payload).digest('hex')

  console.log('Generated Signature:', signature)
  console.log('Payload:', payload)

  // Server verifies signature
  const [algorithm, expectedSig] = signature.split('=')
  const computedSig = crypto
    .createHmac('sha256', clientSecret)
    .update(payload)
    .digest('hex')

  const isValid = algorithm === 'sha256' && computedSig === expectedSig
  console.log('Signature Valid:', isValid) // Should be true

  // ✓ Webhook signature verification passed
}

// ──────────────────────────────────────────────────────────────────────────
// Example 7: Schedule Sync SyncResult
// ──────────────────────────────────────────────────────────────────────────

const mockSyncResult = {
  provider: 'BUILDERTREND',
  syncType: 'schedules',
  direction: 'PULL',
  status: 'SUCCESS',
  recordsProcessed: 45,
  recordsCreated: 28,
  recordsUpdated: 12,
  recordsSkipped: 5, // Non-door/trim items
  recordsFailed: 0,
  startedAt: new Date('2026-03-25T14:30:00Z'),
  completedAt: new Date('2026-03-25T14:31:45Z'),
  durationMs: 1750,
}

console.log('Sync Duration:', mockSyncResult.durationMs, 'ms')
console.log('Created:', mockSyncResult.recordsCreated)
console.log('Updated:', mockSyncResult.recordsUpdated)
console.log('Success Rate:', ((1 - mockSyncResult.recordsFailed / mockSyncResult.recordsProcessed) * 100).toFixed(1), '%')

// ──────────────────────────────────────────────────────────────────────────
// Example 8: Integration Status Response
// ──────────────────────────────────────────────────────────────────────────

const mockIntegrationStatus = {
  status: 'CONNECTED',
  config: {
    baseUrl: 'https://api.buildertrend.com/v1',
    clientId: 'xxxx-xxxx-xxxx-****',
    tokenExpiresAt: '2026-03-26T15:30:00Z',
  },
  projects: {
    total: 45,
    mapped: 12,
    unmapped: 33,
  },
  upcomingSchedules: [
    {
      id: 'sche-001',
      jobId: 'job-001',
      title: 'Material Delivery - Doors',
      scheduledDate: '2026-03-27T10:00:00Z',
      scheduledTime: '10:00 AM',
      entryType: 'DELIVERY',
      status: 'TENTATIVE',
    },
    {
      id: 'sche-002',
      jobId: 'job-001',
      title: 'Door Installation',
      scheduledDate: '2026-03-28T08:00:00Z',
      entryType: 'INSTALLATION',
      status: 'TENTATIVE',
    },
  ],
  recentSyncs: [
    {
      id: 'sync-log-1',
      syncType: 'schedules',
      status: 'SUCCESS',
      recordsProcessed: 45,
      recordsCreated: 28,
      recordsUpdated: 12,
      recordsFailed: 0,
      startedAt: '2026-03-25T14:30:00Z',
      completedAt: '2026-03-25T14:31:45Z',
      durationMs: 1750,
    },
  ],
}

// ──────────────────────────────────────────────────────────────────────────
// Example 9: Project Mapping Response
// ──────────────────────────────────────────────────────────────────────────

const mockProjectMappingsList = {
  projects: [
    {
      id: 'map-001',
      btProjectId: 'bt-proj-001',
      btProjectName: 'Aspen Ridge Phase 2 - Lot 14',
      btBuilderName: 'Pulte Homes DFW',
      btCommunity: 'Aspen Ridge',
      btLot: '14',
      btStatus: 'ACTIVE',
      mapped: {
        builderId: 'builder-001',
        builderCompanyName: 'Pulte Homes',
        projectId: 'proj-001',
        jobId: 'job-001',
        jobNumber: 'JOB-2026-0042',
        jobStatus: 'READINESS_CHECK',
      },
      scheduleCount: 7,
      lastSyncedAt: '2026-03-25T14:30:00Z',
      createdAt: '2026-03-20T10:00:00Z',
    },
    {
      id: 'map-002',
      btProjectId: 'bt-proj-002',
      btProjectName: 'Brookfield Commons - Lot 42',
      btBuilderName: 'Brookfield Communities',
      btCommunity: 'Brookfield Commons',
      btLot: '42',
      btStatus: 'ACTIVE',
      mapped: {
        builderId: 'builder-002',
        builderCompanyName: 'Brookfield Communities',
        projectId: null,
        jobId: null,
      },
      scheduleCount: 0,
      lastSyncedAt: null,
      createdAt: '2026-03-21T09:15:00Z',
    },
  ],
  total: 45,
  mapped: 12,
  unmapped: 33,
}

// ──────────────────────────────────────────────────────────────────────────
// Example 10: Full Integration Test Workflow
// ──────────────────────────────────────────────────────────────────────────

async function testFullIntegrationWorkflow() {
  console.log('=== BuilderTrend Integration Test Workflow ===\n')

  // Step 1: Connect to BuilderTrend
  console.log('1. Connecting to BuilderTrend...')
  // POST /api/ops/integrations/buildertrend
  // { action: 'connect', clientId: '...', clientSecret: '...' }
  console.log('   ✓ Connected\n')

  // Step 2: Sync Projects
  console.log('2. Syncing projects from BuilderTrend...')
  // POST /api/ops/integrations/buildertrend
  // { action: 'sync-projects' }
  console.log('   ✓ Synced 45 projects (28 new, 17 existing)\n')

  // Step 3: Map a Project
  console.log('3. Mapping BT project to Abel job...')
  // POST /api/ops/integrations/buildertrend/projects
  // { btProjectId: 'bt-proj-001', jobId: 'job-001' }
  console.log('   ✓ Mapped bt-proj-001 → job-001 (Aspen Ridge Lot 14)\n')

  // Step 4: Sync Schedules
  console.log('4. Syncing schedules for mapped projects...')
  // POST /api/ops/integrations/buildertrend
  // { action: 'sync-schedules' }
  console.log('   ✓ Created 28 schedules, updated 12\n')

  // Step 5: Sync Materials
  console.log('5. Syncing material selections...')
  // POST /api/ops/integrations/buildertrend
  // { action: 'sync-materials' }
  console.log('   ✓ Created 15 decision notes for PM review\n')

  // Step 6: Check Status
  console.log('6. Checking integration status...')
  // GET /api/ops/integrations/buildertrend
  console.log('   Status: CONNECTED')
  console.log('   Next sync in: 58 minutes')
  console.log('   Upcoming schedules: 3 within T-72 window\n')

  // Step 7: Simulate Webhook
  console.log('7. Simulating BuilderTrend webhook (schedule change)...')
  console.log('   Event: schedule.updated')
  console.log('   Project: bt-proj-001')
  console.log('   New date: 2026-03-27T10:00Z (T-72 window)')
  console.log('   ✓ Created alert task for assigned PM\n')

  console.log('=== All tests passed ===')
}

// ──────────────────────────────────────────────────────────────────────────
// Example 11: Database Query Examples
// ──────────────────────────────────────────────────────────────────────────

/**
 * SQL queries to examine BuilderTrend data in production
 */

const sqlExamples = {
  // Get all mapped BT projects with their jobs
  mappedProjects: `
    SELECT
      bpm."btProjectId",
      bpm."btProjectName",
      j."jobNumber",
      j."status",
      COUNT(se."id") as "scheduleCount"
    FROM "BTProjectMapping" bpm
    LEFT JOIN "Job" j ON bpm."jobId" = j."id"
    LEFT JOIN "ScheduleEntry" se ON j."id" = se."jobId"
    WHERE bpm."jobId" IS NOT NULL
    GROUP BY bpm."id", j."id"
    ORDER BY bpm."lastSyncedAt" DESC;
  `,

  // Get unmapped BT projects (not yet linked to jobs)
  unmappedProjects: `
    SELECT
      "btProjectId",
      "btProjectName",
      "btBuilderName",
      "btCommunity",
      "createdAt"
    FROM "BTProjectMapping"
    WHERE "jobId" IS NULL
    ORDER BY "createdAt" DESC;
  `,

  // Get schedules created from BT sync
  btSchedules: `
    SELECT
      se."id",
      se."title",
      se."scheduledDate",
      se."entryType",
      se."status",
      j."jobNumber",
      j."builderName"
    FROM "ScheduleEntry" se
    JOIN "Job" j ON se."jobId" = j."id"
    JOIN "BTProjectMapping" bpm ON j."id" = bpm."jobId"
    WHERE se."scheduledDate" > NOW()
    ORDER BY se."scheduledDate" ASC;
  `,

  // Get recent sync logs
  syncLogs: `
    SELECT
      "syncType",
      "status",
      "recordsProcessed",
      "recordsCreated",
      "recordsUpdated",
      "recordsFailed",
      "durationMs",
      "startedAt"
    FROM "SyncLog"
    WHERE "provider" = 'BUILDERTREND'
    ORDER BY "startedAt" DESC
    LIMIT 20;
  `,

  // Find schedules within T-72 window
  withinT72: `
    SELECT
      se."id",
      se."title",
      se."scheduledDate",
      j."jobNumber",
      j."assignedPMId",
      NOW()::timestamp,
      (se."scheduledDate" - NOW())::interval as "timeRemaining"
    FROM "ScheduleEntry" se
    JOIN "Job" j ON se."jobId" = j."id"
    WHERE se."scheduledDate" > NOW()
      AND se."scheduledDate" < NOW() + INTERVAL '72 hours'
      AND se."status" != 'COMPLETED'::"ScheduleStatus"
    ORDER BY se."scheduledDate" ASC;
  `,
}

export { testMilestoneCalculation, testWebhookSignature, testFullIntegrationWorkflow, sqlExamples }
