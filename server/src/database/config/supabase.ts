// database/config/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import logger from '../../utils/logger';

// Load environment variables from .env file
config();

export interface Database {
  public: {
    Tables: {
      agents: {
        Row: {
          description: any;
          id: string;
          tenant_id: string;
          name: string;
          created_at: string;
          updated_at: string;
          workspace_id: string | null;
          status: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          created_at?: string;
          updated_at?: string;
          workspace_id?: string | null;
          status?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
          workspace_id?: string | null;
          status?: string;
        };
      };
      tenants: {
        Row: {
          id: string;
          name: string;
          created_at: string;
          updated_at: string;
          email: string;
          password_hash: string;
          first_name: string | null;
          last_name: string | null;
          email_verified: boolean | null;
          last_login: string | null;
          password_reset_token: string | null;
          password_reset_expires: string | null;
        };
        Insert: {
          id?: string;
          name: string;
          created_at?: string;
          updated_at?: string;
          email?: string;
          password_hash?: string;
          first_name?: string | null;
          last_name?: string | null;
          email_verified?: boolean | null;
          last_login?: string | null;
          password_reset_token?: string | null;
          password_reset_expires?: string | null;
        };
        Update: {
          id?: string;
          name?: string;
          created_at?: string;
          updated_at?: string;
          email?: string;
          password_hash?: string;
          first_name?: string | null;
          last_name?: string | null;
          email_verified?: boolean | null;
          last_login?: string | null;
          password_reset_token?: string | null;
          password_reset_expires?: string | null;
        };
      };
      users: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          password_hash: string;
          first_name: string;
          last_name: string | null;
          role: string;
          email_verified: boolean;
          email_verification_token: string | null;
          email_verification_expires: string | null;
          password_reset_token: string | null;
          password_reset_expires: string | null;
          last_login: string | null;
          login_attempts: number;
          locked_until: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          password_hash: string;
          first_name: string;
          last_name?: string | null;
          role: string;
          email_verified?: boolean;
          email_verification_token?: string | null;
          email_verification_expires?: string | null;
          password_reset_token?: string | null;
          password_reset_expires?: string | null;
          last_login?: string | null;
          login_attempts?: number;
          locked_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          password_hash?: string;
          first_name?: string;
          last_name?: string | null;
          role?: string;
          email_verified?: boolean;
          email_verification_token?: string | null;
          email_verification_expires?: string | null;
          password_reset_token?: string | null;
          password_reset_expires?: string | null;
          last_login?: string | null;
          login_attempts?: number;
          locked_until?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      workflows: {
        Row: {
          id: string;
          name: string;
          tenant_id: string;
          agent_id: string;
          workflow_data: any;
          status: string;
          workflow_version: string;
          settings: any;
          metadata: any;
          created_at: string;
          last_modified_at: string;
          last_modified_by: string;
        };
        Insert: {
          id?: string;
          name: string;
          tenant_id: string;
          agent_id: string;
          workflow_data: any;
          status: string;
          workflow_version?: string;
          settings?: any;
          metadata?: any;
          created_at?: string;
          last_modified_at?: string;
          last_modified_by?: string;
        };
        Update: {
          id?: string;
          name?: string;
          tenant_id?: string;
          agent_id?: string;
          workflow_data?: any;
          status?: string;
          workflow_version?: string;
          settings?: any;
          metadata?: any;
          created_at?: string;
          last_modified_at?: string;
          last_modified_by?: string;
        };
      };
      workflow_triggers: {
        Row: {
          id: string;
          workflow_id: string;
          trigger_type: string;
          trigger_value: string;
          routing_key: string;
          priority: number;
          conditions: any;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          trigger_type: string;
          trigger_value: string;
          routing_key: string;
          priority?: number;
          conditions?: any;
          active?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          workflow_id?: string;
          trigger_type?: string;
          trigger_value?: string;
          routing_key?: string;
          priority?: number;
          conditions?: any;
          active?: boolean;
          created_at?: string;
        };
      };
      workflow_executions: {
        Row: {
          id: string;
          workflow_id: string;
          status: string;
          ended_at: string | null;
          logs: any;
          started_at: string;
        };
        Insert: {
          id?: string;
          workflow_id: string;
          status: string;
          ended_at?: string | null;
          logs: any;
          started_at?: string;
        };
        Update: {
          id?: string;
          workflow_id?: string;
          status?: string;
          ended_at?: string | null;
          logs?: any;
          started_at?: string;
        };
      };
      messages: {
        Row: {
          id: string;
          conversation_id: string;
          sender: string;
          content: string;
          metadata: any;
          content_type: string;
          sent_at: string;
        };
        Insert: {
          id?: string;
          conversation_id: string;
          sender: string;
          content: string;
          metadata: any;
          content_type: string;
          sent_at?: string;
        };
        Update: {
          id?: string;
          conversation_id?: string;
          sender?: string;
          content?: string;
          metadata?: any;
          content_type?: string;
          sent_at?: string;
        };
      };
      conversations: {
        Row: {
          id: string;
          tenant_id: string;
          context_id: string;
          channel: string;
          ended_at: string | null;
          metadata: any;
          status: string;
          started_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          context_id: string;
          channel: string;
          ended_at?: string | null;
          metadata: any;
          status: string;
          started_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          context_id?: string;
          channel?: string;
          ended_at?: string | null;
          metadata?: any;
          status?: string;
          started_at?: string;
        };
      };
      credentials: {
        Row: {
          id: string;
          tenant_id: string;
          name: string;
          type: string;
          data: any;
          created_at: string;
          updated_at: string;
          agent_id: string | null;
          workspace_id: string | null;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          name: string;
          type: string;
          data: any;
          created_at?: string;
          updated_at?: string;
          agent_id?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          name?: string;
          type?: string;
          data?: any;
          created_at?: string;
          updated_at?: string;
          agent_id?: string | null;
          workspace_id?: string | null;
        };
      };
      contacts: {
        Row: {
          id: string;
          tenant_id: string;
          channel: string;
          contact_identifier: string;
          metadata: any;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          channel: string;
          contact_identifier: string;
          metadata: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          channel?: string;
          contact_identifier?: string;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
        };
      };
      agent_table_rows: {
        Row: {
          id: string;
          agent_id: string;
          table_id: string;
          row_data: any;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          table_id: string;
          row_data: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          table_id?: string;
          row_data?: any;
          created_at?: string;
          updated_at?: string;
        };
      };
      agent_tables: {
        Row: {
          id: string;
          agent_id: string;
          tenant_id: string;
          table_name: string;
          description: string | null;
          columns: any;
          type: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          tenant_id: string;
          table_name: string;
          description?: string | null;
          columns: any;
          type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          tenant_id?: string;
          table_name?: string;
          description?: string | null;
          columns?: any;
          type?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      agent_vector_data: {
        Row: {
          id: string;
          tenant_id: string | null;
          agent_id: string;
          table_id: string | null;
          chunk_index: number | null;
          content: string | null;
          embedding: number[] | null; // Supabase vector type represented as number[]
          metadata: any | null; // jsonb
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id?: string | null;
          agent_id: string;
          table_id?: string | null;
          chunk_index?: number | null;
          content?: string | null;
          embedding?: number[] | null;
          metadata?: any | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string | null;
          agent_id?: string;
          table_id?: string | null;
          chunk_index?: number | null;
          content?: string | null;
          embedding?: number[] | null;
          metadata?: any | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      email_verification_codes: {
        Row: {
          id: string;
          email: string;
          code: string;
          type: string; // 'signup' | 'password_reset'
          expires_at: string;
          attempts: number;
          verified: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          email: string;
          code: string;
          type: string;
          expires_at: string;
          attempts?: number;
          verified?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string;
          code?: string;
          type?: string;
          expires_at?: string;
          attempts?: number;
          verified?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      workspaces: {
        Row: {
          id: string;
          tenant_id: string;
          email: string;
          name: string;
          slug: string;
          description: string | null;
          status: string;
          created_at: string;
          updated_at: string;
          metadata: any;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          email: string;
          name: string;
          slug: string;
          description?: string | null;
          status?: string;
          created_at?: string;
          updated_at?: string;
          metadata?: any;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          email?: string;
          name?: string;
          slug?: string;
          description?: string | null;
          status?: string;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
        };
      };
      workspace_usage: {
        Row: {
          id: string;
          workspace_id: string;
          period_start: string;
          period_end: string;
          total_agents: number;
          total_workflows: number;
          workflow_executions: number;
          compute_seconds: number;
          storage_bytes: number;
          api_calls: number;
          cost_usd: number | null;
          metadata: any | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          period_start: string;
          period_end: string;
          total_agents?: number;
          total_workflows?: number;
          workflow_executions?: number;
          compute_seconds?: number;
          storage_bytes?: number;
          api_calls?: number;
          cost_usd?: number | null;
          metadata?: any | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          period_start?: string;
          period_end?: string;
          total_agents?: number;
          total_workflows?: number;
          workflow_executions?: number;
          compute_seconds?: number;
          storage_bytes?: number;
          api_calls?: number;
          cost_usd?: number | null;
          metadata?: any | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      agent_flows: {
        Row: {
          knowledge_tables: any;
          id: string;
          agent_id: string;
          tenant_id: string;
          name: string;
          description: string | null;
          is_default: boolean;
          workflow_data: any;
          version: number;
          status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          agent_id: string;
          tenant_id: string;
          name: string;
          description?: string | null;
          is_default?: boolean;
          workflow_data: any;
          version?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          agent_id?: string;
          tenant_id?: string;
          name?: string;
          description?: string | null;
          is_default?: boolean;
          workflow_data?: any;
          version?: number;
          status?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
      integrations: {
        Row: {
          id: string;
          channel: string;
          status: string;
          config: any;
          metadata: any;
          created_at: string;
          updated_at: string;
          version: string;
          latest_version: string;
          update_available: boolean;
        };
        Insert: {
          id?: string;
          channel: string;
          status: string;
          config?: any;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
          version?: string;
          latest_version?: string;
          update_available?: boolean;
        };
        Update: {
          id?: string;
          channel?: string;
          status?: string;
          config?: any;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
          version?: string;
          latest_version?: string;
          update_available?: boolean;
        };
      };
      agent_integrations: {
        Row: {
          id: string;
          agent_id: string;
          channel: string;
          config: any;
          webhook_url: string;
          is_enabled: boolean;
          created_at: string;
          updated_at: string;
          workflow_id: string;
          integration_id: string | null;
          installed_version: string | null;
          latest_version: string | null;
          update_available: boolean;
          metadata: any | null;
        };
        Insert: {
          id?: string;
          agent_id: string;
          channel: string;
          config?: any;
          webhook_url?: string;
          is_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
          workflow_id?: string;
          integration_id?: string | null;
          installed_version?: string | null;
          latest_version?: string | null;
          update_available?: boolean;
          metadata?: any | null;
        };
        Update: {
          id?: string;
          agent_id?: string;
          channel?: string;
          config?: any;
          webhook_url?: string;
          is_enabled?: boolean;
          created_at?: string;
          updated_at?: string;
          workflow_id?: string;
          integration_id?: string | null;
          installed_version?: string | null;
          latest_version?: string | null;
          update_available?: boolean;
          metadata?: any | null;
        };
      };
      workspace_settings: {
        Row: {
          id: string;
          workspace_id: string;
          max_agents: number | null;
          max_workflows_per_workspace: number | null;
          max_concurrent_executions: number | null;
          default_timeout_seconds: number | null;
          retention_days: number | null;
          notification_settings: any | null;
          feature_flags: any | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          workspace_id: string;
          max_agents?: number | null;
          max_workflows_per_workspace?: number | null;
          max_concurrent_executions?: number | null;
          default_timeout_seconds?: number | null;
          retention_days?: number | null;
          notification_settings?: any | null;
          feature_flags?: any | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          workspace_id?: string;
          max_agents?: number | null;
          max_workflows_per_workspace?: number | null;
          max_concurrent_executions?: number | null;
          default_timeout_seconds?: number | null;
          retention_days?: number | null;
          notification_settings?: any | null;
          feature_flags?: any | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      tenant_secrets: {
        Row: {
          id: string;
          tenant_id: string;
          scope: 'tenant' | 'workspace' | 'agent';
          scope_id: string;
          provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
          encrypted_value: string;
          metadata: any;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          tenant_id: string;
          scope: 'tenant' | 'workspace' | 'agent';
          scope_id: string;
          provider: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
          encrypted_value: string;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          tenant_id?: string;
          scope?: 'tenant' | 'workspace' | 'agent';
          scope_id?: string;
          provider?: 'openai' | 'anthropic' | 'google' | 'slack' | 'webhook' | 'custom';
          encrypted_value?: string;
          metadata?: any;
          created_at?: string;
          updated_at?: string;
        };
      };
      tenant_usage: {
        Row: {
          tenant_id: string;
          jobs_this_month: number;
          tokens_this_month: number;
          agents_created: number;
          last_reset_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          tenant_id: string;
          jobs_this_month?: number;
          tokens_this_month?: number;
          agents_created?: number;
          last_reset_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          tenant_id?: string;
          jobs_this_month?: number;
          tokens_this_month?: number;
          agents_created?: number;
          last_reset_at?: string;
          created_at?: string;
          updated_at?: string;
        };
      };
    };
  };
}

class SupabaseService {
  private static instance: SupabaseService;
  private client: SupabaseClient<Database>;

  private constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.');
    }

    this.client = createClient<Database>(supabaseUrl, supabaseKey, {
      auth: {
        persistSession: false,
      },
      db: {
        schema: 'public',
      },
    });

    logger.info('Supabase client initialized');
  }

  public static getInstance(): SupabaseService {
    if (!SupabaseService.instance) {
      SupabaseService.instance = new SupabaseService();
    }
    return SupabaseService.instance;
  }

  public getClient(): SupabaseClient<Database> {
    return this.client;
  }

  /**
   * Set the current tenant context for RLS policies
   * This must be called before any database operations that need tenant isolation
   * 
   * Requires a PostgreSQL function to be created:
   * CREATE OR REPLACE FUNCTION set_current_tenant(p_tenant_id text)
   * RETURNS void AS $$
   * BEGIN
   *   PERFORM set_config('app.current_tenant', p_tenant_id, false);
   * END;
   * $$ LANGUAGE plpgsql SECURITY DEFINER;
   * 
   * @param tenantId - The tenant ID to set as the current tenant
   */
  public async setTenantContext(tenantId: string): Promise<void> {
    if (!tenantId || typeof tenantId !== 'string') {
      logger.warn('Invalid tenantId provided to setTenantContext', { tenantId });
      return;
    }

    try {
      // Try to use RPC function to set the session variable
      const { error } = await this.client.rpc('set_current_tenant', {
        p_tenant_id: tenantId
      } as any);

      if (error) {
        // If RPC function doesn't exist, log a warning
        // The RLS policy will still work, but we need to ensure tenant_id is in WHERE clauses
        logger.warn('Failed to set tenant context via RPC - ensure set_current_tenant function exists', {
          tenantId: tenantId.substring(0, 8),
          error: error.message,
          hint: 'Create PostgreSQL function: CREATE OR REPLACE FUNCTION set_current_tenant(p_tenant_id text) RETURNS void AS $$ BEGIN PERFORM set_config(\'app.current_tenant\', p_tenant_id, false); END; $$ LANGUAGE plpgsql SECURITY DEFINER;'
        });
      } else {
        logger.debug('Tenant context set successfully', { tenantId: tenantId.substring(0, 8) });
      }
    } catch (error) {
      logger.warn('Error setting tenant context', {
        tenantId: tenantId.substring(0, 8),
        error: error instanceof Error ? error.message : String(error)
      });
      // Don't throw - application layer will handle tenant filtering as fallback
    }
  }

  public async testConnection(): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('id')
        .limit(1);

      if (error) {
        logger.error('Database connection test failed', { error });
        return false;
      }

      logger.info('Database connection test successful');
      return true;
    } catch (error) {
      logger.error('Database connection test failed', { error });
      return false;
    }
  }
}

export default SupabaseService;