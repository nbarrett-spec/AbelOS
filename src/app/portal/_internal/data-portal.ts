/**
 * Helper to apply the `data-portal` HTML attribute that scopes our CSS tokens.
 * Kept in a tiny module so React's JSX type-checker is happy (boolean
 * attributes need careful typing for the data-* prefix).
 */

export function getDataPortalAttribute(): Record<string, string> {
  return { 'data-portal': '' }
}
