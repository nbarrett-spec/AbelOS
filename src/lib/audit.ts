import { prisma } from '@/lib/prisma'
import { NextRequest } from 'next/server'
import { logger } from './logger'
import { publishEvent } from './redis'

// Entity → topic map for the live stream. Covers the common cases — anything
// not listed here still publishes under its lowercased entity name so pages
// can subscribe generically.
const TOPIC_MAP: Record<string, string> = {
  Order: 'orders',
  PurchaseOrder: 'pos',
  Invoice: 'ar',
  Payment: 'ar',
  Builder: 'builders',
  Quote: 'quotes',
  Delivery: 'deliveries',
  Staff: 'staff',
  Activity: 'activity',
  AccountingAI: 'ai',
}

function topicFor(entity: string): string {
  return TOPIC_MAP[entity] ?? entity.toLowerCase()
}

// ──────────────────────────────────────────────────────────────────────────
// Audit Log — tracks ALL sensitive changes across the platform.
// Table is auto-created if it doesn't exist.
// ──────────────────────────────────────────────────────────────────────────

let tableEnsured = false

async function ensureTable() {
  if (tableEnsured) return
  try {
    // NOTE: The canonical schema for AuditLog lives in prisma/schema.prisma.
    // This CREATE is only a safety net for fresh environments. In production
    // the table already exists without a "staffName" column, and staffId is
    // nullable (no FK) — do not drift this shape.
    await prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AuditLog" (
        "id" TEXT PRIMARY KEY,
        "staffId" TEXT,
        "action" TEXT NOT NULL,
        "entity" TEXT NOT NULL,
        "entityId" TEXT,
        "details" JSONB DEFAULT '{}',
        "ipAddress" TEXT,
        "userAgent" TEXT,
        "severity" TEXT DEFAULT 'INFO',
        "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)
    // Add severity column if table already existed without it
    await prisma.$executeRawUnsafe(`
      ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "severity" TEXT DEFAULT 'INFO'
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_auditlog_entity" ON "AuditLog" ("entity", "entityId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_auditlog_staff" ON "AuditLog" ("staffId")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_auditlog_action" ON "AuditLog" ("action")
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_auditlog_created" ON "AuditLog" ("createdAt" DESC)
    `)
    await prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS "idx_auditlog_severity" ON "AuditLog" ("severity")
    `)
    tableEnsured = true
  } catch (e) {
    tableEnsured = true
  }
}

/** Severity levels for audit events */
export type AuditSeverity = 'INFO' | 'WARN' | 'CRITICAL'

export async function logAudit(params: {
  staffId: string
  staffName?: string
  action: string
  entity: string
  entityId?: string
  details?: Record<string, any>
  ipAddress?: string
  userAgent?: string
  severity?: AuditSeverity
}): Promise<string> {
  try {
    await ensureTable()
    const id = 'aud' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

    // staffId is nullable in the canonical schema and has no FK. Normalize
    // empty/"unknown" sentinels to NULL so cron/webhook contexts don't blow
    // up future FK constraints or pollute analytics. Preserve "builder:*"
    // and real staff ids untouched.
    const rawStaffId = (params.staffId ?? '').trim()
    const staffIdForDb =
      !rawStaffId || rawStaffId === 'unknown' ? null : rawStaffId

    // staffName is NOT a column in the canonical AuditLog schema. If callers
    // want the human name, stash it in details so we don't lose it.
    const mergedDetails = params.staffName
      ? { ...(params.details || {}), staffName: params.staffName }
      : params.details || {}

    await prisma.$queryRawUnsafe(
      `INSERT INTO "AuditLog" ("id", "staffId", "action", "entity", "entityId", "details", "ipAddress", "userAgent", "severity", "createdAt")
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, NOW())`,
      id,
      staffIdForDb,
      params.action,
      params.entity,
      params.entityId || null,
      JSON.stringify(mergedDetails),
      params.ipAddress || null,
      params.userAgent || null,
      params.severity || 'INFO'
    )
    // Fan out a live event. Never blocks; never throws.
    publishEvent({
      topic: topicFor(params.entity),
      entity: params.entity,
      entityId: params.entityId,
      action: params.action,
      staffId: params.staffId,
      at: new Date().toISOString(),
      id,
    }).catch(() => {})
    return id
  } catch (e) {
    // IMPORTANT: log before swallow. Call sites use `.catch(() => {})` so
    // their swallow can't see failures — this inner log is the ONLY place a
    // future regression (schema drift, enum change, FK addition) will surface.
    // Use console.warn in addition to logger.error so it's visible in every
    // runtime (Next.js server, cron, webhook) regardless of log transport.
    const msg = e instanceof Error ? e.message : String(e)
    // eslint-disable-next-line no-console
    console.warn('[audit] insert failed:', msg, {
      action: params.action,
      entity: params.entity,
      entityId: params.entityId,
    })
    try {
      logger.error('audit_log_write_failed', e, { action: params.action, entity: params.entity })
    } catch {}
    return ''
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Quick audit helper — extracts staff context from NextRequest headers
// and logs with a single call. Use in any /api/ops route:
//
//   await audit(request, 'UPDATE', 'Order', orderId, { status: 'SHIPPED' })
//
// ──────────────────────────────────────────────────────────────────────────
export async function audit(
  request: NextRequest,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, any>,
  severity?: AuditSeverity
): Promise<string> {
  const staff = getStaffFromHeaders(request.headers)
  return logAudit({
    staffId: staff.staffId,
    staffName: staff.staffName,
    action,
    entity,
    entityId,
    details,
    ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || undefined,
    userAgent: request.headers.get('user-agent') || undefined,
    severity: severity || inferSeverity(action, entity),
  })
}

/** Auto-infer severity based on action + entity type */
function inferSeverity(action: string, entity: string): AuditSeverity {
  const act = action.toUpperCase()
  // Critical: financial, deletion, role/auth changes
  if (['DELETE', 'VOID', 'WRITE_OFF', 'REFUND'].some(a => act.includes(a))) return 'CRITICAL'
  if (['Payment', 'Invoice', 'Credit'].includes(entity) && ['CREATE', 'UPDATE'].some(a => act.includes(a))) return 'WARN'
  if (entity === 'Staff' && ['UPDATE', 'DEACTIVATE', 'ROLE_CHANGE'].some(a => act.includes(a))) return 'CRITICAL'
  if (entity === 'Builder' && act.includes('DELETE')) return 'CRITICAL'
  // Warn: status changes, escalations
  if (['ESCALATE', 'CANCEL', 'DENY', 'OVERRIDE'].some(a => act.includes(a))) return 'WARN'
  return 'INFO'
}

// ──────────────────────────────────────────────────────────────────────────
// Builder-side audit (for tracking builder actions like placing orders)
// ──────────────────────────────────────────────────────────────────────────
export async function auditBuilder(
  builderId: string,
  builderName: string,
  action: string,
  entity: string,
  entityId?: string,
  details?: Record<string, any>
): Promise<string> {
  return logAudit({
    staffId: `builder:${builderId}`,
    staffName: builderName,
    action,
    entity,
    entityId,
    details,
    severity: 'INFO',
  })
}

export async function getAuditLogs(opts: {
  entity?: string
  entityId?: string
  staffId?: string
  action?: string
  severity?: string
  search?: string
  startDate?: string
  endDate?: string
  limit?: number
  offset?: number
}): Promise<{ logs: any[]; total: number }> {
  try {
    await ensureTable()
    const conditions: string[] = []
    const params: any[] = []
    let idx = 1

    if (opts.entity) {
      conditions.push(`"entity" = $${idx}`)
      params.push(opts.entity)
      idx++
    }
    if (opts.entityId) {
      conditions.push(`"entityId" = $${idx}`)
      params.push(opts.entityId)
      idx++
    }
    if (opts.staffId) {
      conditions.push(`"staffId" = $${idx}`)
      params.push(opts.staffId)
      idx++
    }
    if (opts.action) {
      conditions.push(`"action" ILIKE $${idx}`)
      params.push(`%${opts.action}%`)
      idx++
    }
    if (opts.severity) {
      conditions.push(`"severity" = $${idx}`)
      params.push(opts.severity)
      idx++
    }
    if (opts.search) {
      // "staffName" is not a real column — look inside details->>'staffName'
      // (populated by logAudit) as a fallback so name searches still work.
      conditions.push(
        `("action" ILIKE $${idx} OR "entity" ILIKE $${idx} OR "entityId" ILIKE $${idx} OR "staffId" ILIKE $${idx} OR ("details"->>'staffName') ILIKE $${idx})`
      )
      params.push(`%${opts.search}%`)
      idx++
    }
    if (opts.startDate) {
      conditions.push(`"createdAt" >= $${idx}::timestamptz`)
      params.push(opts.startDate)
      idx++
    }
    if (opts.endDate) {
      conditions.push(`"createdAt" <= $${idx}::timestamptz`)
      params.push(opts.endDate)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = opts.limit || 50
    const offset = opts.offset || 0

    const countResult: any[] = await prisma.$queryRawUnsafe(
      `SELECT COUNT(*)::int as total FROM "AuditLog" ${where}`,
      ...params
    )
    const total = countResult[0]?.total || 0

    const rows = await prisma.$queryRawUnsafe(
      `SELECT * FROM "AuditLog" ${where} ORDER BY "createdAt" DESC LIMIT ${limit} OFFSET ${offset}`,
      ...params
    )
    return { logs: rows as any[], total }
  } catch (e) {
    logger.error('audit_log_read_failed', e)
    return { logs: [], total: 0 }
  }
}

/** Get audit stats summary */
export async function getAuditStats(): Promise<any> {
  try {
    await ensureTable()
    const stats: any[] = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::int as "totalLogs",
        COUNT(*) FILTER (WHERE "severity" = 'CRITICAL')::int as "criticalCount",
        COUNT(*) FILTER (WHERE "severity" = 'WARN')::int as "warnCount",
        COUNT(*) FILTER (WHERE "createdAt" >= CURRENT_DATE)::int as "todayCount",
        COUNT(*) FILTER (WHERE "createdAt" >= NOW() - INTERVAL '7 days')::int as "weekCount",
        COUNT(DISTINCT "staffId")::int as "uniqueUsers"
      FROM "AuditLog"
    `)
    return stats[0] || {}
  } catch (e) {
    return {}
  }
}

export function getStaffFromHeaders(headers: Headers) {
  return {
    staffId: headers.get('x-staff-id') || 'unknown',
    staffName: `${headers.get('x-staff-firstname') || ''} ${headers.get('x-staff-lastname') || ''}`.trim() || 'Unknown',
    role: headers.get('x-staff-role') || 'unknown',
    email: headers.get('x-staff-email') || 'unknown',
  }
}
