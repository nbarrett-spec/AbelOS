export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkStaffAuth } from '@/lib/api-auth'
import { audit } from '@/lib/audit'

// ──────────────────────────────────────────────────────────────────────────
// GET  /api/ops/automations — List all automation rules
// POST /api/ops/automations — Create automation rule
// ──────────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Auto-create table
    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AutomationRule" (
        "id"          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "name"        TEXT NOT NULL,
        "description" TEXT,
        "trigger"     TEXT NOT NULL,
        "conditions"  JSONB DEFAULT '{}',
        "actions"     JSONB DEFAULT '[]',
        "roles"       TEXT[] DEFAULT '{}',
        "frequency"   TEXT DEFAULT 'ON_TRIGGER',
        "enabled"     BOOLEAN DEFAULT true,
        "lastRunAt"   TIMESTAMPTZ,
        "runCount"    INTEGER DEFAULT 0,
        "createdById" TEXT,
        "createdAt"   TIMESTAMPTZ DEFAULT NOW(),
        "updatedAt"   TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await prisma.$queryRawUnsafe(`
      CREATE TABLE IF NOT EXISTS "AutomationLog" (
        "id"           TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        "ruleId"       TEXT REFERENCES "AutomationRule"("id"),
        "ruleName"     TEXT,
        "trigger"      TEXT,
        "status"       TEXT DEFAULT 'SUCCESS',
        "actionsRun"   INTEGER DEFAULT 0,
        "details"      JSONB DEFAULT '{}',
        "error"        TEXT,
        "executedAt"   TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_automation_rule_trigger" ON "AutomationRule"("trigger")`)
    await prisma.$queryRawUnsafe(`CREATE INDEX IF NOT EXISTS "idx_automation_log_rule" ON "AutomationLog"("ruleId")`)

    const { searchParams } = new URL(request.url)
    const role = searchParams.get('role')
    const trigger = searchParams.get('trigger')

    let where = ''
    const conds: string[] = []
    const params: any[] = []
    let idx = 1

    if (role) { conds.push(`$${idx} = ANY("roles")`); params.push(role); idx++ }
    if (trigger) { conds.push(`"trigger" = $${idx}`); params.push(trigger); idx++ }

    if (conds.length > 0) where = `WHERE ${conds.join(' AND ')}`

    const rules = await prisma.$queryRawUnsafe(`
      SELECT * FROM "AutomationRule" ${where} ORDER BY "enabled" DESC, "name" ASC
    `, ...params)

    // Get recent logs
    const logs = await prisma.$queryRawUnsafe(`
      SELECT * FROM "AutomationLog" ORDER BY "executedAt" DESC LIMIT 50
    `)

    return NextResponse.json({ rules, logs })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load automations', details: String(error) }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'CREATE', 'Automations', undefined, { method: 'POST' }).catch(() => {})

    const body = await request.json()
    const { name, description, trigger, conditions, actions, roles, frequency } = body
    const staffId = request.headers.get('x-staff-id')

    if (!name || !trigger) {
      return NextResponse.json({ error: 'Name and trigger required' }, { status: 400 })
    }

    const result = await prisma.$queryRawUnsafe(`
      INSERT INTO "AutomationRule" ("name", "description", "trigger", "conditions", "actions", "roles", "frequency", "createdById")
      VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::text[], $7, $8)
      RETURNING *
    `, name, description || null, trigger,
       JSON.stringify(conditions || {}), JSON.stringify(actions || []),
       roles || [], frequency || 'ON_TRIGGER', staffId
    ) as any[]

    return NextResponse.json({ rule: result[0] }, { status: 201 })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create automation', details: String(error) }, { status: 500 })
  }
}

export async function PATCH(request: NextRequest) {
  const authError = checkStaffAuth(request)
  if (authError) return authError

  try {
    // Audit log
    audit(request, 'UPDATE', 'Automations', undefined, { method: 'PATCH' }).catch(() => {})

    const body = await request.json()
    const { id, enabled, name, description, trigger, conditions, actions, roles, frequency } = body

    if (!id) return NextResponse.json({ error: 'Rule ID required' }, { status: 400 })

    const fields: string[] = []
    const values: any[] = []
    let idx = 1

    if (enabled !== undefined) { fields.push(`"enabled" = $${idx}`); values.push(enabled); idx++ }
    if (name) { fields.push(`"name" = $${idx}`); values.push(name); idx++ }
    if (description !== undefined) { fields.push(`"description" = $${idx}`); values.push(description); idx++ }
    if (trigger) { fields.push(`"trigger" = $${idx}`); values.push(trigger); idx++ }
    if (conditions) { fields.push(`"conditions" = $${idx}::jsonb`); values.push(JSON.stringify(conditions)); idx++ }
    if (actions) { fields.push(`"actions" = $${idx}::jsonb`); values.push(JSON.stringify(actions)); idx++ }
    if (roles) { fields.push(`"roles" = $${idx}::text[]`); values.push(roles); idx++ }
    if (frequency) { fields.push(`"frequency" = $${idx}`); values.push(frequency); idx++ }

    fields.push(`"updatedAt" = NOW()`)
    values.push(id)

    const result = await prisma.$queryRawUnsafe(`
      UPDATE "AutomationRule" SET ${fields.join(', ')} WHERE "id" = $${idx} RETURNING *
    `, ...values) as any[]

    return NextResponse.json({ rule: result[0] })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to update automation' }, { status: 500 })
  }
}
