export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-80" />
      </div>

      {/* Create button and filters */}
      <div className="flex gap-4 flex-wrap">
        <div className="h-10 bg-gray-200 rounded w-40" />
        <div className="h-10 bg-gray-200 rounded w-48" />
      </div>

      {/* Quotes grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="bg-white rounded-xl border border-gray-200 p-5">
            {/* Quote header */}
            <div className="h-5 bg-gray-200 rounded w-32 mb-3" />
            <div className="h-3 bg-gray-200 rounded w-48 mb-4" />

            {/* Quote details */}
            <div className="space-y-2 mb-4">
              <div className="h-3 bg-gray-200 rounded w-40" />
              <div className="h-3 bg-gray-200 rounded w-36" />
              <div className="h-3 bg-gray-200 rounded w-44" />
            </div>

            {/* Status badge */}
            <div className="h-6 bg-gray-200 rounded w-24 mb-4" />

            {/* Actions */}
            <div className="flex gap-2">
              <div className="h-8 bg-gray-200 rounded flex-1" />
              <div className="h-8 bg-gray-200 rounded flex-1" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
