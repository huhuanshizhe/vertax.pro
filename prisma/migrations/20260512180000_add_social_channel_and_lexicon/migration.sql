-- AlterEnum: Add SOCIAL to ChannelType
ALTER TYPE "ChannelType" ADD VALUE 'SOCIAL';

-- AlterTable: Add facebookUrl to RadarCandidate
ALTER TABLE "RadarCandidate" ADD COLUMN "facebookUrl" TEXT;

-- CreateTable: CountryLanguageLexicon
CREATE TABLE "country_language_lexicons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "countryCode" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "packId" TEXT,
    "manufacturerTerms" TEXT[],
    "industryTerms" TEXT[],
    "processTerms" TEXT[],
    "productTerms" TEXT[],
    "exclusionTerms" TEXT[],
    "source" TEXT NOT NULL DEFAULT 'manual',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "country_language_lexicons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "country_language_lexicons_countryCode_language_packId_tenantId_key" ON "country_language_lexicons"("countryCode", "language", "packId", "tenantId");

-- CreateIndex
CREATE INDEX "country_language_lexicons_countryCode_packId_idx" ON "country_language_lexicons"("countryCode", "packId");

-- CreateIndex
CREATE INDEX "country_language_lexicons_tenantId_idx" ON "country_language_lexicons"("tenantId");
