/**
 * Status Guard — the single enforcement point for state-machine transitions.
 *
 * Every mutation route that writes a status/stage column MUST go through
 * requireValidTransition() (sync) or requireValidTransitionFor() (async)
 * before executing the UPDATE.
 *
 * Primary truth: `src/lib/state-machines.ts` (for job / order / quote /
 * invoice / delivery / installation / po). Deal transitions live here because
 * Deal uses a `stage` column that maps to the same guard contract.
 *
 * See `docs/STATUS_GUARD_WIRING.md` for the codemod plan covering the ~40
 * routes that still bypass this guard.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isValidTransition, getNextStatuses } from '@/lib/state-machines';

// ─── ENTITY TYPE ───────────────────────────────────────────────────────────
/**
 * Entity types accepted by the status guard. Superset of the types known to
 * state-machines.ts — 'deal' is handled locally because Deal uses a `stage`
 * column and DealStage transitions are defined below.
 */
export type GuardEntity =
  | 'job'
  | 'order'
  | 'quote'
  | 'invoice'
  | 'delivery'
  | 'installation'
  | 'po'
  | 'deal';

// Entities delegated to the shared state-machines module.
type StateMachineEntity = Exclude<GuardEntity, 'deal'>;

// ─── DEAL TRANSITIONS (local — not in state-machines.ts) ───────────────────
/**
 * Sales pipeline stage transitions. Enum source: prisma/schema.prisma → DealStage.
 * Pipeline: PROSPECT → DISCOVERY → WALKTHROUGH → BID_SUBMITTED → BID_REVIEW →
 * NEGOTIATION → WON/LOST; WON → ONBOARDED. LOST is reachable from every
 * pre-WON stage.
 */
const DEAL_TRANSITIONS: Record<string, string[]> = {
  PROSPECT: ['DISCOVERY', 'LOST'],
  DISCOVERY: ['WALKTHROUGH', 'BID_SUBMITTED', 'LOST'],
  WALKTHROUGH: ['BID_SUBMITTED', 'DISCOVERY', 'LOST'],
  BID_SUBMITTED: ['BID_REVIEW', 'NEGOTIATION', 'LOST'],
  BID_REVIEW: ['NEGOTIATION', 'WON', 'LOST'],
  NEGOTIATION: ['WON', 'LOST', 'BID_REVIEW'],
  WON: ['ONBOARDED'],
  LOST: [],
  ONBOARDED: [],
};

function isValidDealTransition(from: string, to: string): boolean {
  if (from === to) return true;
  const allowed = DEAL_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.includes(to);
}

function getDealNextStages(from: string): string[] {
  return DEAL_TRANSITIONS[from] ?? [];
}

function isKnownDealStage(stage: string): boolean {
  return Object.prototype.hasOwnProperty.call(DEAL_TRANSITIONS, stage);
}

// ─── DISPATCHERS (wrap state-machines + local deal map) ────────────────────
function guardIsValidTransition(
  entity: GuardEntity,
  from: string,
  to: string
): boolean {
  if (entity === 'deal') return isValidDealTransition(from, to);
  // state-machines treats from === to as an error; we want it to be a silent no-op.
  if (from === to) return true;
  return isValidTransition(entity as StateMachineEntity, from, to);
}

function guardGetNext(entity: GuardEntity, from: string): string[] {
  if (entity === 'deal') return getDealNextStages(from);
  return getNextStatuses(entity as StateMachineEntity, from);
}

function guardIsKnownStatus(entity: GuardEntity, status: string): boolean {
  if (entity === 'deal') return isKnownDealStage(status);
  // state-machines doesn't export a "known?" helper, but getNextStatuses
  // returns [] for both unknown and terminal. We distinguish by probing:
  // every known status either has next states OR is a registered terminal.
  // Cheapest check: if any other status lists `status` as a valid target,
  // it's known. For first-class statuses we walk the map via getNextStatuses
  // on the status itself and on its neighbors.
  //
  // Simpler: treat "known" as "getNextStatuses(entity, status) is not []
  // OR status appears as a known transition target". We approximate with
  // a probe against getNextStatuses which is sufficient for terminal states
  // that have no outgoing edges by falling back to a terminal allow-list.
  const outgoing = getNextStatuses(entity as StateMachineEntity, status);
  if (outgoing.length > 0) return true;
  return TERMINAL_STATES[entity]?.includes(status) ?? false;
}

// Terminal states per entity (must be kept in sync with state-machines.ts).
// Used only by guardIsKnownStatus to distinguish terminal-but-valid from unknown.
const TERMINAL_STATES: Record<GuardEntity, string[]> = {
  job: ['CLOSED'],
  order: ['COMPLETE', 'CANCELLED'],
  quote: ['REJECTED', 'EXPIRED', 'ORDERED'],
  invoice: ['PAID', 'WRITE_OFF'],
  delivery: ['COMPLETE', 'PARTIAL_DELIVERY', 'REFUSED'],
  installation: ['COMPLETE', 'CANCELLED'],
  po: ['RECEIVED', 'CANCELLED'],
  deal: ['LOST', 'ONBOARDED'],
};

// ─── ERROR TYPE ────────────────────────────────────────────────────────────
/**
 * Thrown by requireValidTransition* when a status write would violate the
 * state machine. The payload is safe to serialize to JSON and return to the
 * client — it contains no secrets.
 */
export class InvalidTransitionError extends Error {
  public readonly entity: GuardEntity;
  public readonly from: string;
  public readonly to: string;
  public readonly validNext: string[];
  public readonly reason: 'UNKNOWN_FROM' | 'UNKNOWN_TO' | 'DISALLOWED';

  constructor(opts: {
    entity: GuardEntity;
    from: string;
    to: string;
    validNext: string[];
    reason: 'UNKNOWN_FROM' | 'UNKNOWN_TO' | 'DISALLOWED';
  }) {
    super(
      `Invalid ${opts.entity} transition: ${opts.from} -> ${opts.to}. ` +
        `Valid next states from ${opts.from}: [${opts.validNext.join(', ') || '(terminal)'}]`
    );
    this.name = 'InvalidTransitionError';
    this.entity = opts.entity;
    this.from = opts.from;
    this.to = opts.to;
    this.validNext = opts.validNext;
    this.reason = opts.reason;

    // Preserve prototype chain when transpiled to ES5.
    Object.setPrototypeOf(this, InvalidTransitionError.prototype);
  }

  toJSON() {
    return {
      error: 'INVALID_TRANSITION',
      entity: this.entity,
      from: this.from,
      to: this.to,
      validNext: this.validNext,
      reason: this.reason,
      message: this.message,
    };
  }
}

// ─── CORE GUARDS ───────────────────────────────────────────────────────────
/**
 * Throws InvalidTransitionError if the transition is disallowed.
 * Idempotent no-ops (from === to) are allowed silently.
 *
 * Use this when you already know the current status (e.g. you loaded it as
 * part of the same request handler).
 */
export function requireValidTransition(
  entity: GuardEntity,
  from: string,
  to: string
): void {
  if (!from || typeof from !== 'string') {
    throw new InvalidTransitionError({
      entity,
      from: String(from),
      to,
      validNext: [],
      reason: 'UNKNOWN_FROM',
    });
  }
  if (!to || typeof to !== 'string') {
    throw new InvalidTransitionError({
      entity,
      from,
      to: String(to),
      validNext: guardGetNext(entity, from),
      reason: 'UNKNOWN_TO',
    });
  }

  // from === to is a silent no-op.
  if (from === to) return;

  if (!guardIsKnownStatus(entity, from)) {
    throw new InvalidTransitionError({
      entity,
      from,
      to,
      validNext: [],
      reason: 'UNKNOWN_FROM',
    });
  }

  if (!guardIsValidTransition(entity, from, to)) {
    throw new InvalidTransitionError({
      entity,
      from,
      to,
      validNext: guardGetNext(entity, from),
      reason: 'DISALLOWED',
    });
  }
}

/**
 * Async variant — matches the contract requested in the wiring spec.
 *
 * Pattern:
 *   await requireValidTransitionFor('order', currentStatus, newStatus)
 *
 * This is intentionally thin; the actual DB read lives in the route so each
 * entity's schema quirks (e.g. Deal.stage vs Order.status) stay in route code.
 */
export async function requireValidTransitionFor<T = void>(
  entity: GuardEntity,
  currentStatus: string,
  newStatus: string
): Promise<T | void> {
  requireValidTransition(entity, currentStatus, newStatus);
  return undefined;
}

// ─── MIDDLEWARE WRAPPER ────────────────────────────────────────────────────
/**
 * Wraps a Next.js route handler so any InvalidTransitionError thrown inside
 * is converted to a 409 JSON response with the full error payload. Non-
 * transition errors are re-thrown.
 *
 * Usage:
 *   export const PATCH = withStatusGuard('order', async (req, ctx) => {
 *     ...
 *     requireValidTransition('order', current, next);
 *     ...
 *     return NextResponse.json(result);
 *   });
 */
export function withStatusGuard<Ctx>(
  _entity: GuardEntity,
  handler: (req: NextRequest, ctx: Ctx) => Promise<NextResponse>
): (req: NextRequest, ctx: Ctx) => Promise<NextResponse> {
  return async (req: NextRequest, ctx: Ctx) => {
    try {
      return await handler(req, ctx);
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return NextResponse.json(err.toJSON(), { status: 409 });
      }
      throw err;
    }
  };
}

/**
 * Convenience helper for routes that can't adopt withStatusGuard yet —
 * catches a thrown InvalidTransitionError and returns a 409 response, or
 * null if the error is something else (caller should re-throw in that case).
 *
 * Usage:
 *   try {
 *     requireValidTransition('order', current, next);
 *   } catch (e) {
 *     const res = transitionErrorResponse(e);
 *     if (res) return res;
 *     throw e;
 *   }
 */
export function transitionErrorResponse(err: unknown): NextResponse | null {
  if (err instanceof InvalidTransitionError) {
    return NextResponse.json(err.toJSON(), { status: 409 });
  }
  return null;
}
