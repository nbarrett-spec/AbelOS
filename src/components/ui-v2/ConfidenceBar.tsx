/**
 * ConfidenceBar — a horizontal stack: on-schedule / at-risk / delayed.
 * Used in schedule-confidence row in Aegis Home and community rollups.
 * See AEGIS_DESIGN_SYSTEM.md §5.4 (v4-confidence).
 */
export function ConfidenceBar({
  on,
  risk,
  late,
  ariaLabel,
}: {
  on: number
  risk: number
  late: number
  ariaLabel?: string
}) {
  const total = on + risk + late || 1
  const p = (n: number) => `${(n / total) * 100}%`
  return (
    <div
      className="v4-confidence"
      role="img"
      aria-label={ariaLabel ?? `${on} on schedule, ${risk} at risk, ${late} delayed`}
    >
      <span className="on"   style={{ width: p(on) }} />
      <span className="risk" style={{ width: p(risk) }} />
      <span className="late" style={{ width: p(late) }} />
    </div>
  )
}

export default ConfidenceBar
