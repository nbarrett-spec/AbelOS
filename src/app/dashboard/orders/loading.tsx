export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-surface-muted rounded w-48 mb-2" />
        <div className="h-4 bg-surface-muted rounded w-80" />
      </div>

      {/* Filters and controls */}
      <div className="flex gap-4 flex-wrap">
        <div className="h-10 bg-surface-muted rounded w-48" />
        <div className="h-10 bg-surface-muted rounded w-40" />
        <div className="h-10 bg-surface-muted rounded w-32" />
      </div>

      {/* Table/List skeleton */}
      <div className="bg-surface rounded-xl border border-border p-6">
        {/* Table header */}
        <div className="flex gap-4 pb-4 border-b border-border mb-4">
          <div className="h-4 bg-surface-muted rounded w-20" />
          <div className="h-4 bg-surface-muted rounded w-32 flex-1" />
          <div className="h-4 bg-surface-muted rounded w-24" />
          <div className="h-4 bg-surface-muted rounded w-28" />
          <div className="h-4 bg-surface-muted rounded w-20" />
        </div>

        {/* Table rows */}
        {[...Array(8)].map((_, i) => (
          <div key={i} className="flex gap-4 py-4 border-b border-border last:border-0">
            <div className="h-4 bg-surface-muted rounded w-20" />
            <div className="h-4 bg-surface-muted rounded w-32 flex-1" />
            <div className="h-4 bg-surface-muted rounded w-24" />
            <div className="h-6 bg-surface-muted rounded w-28" />
            <div className="h-4 bg-surface-muted rounded w-20" />
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex justify-center gap-2">
        <div className="h-10 bg-surface-muted rounded w-10" />
        <div className="h-10 bg-surface-muted rounded w-10" />
        <div className="h-10 bg-surface-muted rounded w-10" />
        <div className="h-10 bg-surface-muted rounded w-10" />
      </div>
    </div>
  )
}
