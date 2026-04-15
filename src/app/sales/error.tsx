'use client'

import ErrorFallback from '@/components/ErrorFallback'

export default function SalesError({
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
      scope="Sales"
      title="Couldn't load this sales page"
      description="We hit an error loading this page. The team has been notified — try again in a moment."
      homeHref="/sales"
      homeLabel="Sales home"
    />
  )
}
