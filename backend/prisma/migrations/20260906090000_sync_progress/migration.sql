-- Sync progress survives navigation and process restarts.
ALTER TABLE "Connector" ADD COLUMN "syncStartedAt" TIMESTAMP(3);
ALTER TABLE "Connector" ADD COLUMN "syncPhase"     TEXT;
ALTER TABLE "Connector" ADD COLUMN "syncMessage"   TEXT;
ALTER TABLE "Connector" ADD COLUMN "syncCompleted" INTEGER;
ALTER TABLE "Connector" ADD COLUMN "syncTotal"     INTEGER;
