'use client'

import ErrorFallback from '@/components/ErrorFallback'

export default function CatalogError({
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
      scope="Catalog"
      title="Couldn't load the catalog"
      description="We hit an error loading product data. Try again in a moment."
      homeHref="/catalog"
      homeLabel="Browse catalog"
    />
  )
}
