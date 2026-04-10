export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div>
        <div className="h-8 bg-gray-200 rounded w-48 mb-2" />
        <div className="h-4 bg-gray-200 rounded w-80" />
      </div>

      {/* Filters and search */}
      <div className="flex gap-4 flex-wrap">
        <div className="h-10 bg-gray-200 rounded w-64" />
        <div className="h-10 bg-gray-200 rounded w-48" />
        <div className="h-10 bg-gray-200 rounded w-40" />
      </div>

      {/* Accounts table */}
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        {/* Table header */}
        <div className="grid grid-cols-5 gap-4 pb-4 border-b border-gray-200 mb-4">
          <div className="h-4 bg-gray-200 rounded w-24" />
          <div className="h-4 bg-gray-200 rounded w-28" />
          <div className="h-4 bg-gray-200 rounded w-20" />
          <div className="h-4 bg-gray-200 rounded w-24" />
          <div className="h-4 bg-gray-200 rounded w-16" />
        </div>

        {/* Table rows */}
        {[...Array(8)].map((_, i) => (
          <div key={i} className="grid grid-cols-5 gap-4 py-4 border-b border-gray-200 last:border-0">
            <div>
              <div className="h-4 bg-gray-200 rounded w-32 mb-2" />
              <div className="h-3 bg-gray-200 rounded w-40" />
            </div>
            <div className="h-4 bg-gray-200 rounded w-28" />
            <div className="h-6 bg-gray-200 rounded w-20" />
            <div className="h-4 bg-gray-200 rounded w-24" />
            <div className="h-8 bg-gray-200 rounded w-16" />
          </div>
        ))}
      </div>

      {/* Pagination */}
      <div className="flex justify-between items-center">
        <div className="h-4 bg-gray-200 rounded w-32" />
        <div className="flex gap-2">
          <div className="h-10 bg-gray-200 rounded w-10" />
          <div className="h-10 bg-gray-200 rounded w-10" />
          <div className="h-10 bg-gray-200 rounded w-10" />
        </div>
      </div>
    </div>
  )
}
