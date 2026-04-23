export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-surface-muted rounded w-48 mb-2" />
        <div className="h-4 bg-surface-muted rounded w-80" />
      </div>

      {/* Message list with sidebar layout */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 h-[600px]">
        {/* Conversations sidebar */}
        <div className="bg-surface rounded-xl border border-border p-4">
          <div className="h-10 bg-surface-muted rounded w-full mb-4" />
          {[...Array(5)].map((_, i) => (
            <div key={i} className="py-3 border-b border-border last:border-0">
              <div className="h-4 bg-surface-muted rounded w-full mb-2" />
              <div className="h-3 bg-surface-muted rounded w-3/4" />
            </div>
          ))}
        </div>

        {/* Chat area */}
        <div className="lg:col-span-3 bg-surface rounded-xl border border-border p-6 flex flex-col">
          {/* Message header */}
          <div className="border-b border-border pb-4 mb-4">
            <div className="h-5 bg-surface-muted rounded w-48 mb-2" />
            <div className="h-3 bg-surface-muted rounded w-80" />
          </div>

          {/* Messages */}
          <div className="flex-1 space-y-4 mb-4 overflow-hidden">
            {[...Array(4)].map((_, i) => (
              <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                <div className={`${i % 2 === 0 ? 'bg-surface-muted w-3/4' : 'bg-surface-muted w-2/3'} rounded-lg p-4`}>
                  <div className="h-3 bg-border rounded w-full mb-2" />
                  <div className="h-3 bg-border rounded w-5/6" />
                </div>
              </div>
            ))}
          </div>

          {/* Message input */}
          <div className="flex gap-2 pt-4 border-t border-border">
            <div className="h-10 bg-surface-muted rounded flex-1" />
            <div className="h-10 bg-surface-muted rounded w-20" />
          </div>
        </div>
      </div>
    </div>
  )
}
