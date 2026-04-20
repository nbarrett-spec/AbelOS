export default function ExecutiveLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-[#3E2A1E] text-white px-6 py-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold tracking-tight">Abel Lumber</h1>
          <p className="text-xs text-amber-200 opacity-80">Executive Dashboard</p>
        </div>
        <a href="/ops" className="text-xs text-white/60 hover:text-white transition-colors">
          ← Operations
        </a>
      </header>
      <main className="p-6 max-w-7xl mx-auto">{children}</main>
    </div>
  )
}
