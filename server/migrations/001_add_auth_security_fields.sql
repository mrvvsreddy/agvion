-- Migration: Add security and billing fields to tenants and workspaces
-- Version: 001
-- Description: Adds status, plan, trial, and limits fields required for auth system security refactoring

-- ==================== TENANTS TABLE ====================

-- Add status field (for account suspension/banning)
ALTER TABLE tenants 
ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned'));

-- Add plan field (for subscription management)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS plan TEXT DEFAULT 'free' CHECK (plan IN ('free', 'pro', 'early', 'enterprise'));

-- Add trial expiry field (for trial period tracking)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

-- Add limits field (JSONB for flexible plan limits)
ALTER TABLE tenants
ADD COLUMN IF NOT EXISTS limits JSONB DEFAULT '{
  "maxAgents": 3,
  "maxWidgets": 5,
  "maxConcurrentJobs": 2,
  "maxMonthlyJobs": 100
}'::jsonb;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tenants_status ON tenants(status);
CREATE INDEX IF NOT EXISTS idx_tenants_plan ON tenants(plan);
CREATE INDEX IF NOT EXISTS idx_tenants_trial_ends_at ON tenants(trial_ends_at) WHERE trial_ends_at IS NOT NULL;

-- ==================== WORKSPACES TABLE ====================

-- Add status field (for workspace disable/read-only modes)
-- Note: If workspaces table doesn't have status field, add it
-- If it already exists, this will be skipped
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'workspaces' AND column_name = 'status'
  ) THEN
    ALTER TABLE workspaces 
    ADD COLUMN status TEXT DEFAULT 'active' CHECK (status IN ('active', 'read_only', 'disabled'));
    
    CREATE INDEX idx_workspaces_status ON workspaces(status);
  END IF;
END $$;

-- ==================== SET DEFAULT VALUES FOR EXISTING ROWS ====================

-- Set default status for existing tenants
UPDATE tenants SET status = 'active' WHERE status IS NULL;

-- Set default plan for existing tenants
UPDATE tenants SET plan = 'free' WHERE plan IS NULL;

-- Set default limits for existing tenants (if not already set)
UPDATE tenants 
SET limits = '{
  "maxAgents": 3,
  "maxWidgets": 5,
  "maxConcurrentJobs": 2,
  "maxMonthlyJobs": 100
}'::jsonb
WHERE limits IS NULL;

-- Set default status for existing workspaces
UPDATE workspaces SET status = 'active' WHERE status IS NULL OR status = '';

-- ==================== COMMENTS ====================

COMMENT ON COLUMN tenants.status IS 'Account status: active (normal), suspended (temporary block), banned (permanent block)';
COMMENT ON COLUMN tenants.plan IS 'Subscription plan: free, pro, early, enterprise';
COMMENT ON COLUMN tenants.trial_ends_at IS 'Trial period expiration timestamp. NULL = no trial or trial converted to paid';
COMMENT ON COLUMN tenants.limits IS 'JSONB object with plan limits: {maxAgents, maxWidgets, maxConcurrentJobs, maxMonthlyJobs}';
COMMENT ON COLUMN workspaces.status IS 'Workspace status: active (normal), read_only (view only), disabled (no access)';

-- ==================== VERIFICATION QUERIES ====================

-- Uncomment these to verify the migration:
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'tenants' AND column_name IN ('status', 'plan', 'trial_ends_at', 'limits');

-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'workspaces' AND column_name = 'status';

-- SELECT COUNT(*) as total_tenants, status, plan 
-- FROM tenants 
-- GROUP BY status, plan;
