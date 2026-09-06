-- Role selection captured at signup, used to shape AI answers.
ALTER TABLE "User" ADD COLUMN "persona" TEXT;
ALTER TABLE "User" ADD COLUMN "focusMetrics" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "onboardedAt" TIMESTAMP(3);
