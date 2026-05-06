-- Inbound Twilio SMS storage (A-API-2)
-- Additive migration — new table only, no destructive changes.

CREATE TABLE IF NOT EXISTS "InboundSms" (
  "id"         TEXT NOT NULL,
  "twilioSid"  TEXT NOT NULL,
  "fromNumber" TEXT NOT NULL,
  "toNumber"   TEXT NOT NULL,
  "body"       TEXT NOT NULL,
  "builderId"  TEXT,
  "urgent"     BOOLEAN NOT NULL DEFAULT false,
  "processed"  BOOLEAN NOT NULL DEFAULT false,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundSms_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "InboundSms_twilioSid_key" ON "InboundSms"("twilioSid");
CREATE INDEX IF NOT EXISTS "InboundSms_fromNumber_idx" ON "InboundSms"("fromNumber");
CREATE INDEX IF NOT EXISTS "InboundSms_builderId_idx" ON "InboundSms"("builderId");
CREATE INDEX IF NOT EXISTS "InboundSms_processed_idx" ON "InboundSms"("processed");
CREATE INDEX IF NOT EXISTS "InboundSms_urgent_idx" ON "InboundSms"("urgent");
CREATE INDEX IF NOT EXISTS "InboundSms_receivedAt_idx" ON "InboundSms"("receivedAt");
