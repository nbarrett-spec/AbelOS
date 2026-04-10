// ── Shared Intent Classification for All Channels ───────────────────────
// Single source of truth for chat, SMS, and email intent detection

export type Intent =
  | 'DELIVERY_STATUS' | 'DELIVERY_ETA' | 'DELIVERY_LIST'
  | 'SCHEDULE_CHANGE' | 'SCHEDULE_VIEW'
  | 'ORDER_STATUS' | 'ORDER_HISTORY' | 'ORDER_DETAIL'
  | 'INVOICE_STATUS' | 'INVOICE_LIST'
  | 'PRODUCT_PRICING' | 'PRODUCT_AVAILABILITY'
  | 'WARRANTY_STATUS'
  | 'GENERAL' | 'ESCALATE' | 'GREETING'

interface IntentRule {
  intent: Intent
  patterns: RegExp[]
  /** If true, only match when the message is short (< 30 chars) */
  shortOnly?: boolean
}

const INTENT_RULES: IntentRule[] = [
  // Greetings — only match short messages
  {
    intent: 'GREETING',
    patterns: [/^(hi|hello|hey|good morning|good afternoon|howdy|sup|yo|what'?s up)\b/i],
    shortOnly: true,
  },

  // Delivery tracking
  {
    intent: 'DELIVERY_STATUS',
    patterns: [
      /where.*(order|delivery|shipment|package|stuff|materials)/i,
      /track.*delivery/i,
      /delivery.*status/i,
      /where.*is.*my/i,
      /has.*my.*(order|delivery).*shipped/i,
    ],
  },
  {
    intent: 'DELIVERY_ETA',
    patterns: [
      /when.*(deliver|arrive|coming|get here|show up|expected)/i,
      /\beta\b/i,
      /estimated.*time/i,
      /how long.*(until|till|before).*deliver/i,
    ],
  },
  {
    intent: 'DELIVERY_LIST',
    patterns: [
      /deliveries/i,
      /upcoming.*deliver/i,
      /next.*deliver/i,
      /all.*deliver/i,
      /show.*deliver/i,
      /my.*deliver/i,
      /list.*deliver/i,
    ],
  },

  // Schedule
  {
    intent: 'SCHEDULE_CHANGE',
    patterns: [
      /reschedule/i,
      /change.*(date|schedule|time)/i,
      /move.*(deliver|date|schedule)/i,
      /push.*back/i,
      /different.*(day|date|time)/i,
      /postpone/i,
      /delay.*deliver/i,
    ],
  },
  {
    intent: 'SCHEDULE_VIEW',
    patterns: [
      /schedule/i,
      /calendar/i,
      /what.*scheduled/i,
      /when.*am.*i/i,
      /what'?s.*(on|coming up)/i,
      /upcoming.*(events|appointments)/i,
    ],
  },

  // Orders
  {
    intent: 'ORDER_STATUS',
    patterns: [
      /order.*status/i,
      /status.*order/i,
      /how.*my.*order/i,
      /order.*update/i,
      /check.*order/i,
    ],
  },
  {
    intent: 'ORDER_HISTORY',
    patterns: [
      /order.*history/i,
      /past.*order/i,
      /previous.*order/i,
      /all.*order/i,
    ],
  },
  {
    intent: 'ORDER_DETAIL',
    patterns: [
      /order.*#/i,
      /order.*number/i,
      /SO-\d/i,
    ],
  },

  // Invoices
  {
    intent: 'INVOICE_STATUS',
    patterns: [
      /invoice.*status/i,
      /pay.*invoice/i,
      /balance.*due/i,
      /outstanding/i,
      /what.*owe/i,
      /amount.*due/i,
      /how much.*owe/i,
    ],
  },
  {
    intent: 'INVOICE_LIST',
    patterns: [
      /invoices/i,
      /billing/i,
      /payment.*history/i,
    ],
  },

  // Products & pricing
  {
    intent: 'PRODUCT_PRICING',
    patterns: [
      /price/i,
      /cost/i,
      /how much/i,
      /pricing/i,
      /catalog/i,
      /quote.*for/i,
    ],
  },
  {
    intent: 'PRODUCT_AVAILABILITY',
    patterns: [
      /in.?stock/i,
      /available/i,
      /availability/i,
      /lead.*time/i,
      /when.*can.*(get|order|have)/i,
    ],
  },

  // Warranty
  {
    intent: 'WARRANTY_STATUS',
    patterns: [
      /warranty/i,
      /claim/i,
      /defect/i,
      /damage.*report/i,
      /broken/i,
      /damaged/i,
    ],
  },

  // Escalation
  {
    intent: 'ESCALATE',
    patterns: [
      /speak.*human/i,
      /real.*person/i,
      /manager/i,
      /representative/i,
      /talk.*someone/i,
      /help.*me/i,
      /escalate/i,
      /frustrated/i,
      /angry/i,
      /not helpful/i,
      /connect.*me/i,
    ],
  },
]

/**
 * Classify a single message into the best-matching intent.
 */
export function classifyIntent(message: string): Intent {
  const m = message.toLowerCase().trim()

  for (const rule of INTENT_RULES) {
    if (rule.shortOnly && m.length >= 30) continue
    for (const pattern of rule.patterns) {
      if (pattern.test(m)) return rule.intent
    }
  }

  return 'GENERAL'
}

/**
 * Classify ALL matching intents for multi-intent support.
 * Returns intents in priority order (first match = primary).
 */
export function classifyAllIntents(message: string): Intent[] {
  const m = message.toLowerCase().trim()
  const matched: Intent[] = []
  const seen = new Set<Intent>()

  for (const rule of INTENT_RULES) {
    if (rule.shortOnly && m.length >= 30) continue
    if (seen.has(rule.intent)) continue
    for (const pattern of rule.patterns) {
      if (pattern.test(m)) {
        matched.push(rule.intent)
        seen.add(rule.intent)
        break
      }
    }
  }

  return matched.length > 0 ? matched : ['GENERAL']
}
