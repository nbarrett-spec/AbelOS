export default function PortalQuoteDetailLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-5 w-32 rounded-md bg-[var(--portal-bg-elevated)]" />
      <div>
        <div className="h-8 w-48 rounded-md bg-[var(--portal-bg-elevated)]" />
        <div className="h-4 w-72 mt-2 rounded-md bg-[var(--portal-bg-elevated)]" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div
          className="lg:col-span-2 rounded-[14px] h-[360px] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
        <div
          className="rounded-[14px] h-[360px] bg-[var(--portal-bg-card)]"
          style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
        />
      </div>
    </div>
  )
}
