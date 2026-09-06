-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN "context" JSONB;

-- AlterTable
ALTER TABLE "QueryTrace" ADD COLUMN "plannerModel" TEXT,
ADD COLUMN "planWarnings" JSONB,
ADD COLUMN "dataQuality" JSONB;
