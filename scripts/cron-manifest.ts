/**
 * Cron Schedule Manifest Builder
 *
 * Source tag: CRON_MANIFEST_APR2026
 *
 * Reads vercel.json, cross-references each cron entry with a known
 * purpose, pulls last-run status + 24-run error rate from CronRun,
 * and writes an ops-visibility manifest to AEGIS-CRON-MANIFEST.md.
 *
 * Creates InboxItems for: (1) overall summary, (2) stale crons (no run
 * in >24h), (3) crons whose error rate exceeds 5% over the last 24 runs.
 *
 * READ-ONLY on CronRun. InboxItem writes allowed (flagged findings).
 *
 * Usage:
 *   tsx scripts/cron-manifest.ts           # DRY-RUN (default)
 *   tsx scripts/cron-manifest.ts --commit  # Write manifest + inbox items
 */

import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';

const prisma = new PrismaClient();

const COMMIT = process.argv.includes('--commit');
const SOURCE_TAG = 'CRON_MANIFEST_APR2026';

const REPO_ROOT = path.resolve(__dirname, '..');
const VERCEL_JSON = path.join(REPO_ROOT, 'vercel.json');
const MANIFEST_OUT = path.resolve(REPO_ROOT, '..', 'AEGIS-CRON-MANIFEST.md');

// ── Human-readable purpose map keyed by route path ─────────────────────────
const PURPOSE: Record<string, { purpose: string; schedule_human: string }> = {
  '/api/cron/quote-followups':      { purpose: 'Nudge sales on stale/aged quotes',                                schedule_human: '09:00 weekdays' },
  '/api/cron/agent-opportunities':  { purpose: 'Auto-detect stale quotes, dormant builders, un-analyzed blueprints → queue agent workflows', schedule_human: '14:00 weekdays' },
  '/api/cron/inflow-sync':          { purpose: 'InFlow → Aegis product, inventory, PO, SO sync',                  schedule_human: 'Hourly :00' },
  '/api/cron/bolt-sync':            { purpose: 'ECI Bolt → Aegis customer/order/WO/invoice sync',                 schedule_human: 'Hourly :30' },
  '/api/cron/hyphen-sync':          { purpose: 'Brookfield Hyphen portal → Job ingest',                           schedule_human: 'Hourly :15' },
  '/api/cron/bpw-sync':             { purpose: 'BPW Pulte → Community/Job/Schedule sync (legacy, Pulte churned 4/20)', schedule_human: 'Hourly :45' },
  '/api/cron/buildertrend-sync':    { purpose: 'BuilderTrend schedule + material selections mirror',              schedule_human: 'Every 2h at :15' },
  '/api/cron/run-automations':      { purpose: 'Execute scheduled + event-based automation rules',                schedule_human: '08,13,17 weekdays' },
  '/api/cron/mrp-nightly':          { purpose: 'MRP projection + SmartPORecommendation maintenance',              schedule_human: '04:00 daily' },
  '/api/cron/webhook-retry':        { purpose: 'Retry FAILED WebhookEvent rows with exponential backoff',         schedule_human: 'Every 5 min' },
  '/api/cron/uptime-probe':         { purpose: 'Persist /api/health/ready probe → UptimeProbe table',             schedule_human: 'Every 5 min' },
  '/api/cron/observability-gc':     { purpose: 'GC of ClientError / ServerError / SlowQueryLog tables',           schedule_human: '03:00 daily' },
  '/api/cron/process-outreach':     { purpose: 'Process outbound outreach queue (emails, tasks)',                 schedule_human: 'Every 10 min' },
  '/api/cron/gmail-sync':           { purpose: 'Pull Gmail (all abellumber.com mailboxes) → CommunicationLog',    schedule_human: 'Every 15 min' },
  '/api/cron/material-watch':       { purpose: 'Watch MaterialWatch rows; mark ARRIVED when stock lands',         schedule_human: 'Every 30 min' },
  '/api/cron/nuc-alerts':           { purpose: 'Pull alerts from NUC AI engine → InboxItem',                       schedule_human: 'Every 6h' },
  '/api/cron/morning-briefing':     { purpose: 'Compose + send morning briefing email to leadership',             schedule_human: '12:00 weekdays' },
  '/api/cron/collections-email':    { purpose: 'Send collections dunning emails',                                  schedule_human: '14:00 weekdays' },
  '/api/cron/weekly-report':        { purpose: 'Monday ops weekly report to leadership',                           schedule_human: 'Mon 13:00' },
  '/api/cron/pm-daily-tasks':       { purpose: 'Generate each PM\'s daily task list (jobs, ETAs, overdue)',        schedule_human: '11:30 weekdays' },
  '/api/cron/collections-cycle':    { purpose: 'Run collections rule engine; create approval tasks + payment plans', schedule_human: '13:00 weekdays' },
  '/api/cron/data-quality':         { purpose: 'Data Quality Watchdog — evaluate rules, flag violations, auto-fix', schedule_human: '02:00 daily' },
  '/api/cron/financial-snapshot':   { purpose: 'Capture daily financial KPI snapshot',                             schedule_human: '06:00 daily' },
  '/api/cron/inbox-feed':           { purpose: 'Scan source systems → generate InboxItem rows for new actions',    schedule_human: 'Every 15 min' },
  '/api/cron/brain-sync':           { purpose: 'Pull Communities / Builders / Scores from NUC Brain API',          schedule_human: 'Every 4h' },
  '/api/cron/brain-sync-staff':     { purpose: 'Pull Staff / Deal / FinancialSnapshot from NUC Brain API',         schedule_human: 'Every 4h' },
  '/api/cron/daily-digest':         { purpose: 'Personalized daily digest email per active staff',                 schedule_human: '11:00 daily (06:00 CT)' },
};

interface VercelCron {
  path: string;
  schedule: string;
}

interface ManifestRow {
  path: string;
  cronName: string;
  schedule: string;
  scheduleHuman: string;
  purpose: string;
  lastRun: Date | null;
  lastStatus: string | null;
  lastDurationMs: number | null;
  runsLast24: number;
  errorsLast24: number;
  errorRatePct: number;
  stale: boolean;
  errorProne: boolean;
}

function cronNameFromPath(p: string): string {
  // e.g. "/api/cron/quote-followups" → "quote-followups"
  return p.replace(/^\/api\/cron\//, '');
}

// The Prisma schema and the live DB have drifted on CronRun column naming
// (schema.prisma says `cronName`, DB has `name`). Use raw SQL and probe both
// column names so this script works in either state. READ-ONLY.
let CRON_NAME_COL: 'name' | 'cronName' | null = null;

async function detectCronNameCol(): Promise<void> {
  if (CRON_NAME_COL !== null) return;
  try {
    const rows = await prisma.$queryRawUnsafe<Array<{ column_name: string }>>(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'CronRun' AND column_name IN ('name','cronName')`,
    );
    const cols = rows.map((r) => r.column_name);
    if (cols.includes('name')) CRON_NAME_COL = 'name';
    else if (cols.includes('cronName')) CRON_NAME_COL = 'cronName';
    else CRON_NAME_COL = 'name'; // fall through; raw query will surface the error
  } catch {
    CRON_NAME_COL = 'name';
  }
}

async function lastRunForCron(cronName: string) {
  await detectCronNameCol();
  const col = `"${CRON_NAME_COL}"`;
  const candidates = [cronName, `/api/cron/${cronName}`];
  const rows = await prisma.$queryRawUnsafe<
    Array<{ status: string; startedAt: Date; durationMs: number | null; error: string | null }>
  >(
    `SELECT status, "startedAt", "durationMs", error FROM "CronRun" WHERE ${col} = ANY($1::text[]) ORDER BY "startedAt" DESC LIMIT 1`,
    candidates,
  );
  return rows[0] ?? null;
}

async function last24Stats(cronName: string) {
  await detectCronNameCol();
  const col = `"${CRON_NAME_COL}"`;
  const candidates = [cronName, `/api/cron/${cronName}`];
  const rows = await prisma.$queryRawUnsafe<Array<{ status: string }>>(
    `SELECT status FROM "CronRun" WHERE ${col} = ANY($1::text[]) ORDER BY "startedAt" DESC LIMIT 24`,
    candidates,
  );
  // DB uses both "FAILED" (schema.prisma) and "FAILURE" (live rows) — handle both.
  const errors = rows.filter((r) => r.status === 'FAILED' || r.status === 'FAILURE' || r.status === 'ERROR').length;
  return {
    total: rows.length,
    errors,
    ratePct: rows.length === 0 ? 0 : (errors / rows.length) * 100,
  };
}

function fmt(d: Date | null): string {
  if (!d) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function hoursSince(d: Date | null): number {
  if (!d) return Infinity;
  return (Date.now() - d.getTime()) / (1000 * 60 * 60);
}

async function build(): Promise<ManifestRow[]> {
  const raw = fs.readFileSync(VERCEL_JSON, 'utf8');
  const { crons = [] } = JSON.parse(raw) as { crons: VercelCron[] };

  const rows: ManifestRow[] = [];

  for (const c of crons) {
    const cronName = cronNameFromPath(c.path);
    const meta = PURPOSE[c.path] || { purpose: '(unmapped — add to cron-manifest.ts)', schedule_human: c.schedule };
    let last: Awaited<ReturnType<typeof lastRunForCron>> = null;
    let stats = { total: 0, errors: 0, ratePct: 0 };
    try {
      last = await lastRunForCron(cronName);
      stats = await last24Stats(cronName);
    } catch (err) {
      // CronRun table might not be queryable (e.g. drift). Don't explode.
      console.error(`  [warn] CronRun lookup failed for ${cronName}:`, (err as Error).message);
    }

    const hrs = hoursSince(last?.startedAt ?? null);
    rows.push({
      path: c.path,
      cronName,
      schedule: c.schedule,
      scheduleHuman: meta.schedule_human,
      purpose: meta.purpose,
      lastRun: last?.startedAt ?? null,
      lastStatus: last?.status ?? null,
      lastDurationMs: last?.durationMs ?? null,
      runsLast24: stats.total,
      errorsLast24: stats.errors,
      errorRatePct: Number(stats.ratePct.toFixed(1)),
      stale: hrs > 24,
      errorProne: stats.total >= 4 && stats.ratePct > 5,
    });
  }

  return rows;
}

function renderMarkdown(rows: ManifestRow[]): string {
  const lines: string[] = [];
  lines.push('# Aegis Cron Manifest');
  lines.push('');
  lines.push(`> Source: \`vercel.json\` + \`CronRun\` table. Generated by \`scripts/cron-manifest.ts\`.  `);
  lines.push(`> Source tag: \`${SOURCE_TAG}\`  `);
  lines.push(`> Generated: ${new Date().toISOString()}  `);
  lines.push(`> Total crons: **${rows.length}**`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  const stale = rows.filter((r) => r.stale && r.runsLast24 > 0);
  const neverRan = rows.filter((r) => r.lastRun === null);
  const errorProne = rows.filter((r) => r.errorProne);
  lines.push(`- **${rows.length}** crons scheduled`);
  lines.push(`- **${neverRan.length}** have no CronRun history (never instrumented, or new)`);
  lines.push(`- **${stale.length}** stale (last run > 24h ago but has history)`);
  lines.push(`- **${errorProne.length}** error-prone (>5% failure over last 24 runs)`);
  lines.push('');
  lines.push('## Manifest');
  lines.push('');
  lines.push('| Path | Schedule (cron) | Cadence | Purpose | Last Run (UTC) | Last Status | Last ms | 24-run errs | Err % | Flags |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    const flags: string[] = [];
    if (r.stale && r.runsLast24 > 0) flags.push('STALE');
    if (r.errorProne) flags.push('ERROR-PRONE');
    if (r.lastRun === null) flags.push('NO-HISTORY');
    lines.push([
      '',
      `\`${r.path}\``,
      `\`${r.schedule}\``,
      r.scheduleHuman,
      r.purpose,
      fmt(r.lastRun),
      r.lastStatus ?? '—',
      r.lastDurationMs?.toString() ?? '—',
      `${r.errorsLast24}/${r.runsLast24}`,
      r.runsLast24 ? `${r.errorRatePct}%` : '—',
      flags.join(' ') || '—',
      '',
    ].join(' | ').trim());
  }
  lines.push('');
  lines.push('## Flagged');
  lines.push('');
  if (stale.length) {
    lines.push('### Stale (no run in >24h)');
    for (const r of stale) lines.push(`- \`${r.path}\` — last run ${fmt(r.lastRun)}`);
    lines.push('');
  }
  if (errorProne.length) {
    lines.push('### Error-prone (>5% failure over last 24 runs)');
    for (const r of errorProne) lines.push(`- \`${r.path}\` — ${r.errorsLast24}/${r.runsLast24} failed (${r.errorRatePct}%)`);
    lines.push('');
  }
  if (!stale.length && !errorProne.length) lines.push('_No stale or error-prone crons._');
  lines.push('');
  lines.push('---');
  lines.push(`_Source tag: ${SOURCE_TAG}. Regenerate with \`tsx scripts/cron-manifest.ts --commit\`._`);
  return lines.join('\n') + '\n';
}

async function writeInboxItems(rows: ManifestRow[]) {
  const stale = rows.filter((r) => r.stale && r.runsLast24 > 0);
  const errorProne = rows.filter((r) => r.errorProne);

  const items: Array<{ title: string; description: string; priority: string }> = [];

  // 1. Summary
  items.push({
    title: `Cron manifest refreshed — ${rows.length} crons, ${stale.length} stale, ${errorProne.length} error-prone`,
    description: `Full manifest written to AEGIS-CRON-MANIFEST.md. ${rows.length} cron jobs are scheduled in vercel.json. ${rows.filter((r) => r.lastRun === null).length} have no CronRun history yet.`,
    priority: 'LOW',
  });

  // 2. Stale
  if (stale.length) {
    items.push({
      title: `${stale.length} cron job(s) have not run in >24h`,
      description:
        'Stale crons (last CronRun >24h ago):\n' +
        stale.map((r) => `- ${r.path} — last run ${fmt(r.lastRun)}`).join('\n') +
        '\n\nCheck Vercel Cron dashboard and CRON_SECRET env var.',
      priority: 'HIGH',
    });
  }

  // 3. Error-prone
  if (errorProne.length) {
    items.push({
      title: `${errorProne.length} cron job(s) failing >5% over last 24 runs`,
      description:
        errorProne
          .map((r) => `- ${r.path}: ${r.errorsLast24}/${r.runsLast24} failed (${r.errorRatePct}%)`)
          .join('\n') +
        '\n\nReview CronRun.error field for root cause. Common causes: upstream API outage, schema drift, secret rotation.',
      priority: 'HIGH',
    });
  }

  console.log(`\n[inbox] ${items.length} InboxItem(s) to write:`);
  for (const it of items) console.log(`  [${it.priority}] ${it.title}`);

  if (!COMMIT) {
    console.log('\n[dry-run] Skipping InboxItem writes. Pass --commit to persist.');
    return;
  }

  for (const it of items) {
    await prisma.inboxItem.create({
      data: {
        type: 'SYSTEM',
        source: SOURCE_TAG,
        title: it.title,
        description: it.description,
        priority: it.priority,
        status: 'PENDING',
      },
    });
  }
  console.log(`[inbox] Wrote ${items.length} item(s).`);
}

async function main() {
  console.log(`[cron-manifest] ${COMMIT ? 'COMMIT' : 'DRY-RUN'} — source tag ${SOURCE_TAG}`);
  const rows = await build();
  const md = renderMarkdown(rows);

  console.log(`\n[manifest] ${rows.length} cron rows built.`);
  console.log(`[manifest] ${rows.filter((r) => r.stale && r.runsLast24 > 0).length} stale, ${rows.filter((r) => r.errorProne).length} error-prone.`);

  if (COMMIT) {
    fs.writeFileSync(MANIFEST_OUT, md, 'utf8');
    console.log(`[manifest] Wrote ${MANIFEST_OUT}`);
  } else {
    console.log(`[dry-run] Would write ${MANIFEST_OUT} (${md.length} bytes)`);
    console.log('\n----- MANIFEST PREVIEW (first 40 lines) -----');
    console.log(md.split('\n').slice(0, 40).join('\n'));
    console.log('----- ... -----\n');
  }

  await writeInboxItems(rows);
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (err) => {
    console.error('[cron-manifest] FAILED:', err);
    await prisma.$disconnect();
    process.exit(1);
  });
