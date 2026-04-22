'use client'

/**
 * PageBackgroundRouter — client-side wrapper that reads the current pathname
 * and renders <PageBackground> with the right section key.
 *
 * Use this from server components (like dashboard/layout.tsx) where we can't
 * call usePathname() directly. For client-rendered layouts that already have
 * pathname (ops, admin, crew, sales), prefer rendering <PageBackground> directly.
 */

import { usePathname } from 'next/navigation'
import PageBackground from './PageBackground'
import { getSectionForPath, type PageSection } from '@/lib/page-backgrounds'

interface Props {
  /** Override the auto-detected section (rarely needed) */
  section?: PageSection
  className?: string
}

export default function PageBackgroundRouter({ section, className }: Props) {
  const pathname = usePathname()
  const resolved = section ?? getSectionForPath(pathname)
  return <PageBackground section={resolved} className={className} />
}
