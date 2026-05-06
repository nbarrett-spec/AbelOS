/**
 * generate-pitch smoke harness — runnable, NOT a Vitest test.
 *
 * Usage:
 *   npx tsx src/lib/agents/__tests__/generate-pitch.smoke.ts <prospectId>
 *
 * Behavior:
 *   1. Validate ANTHROPIC_API_KEY present.
 *   2. Call generatePitch() with HERITAGE / MICROSITE / [cover, exec_summary,
 *      pricing, scope, terms] — the default 5-element preview shape.
 *   3. Print the PitchRunResult (status, costUsd, previewUrl).
 *   4. If a previewUrl is returned, log it for human review (Nate).
 *
 * Requirements:
 *   - ANTHROPIC_API_KEY env var
 *   - DATABASE_URL pointing at the Prospect row you want to pitch
 *   - .env at repo root (loaded via dotenv/config below)
 *
 * This is for manual verification. Generate-pitch involves a Claude API call
 * + Vercel deploy and is non-deterministic; no CI integration.
 */
import 'dotenv/config'

import type {
  PitchElement,
  PitchLayout,
  PitchRunInput,
  PitchRunResult,
  PitchStyle,
} from '../types'

const DEFAULT_STYLE: PitchStyle = 'HERITAGE'
const DEFAULT_LAYOUT: PitchLayout = 'MICROSITE'
const DEFAULT_ELEMENTS: PitchElement[] = [
  'cover',
  'exec_summary',
  'pricing',
  'scope',
  'terms',
]

function fail(msg: string, code = 1): never {
  // eslint-disable-next-line no-console
  console.error(`[smoke] ${msg}`)
  process.exit(code)
}

function header(title: string): void {
  // eslint-disable-next-line no-console
  console.log(`\n=== ${title} ===`)
}

async function main(): Promise<void> {
  const prospectId = process.argv[2]
  if (!prospectId) {
    fail(
      'missing <prospectId> arg.\n' +
        'usage: npx tsx src/lib/agents/__tests__/generate-pitch.smoke.ts <prospectId>\n' +
        'tip: run enrich-prospect.smoke.ts first to create a smoke-* prospectId.',
    )
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    fail('ANTHROPIC_API_KEY not set — load it from repo-root .env first.')
  }

  // Lazy-import so the missing-arg branch above never accidentally evaluates
  // generate-pitch.ts (which Agent A may not have landed yet).
  let generatePitch: (input: PitchRunInput) => Promise<PitchRunResult>
  try {
    const mod = await import('../generate-pitch')
    if (typeof mod.generatePitch !== 'function') {
      fail(
        'generate-pitch module did not export a `generatePitch` function. ' +
          'Has Agent A landed src/lib/agents/generate-pitch.ts yet?',
      )
    }
    generatePitch = mod.generatePitch
  } catch (err) {
    fail(
      `failed to import generate-pitch.ts: ${
        err instanceof Error ? err.message : String(err)
      }\n` +
        '(this is expected until Agent A lands — try again after the merge.)',
    )
  }

  header('INPUT')
  const input: PitchRunInput = {
    prospectId,
    style: DEFAULT_STYLE,
    layout: DEFAULT_LAYOUT,
    elements: DEFAULT_ELEMENTS,
  }
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(input, null, 2))

  header('GENERATE PITCH (live Claude API + Vercel deploy — costs money)')
  const startedAt = Date.now()
  const result = await generatePitch(input)
  const elapsedMs = Date.now() - startedAt

  header('RESULT')
  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        pitchRunId: result.pitchRunId,
        status: result.status,
        previewUrl: result.previewUrl ?? null,
        emailDraft: result.emailDraft
          ? `${result.emailDraft.slice(0, 200)}...`
          : null,
        costUsd: result.costUsd,
        errorMessage: result.errorMessage ?? null,
        htmlBytes: result.htmlContent ? result.htmlContent.length : 0,
      },
      null,
      2,
    ),
  )
  // eslint-disable-next-line no-console
  console.log(`elapsedMs = ${elapsedMs}`)

  header('VERDICT')
  if (result.status === 'PREVIEW' && result.previewUrl) {
    // eslint-disable-next-line no-console
    console.log(`PASS — pitch generated.`)
    // eslint-disable-next-line no-console
    console.log(`open this in a browser: ${result.previewUrl}`)
    process.exit(0)
  }
  // eslint-disable-next-line no-console
  console.log(
    `FAIL — status=${result.status} ${
      result.errorMessage ? `error=${result.errorMessage}` : ''
    }`,
  )
  process.exit(1)
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error('[smoke] uncaught:', err)
  process.exit(1)
})
