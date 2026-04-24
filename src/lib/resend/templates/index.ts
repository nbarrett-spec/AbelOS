/**
 * Template barrel — re-exports each `render*` function so callers can do:
 *
 *   import { renderARReminder } from '@/lib/resend/templates'
 *
 * As new templates land under `src/lib/resend/templates/*`, add a line
 * here so the surface is discoverable.
 */

export { renderARReminder } from './ar-reminder'
export type {
  ARReminderArgs,
  ARReminderInvoice,
  ARReminderOutput,
} from './ar-reminder'
