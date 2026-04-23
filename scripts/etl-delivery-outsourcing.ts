/**
 * scripts/etl-delivery-outsourcing.ts
 *
 * Loads the Delivery Outsourcing evaluation package into InboxItem as
 * source-tag DELIVERY_OUTSOURCING_EVAL_APR2026. The folder contains:
 *   - Abel Lumber - Delivery RFQ.docx   (April 16, 2026 RFQ — responses due 4/30)
 *   - Delivery Outsourcing Memo - Abel Lumber.docx (cost analysis + vendor shortlist)
 *
 * The memo concludes a HYBRID strategy: keep the in-house truck for full-load
 * jobsite runs; trial outsourced partners (Curri, Fero, Eagle Express) on
 * lighter 1-2 stop DFW runs. Estimated savings of $13K-$31K/yr at 2-3
 * outsourced runs/week, with 832-1,248 labor hours redeployed.
 *
 * We create:
 *   - 1 summary InboxItem  (overall recommendation: hybrid / 2-wk trial)
 *   - 3 per-vendor InboxItems (Curri, Fero, Eagle Express — each is a
 *     proposal to evaluate once quotes come back from the RFQ)
 *   - 1 RFQ-deadline InboxItem (responses due April 30, 2026)
 *
 * NO changes to Delivery / Crew / Staff rows. InboxItem only.
 */

import { PrismaClient } from '@prisma/client'
import * as crypto from 'node:crypto'

const DRY_RUN = !process.argv.includes('--commit')
const SRC_TAG = 'DELIVERY_OUTSOURCING_EVAL_APR2026'

function hashId(k: string): string {
  return 'dlv_' + crypto.createHash('sha256').update(`${SRC_TAG}::${k}`).digest('hex').slice(0, 18)
}

type Item = {
  key: string
  type: string
  title: string
  description: string
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'
  financialImpact?: number | null
  dueBy?: Date | null
  actionData: Record<string, unknown>
}

// Current in-house cost: $140-$175/stop all-in (memo, April 15 real run).
// Outsourced quote ranges (memo): Curri $90-$160/2-stop, Fero $150-$450/2-stop, Eagle quote-based.
// Midpoint in-house 2-stop: ~$295/run. Midpoint Curri: ~$125. Diff/run ~$170.
// Annual savings (memo): $13,000-$20,800 at 2 runs/week; $19,500-$31,200 at 3 runs/week.
const ANNUAL_SAVINGS_MIDPOINT = 22_100 // midpoint of $13K-$31.2K range

const items: Item[] = [
  {
    key: 'summary',
    type: 'AGENT_TASK',
    title: '[DELIVERY] Outsourcing evaluation — HYBRID recommended; 2-wk trial w/ Curri + Fero',
    description:
      'Delivery Outsourcing Memo (4/16/2026) concludes in-house cost is $140-$175/stop all-in ' +
      '(April 15 run: 2 stops, 4 hrs, $75 diesel, 2 crew, $285-$305 total). DFW market can deliver ' +
      'same loads for $45-$150/stop via Curri, Fero, Eagle Express. RECOMMENDATION: keep truck for ' +
      'full jobsite loads where we need control; shift 30-40% of volume (lighter 1-2 stop residential) ' +
      'to outsourced partners. Est. savings: $13K-$31.2K/yr + 832-1,248 labor hrs redeployed to yard. ' +
      'Fuel price risk (Dallas diesel $5.19/gal, +61% YoY) transfers to carrier. Next step: run ' +
      '2-week trial week of 5/4/2026 with top 1-2 partners after RFQ responses close 4/30.',
    priority: 'HIGH',
    financialImpact: ANNUAL_SAVINGS_MIDPOINT,
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'summary',
      files: [
        'Delivery Outsourcing/Abel Lumber - Delivery RFQ.docx',
        'Delivery Outsourcing/Delivery Outsourcing Memo - Abel Lumber.docx',
      ],
      recommendation: 'HYBRID',
      inHouseCostPerStop: { low: 140, high: 175, allInNote: 'includes truck overhead' },
      currentDrivers: ['Austin Collett', 'Aaron Treadaway', 'Jack Zenker', 'Noah Ridge'],
      trialStart: '2026-05-04',
      savingsScenarios: [
        { runsPerWeek: 2, weekly: [250, 400], annual: [13000, 20800] },
        { runsPerWeek: 3, weekly: [375, 600], annual: [19500, 31200] },
      ],
    },
  },
  {
    key: 'rfq-deadline',
    type: 'AGENT_TASK',
    title: '[DELIVERY] RFQ responses due April 30, 2026 — evaluate & pick trial partners',
    description:
      'Delivery RFQ issued 4/16/2026 to third-party DFW delivery providers. Key specs: 8\'0" door ' +
      'standing-upright capability (8\'2"+ interior), 4,000 lb min payload, 16 ft deck, Gainesville ' +
      'pickup, DFW-wide drop. 2-4 runs/week initial volume. Evaluation weights: Cost 30%, Vehicle ' +
      'suitability 25%, Reliability 20%, Insurance 15%, Tracking 10%. Select 1-2 partners for ' +
      '2-week trial week of 5/4/2026. Primary contact: Nate Barrett; secondary: Sarah Knighton.',
    priority: 'HIGH',
    dueBy: new Date('2026-04-30T23:59:59Z'),
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'rfq-deadline',
      file: 'Delivery Outsourcing/Abel Lumber - Delivery RFQ.docx',
      issuedDate: '2026-04-16',
      dueDate: '2026-04-30',
      trialStart: '2026-05-04',
      evaluationWeights: {
        cost: 0.30,
        vehicleSuitability: 0.25,
        reliability: 0.20,
        insurance: 0.15,
        tracking: 0.10,
      },
      vehicleRequirements: {
        minInteriorHeight: '8\'2"',
        minPayloadLbs: 4000,
        typicalLoadLbs: [2000, 5000],
        minDeckLengthFt: 16,
      },
    },
  },
  {
    key: 'vendor-curri',
    type: 'AGENT_TASK',
    title: '[DELIVERY] Vendor: Curri — $90-$160 per 2-stop run; built for lumber yards',
    description:
      'Curri — delivery partner specialized in lumber yards & building supply. Flatbed, semi, ' +
      'lowboy all available; confirmed 8\'0" door capable. Pricing model: per-delivery quote, ' +
      'upfront. Est. 2-stop run: $90-$160 (vs in-house $285-$305 all-in). Cargo insurance: $250K. ' +
      'Real-time tracking. Best for: on-demand + scheduled routes. Contact: curri.com. ' +
      'Est. delta vs in-house: ~$150-$170/run savings. TOP-RANKED by memo for our use case.',
    priority: 'HIGH',
    financialImpact: 160 * 52 * 3, // ~$25K/yr if 3 runs/wk at $160/run saved vs in-house
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'vendor-proposal',
      vendor: 'Curri',
      contact: 'curri.com',
      specialty: 'Built for lumber yards & building supply',
      doorReady: true,
      equipmentTypes: ['flatbed', 'semi', 'lowboy'],
      pricingModel: 'per-delivery quote, upfront',
      estPer2StopRun: { low: 90, high: 160 },
      cargoInsurance: 250000,
      tracking: 'real-time',
      bestFor: 'on-demand + scheduled routes',
      rank: 1,
    },
  },
  {
    key: 'vendor-fero',
    type: 'AGENT_TASK',
    title: '[DELIVERY] Vendor: Fero — $75-$150/hr; flatbed & deck trailers; hourly transparent',
    description:
      'Fero — on-demand flatbed & construction courier. Flatbed & deck trailers verified for ' +
      '8\'0" doors. Pricing: hourly, $75-$150/hr by vehicle. Est. 2-stop run: $150-$450 ' +
      '(wider variance than Curri; 4-hr typical run at $75/hr = $300 midpoint). Verified & ' +
      'insured. Real-time tracking + photo docs. Best for: transparent hourly pricing when ' +
      'runs vary in length. Contact: feronow.com. Good second-partner candidate for trial.',
    priority: 'MEDIUM',
    financialImpact: 0, // neutral-to-mild savings, depends on run length
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'vendor-proposal',
      vendor: 'Fero',
      contact: 'feronow.com',
      specialty: 'On-demand flatbed & construction',
      doorReady: true,
      equipmentTypes: ['flatbed', 'deck trailer'],
      pricingModel: 'hourly by vehicle',
      hourlyRate: { low: 75, high: 150 },
      estPer2StopRun: { low: 150, high: 450 },
      tracking: 'real-time + photo docs',
      bestFor: 'transparent hourly pricing',
      rank: 2,
    },
  },
  {
    key: 'vendor-eagle-express',
    type: 'AGENT_TASK',
    title: '[DELIVERY] Vendor: Eagle Express Specialty — DFW-native, 20+ yrs; quote-based',
    description:
      'Eagle Express Specialty — DFW-native courier, 20+ years in market. Truck height for ' +
      '8\'0" doors needs confirmation on intro call. Pricing: quote-based (no published rates). ' +
      'App-based tracking. Insured. Best for: dedicated recurring runs once a weekly route ' +
      'pattern is established. Contact: 214-351-5777. Include in RFQ but subordinate to Curri/Fero ' +
      'for initial trial — less transparent on vehicle fit + pricing until first call.',
    priority: 'MEDIUM',
    financialImpact: 0,
    actionData: {
      sourceTag: SRC_TAG,
      kind: 'vendor-proposal',
      vendor: 'Eagle Express Specialty',
      contact: '214-351-5777',
      specialty: 'DFW-native courier, 20+ yrs',
      doorReady: 'needs confirmation',
      pricingModel: 'quote-based',
      tracking: 'app-based',
      bestFor: 'dedicated recurring runs',
      rank: 3,
    },
  },
]

async function main() {
  console.log(`ETL Delivery Outsourcing — mode: ${DRY_RUN ? 'DRY-RUN' : 'COMMIT'}`)
  console.log(`Source tag: ${SRC_TAG}`)
  console.log(`Items to upsert: ${items.length}`)
  console.log()
  for (const it of items) {
    const fin = it.financialImpact != null ? ` [$${it.financialImpact.toLocaleString()}]` : ''
    const due = it.dueBy ? ` [due ${it.dueBy.toISOString().slice(0, 10)}]` : ''
    console.log(`  + ${it.priority.padEnd(6)} ${it.title}${fin}${due}`)
  }
  console.log()

  if (DRY_RUN) {
    console.log('DRY-RUN — re-run with --commit to persist.')
    return
  }

  const prisma = new PrismaClient()
  try {
    let created = 0
    let updated = 0
    for (const it of items) {
      const id = hashId(it.key)
      const res = await prisma.inboxItem.upsert({
        where: { id },
        create: {
          id,
          type: it.type,
          source: 'delivery-outsourcing-eval',
          title: it.title,
          description: it.description,
          priority: it.priority,
          status: 'PENDING',
          financialImpact: it.financialImpact ?? null,
          dueBy: it.dueBy ?? null,
          actionData: it.actionData as any,
        },
        update: {
          title: it.title,
          description: it.description,
          priority: it.priority,
          financialImpact: it.financialImpact ?? null,
          dueBy: it.dueBy ?? null,
          actionData: it.actionData as any,
        },
        select: { createdAt: true, updatedAt: true },
      })
      if (res.createdAt.getTime() === res.updatedAt.getTime()) created++
      else updated++
    }
    console.log(`InboxItems: created=${created} updated=${updated}`)
    console.log('DONE.')
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
