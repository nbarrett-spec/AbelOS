'use client'

import ErrorFallback from '@/components/ErrorFallback'

export default function PortalError({
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
      scope="Portal"
      title="Couldn't load this portal page"
      description="We hit an error loading portal settings. Try again — if it keeps happening, contact support."
      homeHref="/"
    />
  )
}
