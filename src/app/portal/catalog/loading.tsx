export default function PortalCatalogLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-44 rounded-md bg-[var(--portal-bg-elevated)]" />
        <div className="h-4 w-72 mt-2 rounded-md bg-[var(--portal-bg-elevated)]" />
      </div>
      <div className="flex gap-2 flex-wrap">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <div
            key={i}
            className="h-9 w-24 rounded-full bg-[var(--portal-bg-elevated)]"
          />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => (
          <div
            key={i}
            className="rounded-[14px] aspect-[3/4] bg-[var(--portal-bg-card)]"
            style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
          />
        ))}
      </div>
    </div>
  )
}
