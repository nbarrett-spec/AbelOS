import { describe, it, expect } from 'vitest'
import { parseDollar } from '../parse-dollar'

describe('parseDollar — Hyphen SupplyPro payment amount normalizer', () => {
  // ── Standard currency strings ──────────────────────────────────────────
  it('parses plain dollar amounts', () => {
    expect(parseDollar('1234.56')).toBe(1234.56)
    expect(parseDollar('$1,234.56')).toBe(1234.56)
    expect(parseDollar('$0.01')).toBe(0.01)
  })

  // ── The root-cause bug: parenthesized "negatives" must come out POSITIVE
  // These are the same inputs that produced -$714K in the Toll Brothers data
  // and had to be mass-updated. The test encodes the contract so a future
  // refactor can't silently re-introduce the sign flip.
  it('returns POSITIVE magnitude for parenthesized amounts (Toll Brothers bug)', () => {
    expect(parseDollar('($644.83)')).toBe(644.83)
    expect(parseDollar('($8,645.59)')).toBe(8645.59)
    expect(parseDollar('(1,234.56)')).toBe(1234.56)
    expect(parseDollar('($0.01)')).toBe(0.01)
  })

  it('returns POSITIVE magnitude for raw-negative amounts', () => {
    expect(parseDollar('-644.83')).toBe(644.83)
    expect(parseDollar('-$8,645.59')).toBe(8645.59)
    // Trailing-minus accounting format
    expect(parseDollar('644.83-')).toBe(644.83)
    expect(parseDollar('$1,234.56-')).toBe(1234.56)
  })

  // ── Type coercion: numbers, null, undefined ────────────────────────────
  it('handles numeric inputs as magnitude', () => {
    expect(parseDollar(1234.56)).toBe(1234.56)
    expect(parseDollar(-644.83)).toBe(644.83)
    expect(parseDollar(0)).toBe(0)
  })

  it('returns 0 for empty / null / NaN / garbage', () => {
    expect(parseDollar(null)).toBe(0)
    expect(parseDollar(undefined)).toBe(0)
    expect(parseDollar('')).toBe(0)
    expect(parseDollar('   ')).toBe(0)
    expect(parseDollar('abc')).toBe(0)
    expect(parseDollar('$$')).toBe(0)
    expect(parseDollar(NaN)).toBe(0)
    expect(parseDollar(Infinity)).toBe(0)
  })

  // ── Regression guard: replay of real Hyphen-export sample rows ─────────
  // Values taken verbatim from public/data/hp-sql.json, which is what the
  // cron ingests. Every amount must come out positive.
  it('regression: real Hyphen export values all normalize positive', () => {
    const samples = [
      { raw: '($644.83)', expected: 644.83 },
      { raw: '($8,645.59)', expected: 8645.59 },
      { raw: '($458.66)', expected: 458.66 },
      { raw: '($4,647.75)', expected: 4647.75 },
      { raw: '($297.30)', expected: 297.3 },
      { raw: '($42.79)', expected: 42.79 },
      { raw: '($34.72)', expected: 34.72 },
    ]
    for (const { raw, expected } of samples) {
      const got = parseDollar(raw)
      expect(got, `parseDollar(${JSON.stringify(raw)})`).toBe(expected)
      expect(got, `${raw} must be >= 0`).toBeGreaterThanOrEqual(0)
    }
    const totalOriginal = samples.reduce((acc, s) => acc + s.expected, 0)
    // Sum must equal sum of magnitudes — no sign flips sneaking in.
    const totalParsed = samples.reduce((acc, s) => acc + parseDollar(s.raw), 0)
    expect(totalParsed).toBeCloseTo(totalOriginal, 2)
  })

  // ── Whitespace / formatting ────────────────────────────────────────────
  it('strips whitespace, $, commas', () => {
    expect(parseDollar('  $ 1, 234 . 56  ')).toBe(1234.56)
    expect(parseDollar('\t-$100.00\n')).toBe(100)
  })
})
