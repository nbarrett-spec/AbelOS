export default function PortalMessagesLoading() {
  return (
    <div className="h-[calc(100vh-180px)] grid grid-cols-1 md:grid-cols-[320px_1fr] gap-4 animate-pulse">
      <div
        className="rounded-[14px] bg-[var(--portal-bg-card)]"
        style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
      />
      <div
        className="rounded-[14px] bg-[var(--portal-bg-card)]"
        style={{ border: '1px solid var(--portal-border-light, #F0E8DA)' }}
      />
    </div>
  )
}
