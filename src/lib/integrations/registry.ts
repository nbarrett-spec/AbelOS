// ──────────────────────────────────────────────────────────────────────────
// Integration registry — the canonical list of all external systems
// Abel OS syncs with, for the sync-health dashboard.
// ──────────────────────────────────────────────────────────────────────────
// Each entry maps a provider key to:
//   - human label
//   - description of what it syncs
//   - staleness threshold (ms) — when we flag a source as stale
//   - retry endpoint (internal API that triggers a manual sync)
//   - config url (where admins go to fix it)
//
// Order here drives the display order on the sync-health page.
// ──────────────────────────────────────────────────────────────────────────

export interface IntegrationSpec {
  key: string               // lowercase, used as URL slug
  dbProvider: string        // uppercase DB provider string in SyncLog/IntegrationConfig
  label: string
  description: string
  /** Hours before a sync is considered "stale" */
  staleHours: number
  /** Internal endpoint to trigger a manual resync */
  retryPath: string | null
  /** Where to go to configure/reauth */
  configPath: string
  /** Category bucket for grouping on the dashboard */
  category: 'inventory' | 'builder' | 'financial' | 'communication' | 'ai'
}

export const INTEGRATIONS: IntegrationSpec[] = [
  {
    key: 'inflow',
    dbProvider: 'INFLOW',
    label: 'InFlow',
    description: 'Products, inventory, POs, sales orders',
    staleHours: 2,
    retryPath: '/api/ops/sync-health',
    configPath: '/ops/settings?tab=integrations&provider=inflow',
    category: 'inventory',
  },
  {
    key: 'hyphen',
    dbProvider: 'HYPHEN',
    label: 'Hyphen (Brookfield)',
    description: 'Brookfield schedules, payments, orders',
    staleHours: 4,
    retryPath: '/api/ops/sync-health',
    configPath: '/ops/settings?tab=integrations&provider=hyphen',
    category: 'builder',
  },
  {
    key: 'buildertrend',
    dbProvider: 'BUILDERTREND',
    label: 'BuilderTrend',
    description: 'Builder project schedules, change orders',
    staleHours: 6,
    retryPath: null, // cron-only for now
    configPath: '/ops/settings?tab=integrations&provider=buildertrend',
    category: 'builder',
  },
  {
    key: 'quickbooks',
    dbProvider: 'QUICKBOOKS_ONLINE',
    label: 'QuickBooks Online',
    description: 'Journal entries, AR/AP sync (stub)',
    staleHours: 24,
    retryPath: null,
    configPath: '/ops/settings?tab=integrations&provider=quickbooks',
    category: 'financial',
  },
  {
    key: 'gmail',
    dbProvider: 'GMAIL',
    label: 'Gmail',
    description: 'Inbound lead emails, builder correspondence',
    staleHours: 6,
    retryPath: null,
    configPath: '/ops/settings?tab=integrations&provider=gmail',
    category: 'communication',
  },
  {
    key: 'stripe',
    dbProvider: 'STRIPE',
    label: 'Stripe',
    description: 'Card payments, subscription billing',
    staleHours: 24,
    retryPath: null,
    configPath: '/ops/settings?tab=integrations&provider=stripe',
    category: 'financial',
  },
  {
    key: 'elevenlabs',
    dbProvider: 'ELEVENLABS',
    label: 'ElevenLabs',
    description: 'Voice briefings, phone assistant',
    staleHours: 72,
    retryPath: null,
    configPath: '/ops/settings?tab=integrations&provider=elevenlabs',
    category: 'ai',
  },
  {
    key: 'anthropic',
    dbProvider: 'ANTHROPIC',
    label: 'Anthropic (Claude API)',
    description: 'AI briefings, daily digests, copilot',
    staleHours: 24,
    retryPath: null,
    configPath: '/ops/settings?tab=integrations&provider=anthropic',
    category: 'ai',
  },
]

export function findIntegration(key: string): IntegrationSpec | undefined {
  const k = key.toLowerCase()
  return INTEGRATIONS.find(i => i.key === k || i.dbProvider.toLowerCase() === k)
}
