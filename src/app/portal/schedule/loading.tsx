export default function PortalScheduleLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div>
        <div className="h-8 w-48 rounded-md bg-[var(--portal-bg-elevated)]" />
        <div className="h-4 w-96 mt-2 rounded-md bg-[var(--portal-bg-elevated)]" />
      </div>
      {/* Week nav */}
      <div className="flex items-center justify-between">
        <div className="h-9 w-9 rounded bg-[var(--portal-bg-elevated)]" />
        <div className="h-6 w-56 rounded bg-[var(--portal-bg-elevated)]" />
        <div className="h-9 w-9 rounded bg-[var(--portal-bg-elevated)]" />
      </div>
      {/* Calendar grid */}
      <div
        className="rounded-[14px] h-[260px] bg-[var(--portal-bg-card)]"
        style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
      />
      {/* Delivery list */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div
          className="rounded-[14px] h-[280px] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
        <div
          className="rounded-[14px] h-[280px] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
      </div>
    </div>
  )
}
