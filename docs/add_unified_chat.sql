-- =====================================================
-- UNIFIED CHAT SYSTEM — Schema Migration
-- Extends existing Conversation/Message models to
-- support builder-to-staff messaging alongside
-- internal staff-to-staff chat
-- =====================================================

-- 1. Add BUILDER_SUPPORT to ConversationType enum
ALTER TYPE "ConversationType" ADD VALUE IF NOT EXISTS 'BUILDER_SUPPORT';

-- 2. Extend Conversation table for builder support
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "builderId" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "subject" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMessagePreview" TEXT;

-- Make createdById nullable (builder-created conversations won't have a staff creator)
ALTER TABLE "Conversation" ALTER COLUMN "createdById" DROP NOT NULL;

-- Add foreign key for builder
ALTER TABLE "Conversation"
  ADD CONSTRAINT "Conversation_builderId_fkey"
  FOREIGN KEY ("builderId") REFERENCES "Builder"("id") ON DELETE CASCADE;

-- Index for builder conversations
CREATE INDEX IF NOT EXISTS "Conversation_builderId_idx" ON "Conversation"("builderId");

-- 3. Extend Message table for builder senders
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "builderSenderId" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "senderType" TEXT NOT NULL DEFAULT 'STAFF';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "readByBuilder" BOOLEAN NOT NULL DEFAULT false;

-- Make senderId nullable (builder-sent messages won't have a staff sender)
ALTER TABLE "Message" ALTER COLUMN "senderId" DROP NOT NULL;

-- Add foreign key for builder sender
ALTER TABLE "Message"
  ADD CONSTRAINT "Message_builderSenderId_fkey"
  FOREIGN KEY ("builderSenderId") REFERENCES "Builder"("id") ON DELETE RESTRICT;

-- Index for builder sender
CREATE INDEX IF NOT EXISTS "Message_builderSenderId_idx" ON "Message"("builderSenderId");

-- 4. Migrate existing BuilderMessage data to the unified system
-- This creates a conversation for each existing builder message thread
-- Run this AFTER the schema changes above
DO $$
DECLARE
  rec RECORD;
  conv_id TEXT;
  msg_id TEXT;
  reply_msg_id TEXT;
BEGIN
  FOR rec IN
    SELECT DISTINCT ON (bm."builderId")
      bm."builderId",
      b."companyName"
    FROM "BuilderMessage" bm
    JOIN "Builder" b ON b."id" = bm."builderId"
  LOOP
    conv_id := 'conv_migrated_' || rec."builderId";

    -- Create a conversation for this builder
    INSERT INTO "Conversation" (
      "id", "type", "name", "builderId", "subject",
      "createdAt", "updatedAt"
    ) VALUES (
      conv_id, 'BUILDER_SUPPORT', rec."companyName" || ' Support',
      rec."builderId", 'Migrated from legacy messaging',
      NOW(), NOW()
    ) ON CONFLICT (id) DO NOTHING;

    -- Migrate each message
    FOR rec IN
      SELECT * FROM "BuilderMessage"
      WHERE "builderId" = rec."builderId"
      ORDER BY "createdAt" ASC
    LOOP
      msg_id := 'msg_mig_' || rec."id";

      INSERT INTO "Message" (
        "id", "conversationId", "builderSenderId", "senderType",
        "body", "readBy", "readByBuilder", "createdAt"
      ) VALUES (
        msg_id, conv_id, rec."builderId", 'BUILDER',
        rec."subject" || E'\n\n' || rec."body",
        '{}', true, NOW()
      ) ON CONFLICT (id) DO NOTHING;

      -- If there's a staff reply, add that too
      IF rec."staffReply" IS NOT NULL AND rec."staffReplyById" IS NOT NULL THEN
        reply_msg_id := 'msg_reply_' || rec."id";
        INSERT INTO "Message" (
          "id", "conversationId", "senderId", "senderType",
          "body", "readBy", "readByBuilder", "createdAt"
        ) VALUES (
          reply_msg_id, conv_id, rec."staffReplyById", 'STAFF',
          rec."staffReply", '{}', COALESCE(rec."readByBuilder", false),
          COALESCE(rec."staffReplyAt", NOW())
        ) ON CONFLICT (id) DO NOTHING;
      END IF;
    END LOOP;
  END LOOP;
END $$;
