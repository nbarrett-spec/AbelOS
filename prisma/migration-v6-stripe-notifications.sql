-- Migration V6: Stripe Payment Integration + Delivery Notifications
-- Run against your Neon database to add Stripe tracking columns and notification support

-- ──────────────────────────────────────────────────────────────────────────
-- Stripe columns on Invoice table
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "stripeSessionId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "stripePaymentUrl" TEXT;
ALTER TABLE "Invoice" ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;

-- Index for looking up invoices by Stripe session
CREATE INDEX IF NOT EXISTS "Invoice_stripeSessionId_idx" ON "Invoice" ("stripeSessionId")
  WHERE "stripeSessionId" IS NOT NULL;

-- ──────────────────────────────────────────────────────────────────────────
-- Delivery Notification Tracking
-- ──────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "DeliveryNotification" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  "deliveryId" TEXT NOT NULL,
  "builderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,              -- SCHEDULED, LOADING, IN_TRANSIT, ARRIVED, DELIVERED, RESCHEDULED
  "channel" TEXT NOT NULL DEFAULT 'EMAIL', -- EMAIL, SMS, BOTH
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "sentAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'PENDING', -- PENDING, SENT, FAILED
  "error" TEXT,
  "metadata" JSONB DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DeliveryNotification_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "DeliveryNotification_deliveryId_idx" ON "DeliveryNotification" ("deliveryId");
CREATE INDEX IF NOT EXISTS "DeliveryNotification_builderId_idx" ON "DeliveryNotification" ("builderId");
CREATE INDEX IF NOT EXISTS "DeliveryNotification_status_idx" ON "DeliveryNotification" ("status");

-- ──────────────────────────────────────────────────────────────────────────
-- Builder notification preferences
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "notifyEmail" BOOLEAN DEFAULT true;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "notifySms" BOOLEAN DEFAULT false;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "notifyDeliveryUpdates" BOOLEAN DEFAULT true;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "notifyInvoiceReady" BOOLEAN DEFAULT true;
ALTER TABLE "Builder" ADD COLUMN IF NOT EXISTS "notifyPaymentReceived" BOOLEAN DEFAULT true;
