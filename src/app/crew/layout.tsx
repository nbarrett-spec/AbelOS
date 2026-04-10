export const dynamic = 'force-dynamic'

import CrewClientLayout from './CrewClientLayout'

export default function CrewLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <CrewClientLayout>{children}</CrewClientLayout>
}
