-- Add Tenant FK relations and composite indexes for Radar models
-- This migration adds proper foreign key constraints and performance indexes

-- RadarTask: add tenant FK + index
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'RadarTask_tenantId_fkey'
    AND table_name = 'radar_tasks'
  ) THEN
    ALTER TABLE "radar_tasks" ADD CONSTRAINT "RadarTask_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "RadarTask_tenantId_status_idx" ON "radar_tasks"("tenantId", "status");

-- RadarCandidate: add tenant FK + indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'RadarCandidate_tenantId_fkey'
    AND table_name = 'radar_candidates'
  ) THEN
    ALTER TABLE "radar_candidates" ADD CONSTRAINT "RadarCandidate_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "RadarCandidate_tenantId_status_idx" ON "radar_candidates"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "RadarCandidate_tenantId_candidateType_idx" ON "radar_candidates"("tenantId", "candidateType");
CREATE INDEX IF NOT EXISTS "RadarCandidate_tenantId_qualifyTier_idx" ON "radar_candidates"("tenantId", "qualifyTier");
CREATE INDEX IF NOT EXISTS "RadarCandidate_country_status_idx" ON "radar_candidates"("country", "status");

-- ProspectCompany: fix onDelete to CASCADE + add indexes
DO $$ BEGIN
  -- Drop existing FK if it exists (to recreate with CASCADE)
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectCompany_tenantId_fkey'
    AND table_name = 'prospect_companies'
  ) THEN
    ALTER TABLE "prospect_companies" DROP CONSTRAINT "ProspectCompany_tenantId_fkey";
  END IF;
  ALTER TABLE "prospect_companies" ADD CONSTRAINT "ProspectCompany_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
END $$;
CREATE INDEX IF NOT EXISTS "ProspectCompany_tenantId_status_idx" ON "prospect_companies"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "ProspectCompany_tenantId_createdAt_idx" ON "prospect_companies"("tenantId", "createdAt");

-- ProspectContact: add tenant FK + indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ProspectContact_tenantId_fkey'
    AND table_name = 'prospect_contacts'
  ) THEN
    ALTER TABLE "prospect_contacts" ADD CONSTRAINT "ProspectContact_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "ProspectContact_tenantId_idx" ON "prospect_contacts"("tenantId");
CREATE INDEX IF NOT EXISTS "ProspectContact_companyId_idx" ON "prospect_contacts"("companyId");

-- Opportunity: add tenant FK + indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'Opportunity_tenantId_fkey'
    AND table_name = 'opportunities'
  ) THEN
    ALTER TABLE "opportunities" ADD CONSTRAINT "Opportunity_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "Opportunity_tenantId_stage_idx" ON "opportunities"("tenantId", "stage");
CREATE INDEX IF NOT EXISTS "Opportunity_tenantId_assignedTo_idx" ON "opportunities"("tenantId", "assignedTo");

-- RadarSearchProfile: add tenant FK + indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'RadarSearchProfile_tenantId_fkey'
    AND table_name = 'radar_search_profiles'
  ) THEN
    ALTER TABLE "radar_search_profiles" ADD CONSTRAINT "RadarSearchProfile_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "RadarSearchProfile_tenantId_isActive_idx" ON "radar_search_profiles"("tenantId", "isActive");
CREATE INDEX IF NOT EXISTS "RadarSearchProfile_isActive_nextRunAt_idx" ON "radar_search_profiles"("isActive", "nextRunAt");

-- IntentSignal: add tenant FK + indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'IntentSignal_tenantId_fkey'
    AND table_name = 'intent_signals'
  ) THEN
    ALTER TABLE "intent_signals" ADD CONSTRAINT "IntentSignal_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "IntentSignal_tenantId_idx" ON "intent_signals"("tenantId");
CREATE INDEX IF NOT EXISTS "IntentSignal_candidateId_idx" ON "intent_signals"("candidateId");

-- WebhookConfig: add tenant FK + index
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WebhookConfig_tenantId_fkey'
    AND table_name = 'webhook_configs'
  ) THEN
    ALTER TABLE "webhook_configs" ADD CONSTRAINT "WebhookConfig_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "WebhookConfig_tenantId_idx" ON "webhook_configs"("tenantId");

-- WebhookLog: add tenant FK + index
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'WebhookLog_tenantId_fkey'
    AND table_name = 'webhook_logs'
  ) THEN
    ALTER TABLE "webhook_logs" ADD CONSTRAINT "WebhookLog_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "WebhookLog_tenantId_webhookId_idx" ON "webhook_logs"("tenantId", "webhookId");

-- OutreachRecord: add tenant FK + indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'OutreachRecord_tenantId_fkey'
    AND table_name = 'outreach_records'
  ) THEN
    ALTER TABLE "outreach_records" ADD CONSTRAINT "OutreachRecord_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "OutreachRecord_tenantId_status_idx" ON "outreach_records"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "OutreachRecord_tenantId_createdAt_idx" ON "outreach_records"("tenantId", "createdAt");

-- SequenceInstance: add tenant FK (indexes already exist)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'SequenceInstance_tenantId_fkey'
    AND table_name = 'sequence_instances'
  ) THEN
    ALTER TABLE "sequence_instances" ADD CONSTRAINT "SequenceInstance_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- RadarError: add tenant FK
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'RadarError_tenantId_fkey'
    AND table_name = 'radar_errors'
  ) THEN
    ALTER TABLE "radar_errors" ADD CONSTRAINT "RadarError_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- RadarContentLink: add tenant FK
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'RadarContentLink_tenantId_fkey'
    AND table_name = 'radar_content_links'
  ) THEN
    ALTER TABLE "radar_content_links" ADD CONSTRAINT "RadarContentLink_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE;
  END IF;
END $$;

-- Lead: add index
CREATE INDEX IF NOT EXISTS "Lead_tenantId_status_idx" ON "leads"("tenantId", "status");
