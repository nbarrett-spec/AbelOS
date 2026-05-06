/**
 * Unit tests for src/lib/agents/tools/pattern-engine.ts
 *
 * Pattern-engine is the only deterministic module in the agent stack — it's a
 * direct TypeScript port of scripts/builder_enrichment/patterns.py. The agent
 * orchestrators that wrap it involve Claude API calls and live web search, so
 * those get smoke-tested manually (see *.smoke.ts in this directory).
 *
 * The 4 golden cases below are the same evidence the Python source cites in
 * its module docstring (Goff / Doug Parr / Bailee / Schedcik). If you change
 * pattern-engine.ts, run `npm test` here first — those four still need to pass.
 */
import { describe, it, expect } from 'vitest'

import {
  applyPattern,
  confidenceFor,
  detectPattern,
  type EmailPattern,
} from '../tools/pattern-engine'

// ── detectPattern ────────────────────────────────────────────────────────────

describe('detectPattern', () => {
  // Golden case 1 — Goff Custom Homes: rusty@goffcustomhomes.com is firstname-only.
  it('detects firstname pattern from a single rusty@goffcustomhomes.com sample', () => {
    const result = detectPattern('goffcustomhomes.com', [
      { name: 'Rusty Goff', email: 'rusty@goffcustomhomes.com' },
    ])
    expect(result).toEqual<EmailPattern[]>(['firstname'])
  })

  // Golden case 2 — Victor Myers (synthetic same-pattern proof).
  it('detects firstname pattern from a victor@victormyers.com sample', () => {
    const result = detectPattern('victormyers.com', [
      { name: 'Victor Myers', email: 'victor@victormyers.com' },
    ])
    expect(result).toEqual<EmailPattern[]>(['firstname'])
  })

  // Golden case 3 — Doug Parr: ZoomInfo masked d***@dougparrhomes.com,
  // unmasked to doug@dougparrhomes.com → firstname.
  it('detects firstname pattern from doug@dougparrhomes.com', () => {
    const result = detectPattern('dougparrhomes.com', [
      { name: 'Doug Parr', email: 'doug@dougparrhomes.com' },
    ])
    expect(result).toEqual<EmailPattern[]>(['firstname'])
  })

  // Golden case 4 — Bailee Custom Homes: scott.mauldin@baileecustomhomes.org
  // is firstname.lastname (note .org TLD, not .com).
  it('detects firstname.lastname from scott.mauldin@baileecustomhomes.org', () => {
    const result = detectPattern('baileecustomhomes.org', [
      { name: 'Scott Mauldin', email: 'scott.mauldin@baileecustomhomes.org' },
    ])
    expect(result).toEqual<EmailPattern[]>(['firstname.lastname'])
  })

  // Mixed-frequency case — 2 firstname samples + 1 firstname.lastname.
  // Most-common-first ordering is the contract callers depend on.
  it('sorts by frequency desc when multiple patterns appear', () => {
    const result = detectPattern('mixed.com', [
      { name: 'Rusty Goff', email: 'rusty@mixed.com' },
      { name: 'Doug Parr', email: 'doug@mixed.com' },
      { name: 'Scott Mauldin', email: 'scott.mauldin@mixed.com' },
    ])
    expect(result).toEqual<EmailPattern[]>(['firstname', 'firstname.lastname'])
  })

  // Empty input → fallback list (matches Python).
  it('returns the canonical fallback list for empty input', () => {
    expect(detectPattern('unknown.com', [])).toEqual<EmailPattern[]>([
      'firstname.lastname',
      'firstname',
      'flastname',
    ])
  })

  // Bad email rows — no @ symbol — should be skipped, then fall back.
  it('skips entries without an @ and falls back if none usable', () => {
    const result = detectPattern('bad.com', [
      { name: 'No Email Person', email: '' },
      { name: 'Bad Email', email: 'not-an-email' },
    ])
    expect(result).toEqual<EmailPattern[]>([
      'firstname.lastname',
      'firstname',
      'flastname',
    ])
  })
})

// ── applyPattern ─────────────────────────────────────────────────────────────

describe('applyPattern', () => {
  it('applies firstname.lastname for John Doe @ example.com', () => {
    expect(applyPattern('firstname.lastname', 'John Doe', 'example.com')).toBe(
      'john.doe@example.com',
    )
  })

  it('applies firstname for John Doe @ example.com', () => {
    expect(applyPattern('firstname', 'John Doe', 'example.com')).toBe(
      'john@example.com',
    )
  })

  it('applies flastname for John Doe @ example.com', () => {
    expect(applyPattern('flastname', 'John Doe', 'example.com')).toBe(
      'jdoe@example.com',
    )
  })

  it('applies firstnamelastname for John Doe @ example.com', () => {
    expect(applyPattern('firstnamelastname', 'John Doe', 'example.com')).toBe(
      'johndoe@example.com',
    )
  })

  it('drops middle name when applying firstname.lastname to "Mary Jane Smith"', () => {
    // The pattern is first + last; middle gets dropped — first_middle_last is
    // a separate pattern handled below.
    expect(
      applyPattern('firstname.lastname', 'Mary Jane Smith', 'example.com'),
    ).toBe('mary.smith@example.com')
  })

  it('falls back to firstname-only when single-name input is given firstname.lastname', () => {
    // Single name, no last — Python falls through to first-name-only. Verify
    // we mirror that so single-name founders (e.g. "Cher") produce a usable
    // address rather than something like "cher.@example.com".
    expect(applyPattern('firstname.lastname', 'Cher', 'example.com')).toBe(
      'cher@example.com',
    )
  })

  it('applies firstname_lastname underscore variant', () => {
    expect(
      applyPattern('firstname_lastname', 'John Doe', 'example.com'),
    ).toBe('john_doe@example.com')
  })

  it('applies firstname-lastname hyphen variant', () => {
    expect(
      applyPattern('firstname-lastname', 'John Doe', 'example.com'),
    ).toBe('john-doe@example.com')
  })

  it('applies first_middle_last pattern with middle initial', () => {
    expect(
      applyPattern('first_middle_last', 'Mary Jane Smith', 'example.com'),
    ).toBe('mary.j.smith@example.com')
  })

  it('lowercases mixed-case input (Rusty Goff → rusty)', () => {
    // Pattern matchers always lowercase; verify applyPattern does too so we
    // don't generate "Rusty@goffcustomhomes.com" and miss a real mailbox.
    expect(applyPattern('firstname', 'Rusty Goff', 'goffcustomhomes.com')).toBe(
      'rusty@goffcustomhomes.com',
    )
  })
})

// ── confidenceFor ────────────────────────────────────────────────────────────

describe('confidenceFor', () => {
  it('returns CONFIRMED when found and pattern emails match exactly', () => {
    expect(
      confidenceFor(
        'rusty@goffcustomhomes.com',
        'rusty@goffcustomhomes.com',
      ),
    ).toBe('CONFIRMED')
  })

  it('returns LIKELY when foundEmail exists but disagrees with pattern guess', () => {
    // Research wins: a researcher surfaced r.goff@... while the pattern
    // engine still expects rusty@... — caller should prefer the researched
    // email but flag it as LIKELY (not CONFIRMED) since the pattern's off.
    expect(
      confidenceFor(
        'r.goff@goffcustomhomes.com',
        'rusty@goffcustomhomes.com',
      ),
    ).toBe('LIKELY')
  })

  it('returns UNVERIFIED when only patternEmail exists', () => {
    expect(confidenceFor(null, 'doug@dougparrhomes.com')).toBe('UNVERIFIED')
  })

  it('returns UNVERIFIED when neither email is present', () => {
    expect(confidenceFor(null, null)).toBe('UNVERIFIED')
  })
})
