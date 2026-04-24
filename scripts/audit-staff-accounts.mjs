#!/usr/bin/env node
/**
 * audit-staff-accounts.mjs
 * ------------------------
 * READ-ONLY diagnostic. Surfaces every active Staff account's login health so
 * we can tell before Monday who will (and won't) be able to log into Aegis.
 *
 * What it does:
 *   1. SELECT all active Staff (id, name, email, role, passwordHash, reset/invite
 *      tokens + expiries, updatedAt).
 *   2. Pulls the most recent successful LOGIN per staffId from AuditLog
 *      (entity='Staff', action='LOGIN'). No SecurityEvent per-user lookup:
 *      that table is IP/path-keyed (prisma/schema.prisma:5351) and has no
 *      staffId column. We probe for it with a try/catch for graceful
 *      degradation on future schema drift, but the actual per-staff signal
 *      lives in AuditLog.
 *   3. Classifies each row:
 *        HEALTHY        — passwordHash set; either logged in < 90 days ago,
 *                         or no login records yet but credential is in place
 *                         (freshly invited, first login pending).
 *        PENDING_RESET  — resetToken set AND resetTokenExpiry in the future.
 *        NEEDS_INVITE   — inviteToken set AND inviteTokenExpiry in the future,
 *                         no passwordHash yet.
 *        INVITE_EXPIRED — inviteToken set AND inviteTokenExpiry in the past.
 *        RESET_EXPIRED  — resetToken set AND resetTokenExpiry in the past.
 *        NO_PASSWORD    — passwordHash IS NULL or empty string.
 *        INACTIVE_90D   — passwordHash set, last LOGIN >= 90 days ago.
 *   4. Prints a PM-readiness headline (Chad Zeh / Brittney Werner /
 *      Ben Wilson / Thomas Robinson), a full table, and per-PM remediation
 *      commands for any broken PM.
 *   5. Exit code: 0 if all four PMs are HEALTHY, 1 otherwise (so CI surfaces).
 *
 * Privacy: non-PM email addresses are masked to `ab***@domain.com`.
 * PMs are shown in full because the whole point of the report is to make their
 * status unambiguous.
 *
 * Usage:
 *   node scripts/audit-staff-accounts.mjs
 *
 * Flags:
 *   --json    Emit machine-readable JSON instead of (in addition to) the table.
 *   --all     Unmask every email address (implies operator authority).
 */
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'

const args = new Set(process.argv.slice(2))
const JSON_OUT = args.has('--json')
const UNMASK_ALL = args.has('--all')

const INACTIVE_DAYS = 90

// The four PMs whose Monday-morning login we explicitly guard. Matches CLAUDE.md.
// Match case-insensitively on "firstName lastName" to avoid surprise on casing.
const PM_NAMES = [
  'Chad Zeh',
  'Brittney Werner',
  'Ben Wilson',
  'Thomas Robinson',
]

// Classification severity — lower = more urgent. Drives table sort order.
const SEVERITY = {
  NO_PASSWORD: 0,
  INVITE_EXPIRED: 1,
  RESET_EXPIRED: 2,
  NEEDS_INVITE: 3,
  PENDING_RESET: 4,
  INACTIVE_90D: 5,
  HEALTHY: 6,
}

// Classifications that mean "this person cannot log in right now unassisted."
const BROKEN = new Set([
  'NO_PASSWORD',
  'INVITE_EXPIRED',
  'RESET_EXPIRED',
  'NEEDS_INVITE',
])

const prisma = new PrismaClient()

function log(...a) { console.log(...a) }

async function q(sql, ...params) {
  return prisma.$queryRawUnsafe(sql, ...params)
}

function maskEmail(email) {
  if (!email || typeof email !== 'string') return ''
  const at = email.indexOf('@')
  if (at < 2) return '***' + (at >= 0 ? email.slice(at) : '')
  return email.slice(0, 2) + '***' + email.slice(at)
}

function daysSince(date) {
  if (!date) return null
  const ms = Date.now() - new Date(date).getTime()
  return Math.floor(ms / 86_400_000)
}

function classify(s, lastLoginAt) {
  const now = Date.now()
  const hasPw = typeof s.passwordHash === 'string' && s.passwordHash.trim().length > 0
  const resetExpiry = s.resetTokenExpiry ? new Date(s.resetTokenExpiry).getTime() : null
  const inviteExpiry = s.inviteTokenExpiry ? new Date(s.inviteTokenExpiry).getTime() : null

  // Expired tokens beat healthy-ish signals: someone in the middle of a broken
  // reset is genuinely stuck, even if an old passwordHash still technically
  // exists.
  if (s.inviteToken && inviteExpiry && inviteExpiry < now) return 'INVITE_EXPIRED'
  if (s.resetToken && resetExpiry && resetExpiry < now) return 'RESET_EXPIRED'

  if (!hasPw) {
    // No password yet — in-flight invite is the healthier bucket of the two.
    if (s.inviteToken && inviteExpiry && inviteExpiry >= now) return 'NEEDS_INVITE'
    return 'NO_PASSWORD'
  }

  // Password is set.
  if (s.resetToken && resetExpiry && resetExpiry >= now) return 'PENDING_RESET'

  const lastDays = daysSince(lastLoginAt)
  if (lastDays !== null && lastDays >= INACTIVE_DAYS) return 'INACTIVE_90D'
  // null = we have no LOGIN record yet. That is fine for freshly-onboarded
  // staff whose passwordHash is in place (e.g. they completed invite and
  // just haven't logged in since we started auditing).
  return 'HEALTHY'
}

function isPM(staff) {
  const full = `${staff.firstName} ${staff.lastName}`.trim().toLowerCase()
  return PM_NAMES.some(n => n.toLowerCase() === full)
}

function pad(s, w) {
  s = String(s ?? '')
  if (s.length >= w) return s.slice(0, w)
  return s + ' '.repeat(w - s.length)
}

try {
  const started = Date.now()

  // 1. Active staff.
  const staff = await q(
    `SELECT id, "firstName", "lastName", email, role::text AS role, active,
            "passwordHash", "resetToken", "resetTokenExpiry",
            "inviteToken", "inviteTokenExpiry", "updatedAt"
       FROM "Staff"
      WHERE active = true
      ORDER BY "lastName" ASC, "firstName" ASC`
  )

  // 2. Last LOGIN per staffId from AuditLog. Scoped narrow — entity='Staff' is
  //    what the ops login route writes (src/app/api/ops/auth/login/route.ts:149).
  //    We intentionally do NOT match entity='auth' because that bucket is the
  //    builder-portal login path and carries staffId='builder:<id>'.
  let loginMap = new Map()
  if (staff.length > 0) {
    const ids = staff.map(s => s.id)
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(',')
    const lastLogins = await q(
      `SELECT "staffId", MAX("createdAt") AS last_login
         FROM "AuditLog"
        WHERE action = 'LOGIN'
          AND entity = 'Staff'
          AND "staffId" IN (${placeholders})
        GROUP BY "staffId"`,
      ...ids
    )
    for (const r of lastLogins) loginMap.set(r.staffId, r.last_login)
  }

  // 3. Probe SecurityEvent for any per-staff signal in its `details` JSONB.
  //    The table schema has no staffId column (prisma/schema.prisma:5351) so
  //    this is a best-effort: if someone ever starts stashing staffId in
  //    `details`, we pick it up; if the table is missing / the JSON query
  //    fails, we shrug and continue. Result is used to fill the "last login"
  //    column only when AuditLog has nothing for that staffId — AuditLog is
  //    authoritative when present.
  let secEventMap = new Map()
  try {
    const sec = await q(
      `SELECT (details->>'staffId') AS staff_id, MAX("createdAt") AS last_seen
         FROM "SecurityEvent"
        WHERE kind IN ('login_success', 'LOGIN', 'LOGIN_SUCCESS')
          AND (details->>'staffId') IS NOT NULL
        GROUP BY (details->>'staffId')`
    )
    for (const r of sec) secEventMap.set(r.staff_id, r.last_seen)
  } catch (e) {
    // Swallow — SecurityEvent is optional for this report.
  }

  // 4. Classify.
  const rows = staff.map(s => {
    const lastLogin = loginMap.get(s.id) ?? secEventMap.get(s.id) ?? null
    const status = classify(s, lastLogin)
    const pm = isPM(s)
    return {
      id: s.id,
      name: `${s.firstName} ${s.lastName}`.trim(),
      email: s.email,
      emailDisplay: pm || UNMASK_ALL ? s.email : maskEmail(s.email),
      role: s.role,
      status,
      severity: SEVERITY[status] ?? 99,
      lastLogin,
      lastLoginDays: daysSince(lastLogin),
      isPM: pm,
    }
  })

  rows.sort((a, b) => {
    if (a.severity !== b.severity) return a.severity - b.severity
    return a.name.localeCompare(b.name)
  })

  // 5. PM readiness headline.
  const pmRows = rows.filter(r => r.isPM)
  const pmHealthy = pmRows.filter(r => r.status === 'HEALTHY')
  const pmBroken = pmRows.filter(r => BROKEN.has(r.status))

  const missingPMs = PM_NAMES.filter(
    name => !pmRows.some(r => r.name.toLowerCase() === name.toLowerCase())
  )

  // Soft warnings = PENDING_RESET / INACTIVE_90D: the PM can still log in
  // (passwordHash is intact, reset token merely issued) so we don't fail CI
  // on them, but we do mention them in the headline as FYI.
  const pmSoft = pmRows.filter(r => !BROKEN.has(r.status) && r.status !== 'HEALTHY')

  let pmHeadline
  if (pmBroken.length === 0 && missingPMs.length === 0) {
    if (pmSoft.length === 0) {
      pmHeadline = `Monday PM readiness: all ${PM_NAMES.length} HEALTHY`
    } else {
      const notes = pmSoft.map(r => `${r.name}=${r.status}`).join(', ')
      pmHeadline = `Monday PM readiness: all ${PM_NAMES.length} can log in (note: ${notes})`
    }
  } else {
    const canLogInCount = PM_NAMES.length - pmBroken.length - missingPMs.length
    const issues = []
    for (const r of pmBroken) issues.push(`${r.name}=${r.status}`)
    for (const name of missingPMs) issues.push(`${name}=NOT_FOUND`)
    const softTail = pmSoft.length > 0
      ? `; soft: ${pmSoft.map(r => `${r.name}=${r.status}`).join(', ')}`
      : ''
    pmHeadline = `Monday PM readiness: ${canLogInCount} of ${PM_NAMES.length} can log in, issues: ${issues.join(', ')}${softTail}`
  }

  // --- JSON output path (for tooling) ---
  if (JSON_OUT) {
    const out = {
      generatedAt: new Date().toISOString(),
      pmHeadline,
      counts: rows.reduce((acc, r) => {
        acc[r.status] = (acc[r.status] || 0) + 1
        return acc
      }, {}),
      rows: rows.map(r => ({
        id: r.id,
        name: r.name,
        email: r.emailDisplay,
        role: r.role,
        status: r.status,
        lastLogin: r.lastLogin,
        lastLoginDays: r.lastLoginDays,
        isPM: r.isPM,
      })),
      brokenPMs: pmBroken.map(r => ({ id: r.id, name: r.name, status: r.status })),
      missingPMs,
      elapsedMs: Date.now() - started,
    }
    log(JSON.stringify(out, null, 2))
  } else {
    // --- Human report ---
    log('\n===== STAFF ACCOUNT AUDIT =====')
    log(`when:       ${new Date().toISOString()}`)
    log(`active:     ${rows.length} Staff rows`)
    log(`inactive >= ${INACTIVE_DAYS}d threshold`)
    log('')
    log(pmHeadline)
    log('')

    const counts = rows.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc }, {})
    log('Counts by status:')
    for (const status of Object.keys(SEVERITY).sort((a, b) => SEVERITY[a] - SEVERITY[b])) {
      if (!counts[status]) continue
      log(`  ${pad(status, 15)} ${counts[status]}`)
    }
    log('')

    // Table header
    log(
      pad('STATUS', 15) +
      pad('PM', 4) +
      pad('NAME', 26) +
      pad('ROLE', 22) +
      pad('LAST LOGIN', 14) +
      'EMAIL'
    )
    log('-'.repeat(120))
    for (const r of rows) {
      const lastLoginDisplay = r.lastLogin
        ? `${r.lastLoginDays ?? '?'}d ago`
        : '(never)'
      log(
        pad(r.status, 15) +
        pad(r.isPM ? 'PM' : '', 4) +
        pad(r.name, 26) +
        pad(r.role, 22) +
        pad(lastLoginDisplay, 14) +
        r.emailDisplay
      )
    }
    log('')

    // Recommendations
    if (pmBroken.length === 0 && missingPMs.length === 0) {
      log('Recommendations: none — all PMs ready for Monday.')
    } else {
      log('Recommendations:')
      for (const r of pmBroken) {
        log(`  [${r.status}] ${r.name} (${r.email})`)
        log(`    Run: curl -X POST https://app.abellumber.com/api/ops/staff/${r.id}/reset-password \\`)
        log(`           -H 'cookie: <staff-admin-session>'`)
        log(`    → triggers a fresh reset email to ${r.name}.`)
      }
      for (const name of missingPMs) {
        log(`  [NOT_FOUND] ${name} — no active Staff row matches this name.`)
        log(`    Check /ops/staff in Aegis; confirm they're hired + active.`)
      }
    }
    log('')
    log(`elapsed ms: ${Date.now() - started}`)
  }

  const brokenPMCount = pmBroken.length + missingPMs.length
  process.exit(brokenPMCount > 0 ? 1 : 0)
} catch (e) {
  console.error('[audit-staff] FAILED:', e?.message || e)
  if (e?.stack) console.error(e.stack)
  process.exit(1)
} finally {
  await prisma.$disconnect()
}
