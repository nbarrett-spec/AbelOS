'use client'

import ErrorFallback from '@/components/ErrorFallback'

export default function ProjectsError({
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
      scope="Projects"
      title="Couldn't load this project"
      description="We hit an error loading this project. Try again — if it keeps happening, head back to your dashboard."
      homeHref="/dashboard/projects"
      homeLabel="My projects"
    />
  )
}
