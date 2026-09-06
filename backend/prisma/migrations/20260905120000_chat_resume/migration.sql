-- Lets the chat UI reattach to an in-flight answer after navigating away.
ALTER TABLE "Conversation" ADD COLUMN "generatingSince" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN "pendingPrompt" TEXT;

-- Section options for scheduled reports (added earlier, migration was missing).
ALTER TABLE "ScheduledReport" ADD COLUMN IF NOT EXISTS "sections" JSONB;
