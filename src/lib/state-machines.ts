/**
 * State Machine Definitions for Abel Lumber Platform
 *
 * Defines valid status transitions for all entities in the system.
 * Each entity has its own transition rules based on business logic.
 */

// ─── JOB STATUS TRANSITIONS ──────────────────────────────────────────
// Linear flow with ability to go back one step and jump from PUNCH_LIST to COMPLETE
export const JOB_TRANSITIONS: Record<string, string[]> = {
  CREATED: ["READINESS_CHECK"],
  READINESS_CHECK: ["MATERIALS_LOCKED", "CREATED"],
  MATERIALS_LOCKED: ["IN_PRODUCTION", "READINESS_CHECK"],
  IN_PRODUCTION: ["STAGED", "MATERIALS_LOCKED"],
  STAGED: ["LOADED", "IN_PRODUCTION"],
  LOADED: ["IN_TRANSIT", "STAGED"],
  IN_TRANSIT: ["DELIVERED", "LOADED"],
  DELIVERED: ["INSTALLING", "IN_TRANSIT"],
  INSTALLING: ["PUNCH_LIST", "DELIVERED"],
  PUNCH_LIST: ["COMPLETE", "INSTALLING"],
  COMPLETE: ["INVOICED"],
  INVOICED: ["CLOSED", "COMPLETE"],
  CLOSED: [],
};

// ─── ORDER STATUS TRANSITIONS ───────────────────────────────────────
// Mostly linear with CANCELLED available from early states only
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  RECEIVED: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PRODUCTION", "CANCELLED"],
  IN_PRODUCTION: ["READY_TO_SHIP", "CANCELLED"],
  READY_TO_SHIP: ["SHIPPED"],
  SHIPPED: ["DELIVERED"],
  DELIVERED: ["COMPLETE"],
  COMPLETE: [],
  CANCELLED: [],
};

// ─── QUOTE STATUS TRANSITIONS ───────────────────────────────────────
// DRAFT → SENT → APPROVED/REJECTED/EXPIRED; APPROVED → ORDERED
export const QUOTE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["SENT"],
  SENT: ["APPROVED", "REJECTED", "EXPIRED"],
  APPROVED: ["ORDERED"],
  REJECTED: [],
  EXPIRED: [],
  ORDERED: [],
};

// ─── INVOICE STATUS TRANSITIONS ──────────────────────────────────────
// Linear payment flow with OVERDUE from SENT, VOID from most states, VOID → WRITE_OFF
export const INVOICE_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["ISSUED", "VOID"],
  ISSUED: ["SENT", "VOID"],
  SENT: ["PARTIALLY_PAID", "OVERDUE", "VOID"],
  PARTIALLY_PAID: ["PAID", "VOID"],
  PAID: [],
  OVERDUE: ["PARTIALLY_PAID", "PAID", "VOID"],
  VOID: ["WRITE_OFF"],
  WRITE_OFF: [],
};

// ─── DELIVERY STATUS TRANSITIONS ────────────────────────────────────
// Linear flow with branching for PARTIAL_DELIVERY, REFUSED, and RESCHEDULED
export const DELIVERY_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["LOADING", "RESCHEDULED"],
  LOADING: ["IN_TRANSIT", "RESCHEDULED"],
  IN_TRANSIT: ["ARRIVED"],
  ARRIVED: ["UNLOADING", "REFUSED"],
  UNLOADING: ["COMPLETE", "PARTIAL_DELIVERY", "REFUSED"],
  COMPLETE: [],
  PARTIAL_DELIVERY: [],
  REFUSED: [],
  RESCHEDULED: ["SCHEDULED"],
};

// ─── INSTALLATION STATUS TRANSITIONS ────────────────────────────────
// SCHEDULED → IN_PROGRESS → COMPLETE/PUNCH_LIST; PUNCH_LIST → REWORK → IN_PROGRESS/COMPLETE
export const INSTALLATION_TRANSITIONS: Record<string, string[]> = {
  SCHEDULED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETE", "PUNCH_LIST"],
  COMPLETE: [],
  PUNCH_LIST: ["REWORK"],
  REWORK: ["IN_PROGRESS", "COMPLETE"],
  CANCELLED: [],
};

// ─── PURCHASE ORDER STATUS TRANSITIONS ───────────────────────────────
// Linear approval flow with CANCELLED available from early states
export const PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["PENDING_APPROVAL", "CANCELLED"],
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["SENT_TO_VENDOR", "CANCELLED"],
  SENT_TO_VENDOR: ["PARTIALLY_RECEIVED"],
  PARTIALLY_RECEIVED: ["RECEIVED"],
  RECEIVED: [],
  CANCELLED: [],
};

// ─── TRANSITION MAP REGISTRY ───────────────────────────────────────
const TRANSITION_MAPS: Record<
  string,
  Record<string, string[]>
> = {
  job: JOB_TRANSITIONS,
  order: ORDER_TRANSITIONS,
  quote: QUOTE_TRANSITIONS,
  invoice: INVOICE_TRANSITIONS,
  delivery: DELIVERY_TRANSITIONS,
  installation: INSTALLATION_TRANSITIONS,
  po: PO_TRANSITIONS,
};

/**
 * Validates whether a transition between two statuses is allowed for a given entity type.
 *
 * @param type - The entity type: 'job', 'order', 'quote', 'invoice', 'delivery', 'installation', or 'po'
 * @param from - The current status
 * @param to - The target status
 * @returns true if the transition is valid, false otherwise
 *
 * @example
 * if (isValidTransition('job', 'CREATED', 'READINESS_CHECK')) {
 *   // Update job status
 * }
 */
export function isValidTransition(
  type: "job" | "order" | "quote" | "invoice" | "delivery" | "installation" | "po",
  from: string,
  to: string
): boolean {
  const transitions = TRANSITION_MAPS[type];

  if (!transitions) {
    return false;
  }

  const allowedTransitions = transitions[from];

  if (!allowedTransitions) {
    return false;
  }

  return allowedTransitions.includes(to);
}

/**
 * Gets all valid next statuses for a given entity type and current status.
 *
 * @param type - The entity type
 * @param currentStatus - The current status
 * @returns An array of valid next statuses, or an empty array if none exist or status is invalid
 *
 * @example
 * const nextStatuses = getNextStatuses('job', 'IN_PRODUCTION');
 * // Returns: ['STAGED', 'MATERIALS_LOCKED']
 */
export function getNextStatuses(
  type: "job" | "order" | "quote" | "invoice" | "delivery" | "installation" | "po",
  currentStatus: string
): string[] {
  const transitions = TRANSITION_MAPS[type];

  if (!transitions) {
    return [];
  }

  return transitions[currentStatus] || [];
}

/**
 * Checks if a status is a terminal state (no further transitions possible).
 *
 * @param type - The entity type
 * @param status - The status to check
 * @returns true if the status is terminal, false otherwise
 *
 * @example
 * if (isTerminalState('job', 'CLOSED')) {
 *   // Job cannot transition further
 * }
 */
export function isTerminalState(
  type: "job" | "order" | "quote" | "invoice" | "delivery" | "installation" | "po",
  status: string
): boolean {
  const nextStatuses = getNextStatuses(type, status);
  return nextStatuses.length === 0;
}
