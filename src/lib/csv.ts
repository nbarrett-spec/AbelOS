/**
 * CSV helpers for /ops/kpis and /ops/reports exports.
 *
 * Kept small and dependency-free — used both server-side (NextResponse) and
 * client-side (copy-to-clipboard in the browser).
 */

/** Escape a single CSV field per RFC 4180. */
export function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return ''
  const s = String(value)
  // Quote if contains comma, quote, newline, or carriage return
  if (/[",\r\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/**
 * Turn an array of objects (or [string[], ...string[][]]) into a CSV string.
 * - `rows` can be an array of row-objects (keys become headers) OR a 2D array.
 * - If `columns` is passed, it overrides header order + field selection.
 */
export function toCsv(
  rows: Array<Record<string, unknown>> | Array<Array<unknown>>,
  columns?: Array<{ key: string; label?: string }>,
): string {
  if (!rows || rows.length === 0) return ''

  // 2D array shape
  if (Array.isArray(rows[0])) {
    return (rows as Array<Array<unknown>>)
      .map((row) => row.map(csvEscape).join(','))
      .join('\r\n')
  }

  const objRows = rows as Array<Record<string, unknown>>
  const cols: Array<{ key: string; label?: string }> =
    columns ??
    Array.from(
      objRows.reduce<Set<string>>((acc, r) => {
        Object.keys(r).forEach((k) => acc.add(k))
        return acc
      }, new Set()),
    ).map<{ key: string; label?: string }>((k) => ({ key: k }))

  const header = cols.map((c) => csvEscape(c.label ?? c.key)).join(',')
  const body = objRows
    .map((r) => cols.map((c) => csvEscape(r[c.key])).join(','))
    .join('\r\n')
  return `${header}\r\n${body}`
}

/** Produce a filename-safe timestamp like `2026-04-22_1430`. */
export function csvFilename(base: string, at = new Date()): string {
  const iso = at.toISOString().replace(/[:.]/g, '-').slice(0, 16)
  return `${base}_${iso.replace('T', '_')}.csv`
}
