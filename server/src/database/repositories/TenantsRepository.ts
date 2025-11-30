// database/repositories/TenantsRepository.ts
import { BaseRepository } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type Tenant = Database['public']['Tables']['tenants']['Row'];
type TenantInsert = Database['public']['Tables']['tenants']['Insert'];
type TenantUpdate = Database['public']['Tables']['tenants']['Update'];

export class TenantsRepository extends BaseRepository<Tenant, TenantInsert, TenantUpdate> {
  constructor() {
    super('tenants');
  }

  // ==================== Tenant-based auth helpers ====================

  async findTenantByEmail(email: string): Promise<Tenant | null> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('*')
        .eq('email', email.toLowerCase())
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to find tenant by email', { error, email });
        throw new Error(`Failed to find tenant by email: ${error.message}`);
      }

      return data as any;
    } catch (error) {
      logger.error('Error finding tenant by email', { error, email });
      throw error;
    }
  }

  async createTenant(tenantData: {
    id: string;
    name: string;
    email: string;
    password_hash: string;
    email_verified?: boolean;
  }): Promise<Tenant> {
    try {
      const insertData: TenantInsert & Partial<Tenant> = {
        id: tenantData.id,
        name: tenantData.name,
        email: tenantData.email.toLowerCase(),
        password_hash: tenantData.password_hash,
        email_verified: tenantData.email_verified ?? false,
        workspace_count: 0,
        total_agents: 0,
        total_workflows: 0,
        metadata: {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      } as any;

      const { data, error } = await this.client
        .from('tenants')
        .insert(insertData)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to create tenant', { error, email: tenantData.email });
        throw new Error(`Failed to create tenant: ${error.message}`);
      }

      logger.info('Tenant created successfully', { tenantId: (data as any).id, email: (data as any).email });
      return data as any;
    } catch (error) {
      logger.error('Failed to create tenant', { error, email: tenantData.email });
      throw error;
    }
  }

  async markTenantEmailAsVerified(tenantId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({
          email_verified: true,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to mark tenant email as verified', { error, tenantId });
        throw new Error(`Failed to mark tenant email as verified: ${error.message}`);
      }

      return !!data;
    } catch (error) {
      logger.error('Failed to mark tenant email as verified', { error, tenantId });
      throw error;
    }
  }

  async updateTenantPassword(tenantId: string, passwordHash: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({
          password_hash: passwordHash,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update tenant password', { error, tenantId });
        throw new Error(`Failed to update tenant password: ${error.message}`);
      }

      return !!data;
    } catch (error) {
      logger.error('Failed to update tenant password', { error, tenantId });
      throw error;
    }
  }


  // ==================== New fields helpers ====================
  async updateTenantCounts(
    tenantId: string,
    counts: { workspace_count?: number; total_agents?: number; total_workflows?: number }
  ): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({
          ...counts,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update tenant counts', { error, tenantId, counts });
        throw new Error(`Failed to update tenant counts: ${error.message}`);
      }

      return !!data;
    } catch (error) {
      logger.error('Failed to update tenant counts', { error, tenantId, counts });
      throw error;
    }
  }

  async updateTenantMetadata(tenantId: string, metadata: any): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({
          metadata,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update tenant metadata', { error, tenantId });
        throw new Error(`Failed to update tenant metadata: ${error.message}`);
      }

      return !!data;
    } catch (error) {
      logger.error('Failed to update tenant metadata', { error, tenantId });
      throw error;
    }
  }

  async updateTenantLastLogin(tenantId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({ last_login: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update tenant last login', { error, tenantId });
        throw new Error(`Failed to update tenant last login: ${error.message}`);
      }

      return !!data;
    } catch (error) {
      logger.error('Failed to update tenant last login', { error, tenantId });
      throw error;
    }
  }

  async findTenantById(tenantId: string): Promise<Tenant | null> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('*')
        .eq('id', tenantId)
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to get tenant by id', { error, tenantId });
        throw new Error(`Failed to get tenant by id: ${error.message}`);
      }

      return data as any;
    } catch (error) {
      logger.error('Error getting tenant by id', { error, tenantId });
      throw error;
    }
  }

  // ==================== Status & Plan Management ====================

  async updateTenantStatus(tenantId: string, status: 'active' | 'suspended' | 'banned'): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({
          status,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update tenant status', { error, tenantId, status });
        throw new Error(`Failed to update tenant status: ${error.message}`);
      }

      logger.info('Tenant status updated', { tenantId, status });
      return !!data;
    } catch (error) {
      logger.error('Failed to update tenant status', { error, tenantId, status });
      throw error;
    }
  }

  async updateTenantPlan(
    tenantId: string,
    plan: 'free' | 'pro' | 'early' | 'enterprise',
    limits?: {
      maxAgents?: number;
      maxWidgets?: number;
      maxConcurrentJobs?: number;
      maxMonthlyJobs?: number;
    }
  ): Promise<boolean> {
    try {
      const updateData: any = {
        plan,
        updated_at: new Date().toISOString()
      };

      if (limits) {
        updateData.limits = limits;
      }

      const { data, error } = await this.client
        .from('tenants')
        .update(updateData)
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update tenant plan', { error, tenantId, plan });
        throw new Error(`Failed to update tenant plan: ${error.message}`);
      }

      logger.info('Tenant plan updated', { tenantId, plan, limits });
      return !!data;
    } catch (error) {
      logger.error('Failed to update tenant plan', { error, tenantId, plan });
      throw error;
    }
  }

  async setTrialExpiry(tenantId: string, expiryDate: Date | null): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .update({
          trial_ends_at: expiryDate ? expiryDate.toISOString() : null,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to set trial expiry', { error, tenantId, expiryDate });
        throw new Error(`Failed to set trial expiry: ${error.message}`);
      }

      logger.info('Trial expiry set', { tenantId, expiryDate });
      return !!data;
    } catch (error) {
      logger.error('Failed to set trial expiry', { error, tenantId, expiryDate });
      throw error;
    }
  }

  async getTenantLimits(tenantId: string): Promise<{
    maxAgents: number;
    maxWidgets: number;
    maxConcurrentJobs: number;
    maxMonthlyJobs: number;
  } | null> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('limits')
        .eq('id', tenantId)
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to get tenant limits', { error, tenantId });
        throw new Error(`Failed to get tenant limits: ${error.message}`);
      }

      return (data as any)?.limits || null;
    } catch (error) {
      logger.error('Error getting tenant limits', { error, tenantId });
      throw error;
    }
  }

  /**
   * Validates if a tenant is active and can perform operations.
   * Checks: status is 'active' AND trial hasn't expired (if trial_ends_at is set)
   * @returns true if tenant is active and operational, false otherwise
   */
  async validateTenantActive(tenantId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('status, trial_ends_at')
        .eq('id', tenantId)
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          logger.warn('Tenant not found during validation', { tenantId });
          return false;
        }
        logger.error('Failed to validate tenant active', { error, tenantId });
        throw new Error(`Failed to validate tenant active: ${error.message}`);
      }

      const tenant = data as any;

      // Check status
      if (tenant.status !== 'active') {
        logger.info('Tenant validation failed: not active', { tenantId, status: tenant.status });
        return false;
      }

      // Check trial expiry if trial_ends_at is set
      if (tenant.trial_ends_at) {
        const trialEndsAt = new Date(tenant.trial_ends_at);
        if (trialEndsAt < new Date()) {
          logger.info('Tenant validation failed: trial expired', { tenantId, trialEndsAt });
          return false;
        }
      }

      return true;
    } catch (error) {
      logger.error('Error validating tenant active', { error, tenantId });
      throw error;
    }
  }

  // Removed reset token helpers due to schema change

  async findByName(name: string): Promise<Tenant | null> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('*')
        .eq('name', name)
        .single();

      if (error) {
        if (error.code === 'PGRST116') {
          return null;
        }
        logger.error('Failed to find tenant by name', { error, name });
        throw new Error(`Failed to find tenant by name: ${error.message}`);
      }

      return data;
    } catch (error) {
      logger.error('Error finding tenant by name', { error, name });
      throw error;
    }
  }

  async getTenantStats(tenantId: string): Promise<{
    agentsCount: number;
    workflowsCount: number;
    credentialsCount: number;
    usersCount: number;
    conversationsCount: number;
    contactsCount: number;
  }> {
    try {
      const [agents, workflows, credentials] = await Promise.all([
        this.client.from('agents').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        this.client.from('workflows').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
        this.client.from('credentials').select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId),
      ]);

      return {
        agentsCount: agents.count || 0,
        workflowsCount: workflows.count || 0,
        credentialsCount: credentials.count || 0,
        // The following counts are placeholders to satisfy the expected type shape.
        // If corresponding tables exist, these can be replaced with real queries.
        usersCount: 0,
        conversationsCount: 0,
        contactsCount: 0,
      };
    } catch (error) {
      logger.error('Error getting tenant stats', { error, tenantId });
      throw error;
    }
  }

  async getTenantWithDetails(tenantId: string): Promise<{
    tenant: Tenant;
    stats: {
      usersCount: number;
      workflowsCount: number;
      conversationsCount: number;
      credentialsCount: number;
      contactsCount: number;
    };
  } | null> {
    try {
      const tenant = await this.findById(tenantId);
      if (!tenant) {
        return null;
      }

      const stats = await this.getTenantStats(tenantId);

      return {
        tenant,
        stats,
      };
    } catch (error) {
      logger.error('Error getting tenant with details', { error, tenantId });
      throw error;
    }
  }

  async deleteWithCascade(tenantId: string): Promise<boolean> {
    try {
      // Note: In a production environment, you should handle cascade deletes
      // either through database constraints or by explicitly deleting related records

      // For now, we'll just delete the tenant
      // The database should handle cascade deletes if foreign key constraints are set up properly
      return await this.delete(tenantId);
    } catch (error) {
      logger.error('Error deleting tenant with cascade', { error, tenantId });
      throw error;
    }
  }

  async searchTenants(searchTerm: string): Promise<Tenant[]> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('*')
        .ilike('name', `%${searchTerm}%`)
        .order('created_at', { ascending: false });

      if (error) {
        logger.error('Failed to search tenants', { error, searchTerm });
        throw new Error(`Failed to search tenants: ${error.message}`);
      }

      return data;
    } catch (error) {
      logger.error('Error searching tenants', { error, searchTerm });
      throw error;
    }
  }

  async getRecentTenants(limit: number = 10): Promise<Tenant[]> {
    try {
      const { data, error } = await this.client
        .from('tenants')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        logger.error('Failed to get recent tenants', { error, limit });
        throw new Error(`Failed to get recent tenants: ${error.message}`);
      }

      return data;
    } catch (error) {
      logger.error('Error getting recent tenants', { error, limit });
      throw error;
    }
  }
}

export default new TenantsRepository();