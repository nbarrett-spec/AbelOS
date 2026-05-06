/**
 * Email pattern detection — TypeScript port of
 * scripts/builder_enrichment/patterns.py (Stage 3 of the enrichment pipeline).
 *
 * Given a domain + a list of known (name, email) employees on that domain,
 * infer the most common email pattern and apply it to a new full name.
 *
 * Golden cases (from the Python source — verify by mental trace before edits):
 *   1. detect_pattern('goffcustomhomes.com', [['Rusty Goff', 'rusty@goffcustomhomes.com']])
 *      → ['firstname'] → applyPattern('firstname','Rusty Goff','goffcustomhomes.com')
 *      → 'rusty@goffcustomhomes.com'
 *
 *   2. ZoomInfo masked email d***@dougparrhomes.com — caller treats first-letter
 *      match as 'firstname' evidence; applyPattern('firstname','Doug Parr','dougparrhomes.com')
 *      → 'doug@dougparrhomes.com'
 *
 *   3. detect_pattern('baileecustomhomes.org', [['Scott Mauldin', 'scott.mauldin@baileecustomhomes.org']])
 *      → ['firstname.lastname']
 *
 * IMPORTANT: keep behavior 1:1 with the Python module — the Python script is
 * the source of truth for batch pipelines that already ran against real data.
 * If you find a Python bug, fix it in BOTH files and add a test case here.
 */

// Pattern union — the eight patterns the Python module recognizes.
// Anything else is treated as 'unknown' and not surfaced to callers.
export type EmailPattern =
  | 'firstname.lastname'
  | 'firstname'
  | 'flastname'
  | 'firstnamelastname'
  | 'firstname_lastname'
  | 'firstname-lastname'
  | 'first_middle_last'
  | 'initial_number'

/**
 * detectPattern — given a domain + known (name, email) pairs, return the
 * patterns observed sorted by frequency (most common first), top entries.
 *
 * If no usable inputs, returns the same fallback as Python:
 *   ['firstname.lastname', 'firstname', 'flastname']
 */
export function detectPattern(
  domain: string,
  knownEmails: Array<{ name: string; email: string }>
): EmailPattern[] {
  // _domain isn't used directly in pattern matching (the Python doesn't read
  // it either) but we accept it to keep the API parallel and to make it
  // available for future per-domain heuristics without a signature change.
  void domain

  if (!knownEmails || knownEmails.length === 0) {
    return ['firstname.lastname', 'firstname', 'flastname']
  }

  const found: EmailPattern[] = []

  for (const entry of knownEmails) {
    const fullName = entry.name
    const email = entry.email
    if (!email || !email.includes('@')) continue

    const localPart = email.split('@')[0].toLowerCase()
    const parts = fullName.trim().split(/\s+/).filter(Boolean)
    if (parts.length === 0) continue

    const firstName = parts[0].toLowerCase()
    const lastName = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''

    if (lastName && localPart === `${firstName}.${lastName}`) {
      found.push('firstname.lastname')
    } else if (localPart === firstName) {
      found.push('firstname')
    } else if (lastName && localPart === `${firstName[0]}${lastName}`) {
      found.push('flastname')
    } else if (lastName && localPart === `${firstName}${lastName}`) {
      found.push('firstnamelastname')
    } else if (lastName && localPart === `${firstName}_${lastName}`) {
      found.push('firstname_lastname')
    } else if (lastName && localPart === `${firstName}-${lastName}`) {
      found.push('firstname-lastname')
    } else if (/^[a-z]\d+$/.test(localPart)) {
      // Pattern like 'j123' — employee ID based
      found.push('initial_number')
    }
    // Else: unknown — Python pushes 'unknown' but it never affects ranking
    // since callers only act on known patterns. We omit it for type safety.
  }

  if (found.length === 0) {
    return ['firstname.lastname', 'firstname', 'flastname']
  }

  // Sort by frequency descending. Python uses Counter.most_common() which is
  // stable on ties — Map preserves insertion order so first-seen wins ties.
  const counts = new Map<EmailPattern, number>()
  for (const p of found) counts.set(p, (counts.get(p) ?? 0) + 1)
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([p]) => p)
}

/**
 * applyPattern — apply a detected pattern to a full name on a domain.
 * Returns the inferred email address. Falls back to firstname.lastname /
 * firstname when the pattern can't be applied (matches Python behavior).
 */
export function applyPattern(
  pattern: EmailPattern,
  fullName: string,
  domain: string
): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return `unknown@${domain}`

  const firstName = parts[0].toLowerCase()
  const lastName = parts.length > 1 ? parts[parts.length - 1].toLowerCase() : ''
  const middleNames = parts.length > 2 ? parts.slice(1, -1) : []

  let localPart: string

  if (pattern === 'firstname.lastname' && lastName) {
    localPart = `${firstName}.${lastName}`
  } else if (pattern === 'firstname') {
    localPart = firstName
  } else if (pattern === 'flastname' && lastName) {
    localPart = `${firstName[0]}${lastName}`
  } else if (pattern === 'firstnamelastname' && lastName) {
    localPart = `${firstName}${lastName}`
  } else if (pattern === 'firstname_lastname' && lastName) {
    localPart = `${firstName}_${lastName}`
  } else if (pattern === 'firstname-lastname' && lastName) {
    localPart = `${firstName}-${lastName}`
  } else if (
    pattern === 'first_middle_last' &&
    middleNames.length > 0 &&
    lastName
  ) {
    const middle = middleNames[0][0].toLowerCase()
    localPart = `${firstName}.${middle}.${lastName}`
  } else if (pattern === 'initial_number') {
    // Guess: first initial + 001 (Python parity)
    localPart = `${firstName[0]}001`
  } else {
    // Fallback — same as Python
    localPart = lastName ? `${firstName}.${lastName}` : firstName
  }

  return `${localPart}@${domain}`
}

/**
 * confidenceFor — assign confidence based on whether we found a confirmed
 * email from web research and whether it agrees with the pattern guess.
 *
 *   foundEmail matches patternEmail   → CONFIRMED
 *   foundEmail present but mismatch   → LIKELY  (research wins; pattern's off)
 *   only patternEmail present         → UNVERIFIED
 *   neither                           → UNVERIFIED
 */
export function confidenceFor(
  foundEmail: string | null,
  patternEmail: string | null
): 'CONFIRMED' | 'LIKELY' | 'UNVERIFIED' {
  if (foundEmail && foundEmail === patternEmail) return 'CONFIRMED'
  if (foundEmail) return 'LIKELY'
  if (patternEmail) return 'UNVERIFIED'
  return 'UNVERIFIED'
}
