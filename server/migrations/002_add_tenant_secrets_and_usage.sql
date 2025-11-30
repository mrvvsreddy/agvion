-- Migration: Add tenant_secrets and tenant_usage tables
-- Version: 002
-- Description: Adds secure secrets storage and usage tracking for multi-tenant platform

-- ==================== TENANT_SECRETS TABLE ====================

-- Create tenant_secrets table for encrypted storage of ALL secret types
CREATE TABLE IF NOT EXISTS tenant_secrets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('tenant', 'workspace', 'agent')),
  scope_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openai', 'anthropic', 'google', 'slack', 'webhook', 'custom')),
  encrypted_value TEXT NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Ensure tenant_id references tenants table
  CONSTRAINT fk_tenant_secrets_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_tenant_id ON tenant_secrets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_scope ON tenant_secrets(scope, scope_id);
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_provider ON tenant_secrets(tenant_id, provider);
CREATE INDEX IF NOT EXISTS idx_tenant_secrets_created_at ON tenant_secrets(created_at DESC);

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tenant_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenant_secrets_updated_at
  BEFORE UPDATE ON tenant_secrets
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_secrets_updated_at();

-- ==================== TENANT_USAGE TABLE ====================

-- Create tenant_usage table for plan enforcement and usage tracking
CREATE TABLE IF NOT EXISTS tenant_usage (
  tenant_id TEXT PRIMARY KEY,
  jobs_this_month INT DEFAULT 0 NOT NULL,
  tokens_this_month BIGINT DEFAULT 0 NOT NULL,
  agents_created INT DEFAULT 0 NOT NULL,
  last_reset_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  
  -- Ensure tenant_id references tenants table
  CONSTRAINT fk_tenant_usage_tenant FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE,
  
  -- Ensure non-negative values
  CONSTRAINT chk_jobs_non_negative CHECK (jobs_this_month >= 0),
  CONSTRAINT chk_tokens_non_negative CHECK (tokens_this_month >= 0),
  CONSTRAINT chk_agents_non_negative CHECK (agents_created >= 0)
);

-- Create index for monthly reset operations
CREATE INDEX IF NOT EXISTS idx_tenant_usage_last_reset ON tenant_usage(last_reset_at);

-- Add trigger to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_tenant_usage_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_tenant_usage_updated_at
  BEFORE UPDATE ON tenant_usage
  FOR EACH ROW
  EXECUTE FUNCTION update_tenant_usage_updated_at();

-- ==================== INITIALIZE EXISTING TENANTS ====================

-- Create usage records for all existing tenants
INSERT INTO tenant_usage (tenant_id, jobs_this_month, tokens_this_month, agents_created, last_reset_at)
SELECT id, 0, 0, 0, now()
FROM tenants
ON CONFLICT (tenant_id) DO NOTHING;

-- ==================== COMMENTS ====================

COMMENT ON TABLE tenant_secrets IS 'Encrypted storage for all secret types (LLM API keys, OAuth tokens, webhooks, integrations)';
COMMENT ON COLUMN tenant_secrets.scope IS 'Secret scope: tenant (all workspaces), workspace (specific workspace), agent (specific agent)';
COMMENT ON COLUMN tenant_secrets.scope_id IS 'ID of the scoped entity (tenant_id, workspace_id, or agent_id)';
COMMENT ON COLUMN tenant_secrets.provider IS 'Secret provider type: openai, anthropic, google, slack, webhook, custom';
COMMENT ON COLUMN tenant_secrets.encrypted_value IS 'AES-256-GCM encrypted secret value (format: iv:authTag:ciphertext)';
COMMENT ON COLUMN tenant_secrets.metadata IS 'Additional metadata: {expiresAt, refreshToken, tokenType, lastRotated, etc.}';

COMMENT ON TABLE tenant_usage IS 'Usage tracking for plan enforcement and billing';
COMMENT ON COLUMN tenant_usage.jobs_this_month IS 'Number of agent job executions this billing month';
COMMENT ON COLUMN tenant_usage.tokens_this_month IS 'Total LLM tokens consumed this billing month';
COMMENT ON COLUMN tenant_usage.agents_created IS 'Total number of agents created (cumulative)';
COMMENT ON COLUMN tenant_usage.last_reset_at IS 'Timestamp of last monthly reset';

-- ==================== VERIFICATION QUERIES ====================

-- Uncomment these to verify the migration:
-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'tenant_secrets'
-- ORDER BY ordinal_position;

-- SELECT column_name, data_type, column_default 
-- FROM information_schema.columns 
-- WHERE table_name = 'tenant_usage'
-- ORDER BY ordinal_position;

-- SELECT COUNT(*) as tenant_count FROM tenant_usage;
