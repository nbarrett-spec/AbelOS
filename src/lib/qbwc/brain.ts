// Lightweight Brain ingest helper for QBWC events. Mirrors the pattern in
// scripts/aegis-to-brain-sync.ts but kept inline so the SOAP route only
// pulls in what it needs.

const BRAIN_BASE = process.env.NUC_BRAIN_URL || 'https://brain.abellumber.com'
const BRAIN_INGEST = `${BRAIN_BASE}/brain/ingest/batch`

export interface BrainEvent {
  source: 'quickbooks'
  event_type: string
  source_id: string
  occurred_at: string
  content: Record<string, unknown>
}

export async function pushBrainEvents(events: BrainEvent[]): Promise<{ ok: boolean; status: number }> {
  if (events.length === 0) return { ok: true, status: 204 }
  const key = process.env.BRAIN_API_KEY
  if (!key) {
    // Brain ingest is best-effort — never fail QBWC because Brain is down.
    return { ok: false, status: 0 }
  }
  try {
    const res = await fetch(BRAIN_INGEST, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ events }),
    })
    return { ok: res.ok, status: res.status }
  } catch {
    return { ok: false, status: 0 }
  }
}
