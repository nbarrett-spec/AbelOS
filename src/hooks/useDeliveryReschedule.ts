import { useState } from 'react'

export type DeliveryWindow = 'EARLY_AM' | 'LATE_AM' | 'EARLY_PM' | 'LATE_PM' | 'ANYTIME'

export interface AvailableSlot {
  date: string
  window: DeliveryWindow
  spotsLeft: number
}

export function useDeliveryReschedule(deliveryId: string) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [availableSlots, setAvailableSlots] = useState<AvailableSlot[]>([])

  const fetchAvailableSlots = async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(
        `/api/builder/deliveries/${deliveryId}/reschedule`
      )
      if (!res.ok) {
        throw new Error('Failed to fetch available slots')
      }
      const data = await res.json()
      setAvailableSlots(data.availableSlots || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setLoading(false)
    }
  }

  const requestReschedule = async (
    preferredDate: string,
    preferredWindow: DeliveryWindow,
    reason?: string
  ) => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch(
        `/api/builder/deliveries/${deliveryId}/reschedule`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ preferredDate, preferredWindow, reason }),
        }
      )
      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to request reschedule')
      }
      return await res.json()
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error'
      setError(errorMsg)
      throw err
    } finally {
      setLoading(false)
    }
  }

  return {
    loading,
    error,
    availableSlots,
    fetchAvailableSlots,
    requestReschedule,
  }
}
