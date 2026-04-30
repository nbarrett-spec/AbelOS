/**
 * Builder Portal — root loading skeleton.
 *
 * Renders inside the layout (sidebar + topbar already painted), so this is
 * just the main-area skeleton.
 */

export default function PortalLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Welcome banner skeleton */}
      <div>
        <div className="h-8 w-72 rounded-md bg-[var(--portal-bg-elevated)]" />
        <div className="h-4 w-96 mt-2 rounded-md bg-[var(--portal-bg-elevated)]" />
      </div>
      {/* KPI strip skeleton (4 cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-[14px] h-[130px] bg-[var(--portal-bg-card)]"
            style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
          />
        ))}
      </div>
      {/* Two-column body skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 rounded-[14px] h-[260px] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
        <div
          className="rounded-[14px] h-[260px] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
      </div>
    </div>
  )
}
