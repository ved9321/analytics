-- Preserve the complete source row alongside normalized metrics.
ALTER TABLE "MetricEvent" ADD COLUMN "rawData" JSONB;
