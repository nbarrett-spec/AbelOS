/**
 * Smoke test for the Morning Brain Brief email template.
 *
 * Calls buildMorningBrainBrief() with mock data and prints the rendered HTML
 * to stdout. Useful for previewing without invoking the cron / firing Resend.
 *
 * Usage:
 *   npx tsx scripts/test-morning-brief-email.ts > /tmp/preview.html
 *   open /tmp/preview.html      # or just paste into a browser tab
 *
 * For SMS preview:
 *   npx tsx scripts/test-morning-brief-email.ts --sms
 *
 * For plaintext preview:
 *   npx tsx scripts/test-morning-brief-email.ts --text
 */

import {
  buildMorningBrainBrief,
  buildMorningBrainSms,
  type BrainBriefData,
} from '../src/lib/email/morning-brain-brief'

const mock: BrainBriefData = {
  date: new Date('2026-04-30T11:00:00Z'),
  fromCachedBrief: true,
  totalActions: 7,
  totalAlerts: 3,
  insights: [
    {
      id: 'ins_1',
      kind: 'opportunity',
      narrative:
        'Brookfield Rev 4 plan breakdown is sitting unread by Amanda Barham for 9 days — pricing window expires Friday.',
      confidence: 0.92,
      entity_ids: ['cust_brookfield', 'plan_rev4', 'contact_amanda'],
    },
    {
      id: 'ins_2',
      kind: 'anomaly',
      narrative:
        'Boise Cascade door PO lead times jumped from 14d → 21d this week (5 of last 6 POs). Flag for AMP negotiation.',
      confidence: 0.84,
      entity_ids: ['vend_boise', 'po_2026_0412'],
    },
    {
      id: 'ins_3',
      kind: 'risk',
      narrative:
        'Pulte AR balance ($32.5K across 21 open POs) past 30 days with account closed — escalate to Dawn for cancellation/credit posting.',
      confidence: 0.97,
      entity_ids: ['cust_pulte', 'ar_aging_30'],
    },
    {
      id: 'ins_4',
      kind: 'trend',
      narrative:
        'Bloomfield order velocity up 23% MoM — three new communities active in Aubrey/Celina. Margin holding at 22.8%.',
      confidence: 0.71,
      entity_ids: ['cust_bloomfield'],
    },
    {
      id: 'ins_5',
      kind: 'finding',
      narrative:
        'Hyphen integration: 0/80 Brookfield jobs linked. Same diagnostic as 4/27 — fix likely auth header drift.',
      confidence: 0.68,
      entity_ids: ['integration_hyphen', 'cust_brookfield'],
    },
  ],
  actions: [
    {
      id: 'act_1',
      title: 'Send Brookfield value-engineering proposal to Amanda Barham',
      description: 'Quote window closes Friday. Pricing locked through May 15.',
      priority: 'CRITICAL',
    },
    {
      id: 'act_2',
      title: 'Post $32.5K Pulte credit memo + cancel 21 open POs',
      description:
        'Account closed 4/20. Brittney has the PO list. Dawn to confirm cancellation routing.',
      priority: 'HIGH',
    },
    {
      id: 'act_3',
      title: 'Investigate Hyphen 0/80 link rate',
      description: 'Reproduce auth flow against staging; likely header drift.',
      priority: 'HIGH',
    },
    {
      id: 'act_4',
      title: 'Schedule cycle count for top-20 risk SKUs',
      description: 'Standard Monday batch. Auto-assigned to WAREHOUSE_LEAD.',
      priority: 'MEDIUM',
    },
  ],
  anomalies: [
    {
      kind: 'spike',
      severity: 'HIGH',
      narrative: 'Resend bounce rate hit 4.2% (24h) — investigate header validation on collections-day-30 template.',
    },
    {
      kind: 'silence',
      severity: 'MEDIUM',
      narrative: 'Brain ingest from QuickBooks paused for 38h — last successful sync 4/29 02:14 UTC.',
    },
    {
      kind: 'drift',
      severity: 'CRITICAL',
      narrative:
        'MRP shortage forecast for Therma-Tru 6068 doors flipped RED overnight — 12 jobs at risk for May 14 deliveries.',
    },
  ],
  calendar: [
    {
      title: '7:30 AM — Daily standup (Clint, Dawn, PMs)',
      start_at: '2026-04-30T12:30:00Z',
      location: 'Conference room',
    },
    {
      title: '10:00 AM — Boise Cascade pricing call',
      start_at: '2026-04-30T15:00:00Z',
      location: 'Zoom',
    },
    {
      title: '1:30 PM — Hancock Whitney line-renewal prep',
      start_at: '2026-04-30T18:30:00Z',
    },
    {
      title: '4:00 PM — Brookfield (Amanda Barham) — Rev 4 walkthrough',
      start_at: '2026-04-30T21:00:00Z',
      location: 'Phone',
    },
  ],
  health: {
    events_ingested_today: 1284,
    total_actions_pending: 17,
    agents_online: 4,
    total_gaps: 6,
  },
}

async function main() {
  const args = process.argv.slice(2)
  const result = buildMorningBrainBrief(mock)

  if (args.includes('--sms')) {
    const sms = buildMorningBrainSms(mock)
    console.log(`SMS (${sms.length} chars):`)
    console.log(sms)
    return
  }

  if (args.includes('--text')) {
    console.log(result.text)
    return
  }

  if (args.includes('--subject')) {
    console.log(result.subject)
    return
  }

  // Default: print HTML
  console.log(result.html)
}

main().catch((e) => {
  console.error('test failed:', e)
  process.exit(1)
})
