// database/repositories/WorkspacesRepository.ts
import { BaseRepository, PaginationOptions, PaginatedResult } from './BaseRepository';
import { Database } from '../config/supabase';
import logger from '../../utils/logger';

type Workspace = Database['public']['Tables']['workspaces']['Row'];
type WorkspaceInsert = Database['public']['Tables']['workspaces']['Insert'];
type WorkspaceUpdate = Database['public']['Tables']['workspaces']['Update'];

export class WorkspacesRepository extends BaseRepository<Workspace, WorkspaceInsert, WorkspaceUpdate> {
  constructor() {
    super('workspaces');
  }

  async createWorkspace(data: {
    id: string;
    tenant_id: string;
    email: string;
    name: string;
    slug: string;
    description?: string | null;
    status?: string;
    metadata?: any;
  }): Promise<Workspace> {
    const payload: WorkspaceInsert = {
      id: data.id,
      tenant_id: data.tenant_id,
      email: data.email.toLowerCase(),
      name: data.name,
      slug: data.slug,
      description: data.description ?? null,
      status: data.status ?? 'active',
      metadata: data.metadata ?? {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    return await this.create(payload);
  }

  async findByTenant(tenantId: string, options: PaginationOptions = {}): Promise<PaginatedResult<Workspace>> {
    try {
      const { page = 1, limit = 50, orderBy = 'created_at', orderDirection = 'desc' } = options;
      const from = (page - 1) * limit;
      const to = from + limit - 1;

      const { count } = await this.client
        .from('workspaces')
        .select('*', { count: 'exact', head: true })
        .eq('tenant_id', tenantId);

      const { data, error } = await this.client
        .from('workspaces')
        .select('*')
        .eq('tenant_id', tenantId)
        .order(orderBy, { ascending: orderDirection === 'asc' })
        .range(from, to);

      if (error) {
        logger.error('Failed to find workspaces by tenant', { error, tenantId, options });
        throw new Error(`Failed to find workspaces by tenant: ${error.message}`);
      }

      const totalCount = count || 0;
      const totalPages = Math.ceil(totalCount / limit);

      return { data: data as Workspace[], totalCount, page, limit, totalPages };
    } catch (error) {
      logger.error('Error finding workspaces by tenant', { error, tenantId, options });
      throw error;
    }
  }

  async findById(id: string): Promise<Workspace | null> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .select('*')
        .eq('id', id)
        .maybeSingle();

      if (error) {
        logger.error('Failed to find workspace by id', { error, id });
        throw new Error(`Failed to find workspace by id: ${error.message}`);
      }

      return (data as Workspace) ?? null;
    } catch (error) {
      logger.error('Error finding workspace by id', { error, id });
      throw error;
    }
  }

  async findBySlug(tenantId: string, slug: string): Promise<Workspace | null> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('slug', slug)
        .maybeSingle();

      if (error) {
        logger.error('Failed to find workspace by slug', { error, tenantId, slug });
        throw new Error(`Failed to find workspace by slug: ${error.message}`);
      }

      return (data as Workspace) ?? null;
    } catch (error) {
      logger.error('Error finding workspace by slug', { error, tenantId, slug });
      throw error;
    }
  }

  async updateStatus(id: string, status: string): Promise<Workspace> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update workspace status', { error, id, status });
        throw new Error(`Failed to update workspace status: ${error.message}`);
      }

      return data as Workspace;
    } catch (error) {
      logger.error('Error updating workspace status', { error, id, status });
      throw error;
    }
  }

  async updateMetadata(id: string, metadata: any): Promise<Workspace> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .update({ metadata, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        logger.error('Failed to update workspace metadata', { error, id, metadata });
        throw new Error(`Failed to update workspace metadata: ${error.message}`);
      }

      return data as Workspace;
    } catch (error) {
      logger.error('Error updating workspace metadata', { error, id, metadata });
      throw error;
    }
  }

  async getWorkspacesByTenant(tenantId: string): Promise<Workspace[]> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .select('*')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to get workspaces by tenant', { error, tenantId });
        throw new Error(`Failed to get workspaces by tenant: ${error.message}`);
      }

      return data as Workspace[];
    } catch (error) {
      logger.error('Error getting workspaces by tenant', { error, tenantId });
      throw error;
    }
  }

  // ==================== Workspace Validation & Authorization ====================

  /**
   * Validates if a workspace is active and can be used.
   * IMPORTANT: Queries Postgres directly, never trusts Redis cache.
   * @returns true if workspace status is 'active', false otherwise
   */
  async validateWorkspaceActive(workspaceId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .select('status')
        .eq('id', workspaceId)
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          logger.warn('Workspace not found during validation', { workspaceId });
          return false;
        }
        logger.error('Failed to validate workspace active', { error, workspaceId });
        throw new Error(`Failed to validate workspace active: ${error.message}`);
      }

      const workspace = data as any;

      if (workspace.status !== 'active') {
        logger.info('Workspace validation failed: not active', { workspaceId, status: workspace.status });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error validating workspace active', { error, workspaceId });
      throw error;
    }
  }

  /**
   * CRITICAL: Validates workspace ownership by querying Postgres directly.
   * NEVER trust Redis cache for authorization decisions.
   * 
   * SQL: SELECT 1 FROM workspaces WHERE id = $workspaceId AND tenant_id = $tenantId LIMIT 1
   * 
   * @param workspaceId - The workspace ID to validate
   * @param tenantId - The tenant ID claiming ownership
   * @returns true if workspace belongs to tenant, false otherwise
   */
  async validateWorkspaceOwnership(workspaceId: string, tenantId: string): Promise<boolean> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .select('id')
        .eq('id', workspaceId)
        .eq('tenant_id', tenantId)
        .single();

      if (error) {
        if ((error as any).code === 'PGRST116') {
          logger.warn('Workspace ownership validation failed: not found or wrong owner', { workspaceId, tenantId });
          return false;
        }
        logger.error('Failed to validate workspace ownership', { error, workspaceId, tenantId });
        throw new Error(`Failed to validate workspace ownership: ${error.message}`);
      }

      // If we got data, the workspace exists and belongs to the tenant
      return !!data;
    } catch (error) {
      logger.error('Error validating workspace ownership', { error, workspaceId, tenantId });
      throw error;
    }
  }

  /**
   * Get only active workspaces for a tenant
   * @param tenantId - The tenant ID
   * @returns Array of active workspaces
   */
  async listActiveWorkspaces(tenantId: string): Promise<Workspace[]> {
    try {
      const { data, error } = await this.client
        .from('workspaces')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('status', 'active')
        .order('created_at', { ascending: true });

      if (error) {
        logger.error('Failed to list active workspaces', { error, tenantId });
        throw new Error(`Failed to list active workspaces: ${error.message}`);
      }

      return data as Workspace[];
    } catch (error) {
      logger.error('Error listing active workspaces', { error, tenantId });
      throw error;
    }
  }
}

export default new WorkspacesRepository();


