import { processStripeEvent } from '@/lib/webhooks/stripe-processor'
import { handleInflowWebhook } from '@/lib/integrations/inflow'
import { handleWebhook as handleHyphenWebhook } from '@/lib/integrations/hyphen'
import { handlePushNotification } from '@/lib/integrations/gmail'

// ──────────────────────────────────────────────────────────────────────────
// Provider-specific payload replay.
//
// The DLQ retry worker and the admin "Replay" button both call into this
// dispatcher. It accepts the stored payload JSONB (as originally written by
// ensureIdempotent) and re-runs the provider's processing function. The
// dispatch key is the `provider` column on WebhookEvent.
//
// New providers that want DLQ support must:
//   1. Pass the payload into ensureIdempotent(...) in their route handler
//   2. Add a case below that calls their processor with the stored payload
// ──────────────────────────────────────────────────────────────────────────

export async function replayWebhookPayload(
  provider: string,
  payload: any
): Promise<void> {
  if (!payload) {
    throw new Error(`No stored payload for ${provider} event — cannot replay`)
  }

  switch (provider) {
    case 'stripe':
      await processStripeEvent(payload)
      return

    case 'inflow': {
      const eventType = payload.eventType || payload.event
      if (!eventType) throw new Error('InFlow payload missing eventType for replay')
      await handleInflowWebhook(eventType, payload.data || payload)
      return
    }

    case 'hyphen': {
      const eventType = payload.eventType || payload.event
      if (!eventType) throw new Error('Hyphen payload missing eventType for replay')
      await handleHyphenWebhook(eventType, payload.data || payload)
      return
    }

    case 'gmail': {
      // Gmail Pub/Sub payloads are shrunk to { emailAddress, historyId, messageId }
      // at ingest time. Replay just re-runs the history fetch.
      const historyId = payload.historyId
      if (!historyId) throw new Error('Gmail payload missing historyId for replay')
      await handlePushNotification(historyId)
      return
    }

    default:
      throw new Error(`No replay handler registered for provider: ${provider}`)
  }
}
