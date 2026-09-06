-- Field catalogue: every dimension and metric a connector's platform offers.
CREATE TABLE "ConnectorField" (
  "id"           TEXT NOT NULL,
  "workspaceId"  TEXT NOT NULL,
  "connectorId"  TEXT NOT NULL,
  "kind"         TEXT NOT NULL,
  "apiName"      TEXT NOT NULL,
  "uiName"       TEXT NOT NULL,
  "description"  TEXT,
  "category"     TEXT,
  "custom"       BOOLEAN NOT NULL DEFAULT false,
  "syncEnabled"  BOOLEAN NOT NULL DEFAULT false,
  "deprecated"   BOOLEAN NOT NULL DEFAULT false,
  "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConnectorField_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ConnectorField_connectorId_kind_apiName_key"
  ON "ConnectorField"("connectorId", "kind", "apiName");
CREATE INDEX "ConnectorField_workspaceId_connectorId_idx"
  ON "ConnectorField"("workspaceId", "connectorId");
CREATE INDEX "ConnectorField_workspaceId_custom_idx"
  ON "ConnectorField"("workspaceId", "custom");

ALTER TABLE "ConnectorField"
  ADD CONSTRAINT "ConnectorField_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Connector" ADD COLUMN "schemaSyncedAt" TIMESTAMP(3);
ALTER TABLE "Connector" ADD COLUMN "schemaError" TEXT;
