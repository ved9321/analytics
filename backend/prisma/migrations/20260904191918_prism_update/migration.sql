-- AlterTable
ALTER TABLE "Connector" ADD COLUMN     "coverageEnd" TIMESTAMP(3),
ADD COLUMN     "coverageStart" TIMESTAMP(3),
ADD COLUMN     "lastRowCount" INTEGER;

-- AlterTable
ALTER TABLE "MetricEvent" ADD COLUMN     "connectorId" TEXT;

-- CreateIndex
CREATE INDEX "MetricEvent_connectorId_date_idx" ON "MetricEvent"("connectorId", "date");

-- CreateIndex
CREATE INDEX "MetricEvent_workspaceId_entityId_idx" ON "MetricEvent"("workspaceId", "entityId");
