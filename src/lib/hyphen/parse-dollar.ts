/**
 * Parse dollar amounts from the Hyphen SupplyPro payment report.
 *
 * Hyphen's PaymentsReport uses accounting convention where EVERY payment
 * amount is rendered either as a raw negative ("-644.83") or wrapped in
 * parentheses ("($644.83)"). Both encodings represent the same thing from
 * Hyphen's perspective: cash LEAVING the builder. From Abel's point of view
 * that same row is INCOMING revenue — i.e. it should be stored as a positive
 * amount in HyphenPayment.amount.
 *
 * The original implementation preserved the sign verbatim, which is why a
 * ~$714K Toll-Brothers total came out as -$714K in HyphenPayment rows and had
 * to be mass-updated to positives. That UPDATE was a band-aid — this helper
 * is the root cause.
 *
 * Fix: normalize to the absolute value of whatever scalar Hyphen sent us.
 * Refund / void rows (rare, shown as positives in the source) end up as
 * positives too — those cases are distinguished upstream by `paymentType`
 * (e.g. 'Void' vs 'Machine Check'), NOT by sign, which matches how Hyphen
 * itself flags them.
 *
 * Accepts:
 *   "$1,234.56"            →  1234.56
 *   "1234.56"              →  1234.56
 *   "-644.83"              →  644.83   (was -644.83 — BUG)
 *   "($644.83)"            →  644.83   (was -644.83 — BUG)
 *   "  $1,234.56-  "       →  1234.56  (trailing-minus format)
 *   ""                     →  0
 *   null / undefined       →  0
 *   non-string (number)    →  Math.abs(n)  (upstream sometimes passes numbers)
 *   garbage ("abc", "$$")  →  0
 */
export function parseDollar(s: string | number | null | undefined): number {
  if (s === null || s === undefined || s === '') return 0
  if (typeof s === 'number') return Number.isFinite(s) ? Math.abs(s) : 0
  const cleaned = String(s).replace(/[$,\s]/g, '')
  if (!cleaned) return 0
  // Strip any wrapping parentheses AND any leading/trailing minus, since both
  // encode "negative" in different report exports. We always return the
  // magnitude — sign semantics are owned by the caller.
  const unwrapped = cleaned.replace(/^\((.+)\)$/, '$1').replace(/^-+|-+$/g, '')
  const n = parseFloat(unwrapped)
  return Number.isFinite(n) ? Math.abs(n) : 0
}
