import { type ReactNode } from 'react'

/**
 * SectionLabel — Aegis's signature section tag.
 * 10px JetBrains-Mono caps · 0.22em tracking · 28×1px brass rule.
 * Use above every content block to frame it. See AEGIS_DESIGN_SYSTEM.md §15.1.
 */
export function SectionLabel({
  children,
  rightSide = false,
  as: Tag = 'div',
  className = '',
}: {
  children: ReactNode
  rightSide?: boolean
  as?: 'div' | 'span' | 'h2' | 'h3'
  className?: string
}) {
  return (
    <Tag className={`v4-section-label ${rightSide ? 'v4-section-label--right' : ''} ${className}`}>
      <span>{children}</span>
    </Tag>
  )
}

export default SectionLabel
