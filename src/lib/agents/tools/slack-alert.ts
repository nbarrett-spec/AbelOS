/**
 * Slack incoming-webhook poster.
 *
 * Wired into the enrichment + pitch agents so high-signal events (CONFIRMED
 * enrichment of a target builder, pitch ready for review, repeated bounce on
 * a high-value prospect) ping the #sales channel without dragging Nate into
 * the admin UI to find them.
 *
 * Endpoint: ${SLACK_WEBHOOK_URL} (incoming webhook URL configured per channel)
 * Docs:     https://api.slack.com/messaging/webhooks
 *
 * Graceful degradation:
 *   - If SLACK_WEBHOOK_URL is unset → returns ok:true, no-op success.
 *     The agents treat Slack alerts as best-effort enhancement, not
 *     correctness-critical. Returning ok:true keeps the feature flag
 *     "off-by-default" semantics tidy (no error spam in dev).
 */
import type { ToolResult, SlackAlert } from '../types'
import { logger } from '@/lib/logger'

const REQUEST_TIMEOUT_MS = 5_000

export async function postSlackAlert(
  input: SlackAlert
): Promise<ToolResult<{ ok: boolean }>> {
  const webhookUrl = process.env.SLACK_WEBHOOK_URL
  if (!webhookUrl) {
    // No-op success — feature flagged off via missing env var.
    return { ok: true, data: { ok: true } }
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const body: Record<string, unknown> = { text: input.text }
    if (input.blocks && input.blocks.length > 0) {
      body.blocks = input.blocks
    }

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    // Slack returns plain text 'ok' (200) on success and 'invalid_payload' /
    // 'channel_not_found' / etc on failure (also non-200).
    const responseText = await res.text().catch(() => '')

    if (!res.ok || responseText.trim() !== 'ok') {
      const msg = `Slack webhook failed: ${res.status} ${res.statusText} — ${responseText.slice(0, 200)}`
      logger.warn('slack_alert_http_error', {
        status: res.status,
        body: responseText.slice(0, 80),
      })
      return { ok: false, error: msg }
    }

    return { ok: true, data: { ok: true } }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    logger.warn('slack_alert_failed', { error: msg })
    return { ok: false, error: `Slack alert error: ${msg}` }
  } finally {
    clearTimeout(timeoutId)
  }
}
