-- A-INT-4 — Gmail sync: ack / receipt handling
-- Additive-only migration. Safe to apply on a populated prod DB.
--
-- Adds:
--   • CommunicationLog.processedAt   — set when post-ingest handling
--                                       (builder linking + InboxItem fanout)
--                                       finished. Cron skips rows where this
--                                       is non-null on subsequent runs.
--   • CommunicationLog.inboxItemId   — reverse pointer to the InboxItem we
--                                       created for this message (null if
--                                       suppressed: automated, no builder match,
--                                       outbound, etc.).
--   • Indexes: processedAt for the cron's "needs processing" scan, and a
--     joined index on builderId + sentAt for the inbox view.

ALTER TABLE "CommunicationLog"
  ADD COLUMN IF NOT EXISTS "processedAt"  TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "inboxItemId"  TEXT;

CREATE INDEX IF NOT EXISTS "idx_commlog_processed_at"
  ON "CommunicationLog" ("processedAt");

CREATE INDEX IF NOT EXISTS "idx_commlog_builder_sent"
  ON "CommunicationLog" ("builderId", "sentAt" DESC);
