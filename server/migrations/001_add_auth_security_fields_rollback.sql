-- Rollback Migration: Remove security and billing fields from tenants and workspaces
-- Version: 001
-- Description: Rollback script for auth system security refactoring

-- ==================== DROP INDEXES ====================

DROP INDEX IF EXISTS idx_tenants_status;
DROP INDEX IF EXISTS idx_tenants_plan;
DROP INDEX IF EXISTS idx_tenants_trial_ends_at;
DROP INDEX IF EXISTS idx_workspaces_status;

-- ==================== REMOVE COLUMNS ====================

-- Remove columns from tenants table
ALTER TABLE tenants DROP COLUMN IF EXISTS status;
ALTER TABLE tenants DROP COLUMN IF EXISTS plan;
ALTER TABLE tenants DROP COLUMN IF EXISTS trial_ends_at;
ALTER TABLE tenants DROP COLUMN IF EXISTS limits;

-- Remove status column from workspaces (only if it was added by this migration)
-- NOTE: If workspaces.status existed before this migration, DO NOT DROP IT
-- Manually verify before running this rollback!

-- ALTER TABLE workspaces DROP COLUMN IF EXISTS status;

-- ==================== VERIFICATION ====================

-- Verify rollback:
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'tenants';
-- SELECT column_name FROM information_schema.columns WHERE table_name = 'workspaces';
