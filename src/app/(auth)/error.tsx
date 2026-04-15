'use client'

import ErrorFallback from '@/components/ErrorFallback'

export default function AuthError({
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
      scope="Sign In"
      title="Couldn't load this page"
      description="We hit an error loading the sign-in flow. Try again — if it keeps happening, reach out to support."
      homeHref="/"
    />
  )
}
