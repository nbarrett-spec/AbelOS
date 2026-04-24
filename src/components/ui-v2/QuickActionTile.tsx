import { type ReactNode } from 'react'
import Link from 'next/link'

/**
 * QuickActionTile — a tile in the Aegis Home quick-action dock.
 * 5 tiles, each with a glyph, a label, a keyboard-hint bottom-right.
 * See AEGIS_DESIGN_SYSTEM.md §16.1.
 */
export function QuickActionTile({
  icon,
  label,
  hint,
  href,
  onClick,
}: {
  icon: ReactNode
  label: string
  hint?: string
  href?: string
  onClick?: () => void
}) {
  const body = (
    <>
      <div className="glyph" aria-hidden>
        {icon}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', width: '100%' }}>
        <span className="label">{label}</span>
        {hint && <span className="hint">{hint}</span>}
      </div>
    </>
  )
  if (href) {
    return (
      <Link href={href} className="v4-quick__tile">
        {body}
      </Link>
    )
  }
  return (
    <button type="button" className="v4-quick__tile" onClick={onClick}>
      {body}
    </button>
  )
}

export default QuickActionTile
