'use client'

import ErrorFallback from '@/components/ErrorFallback'

export default function OrdersError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <ErrorFallback
      error={error}
      reset={reset}
      scope="Orders"
      title="Couldn't load your orders"
      description="We hit an error loading your order data. It's usually temporary — try again in a moment."
      homeHref="/orders"
      homeLabel="Orders home"
    />
  )
}
