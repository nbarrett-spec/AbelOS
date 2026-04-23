export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-surface-muted rounded w-48 mb-2" />
        <div className="h-4 bg-surface-muted rounded w-80" />
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-surface rounded-xl border border-border p-5">
            <div className="h-3 bg-surface-muted rounded w-24 mb-2" />
            <div className="h-7 bg-surface-muted rounded w-20" />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="h-10 bg-surface-muted rounded w-48" />
        <div className="h-10 bg-surface-muted rounded w-40" />
      </div>

      {/* Deliveries list */}
      <div className="bg-surface rounded-xl border border-border p-6">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="py-4 border-b border-border last:border-0">
            {/* Delivery header */}
            <div className="flex justify-between items-start mb-3">
              <div>
                <div className="h-4 bg-surface-muted rounded w-40 mb-2" />
                <div className="h-3 bg-surface-muted rounded w-56" />
              </div>
              <div className="h-6 bg-surface-muted rounded w-28" />
            </div>

            {/* Delivery details */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="h-3 bg-surface-muted rounded w-20 mb-2" />
                <div className="h-4 bg-surface-muted rounded w-28" />
              </div>
              <div>
                <div className="h-3 bg-surface-muted rounded w-20 mb-2" />
                <div className="h-4 bg-surface-muted rounded w-32" />
              </div>
              <div>
                <div className="h-3 bg-surface-muted rounded w-20 mb-2" />
                <div className="h-4 bg-surface-muted rounded w-24" />
              </div>
              <div>
                <div className="h-3 bg-surface-muted rounded w-20 mb-2" />
                <div className="h-4 bg-surface-muted rounded w-28" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
