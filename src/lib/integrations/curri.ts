/**
 * Curri Delivery Integration
 *
 * Third-party courier for overflow / out-of-area / urgent deliveries
 * when in-house drivers (Austin, Aaron, Jack, Noah) are fully booked.
 *
 * Env:
 *   CURRI_API_KEY   — Bearer token
 *   CURRI_API_URL   — defaults to https://api.curri.com/v1
 */

const CURRI_API_URL = process.env.CURRI_API_URL || 'https://api.curri.com/v1'
const CURRI_API_KEY = process.env.CURRI_API_KEY

export function isCurriConfigured(): boolean {
  return Boolean(CURRI_API_KEY && CURRI_API_KEY.length > 8)
}

interface CurriQuoteRequest {
  pickupAddress: { street: string; city: string; state: string; zip: string }
  dropoffAddress: { street: string; city: string; state: string; zip: string }
  items: Array<{ description: string; quantity: number; weight?: number }>
  requestedBy?: string // ISO timestamp
  vehicleType?: 'car' | 'suv' | 'pickup' | 'cargo_van' | 'box_truck' | 'flatbed'
}

interface CurriQuote {
  id: string
  price: number
  estimatedPickup: string
  estimatedDelivery: string
  vehicleType: string
  provider: 'CURRI'
}

export interface CurriBooking {
  id: string
  trackingUrl: string
  driverName?: string
  driverPhone?: string
  status: string
  estimatedPickup: string
  estimatedDelivery: string
  price: number
}

export interface CurriResult<T> {
  ok: boolean
  data?: T
  error?: string
  skipped?: boolean
  reason?: string
}

async function curriFetch<T>(path: string, init?: RequestInit): Promise<CurriResult<T>> {
  if (!isCurriConfigured()) {
    return { ok: false, skipped: true, reason: 'CURRI_API_KEY not configured' }
  }
  try {
    const res = await fetch(`${CURRI_API_URL}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${CURRI_API_KEY}`,
        ...(init?.headers || {}),
      },
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      return { ok: false, error: `Curri ${res.status}: ${text.slice(0, 300)}` }
    }
    const data = (await res.json()) as T
    return { ok: true, data }
  } catch (err: any) {
    return { ok: false, error: err?.message?.slice(0, 300) || 'Curri network error' }
  }
}

export async function getQuote(req: CurriQuoteRequest): Promise<CurriResult<CurriQuote[]>> {
  return curriFetch<CurriQuote[]>('/quotes', {
    method: 'POST',
    body: JSON.stringify({
      origin: req.pickupAddress,
      destination: req.dropoffAddress,
      items: req.items,
      pickupTime: req.requestedBy,
      vehicleType: req.vehicleType || 'cargo_van',
    }),
  })
}

export async function bookDelivery(
  quoteId: string,
  opts: { pickupContactName?: string; pickupPhone?: string; dropoffContactName?: string; dropoffPhone?: string; notes?: string }
): Promise<CurriResult<CurriBooking>> {
  return curriFetch<CurriBooking>('/deliveries', {
    method: 'POST',
    body: JSON.stringify({ quoteId, ...opts }),
  })
}

export async function getDeliveryStatus(curriDeliveryId: string): Promise<CurriResult<CurriBooking>> {
  return curriFetch<CurriBooking>(`/deliveries/${curriDeliveryId}`)
}

export async function cancelDelivery(curriDeliveryId: string): Promise<CurriResult<{ id: string; status: string }>> {
  return curriFetch<{ id: string; status: string }>(`/deliveries/${curriDeliveryId}/cancel`, {
    method: 'POST',
  })
}

/**
 * Status polling for in-flight Curri deliveries — called by a cron.
 */
export async function syncActiveCurriDeliveries(): Promise<{ checked: number; updated: number; errors: string[] }> {
  if (!isCurriConfigured()) return { checked: 0, updated: 0, errors: ['skipped: not configured'] }

  const { prisma } = await import('@/lib/prisma')
  const active: any[] = await prisma.$queryRawUnsafe(
    `SELECT id, "curriBookingId" FROM "Delivery" WHERE "curriBookingId" IS NOT NULL AND status::text NOT IN ('COMPLETE','FAILED','CANCELLED') LIMIT 100`
  )

  let updated = 0
  const errors: string[] = []
  for (const d of active) {
    try {
      const res = await getDeliveryStatus(d.curriBookingId)
      if (res.ok && res.data) {
        // Map Curri status → Aegis DeliveryStatus
        const mapped = mapCurriStatus(res.data.status)
        await prisma.$executeRawUnsafe(
          `UPDATE "Delivery" SET status = $1::"DeliveryStatus", "updatedAt" = NOW() WHERE id = $2`,
          mapped,
          d.id
        )
        updated++
      } else if (res.error) {
        errors.push(`${d.id}: ${res.error}`)
      }
    } catch (err: any) {
      errors.push(`${d.id}: ${err?.message?.slice(0, 200)}`)
    }
  }

  return { checked: active.length, updated, errors }
}

function mapCurriStatus(curriStatus: string): string {
  const s = curriStatus.toUpperCase()
  if (s.includes('PICKED_UP') || s.includes('IN_PROGRESS')) return 'IN_TRANSIT'
  if (s.includes('DELIVERED') || s.includes('COMPLETE')) return 'COMPLETE'
  if (s.includes('CANCEL')) return 'CANCELLED'
  if (s.includes('FAIL')) return 'FAILED'
  if (s.includes('ASSIGNED') || s.includes('CONFIRMED')) return 'SCHEDULED'
  return 'SCHEDULED'
}
