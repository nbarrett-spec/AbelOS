/**
 * Standup narrative composition for /api/ops/projects/standup/[pmId].
 *
 * Today: deterministic templated prose driven by the PM's real data.
 * Tomorrow: when the NUC brain is reachable from Vercel (blocked on
 * Tailscale-on-Vercel — see A-INT-9), swap the body of composeStandupNarrative
 * for an Anthropic call that takes the same StandupPMContext shape and returns
 * `string`. Callers don't need to change.
 */

export type StandupPMContext = {
  pm: { firstName: string; lastName: string }
  now: Date
  counts: {
    inProduction: number
    materialsLocked: number
    completedLast7d: number
    committedToday: number
    blocked: number
  }
  upcomingNext7d: Array<{
    jobNumber: string
    scheduledDate: Date
    community: string | null
    builderName: string
    lotBlock: string | null
  }>
  alerts: {
    total: number
    critical: number
    high: number
    topTitles: string[]
  }
}

export function composeStandupNarrative(ctx: StandupPMContext): string {
  const { pm, counts, upcomingNext7d, alerts } = ctx

  const sentences: string[] = []

  // Sentence 1 — workload posture
  const workItems: string[] = []
  if (counts.inProduction > 0) workItems.push(`${counts.inProduction} in production`)
  if (counts.materialsLocked > 0) workItems.push(`${counts.materialsLocked} materials-locked`)
  if (counts.committedToday > 0) workItems.push(`${counts.committedToday} on today's board`)

  if (workItems.length === 0 && counts.blocked === 0) {
    sentences.push(
      `${pm.firstName} has a clean board this morning — no active production, nothing scheduled today, and nothing flagged.`
    )
  } else if (workItems.length === 0) {
    sentences.push(
      `${pm.firstName} has nothing in active production but ${counts.blocked} item${
        counts.blocked === 1 ? '' : 's'
      } flagged at-risk.`
    )
  } else {
    sentences.push(`${pm.firstName} is carrying ${joinWithAnd(workItems)}.`)
  }

  // Sentence 2 — last 7d closes
  if (counts.completedLast7d > 0) {
    sentences.push(
      `Closed ${counts.completedLast7d} job${counts.completedLast7d === 1 ? '' : 's'} in the last 7 days.`
    )
  }

  // Sentence 3 — upcoming
  if (upcomingNext7d.length > 0) {
    const top = upcomingNext7d.map((j) => {
      const where = j.community || j.builderName
      const lot = j.lotBlock ? ` (${j.lotBlock})` : ''
      const day = j.scheduledDate.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      return `${j.jobNumber} at ${where}${lot} on ${day}`
    })
    sentences.push(`Next up: ${joinWithAnd(top)}.`)
  } else {
    sentences.push(`Nothing scheduled in the next 7 days.`)
  }

  // Sentence 4 — alerts / blockers
  if (alerts.critical > 0 || alerts.high > 0) {
    const parts: string[] = []
    if (alerts.critical > 0) parts.push(`${alerts.critical} critical`)
    if (alerts.high > 0) parts.push(`${alerts.high} high-priority`)
    const titlePreview =
      alerts.topTitles.length > 0 ? ` Top item: "${alerts.topTitles[0]}".` : ''
    sentences.push(
      `Inbox shows ${joinWithAnd(parts)} alert${
        alerts.critical + alerts.high === 1 ? '' : 's'
      } waiting.${titlePreview}`
    )
  } else if (alerts.total > 0) {
    sentences.push(
      `Inbox has ${alerts.total} open item${alerts.total === 1 ? '' : 's'}, none flagged critical or high.`
    )
  }

  if (counts.blocked > 0) {
    sentences.push(
      `${counts.blocked} job${counts.blocked === 1 ? ' is' : 's are'} flagged at-risk — see Blocked section below.`
    )
  }

  return sentences.join(' ')
}

function joinWithAnd(items: string[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`
}
