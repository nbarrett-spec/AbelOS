export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-surface-muted rounded w-48 mb-2" />
        <div className="h-4 bg-surface-muted rounded w-96" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-border p-5">
            <div className="h-4 bg-surface-muted rounded w-24 mb-2" />
            <div className="h-7 bg-surface-muted rounded w-32" />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="h-10 bg-surface-muted rounded w-48" />
        <div className="h-10 bg-surface-muted rounded w-40" />
      </div>

      {/* Invoices table */}
      <div className="bg-white rounded-xl border border-border p-6">
        {/* Table header */}
        <div className="flex gap-4 pb-4 border-b border-border mb-4">
          <div className="h-4 bg-surface-muted rounded w-20" />
          <div className="h-4 bg-surface-muted rounded w-32 flex-1" />
          <div className="h-4 bg-surface-muted rounded w-24" />
          <div className="h-4 bg-surface-muted rounded w-28" />
          <div className="h-4 bg-surface-muted rounded w-20" />
        </div>

        {/* Table rows */}
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex gap-4 py-4 border-b border-border last:border-0">
            <div className="h-4 bg-surface-muted rounded w-20" />
            <div className="h-4 bg-surface-muted rounded w-32 flex-1" />
            <div className="h-4 bg-surface-muted rounded w-24" />
            <div className="h-6 bg-surface-muted rounded w-28" />
            <div className="h-4 bg-surface-muted rounded w-20" />
          </div>
        ))}
      </div>
    </div>
  )
}
