'use client'

import { useEffect, useRef, useState } from 'react'

export interface LiveEvent {
  topic: string
  id?: string
  action: string
  at: string
  entity?: string
  entityId?: string
  staffId?: string
}

type EventSourceLike = {
  addEventListener: (evt: string, cb: (e: MessageEvent) => void) => void
  close: () => void
}

// Module-level shared EventSource — one stream per `topics` key shared by all
// subscribers, so we don't open N connections on a page with N widgets.
const sources = new Map<
  string,
  {
    es: EventSourceLike
    listeners: Set<(evt: LiveEvent) => void>
    refCount: number
  }
>()

function subscribeAll(topicsKey: string, handler: (evt: LiveEvent) => void) {
  let entry = sources.get(topicsKey)
  if (!entry) {
    const url = `/api/ops/stream/changes${topicsKey ? `?topics=${topicsKey}` : ''}`
    const es = new EventSource(url, { withCredentials: true })
    entry = { es, listeners: new Set(), refCount: 0 }
    es.addEventListener('change', (e: MessageEvent) => {
      try {
        const data: LiveEvent = JSON.parse(e.data)
        entry!.listeners.forEach((l) => l(data))
      } catch {}
    })
    sources.set(topicsKey, entry)
  }
  entry.listeners.add(handler)
  entry.refCount++
  return () => {
    const e = sources.get(topicsKey)
    if (!e) return
    e.listeners.delete(handler)
    e.refCount--
    if (e.refCount <= 0) {
      e.es.close()
      sources.delete(topicsKey)
    }
  }
}

/**
 * useLiveTopic — subscribe to mutation events on one or more topics.
 *
 * const last = useLiveTopic('orders')
 * useEffect(() => { if (last) mutate('/api/ops/orders') }, [last])
 *
 * Multiple topics: `useLiveTopic(['orders','pos'])` or empty/null for all.
 */
export function useLiveTopic(
  topic: string | string[] | null | undefined
): LiveEvent | null {
  const [last, setLast] = useState<LiveEvent | null>(null)
  const unsubRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof EventSource === 'undefined') return
    const key = Array.isArray(topic) ? topic.join(',') : (topic || '')
    const unsub = subscribeAll(key, (evt) => {
      // Filter client-side too, in case the stream gave us broader data
      if (!topic) return setLast(evt)
      if (Array.isArray(topic)) {
        if (topic.includes(evt.topic)) setLast(evt)
      } else if (evt.topic === topic) {
        setLast(evt)
      }
    })
    unsubRef.current = unsub
    return () => {
      unsub()
      unsubRef.current = null
    }
  }, [Array.isArray(topic) ? topic.join(',') : topic])

  return last
}

/**
 * useLiveTick — lightweight: returns an incrementing counter each time any
 * event for the subscribed topics arrives. Good for `<LiveDataIndicator trigger={tick}>`.
 */
export function useLiveTick(topic: string | string[] | null | undefined): number {
  const [tick, setTick] = useState(0)
  const evt = useLiveTopic(topic)
  useEffect(() => {
    if (evt) setTick((t) => t + 1)
  }, [evt?.at, evt?.id])
  return tick
}
