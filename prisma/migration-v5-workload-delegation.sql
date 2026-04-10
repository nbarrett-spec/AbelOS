-- Migration V5: Workload Delegation System
-- Enables vacation/out-of-office coverage for PMs and shop managers

-- WorkloadDelegation table: who covers for whom, when, and for what scope
CREATE TABLE IF NOT EXISTS "WorkloadDelegation" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "delegatorId" TEXT NOT NULL,
  "delegateId" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "reason" TEXT NOT NULL DEFAULT 'VACATION',
  "scope" TEXT NOT NULL DEFAULT 'ALL',
  "notes" TEXT,
  "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkloadDelegation_pkey" PRIMARY KEY ("id")
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS "WorkloadDelegation_delegatorId_idx" ON "WorkloadDelegation"("delegatorId");
CREATE INDEX IF NOT EXISTS "WorkloadDelegation_delegateId_idx" ON "WorkloadDelegation"("delegateId");
CREATE INDEX IF NOT EXISTS "WorkloadDelegation_status_idx" ON "WorkloadDelegation"("status");
CREATE INDEX IF NOT EXISTS "WorkloadDelegation_dates_idx" ON "WorkloadDelegation"("startDate", "endDate");

-- Foreign keys
ALTER TABLE "WorkloadDelegation" ADD CONSTRAINT "WorkloadDelegation_delegatorId_fkey"
  FOREIGN KEY ("delegatorId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkloadDelegation" ADD CONSTRAINT "WorkloadDelegation_delegateId_fkey"
  FOREIGN KEY ("delegateId") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorkloadDelegation" ADD CONSTRAINT "WorkloadDelegation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "Staff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- reason values: VACATION, SICK_LEAVE, PARENTAL_LEAVE, TRAINING, BUSINESS_TRIP, OTHER
-- scope values: ALL, JOBS_ONLY, APPROVALS_ONLY, COMMUNICATIONS_ONLY
-- status values: SCHEDULED, ACTIVE, COMPLETED, CANCELLED
