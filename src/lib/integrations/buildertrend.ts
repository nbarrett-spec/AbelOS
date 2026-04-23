// ──────────────────────────────────────────────────────────────────────────
// BuilderTrend — Integration Library
// REST API + OAuth2 (client_credentials flow)
// Bidirectional: project schedules, material selections, webhooks
// Used by: Toll Brothers, Pulte Homes, Brookfield, and other national builders
// ──────────────────────────────────────────────────────────────────────────

import { prisma } from '@/lib/prisma'
import type { SyncResult } from './types'
import * as crypto from 'crypto'

// ─── Types ────────────────────────────────────────────────────────────────

export interface BuilderTrendConfig {
  clientId: string
  clientSecret: string
  baseUrl: string
  accessToken?: string
  tokenExpiresAt?: Date
}

export interface BTProject {
  id: string
  name: string
  number?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  community?: string
  lot?: string
  block?: string
  builderName?: string
  builderContact?: string
  status: string
  startDate?: string
  endDate?: string
}

export interface BTScheduleItem {
  id: string
  projectId: string
  title: string
  description?: string
  type: string // e.g., "Material Delivery", "Door Installation", "Trim Work"
  scheduledDate: string
  scheduledTime?: string
  dueDate?: string
  status: string
  notes?: string
  assignedTo?: string
  customFields?: Record<string, any>
}

export interface BTMaterialSelection {
  id: string
  projectId: string
  itemId?: string
  category: string // e.g., "Doors", "Trim", "Hardware"
  productName: string
  productCode?: string
  specification: string
  quantity?: number
  unit?: string
  notes?: string
  selectedAt?: string
  selectedBy?: string
}

export interface BTWebhookPayload {
  event: string
  timestamp: string
  projectId: string
  data: Record<string, any>
  signature?: string
}

interface TokenResponse {
  access_token: string
  token_type: string
  expires_in: number
}

// ─── BuilderTrend API Client ──────────────────────────────────────────────

class BuilderTrendClient {
  private config: BuilderTrendConfig

  constructor(config: BuilderTrendConfig) {
    this.config = config
  }

  /**
   * Get or refresh the OAuth2 access token
   */
  async getAccessToken(): Promise<string> {
    const now = new Date()

    // If we have a valid token, use it
    if (this.config.accessToken && this.config.tokenExpiresAt && this.config.tokenExpiresAt > now) {
      return this.config.accessToken
    }

    // Otherwise, refresh
    const tokenUrl = `${this.config.baseUrl}/oauth/token`

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }).toString(),
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`BuilderTrend OAuth2 token error ${response.status}: ${text}`)
    }

    const data: TokenResponse = await response.json()

    // Update config with new token
    this.config.accessToken = data.access_token
    this.config.tokenExpiresAt = new Date(now.getTime() + data.expires_in * 1000)

    // Persist to database for future use
    await this.persistToken()

    return data.access_token
  }

  /**
   * Make an authenticated API request to BuilderTrend
   */
  async request(
    path: string,
    options?: RequestInit & { headers?: Record<string, string> }
  ): Promise<any> {
    const token = await this.getAccessToken()
    const url = `${this.config.baseUrl}${path}`

    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        ...(options?.headers || {}),
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`BuilderTrend API ${response.status}: ${text}`)
    }

    // Handle 204 No Content
    if (response.status === 204) {
      return null
    }

    return response.json()
  }

  /**
   * Persist OAuth2 token to IntegrationConfig
   */
  private async persistToken(): Promise<void> {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "IntegrationConfig"
         SET "accessToken" = $1, "tokenExpiresAt" = $2, "updatedAt" = CURRENT_TIMESTAMP
         WHERE "provider" = 'BUILDERTREND'::"IntegrationProvider"`,
        this.config.accessToken,
        this.config.tokenExpiresAt
      )
    } catch (error) {
      console.error('Failed to persist BuilderTrend token:', error)
      // Continue anyway; token is in memory
    }
  }
}

// ─── Configuration & Initialization ────────────────────────────────────────

export async function getBuilderTrendConfig(): Promise<BuilderTrendConfig | null> {
  try {
    const configs: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "IntegrationConfig" WHERE "provider" = $1 LIMIT 1`,
      'BUILDERTREND'
    )

    if (configs.length === 0) return null

    const config = configs[0]
    if (!config.apiKey || !config.apiSecret || !config.baseUrl) {
      return null
    }

    return {
      clientId: config.apiKey,
      clientSecret: config.apiSecret,
      baseUrl: config.baseUrl || 'https://api.buildertrend.com/v1',
      accessToken: config.accessToken,
      tokenExpiresAt: config.tokenExpiresAt,
    }
  } catch (error) {
    console.error('Failed to load BuilderTrend config:', error)
    return null
  }
}

export async function getBuilderTrendClient(): Promise<BuilderTrendClient | null> {
  const config = await getBuilderTrendConfig()
  if (!config) return null

  return new BuilderTrendClient(config)
}

// ─── Project Sync ─────────────────────────────────────────────────────────

export async function syncProjects(): Promise<SyncResult> {
  const startedAt = new Date()
  let recordsProcessed = 0,
    recordsCreated = 0,
    recordsUpdated = 0,
    recordsSkipped = 0,
    recordsFailed = 0
  let errorMessage: string | undefined

  try {
    const client = await getBuilderTrendClient()
    if (!client) {
      return {
        provider: 'BUILDERTREND',
        syncType: 'projects',
        direction: 'PULL',
        status: 'FAILED',
        recordsProcessed,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        recordsFailed,
        errorMessage: 'BuilderTrend not configured',
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      }
    }

    // Fetch projects from BuilderTrend API
    const projects = await client.request('/projects', { method: 'GET' })
    const projectList: BTProject[] = Array.isArray(projects) ? projects : projects.data || []

    recordsProcessed = projectList.length

    for (const btProject of projectList) {
      try {
        // Find or create mapping
        const existing: any[] = await prisma.$queryRawUnsafe(
          `SELECT * FROM "BTProjectMapping" WHERE "btProjectId" = $1 LIMIT 1`,
          btProject.id
        )

        if (existing.length > 0) {
          // Update existing mapping with latest BT data
          await prisma.$executeRawUnsafe(
            `UPDATE "BTProjectMapping"
             SET "btProjectName" = $1, "btBuilderName" = $2, "btCommunity" = $3,
                 "btLot" = $4, "btStatus" = $5, "btScheduleData" = $6,
                 "lastSyncedAt" = CURRENT_TIMESTAMP, "updatedAt" = CURRENT_TIMESTAMP
             WHERE "id" = $7`,
            btProject.name,
            btProject.builderName || null,
            btProject.community || null,
            btProject.lot || null,
            btProject.status,
            JSON.stringify(btProject),
            existing[0].id
          )
          recordsUpdated++
        } else {
          // Create new mapping (unattached to builder/project/job initially)
          await prisma.$executeRawUnsafe(
            `INSERT INTO "BTProjectMapping"
             ("btProjectId", "btProjectName", "btBuilderName", "btCommunity", "btLot", "btStatus", "btScheduleData", "lastSyncedAt")
             VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP)`,
            btProject.id,
            btProject.name,
            btProject.builderName || null,
            btProject.community || null,
            btProject.lot || null,
            btProject.status,
            JSON.stringify(btProject)
          )
          recordsCreated++
        }
      } catch (err) {
        console.error(`Error processing BT project ${btProject.id}:`, err)
        recordsFailed++
      }
    }

    return {
      provider: 'BUILDERTREND',
      syncType: 'projects',
      direction: 'PULL',
      status: recordsFailed === 0 ? 'SUCCESS' : 'PARTIAL',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'BUILDERTREND',
      syncType: 'projects',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      errorMessage: error.message,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Schedule Sync ────────────────────────────────────────────────────────

export async function syncSchedules(since?: Date): Promise<SyncResult> {
  const startedAt = new Date()
  let recordsProcessed = 0,
    recordsCreated = 0,
    recordsUpdated = 0,
    recordsSkipped = 0,
    recordsFailed = 0
  let errorMessage: string | undefined

  try {
    const client = await getBuilderTrendClient()
    if (!client) {
      return {
        provider: 'BUILDERTREND',
        syncType: 'schedules',
        direction: 'PULL',
        status: 'FAILED',
        recordsProcessed,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        recordsFailed,
        errorMessage: 'BuilderTrend not configured',
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      }
    }

    // Get all mapped BT projects
    const mappings: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BTProjectMapping" WHERE "jobId" IS NOT NULL`
    )

    for (const mapping of mappings) {
      try {
        // Fetch schedule items for this project
        const scheduleData = await client.request(`/projects/${mapping.btProjectId}/schedules`, {
          method: 'GET',
        })

        const schedules: BTScheduleItem[] = Array.isArray(scheduleData) ? scheduleData : scheduleData.data || []
        recordsProcessed += schedules.length

        for (const btSchedule of schedules) {
          try {
            // Filter for door/trim related items
            if (!isDoorTrimRelated(btSchedule.type)) {
              recordsSkipped++
              continue
            }

            const scheduledDate = new Date(btSchedule.scheduledDate)

            // Check if entry already exists
            const existing: any[] = await prisma.$queryRawUnsafe(
              `SELECT * FROM "ScheduleEntry"
               WHERE "jobId" = $1 AND "title" ILIKE $2 AND "scheduledDate"::DATE = $3::DATE
               LIMIT 1`,
              mapping.jobId,
              btSchedule.title,
              scheduledDate.toISOString().split('T')[0]
            )

            if (existing.length > 0) {
              // Update existing schedule entry
              await prisma.$executeRawUnsafe(
                `UPDATE "ScheduleEntry"
                 SET "title" = $1, "scheduledTime" = $2, "notes" = $3, "updatedAt" = CURRENT_TIMESTAMP
                 WHERE "id" = $4`,
                btSchedule.title,
                btSchedule.scheduledTime || null,
                btSchedule.notes || null,
                existing[0].id
              )
              recordsUpdated++
            } else {
              // Create new schedule entry
              // Infer entry type from BT schedule type
              const entryType = inferScheduleType(btSchedule.type)

              await prisma.$executeRawUnsafe(
                `INSERT INTO "ScheduleEntry"
                 ("jobId", "entryType", "title", "scheduledDate", "scheduledTime", "notes", "status")
                 VALUES ($1, $2::"ScheduleType", $3, $4, $5, $6, 'TENTATIVE'::"ScheduleStatus")`,
                mapping.jobId,
                entryType,
                btSchedule.title,
                scheduledDate.toISOString(),
                btSchedule.scheduledTime || null,
                btSchedule.notes || null
              )
              recordsCreated++
            }
          } catch (err) {
            console.error(`Error processing BT schedule ${btSchedule.id}:`, err)
            recordsFailed++
          }
        }
      } catch (err) {
        console.error(`Error syncing schedules for mapping ${mapping.id}:`, err)
        recordsFailed += mapping.length || 1
      }
    }

    // Log the sync
    await logSync({
      provider: 'BUILDERTREND',
      syncType: 'schedules',
      direction: 'PULL',
      status: recordsFailed === 0 ? 'SUCCESS' : 'PARTIAL',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    })

    return {
      provider: 'BUILDERTREND',
      syncType: 'schedules',
      direction: 'PULL',
      status: recordsFailed === 0 ? 'SUCCESS' : 'PARTIAL',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'BUILDERTREND',
      syncType: 'schedules',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      errorMessage: error.message,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Material Selection Sync ──────────────────────────────────────────────

export async function syncMaterialSelections(): Promise<SyncResult> {
  const startedAt = new Date()
  let recordsProcessed = 0,
    recordsCreated = 0,
    recordsUpdated = 0,
    recordsSkipped = 0,
    recordsFailed = 0

  try {
    const client = await getBuilderTrendClient()
    if (!client) {
      return {
        provider: 'BUILDERTREND',
        syncType: 'materials',
        direction: 'PULL',
        status: 'FAILED',
        recordsProcessed,
        recordsCreated,
        recordsUpdated,
        recordsSkipped,
        recordsFailed,
        errorMessage: 'BuilderTrend not configured',
        startedAt,
        completedAt: new Date(),
        durationMs: Date.now() - startedAt.getTime(),
      }
    }

    // Get all mapped BT projects
    const mappings: any[] = await prisma.$queryRawUnsafe(
      `SELECT * FROM "BTProjectMapping" WHERE "jobId" IS NOT NULL`
    )

    for (const mapping of mappings) {
      try {
        // Fetch material selections for this project
        const selectionsData = await client.request(`/projects/${mapping.btProjectId}/selections`, {
          method: 'GET',
        })

        const selections: BTMaterialSelection[] = Array.isArray(selectionsData)
          ? selectionsData
          : selectionsData.data || []
        recordsProcessed += selections.length

        for (const selection of selections) {
          try {
            // Only process door/trim selections for now
            if (!['Doors', 'Trim', 'Hardware'].includes(selection.category)) {
              recordsSkipped++
              continue
            }

            // Try to match to Abel's product catalog by product code or name
            const productMatch: any[] = await prisma.$queryRawUnsafe(
              `SELECT * FROM "Product"
               WHERE UPPER("sku") = UPPER($1) OR UPPER("name") ILIKE UPPER($2)
               LIMIT 1`,
              selection.productCode || '',
              `%${selection.productName}%`
            )

            const productId = productMatch.length > 0 ? productMatch[0].id : null

            // Store in decision note for human review
            const notes = `BT Selection: ${selection.productName} (${selection.category})\nQty: ${selection.quantity || 'N/A'} ${selection.unit || ''}\nSpec: ${selection.specification}`

            await prisma.$executeRawUnsafe(
              `INSERT INTO "DecisionNote"
               ("jobId", "authorId", "noteType", "subject", "body", "priority")
               SELECT $1, (SELECT "id" FROM "Staff" WHERE "role" = 'ADMIN' LIMIT 1),
                      'GENERAL'::"DecisionNoteType", $2, $3, 'NORMAL'::"NotePriority"
               WHERE (SELECT "id" FROM "Staff" WHERE "role" = 'ADMIN' LIMIT 1) IS NOT NULL`,
              mapping.jobId,
              selection.productName,
              notes
            )

            recordsCreated++
          } catch (err) {
            console.error(`Error processing BT selection ${selection.id}:`, err)
            recordsFailed++
          }
        }
      } catch (err) {
        console.error(`Error syncing materials for mapping ${mapping.id}:`, err)
      }
    }

    return {
      provider: 'BUILDERTREND',
      syncType: 'materials',
      direction: 'PULL',
      status: recordsFailed === 0 ? 'SUCCESS' : 'PARTIAL',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  } catch (error: any) {
    return {
      provider: 'BUILDERTREND',
      syncType: 'materials',
      direction: 'PULL',
      status: 'FAILED',
      recordsProcessed,
      recordsCreated,
      recordsUpdated,
      recordsSkipped,
      recordsFailed,
      errorMessage: error.message,
      startedAt,
      completedAt: new Date(),
      durationMs: Date.now() - startedAt.getTime(),
    }
  }
}

// ─── Webhook Signature Verification ────────────────────────────────────────

/**
 * Verify a BuilderTrend webhook signature with constant-time comparison.
 *
 * Header format: `X-BuilderTrend-Signature: sha256=<hex>`. BT signs the raw
 * body with the shared `clientSecret`. This check was previously implemented
 * with `computed === expectedSignature`, which leaks timing. Now uses
 * `crypto.timingSafeEqual` after length-matching both buffers.
 */
export async function verifyWebhookSignature(
  payload: string,
  signature: string
): Promise<boolean> {
  try {
    const config = await getBuilderTrendConfig()
    if (!config) return false

    const [algorithm, expectedSignature] = (signature || '').split('=')
    if (algorithm !== 'sha256' || !expectedSignature) return false

    const computedHex = crypto
      .createHmac('sha256', config.clientSecret)
      .update(payload)
      .digest('hex')

    let providedBuf: Buffer
    try {
      providedBuf = Buffer.from(expectedSignature, 'hex')
    } catch {
      return false
    }
    const expectedBuf = Buffer.from(computedHex, 'hex')
    if (providedBuf.length !== expectedBuf.length) return false
    return crypto.timingSafeEqual(providedBuf, expectedBuf)
  } catch (error) {
    console.error('Error verifying webhook signature:', error)
    return false
  }
}

// ─── Webhook Processing ────────────────────────────────────────────────────

export async function processWebhookPayload(payload: BTWebhookPayload): Promise<void> {
  try {
    if (payload.event === 'schedule.updated' || payload.event === 'schedule.created') {
      // Find the mapping for this project
      const mappings: any[] = await prisma.$queryRawUnsafe(
        `SELECT * FROM "BTProjectMapping" WHERE "btProjectId" = $1 LIMIT 1`,
        payload.projectId
      )

      if (mappings.length === 0) {
        // console.log(`No mapping found for BT project ${payload.projectId}`)
        return
      }

      const mapping = mappings[0]

      if (!mapping.jobId) {
        // console.log(`Mapping exists but no jobId attached for BT project ${payload.projectId}`)
        return
      }

      const scheduleData = payload.data as BTScheduleItem

      // Check if within T-72 window
      const scheduledDate = new Date(scheduleData.scheduledDate)
      const now = new Date()
      const daysUntilSchedule = Math.floor((scheduledDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

      if (daysUntilSchedule <= 72 && daysUntilSchedule > 0) {
        // Create an alert task for the assigned PM
        const job: any[] = await prisma.$queryRawUnsafe(
          `SELECT "assignedPMId", "jobNumber" FROM "Job" WHERE "id" = $1 LIMIT 1`,
          mapping.jobId
        )

        if (job.length > 0 && job[0].assignedPMId) {
          await prisma.$executeRawUnsafe(
            `INSERT INTO "Task"
             ("jobId", "assignedToId", "title", "description", "priority", "dueDate", "status")
             VALUES ($1, $2, $3, $4, 'HIGH'::"TaskPriority", $5, 'TODO'::"TaskStatus")`,
            mapping.jobId,
            job[0].assignedPMId,
            `BuilderTrend Schedule Update: ${scheduleData.title}`,
            `BT Schedule ${payload.event}: "${scheduleData.title}" scheduled for ${scheduleData.scheduledDate}. Within T-${72 - Math.abs(daysUntilSchedule)} window.`,
            scheduledDate.toISOString()
          )
        }
      }

      // Update or create schedule entry
      await syncSchedules()
    } else if (payload.event === 'selection.updated' || payload.event === 'selection.created') {
      // Re-sync material selections for affected project
      await syncMaterialSelections()
    }
  } catch (error) {
    console.error('Error processing webhook payload:', error)
  }
}

// ─── Helper Functions ─────────────────────────────────────────────────────

function isDoorTrimRelated(scheduleType: string): boolean {
  const types = ['door', 'trim', 'delivery', 'installation', 'framing', 'cabinet']
  return types.some(t => scheduleType.toLowerCase().includes(t))
}

function inferScheduleType(btScheduleType: string): string {
  const lower = btScheduleType.toLowerCase()

  if (lower.includes('delivery')) return 'DELIVERY'
  if (lower.includes('install') || lower.includes('hang')) return 'INSTALLATION'
  if (lower.includes('pickup') || lower.includes('collect')) return 'PICKUP'
  if (lower.includes('inspec')) return 'INSPECTION'

  return 'DELIVERY' // Default
}

async function logSync(result: any): Promise<void> {
  try {
    await prisma.$executeRawUnsafe(
      `INSERT INTO "SyncLog"
       ("provider", "syncType", "direction", "status", "recordsProcessed", "recordsCreated",
        "recordsUpdated", "recordsSkipped", "recordsFailed", "errorMessage", "startedAt", "completedAt", "durationMs")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      result.provider,
      result.syncType,
      result.direction,
      result.status,
      result.recordsProcessed,
      result.recordsCreated,
      result.recordsUpdated,
      result.recordsSkipped,
      result.recordsFailed,
      result.errorMessage || null,
      result.startedAt,
      result.completedAt,
      result.durationMs
    )
  } catch (error) {
    console.error('Error logging sync:', error)
  }
}

// ─── T-72/T-48/T-24 Milestone Calculation ─────────────────────────────────

export interface MilestoneCalculation {
  T72Date: Date
  T48Date: Date
  T24Date: Date
  deliveryDate: Date
}

export function calculateMilestones(deliveryDate: Date): MilestoneCalculation {
  return {
    T72Date: new Date(deliveryDate.getTime() - 72 * 60 * 60 * 1000),
    T48Date: new Date(deliveryDate.getTime() - 48 * 60 * 60 * 1000),
    T24Date: new Date(deliveryDate.getTime() - 24 * 60 * 60 * 1000),
    deliveryDate,
  }
}

export function getCurrentMilestone(deliveryDate: Date): 'T72' | 'T48' | 'T24' | 'DELIVERY' | null {
  const now = new Date()
  const milestones = calculateMilestones(deliveryDate)

  if (now < milestones.T72Date) return null
  if (now < milestones.T48Date) return 'T72'
  if (now < milestones.T24Date) return 'T48'
  if (now < milestones.deliveryDate) return 'T24'

  return 'DELIVERY'
}
