# Database Migrations

This directory contains SQL migration scripts for the auth system security refactoring.

## Migration Files

### 001_add_auth_security_fields.sql
**Purpose:** Adds security and billing fields required for production-ready auth system

**Changes:**
- Adds `status` field to `tenants` table (active | suspended | banned)
- Adds `plan` field to `tenants` table (free | pro | early | enterprise)
- Adds `trial_ends_at` field to `tenants` table (timestamptz, nullable)
- Adds `limits` JSONB field to `tenants` table with default limits
- Adds `status` field to `workspaces` table (active | read_only | disabled)
- Creates indexes for performance
- Sets default values for existing rows

**Rollback:** Use `001_add_auth_security_fields_rollback.sql`

## Running Migrations

### Option 1: Using Supabase CLI
```bash
# If using Supabase, run migrations with:
supabase db reset
# Or apply specific migration:
psql -h <host> -U <user> -d <database> -f migrations/001_add_auth_security_fields.sql
```

### Option 2: Direct PostgreSQL
```bash
# Connect to your database
psql -h localhost -U postgres -d agvion_mvp

# Run migration
\i ./migrations/001_add_auth_security_fields.sql

# Verify
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'tenants' AND column_name IN ('status', 'plan', 'trial_ends_at', 'limits');
```

### Option 3: Using Node.js
```typescript
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const migrationSQL = fs.readFileSync('./migrations/001_add_auth_security_fields.sql', 'utf8');

// Note: Supabase doesn't expose raw SQL execution via JS client
// You'll need to use the Supabase dashboard SQL editor or psql
```

## Rollback Instructions

If you need to rollback the migration:

```bash
psql -h <host> -U <user> -d <database> -f migrations/001_add_auth_security_fields_rollback.sql
```

**⚠️ WARNING:** Rollback will DELETE all data in the new columns. Only rollback if absolutely necessary.

## Verification

After running the migration, verify the changes:

```sql
-- Check tenants table structure
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'tenants' 
AND column_name IN ('status', 'plan', 'trial_ends_at', 'limits')
ORDER BY column_name;

-- Check workspaces table structure
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns 
WHERE table_name = 'workspaces' 
AND column_name = 'status';

-- Verify data
SELECT id, email, status, plan, trial_ends_at, limits 
FROM tenants 
LIMIT 5;

SELECT id, name, status 
FROM workspaces 
LIMIT 5;
```

## Future Migrations

### Planned: tenant_usage table
For real-time usage tracking and limits enforcement:

```sql
CREATE TABLE tenant_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  agents_created INTEGER DEFAULT 0,
  widgets_created INTEGER DEFAULT 0,
  jobs_executed INTEGER DEFAULT 0,
  tokens_used BIGINT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, period_start)
);

CREATE INDEX idx_tenant_usage_tenant_period ON tenant_usage(tenant_id, period_start DESC);
```

This will enable real `checkPlanLimits()` implementation.
