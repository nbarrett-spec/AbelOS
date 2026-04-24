/**
 * JobType — operational phase for a Job.
 *
 * Distinct from ScopeType (which describes what's being installed:
 * doors-only, trim-only, etc.). A single address can have many Jobs
 * across its build cycle, one per phase (T1 → T1I → T2 → T2I → FF → QC …).
 *
 * When both `jobAddress` and `jobType` are provided on POST /api/ops/jobs
 * the server derives the new job number as "<address> <code>", e.g.
 * "10567 Boxthorn T1". When either is missing the server falls back to
 * the legacy "JOB-YYYY-NNNN" sequence.
 *
 * This module is the single source of truth for the enum values, their
 * short codes, and human labels. The server handler in
 * src/app/api/ops/jobs/route.ts keeps its own copy of the codes map for
 * now (DB-adjacent, no cross-import) — keep both in sync.
 */

export type JobType =
  | 'TRIM_1'
  | 'TRIM_1_INSTALL'
  | 'TRIM_2'
  | 'TRIM_2_INSTALL'
  | 'DOORS'
  | 'DOOR_INSTALL'
  | 'HARDWARE'
  | 'HARDWARE_INSTALL'
  | 'FINAL_FRONT'
  | 'FINAL_FRONT_INSTALL'
  | 'QC_WALK'
  | 'PUNCH'
  | 'WARRANTY'
  | 'CUSTOM'

/** Short code used in the generated job number, e.g. "10567 Boxthorn T1". */
export const JOB_TYPE_CODES: Record<JobType, string> = {
  TRIM_1: 'T1',
  TRIM_1_INSTALL: 'T1I',
  TRIM_2: 'T2',
  TRIM_2_INSTALL: 'T2I',
  DOORS: 'DR',
  DOOR_INSTALL: 'DRI',
  HARDWARE: 'HW',
  HARDWARE_INSTALL: 'HWI',
  FINAL_FRONT: 'FF',
  FINAL_FRONT_INSTALL: 'FFI',
  QC_WALK: 'QC',
  PUNCH: 'PL',
  WARRANTY: 'WR',
  CUSTOM: 'CU',
}

/** Friendly label for dropdowns, e.g. "Trim 1 (T1)". */
export const JOB_TYPE_LABELS: Record<JobType, string> = {
  TRIM_1: 'Trim 1 (T1)',
  TRIM_1_INSTALL: 'Trim 1 Install (T1I)',
  TRIM_2: 'Trim 2 (T2)',
  TRIM_2_INSTALL: 'Trim 2 Install (T2I)',
  DOORS: 'Doors (DR)',
  DOOR_INSTALL: 'Door Install (DRI)',
  HARDWARE: 'Hardware (HW)',
  HARDWARE_INSTALL: 'Hardware Install (HWI)',
  FINAL_FRONT: 'Final Front (FF)',
  FINAL_FRONT_INSTALL: 'Final Front Install (FFI)',
  QC_WALK: 'QC Walk (QC)',
  PUNCH: 'Punch List (PL)',
  WARRANTY: 'Warranty (WR)',
  CUSTOM: 'Custom (CU)',
}

/**
 * Ordered list for rendering selects. Order reflects the rough operational
 * sequence of a build (trim → doors → hardware → final → qc → punch →
 * warranty → custom), not alphabetical.
 */
export const JOB_TYPE_OPTIONS: ReadonlyArray<{ value: JobType; label: string; code: string }> = [
  { value: 'TRIM_1', label: JOB_TYPE_LABELS.TRIM_1, code: JOB_TYPE_CODES.TRIM_1 },
  { value: 'TRIM_1_INSTALL', label: JOB_TYPE_LABELS.TRIM_1_INSTALL, code: JOB_TYPE_CODES.TRIM_1_INSTALL },
  { value: 'TRIM_2', label: JOB_TYPE_LABELS.TRIM_2, code: JOB_TYPE_CODES.TRIM_2 },
  { value: 'TRIM_2_INSTALL', label: JOB_TYPE_LABELS.TRIM_2_INSTALL, code: JOB_TYPE_CODES.TRIM_2_INSTALL },
  { value: 'DOORS', label: JOB_TYPE_LABELS.DOORS, code: JOB_TYPE_CODES.DOORS },
  { value: 'DOOR_INSTALL', label: JOB_TYPE_LABELS.DOOR_INSTALL, code: JOB_TYPE_CODES.DOOR_INSTALL },
  { value: 'HARDWARE', label: JOB_TYPE_LABELS.HARDWARE, code: JOB_TYPE_CODES.HARDWARE },
  { value: 'HARDWARE_INSTALL', label: JOB_TYPE_LABELS.HARDWARE_INSTALL, code: JOB_TYPE_CODES.HARDWARE_INSTALL },
  { value: 'FINAL_FRONT', label: JOB_TYPE_LABELS.FINAL_FRONT, code: JOB_TYPE_CODES.FINAL_FRONT },
  { value: 'FINAL_FRONT_INSTALL', label: JOB_TYPE_LABELS.FINAL_FRONT_INSTALL, code: JOB_TYPE_CODES.FINAL_FRONT_INSTALL },
  { value: 'QC_WALK', label: JOB_TYPE_LABELS.QC_WALK, code: JOB_TYPE_CODES.QC_WALK },
  { value: 'PUNCH', label: JOB_TYPE_LABELS.PUNCH, code: JOB_TYPE_CODES.PUNCH },
  { value: 'WARRANTY', label: JOB_TYPE_LABELS.WARRANTY, code: JOB_TYPE_CODES.WARRANTY },
  { value: 'CUSTOM', label: JOB_TYPE_LABELS.CUSTOM, code: JOB_TYPE_CODES.CUSTOM },
]

/**
 * Preview the job number that would be generated server-side given a
 * free-text address and a (possibly empty) JobType selection. Returns
 * null when we can't confidently preview (missing inputs) so callers
 * can render a placeholder instead of a misleading value.
 *
 * Mirrors the logic in src/app/api/ops/jobs/route.ts POST handler —
 * keep in sync.
 */
export function previewJobNumber(
  jobAddress: string | null | undefined,
  jobType: JobType | '' | null | undefined
): string | null {
  const addr = (jobAddress ?? '').trim()
  if (!addr || !jobType) return null
  const code = JOB_TYPE_CODES[jobType as JobType]
  if (!code) return null
  return `${addr} ${code}`
}
