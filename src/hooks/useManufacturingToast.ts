'use client'

import { useCallback, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'

/**
 * Manufacturing-specific toast wrapper.
 *
 * Exposes three semantic methods (qcFail / materialShort / jobAdvanced)
 * with prefixed-key dedup over a 60s window so a 30s polling loop never
 * re-fires the same alert twice.
 *
 * Built on top of the existing ToastContext (mounted in src/app/layout.tsx).
 */

type DedupMap = Map<string, number>

const DEDUP_WINDOW_MS = 60_000

export function useManufacturingToast() {
  const { addToast } = useToast()
  const seen = useRef<DedupMap>(new Map())

  const shouldFire = useCallback((key: string): boolean => {
    const now = Date.now()
    const last = seen.current.get(key)
    if (last && now - last < DEDUP_WINDOW_MS) return false
    seen.current.set(key, now)
    // Garbage-collect stale keys to avoid unbounded growth.
    if (seen.current.size > 200) {
      for (const [k, t] of seen.current) {
        if (now - t > DEDUP_WINDOW_MS) seen.current.delete(k)
      }
    }
    return true
  }, [])

  const qcFail = useCallback(
    (jobNumber: string) => {
      if (!shouldFire(`qcFail:${jobNumber}`)) return
      addToast({
        type: 'error',
        title: 'QC Failed',
        message: `Job ${jobNumber} flagged a defect.`,
      })
    },
    [addToast, shouldFire],
  )

  const materialShort = useCallback(
    (jobNumber: string, sku: string) => {
      if (!shouldFire(`materialShort:${jobNumber}:${sku}`)) return
      addToast({
        type: 'warning',
        title: 'Material short',
        message: jobNumber === 'multiple' ? sku : `Job ${jobNumber} — ${sku}`,
      })
    },
    [addToast, shouldFire],
  )

  const jobAdvanced = useCallback(
    (jobNumber: string, newStatus: string) => {
      if (!shouldFire(`jobAdvanced:${jobNumber}:${newStatus}`)) return
      addToast({
        type: 'success',
        title: 'Job advanced',
        message: `${jobNumber} → ${newStatus}`,
      })
    },
    [addToast, shouldFire],
  )

  return { qcFail, materialShort, jobAdvanced }
}
