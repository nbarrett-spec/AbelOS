export default function PortalProductDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-5 w-32 rounded-md bg-[var(--portal-bg-elevated)]" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div
          className="rounded-[14px] aspect-[4/3] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
        <div className="space-y-4">
          <div className="h-6 w-32 rounded-md bg-[var(--portal-bg-elevated)]" />
          <div className="h-9 w-full rounded-md bg-[var(--portal-bg-elevated)]" />
          <div className="h-4 w-3/4 rounded-md bg-[var(--portal-bg-elevated)]" />
          <div
            className="rounded-[14px] h-32 bg-[var(--portal-bg-card)]"
            style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
          />
          <div
            className="rounded-[14px] h-44 bg-[var(--portal-bg-card)]"
            style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
          />
        </div>
      </div>
    </div>
  )
}
