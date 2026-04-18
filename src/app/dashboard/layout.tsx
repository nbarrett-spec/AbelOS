import Navbar from '@/components/Navbar'
import Breadcrumbs from '@/components/Breadcrumbs'
import AgentChat from '@/components/AgentChat'
import MobileBottomNav from '@/components/MobileBottomNav'
import MobileQuickActions from '@/components/MobileQuickActions'
import OfflineIndicator from '@/components/OfflineIndicator'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <Navbar />
      <OfflineIndicator />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-24 md:pb-8">
        <Breadcrumbs />
        <div className="animate-enter">{children}</div>
      </main>
      <AgentChat />
      <MobileQuickActions />
      <MobileBottomNav />
    </div>
  )
}
