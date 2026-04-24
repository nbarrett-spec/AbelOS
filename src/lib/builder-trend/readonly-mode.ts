// ──────────────────────────────────────────────────────────────────────────
// BuilderTrend — Read-Only Mode Guard
//
// Wave-2 / Agent B9 / Monday-launch sprint (2026-04-23).
//
// Purpose: give every caller in the BuilderTrend lib a single, explicit
// choke-point to check before performing any write-flavored operation
// (create/update/delete on BT or any Aegis model that would persist BT
// state outward). For Monday we ship read-only — no two-way writes.
//
// Contract:
//   • `isWriteAllowed()` returns true only when BUILDERTREND_WRITE_ENABLED
//     is exactly the string 'true'. Anything else (undefined, 'false',
//     '1', 'yes', empty) returns false. This is intentional — flipping
//     this flag is a conscious act, not a typo.
//   • `assertReadOnly(op)` throws `BuilderTrendReadOnlyError` when called
//     from a write path while writes are disabled. Callers can catch the
//     typed class to distinguish from generic errors and log/respond
//     appropriately without leaking the flag name to end users.
//   • The error carries the attempted `op` string so logs can point at
//     exactly which write path tried to fire.
//
// Enabling writes later is NOT a one-line change — see the "write-mode
// roadmap" note in client.ts.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Typed error thrown by `assertReadOnly()` when a write is attempted while
 * the feature flag is disabled. Callers can `instanceof` this to branch
 * their error handling (e.g. return 503 vs 500).
 */
export class BuilderTrendReadOnlyError extends Error {
  public readonly code = 'BT_READONLY' as const
  public readonly op: string

  constructor(op: string) {
    super(
      `BuilderTrend is in read-only mode — write operation "${op}" is disabled. ` +
        `Set BUILDERTREND_WRITE_ENABLED=true only after the compliance review in ` +
        `BUILDERTREND-WRITE.md is complete.`
    )
    this.name = 'BuilderTrendReadOnlyError'
    this.op = op
    // Restore prototype chain for `instanceof` checks across bundler/transpiler boundaries.
    Object.setPrototypeOf(this, BuilderTrendReadOnlyError.prototype)
  }
}

/**
 * Returns true if BuilderTrend write operations are enabled for this
 * process. Defaults to false — every environment must opt in explicitly.
 */
export function isWriteAllowed(): boolean {
  return process.env.BUILDERTREND_WRITE_ENABLED === 'true'
}

/**
 * Guard for write-flavored code paths. Call this BEFORE doing any mutation
 * against BuilderTrend or any Aegis table that is the persistent image of
 * a BT-side write. No-op when writes are allowed; throws otherwise.
 *
 * @param op   Short description of the attempted operation — included in
 *             the error message and log output. Prefer dot-path style:
 *             e.g. "schedule.update", "selection.delete", "project.create".
 *
 * @throws BuilderTrendReadOnlyError when writes are disabled.
 */
export function assertReadOnly(op: string): void {
  if (!isWriteAllowed()) {
    throw new BuilderTrendReadOnlyError(op)
  }
}
