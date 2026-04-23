/**
 * scripts/etl-staff-onboarding.ts
 *
 * Generates InboxItem action items for Aegis staff onboarding:
 *   1. For active Staff in target roles (ADMIN, MANAGER, ACCOUNTING, SALES_REP,
 *      PROJECT_MANAGER) with a real @abellumber.com email → create a "send
 *      Aegis login invite" item (priority MEDIUM).
 *   2. For active Staff in target roles with a placeholder/missing email
 *      (@placeholder.*, employee-ID-based, blank, or non-@abellumber.com) →
 *      create a "collect real email" item (priority LOW).
 *   3. One summary InboxItem tallying the rollout.
 *
 * Source tag: STAFF_ONBOARDING_APR2026
 * Writes ONLY to InboxItem. No Staff writes. No emails sent.
 * Cap: 40 InboxItems across the two per-staff buckets (summary item excluded
 * from cap for visibility, but total output is capped at 41).
 *
 * Idempotent via deterministic IDs (sha256 of source tag + staff id + bucket).
 *
 * Run:
 *   npx ts-node scripts/etl-staff-onboarding.ts            # DRY-RUN
 *   npx ts-node scripts/etl-staff-onboarding.ts --commit   # COMMIT
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC = 'STAFF_ONBOARDING_APR2026'
const CAP = 40

type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'

interface InboxData {
  id: string
  type: string
  source: string
  title: string
  description?: string
  priority: Priority
  dueBy?: Date
}

const DUE_WEEK = new Date('2026-04-29T23:00:00Z')
const DUE_MONTH = new Date('2026-05-22T23:00:00Z')

const TARGET_ROLES = new Set([
  'ADMIN',
  'MANAGER',
  'ACCOUNTING',
  'SALES_REP',       // spec says "SALES"; enum is SALES_REP
  'PROJECT_MANAGER', // spec says "PM"; enum is PROJECT_MANAGER
])

function hashId(bucket: string, key: string): string {
  return (
    'ib_staffonb_' +
    crypto.createHash('sha256').update(`${SRC}::${bucket}::${key}`).digest('hex').slice(0, 18)
  )
}

/**
 * Classify an email into: real | placeholder | external
 *   - blank / null  → placeholder
 *   - matches @placeholder.* (any subdomain)  → placeholder
 *   - looks like employee-id based (al-001@, emp123@, e001@, id-###@) → placeholder
 *   - ends in @abellumber.com AND isn't an AI agent / coordinator  → real
 *   - any other domain (e.g. @mgfinancialpartners.com, @test.com)  → external
 *
 * AI/agent accounts under @abellumber.com are treated as "skip" — they are
 * system accounts, not humans who need logins. Returned as 'skip'.
 */
type EmailClass = 'real' | 'placeholder' | 'external' | 'skip'

function classifyEmail(emailRaw: string | null | undefined): EmailClass {
  const email = (emailRaw ?? '').trim().toLowerCase()
  if (!email) return 'placeholder'
  if (/@placeholder\./.test(email)) return 'placeholder'
  // Employee-ID patterns: al-001@, emp123@, e001@, id-###@, employee123@
  if (/^(al-?\d+|emp\d+|e\d{3,}|id-?\d+|employee\d+)@/i.test(email)) return 'placeholder'
  // AI agent / coordinator / bot accounts — not humans, skip entirely
  if (/@abellumber\.com$/.test(email)) {
    if (/(\.agent|^coordinator|^bot|^system|^ai|^intel\.)/.test(email.split('@')[0])) {
      return 'skip'
    }
    return 'real'
  }
  // test emails
  if (/@(test|example)\./.test(email)) return 'external'
  return 'external'
}

async function main() {
  console.log(`ETL Staff Onboarding — source tag: ${SRC} — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log()

  const prisma = new PrismaClient()
  try {
    const staff = await prisma.staff.findMany({
      where: { active: true },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
        title: true,
      },
      orderBy: [{ role: 'asc' }, { lastName: 'asc' }, { firstName: 'asc' }],
    })

    console.log(`Active staff total: ${staff.length}`)

    // Filter to target roles only
    const inScope = staff.filter((s) => TARGET_ROLES.has(s.role as string))
    console.log(`In-scope (ADMIN/MANAGER/ACCOUNTING/SALES_REP/PROJECT_MANAGER): ${inScope.length}`)

    const readyForInvite: typeof inScope = []
    const emailMissing: typeof inScope = []
    const skipped: typeof inScope = []

    for (const s of inScope) {
      const cls = classifyEmail(s.email)
      if (cls === 'real') readyForInvite.push(s)
      else if (cls === 'skip') skipped.push(s)
      else emailMissing.push(s) // placeholder OR external both go to verification bucket
    }

    console.log()
    console.log(`Ready for invite (real @abellumber.com email):   ${readyForInvite.length}`)
    console.log(`Email needs verification (placeholder/external): ${emailMissing.length}`)
    console.log(`Skipped (AI agent / system account):             ${skipped.length}`)
    if (skipped.length) {
      for (const s of skipped) {
        console.log(`  skip: ${s.firstName} ${s.lastName} <${s.email}> [${s.role}]`)
      }
    }

    // Build InboxItems for each bucket
    const inviteItems: InboxData[] = readyForInvite.map((s) => {
      const full = `${s.firstName} ${s.lastName}`.trim()
      return {
        id: hashId('invite', s.id),
        type: 'AGENT_TASK',
        source: 'staff-onboarding',
        title: `Send Aegis login invite to ${full} (${s.email}, ${s.role})`,
        description:
          `Active Staff id=${s.id} with a real @abellumber.com email and a target role ` +
          `(${s.role}${s.title ? `, title: ${s.title}` : ''}). ` +
          `Trigger the existing Aegis invite flow (Staff.inviteToken / inviteTokenExpiry + Resend email). ` +
          `Do NOT send until Nate confirms the staff rollout go-ahead.`,
        priority: 'MEDIUM',
        dueBy: DUE_WEEK,
      }
    })

    const verifyItems: InboxData[] = emailMissing.map((s) => {
      const full = `${s.firstName} ${s.lastName}`.trim()
      const reason = classifyEmail(s.email)
      return {
        id: hashId('verify', s.id),
        type: 'AGENT_TASK',
        source: 'staff-onboarding',
        title: `Collect real email for ${full} before sending Aegis invite`,
        description:
          `Active Staff id=${s.id} role=${s.role}${s.title ? ` title=${s.title}` : ''}. ` +
          `Current email on file: "${s.email ?? '(blank)'}" — classified as ${reason}. ` +
          `Confirm their actual @abellumber.com address with Dawn (Accounting) or directly, ` +
          `update Staff.email in Aegis, then re-run this ETL to generate the invite item.`,
        priority: 'LOW',
        dueBy: DUE_MONTH,
      }
    })

    // Cap: 40 total across the two per-staff buckets. Invites first (higher pri).
    const combined = [...inviteItems, ...verifyItems]
    let finalPerStaff: InboxData[]
    if (combined.length > CAP) {
      // Take all invites first, then fill remaining slots with verification items
      const invitesCount = Math.min(inviteItems.length, CAP)
      const verifyCount = Math.max(0, CAP - invitesCount)
      finalPerStaff = [
        ...inviteItems.slice(0, invitesCount),
        ...verifyItems.slice(0, verifyCount),
      ]
    } else {
      finalPerStaff = combined
    }

    const droppedInvites = inviteItems.length - finalPerStaff.filter((i) => i.title.startsWith('Send Aegis')).length
    const droppedVerify = verifyItems.length - finalPerStaff.filter((i) => i.title.startsWith('Collect real')).length

    // Summary item (always produced, not counted against CAP)
    const summary: InboxData = {
      id: hashId('summary', 'rollout-summary'),
      type: 'AGENT_TASK',
      source: 'staff-onboarding',
      title: `Aegis staff rollout — ${readyForInvite.length} invites pending, ${emailMissing.length} emails need verification`,
      description:
        `Generated ${new Date().toISOString()} by etl-staff-onboarding.ts. ` +
        `Active staff: ${staff.length}. In-scope roles (ADMIN/MANAGER/ACCOUNTING/SALES_REP/PROJECT_MANAGER): ${inScope.length}. ` +
        `Ready-for-invite: ${readyForInvite.length}. Email-needs-verification: ${emailMissing.length}. ` +
        `Skipped AI/system accounts: ${skipped.length}. ` +
        (droppedInvites + droppedVerify > 0
          ? `NOTE: cap=${CAP} reached — ${droppedInvites} invite item(s) and ${droppedVerify} verify item(s) NOT materialized this run; rerun after clearing the queue. `
          : '') +
        `Next step: work the "Send Aegis login invite" items after verifying each email is valid and the staff member is ready for access.`,
      priority: 'HIGH',
      dueBy: DUE_WEEK,
    }

    const final: InboxData[] = [summary, ...finalPerStaff]

    console.log()
    console.log(`InboxItems to produce: ${final.length}`)
    console.log(`  summary:         1`)
    console.log(`  invites (MED):   ${final.filter((i) => i.source === 'staff-onboarding' && i.priority === 'MEDIUM').length}`)
    console.log(`  verifies (LOW):  ${final.filter((i) => i.source === 'staff-onboarding' && i.priority === 'LOW').length}`)
    if (droppedInvites + droppedVerify > 0) {
      console.log(`  dropped (cap):   invites=${droppedInvites} verifies=${droppedVerify}`)
    }
    console.log()
    console.log('Sample (first 5):')
    final.slice(0, 5).forEach((it, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. [${it.priority}] ${it.title.slice(0, 120)}`)
    })
    console.log()

    if (DRY_RUN) {
      console.log('DRY-RUN — re-run with --commit to write.')
      return
    }

    let created = 0
    let updated = 0
    let failed = 0
    for (const it of final) {
      try {
        const existing = await prisma.inboxItem.findUnique({
          where: { id: it.id },
          select: { id: true },
        })
        await prisma.inboxItem.upsert({
          where: { id: it.id },
          create: {
            id: it.id,
            type: it.type,
            source: it.source,
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            status: 'PENDING',
            dueBy: it.dueBy,
          },
          update: {
            title: it.title.slice(0, 240),
            description: it.description?.slice(0, 2000),
            priority: it.priority,
            dueBy: it.dueBy,
          },
        })
        if (existing) updated++
        else created++
      } catch (e) {
        failed++
        console.error(`  FAIL ${it.id}:`, (e as Error).message.slice(0, 160))
      }
    }
    console.log(`Committed: created=${created}, updated=${updated}, failed=${failed}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
