export default function PortalOrdersLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-48 rounded-md bg-[var(--portal-bg-elevated)]" />
        <div className="h-4 w-72 mt-2 rounded-md bg-[var(--portal-bg-elevated)]" />
      </div>
      {/* Filter tabs row skeleton */}
      <div className="flex gap-2 flex-wrap">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="h-9 w-24 rounded-full bg-[var(--portal-bg-elevated)]"
          />
        ))}
      </div>
      {/* Featured card skeleton */}
      <div
        className="rounded-[14px] h-[180px] bg-[var(--portal-bg-card)]"
        style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
      />
      {/* Table skeleton */}
      <div
        className="rounded-[14px] h-[420px] bg-[var(--portal-bg-card)]"
        style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
      />
    </div>
  )
}
