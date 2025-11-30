-- Rollback Migration: Remove tenant_secrets and tenant_usage tables
-- Version: 002
-- Description: Rollback script to remove tenant_secrets and tenant_usage tables

-- Drop triggers first
DROP TRIGGER IF EXISTS trigger_tenant_secrets_updated_at ON tenant_secrets;
DROP TRIGGER IF EXISTS trigger_tenant_usage_updated_at ON tenant_usage;

-- Drop functions
DROP FUNCTION IF EXISTS update_tenant_secrets_updated_at();
DROP FUNCTION IF EXISTS update_tenant_usage_updated_at();

-- Drop tables (CASCADE will drop dependent foreign keys)
DROP TABLE IF EXISTS tenant_secrets CASCADE;
DROP TABLE IF EXISTS tenant_usage CASCADE;
