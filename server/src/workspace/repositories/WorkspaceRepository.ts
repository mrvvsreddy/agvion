import { WorkspacesRepository } from '../../database/repositories/WorkspacesRepository';
import { AgentsRepository } from '../../database/repositories/AgentsRepository';
import { Database } from '../../database/config/supabase';
import { Workspace, CreateWorkspaceRequest, Agent, UserWorkspaceAccess, WorkspaceMetadata } from '../types';
import { WorkspaceAccessError, WorkspaceNotFoundError } from '../errors/WorkspaceErrors';
import logger from '../../utils/logger';

type DbWorkspace = Database['public']['Tables']['workspaces']['Row'];

export class WorkspaceRepository {
  private workspacesRepo: WorkspacesRepository;
  private agentsRepo: AgentsRepository;

  constructor() {
    this.workspacesRepo = new WorkspacesRepository();
    this.agentsRepo = new AgentsRepository();
  }

  async createWorkspace(request: CreateWorkspaceRequest): Promise<Workspace> {
    const db = await this.workspacesRepo.createWorkspace({
      id: request.id,
      tenant_id: request.tenantId,
      email: request.email,
      name: request.name,
      slug: request.slug,
      description: request.description ?? null,
      status: request.status ?? 'active',
    });
    return this.mapDb(db);
  }

  async getWorkspaceBySlug(tenantId: string, slug: string): Promise<Workspace | null> {
    const db = await this.workspacesRepo.findBySlug(tenantId, slug);
    return db ? this.mapDb(db) : null;
  }

  async listWorkspaces(tenantId: string, page: number = 1, limit: number = 50): Promise<{ data: Workspace[]; page: number; limit: number; total: number; totalPages: number; }> {
    const result = await this.workspacesRepo.findByTenant(tenantId, { page, limit });
    return {
      data: result.data.map(w => this.mapDb(w)),
      page: result.page,
      limit: result.limit,
      total: result.totalCount,
      totalPages: result.totalPages,
    };
  }

  async getFirstWorkspaceByTenant(tenantId: string): Promise<Workspace | null> {
    const result = await this.workspacesRepo.findByTenant(tenantId, { page: 1, limit: 1, orderBy: 'created_at', orderDirection: 'desc' as any });
    const first = result.data?.[0];
    if (!first) return null;
    
    const workspace = this.mapDb(first as DbWorkspace);
    return await this.enrichWorkspaceWithAgents(workspace);
  }

  async getWorkspaceWithAgents(workspaceId: string): Promise<Workspace | null> {
    const db = await this.workspacesRepo.findById(workspaceId);
    if (!db) return null;
    
    const workspace = this.mapDb(db);
    return await this.enrichWorkspaceWithAgents(workspace);
  }


  async updateWorkspaceMetadata(workspaceId: string, metadata: any): Promise<Workspace | null> {
    const updatedDb = await this.workspacesRepo.updateMetadata(workspaceId, metadata);
    if (!updatedDb) return null;
    
    const workspace = this.mapDb(updatedDb);
    return await this.enrichWorkspaceWithAgents(workspace);
  }

  /**
   * Verify that a user has access to a specific workspace
   * This is a critical security check to prevent unauthorized access
   */
  async verifyUserWorkspaceAccess(userId: string, workspaceId: string, tenantId: string): Promise<UserWorkspaceAccess> {
    try {
      logger.info('Verifying user workspace access', { userId, workspaceId, tenantId });

      // First, verify the workspace exists and belongs to the tenant
      const workspace = await this.workspacesRepo.findById(workspaceId);
      if (!workspace) {
        logger.warn('Workspace not found during access verification', { workspaceId, userId });
        throw new WorkspaceNotFoundError(workspaceId, { userId, tenantId });
      }

      if (workspace.tenant_id !== tenantId) {
        logger.warn('Workspace tenant mismatch during access verification', { 
          workspaceId, 
          userId, 
          workspaceTenantId: workspace.tenant_id,
          userTenantId: tenantId 
        });
        throw new WorkspaceAccessError('Workspace does not belong to user tenant', {
          workspaceId,
          userId,
          tenantId
        });
      }

      // For now, we assume all users in the same tenant have access to all workspaces
      // In a more complex system, you might check user_workspace_memberships table
      // or similar role-based access control
      
      const access: UserWorkspaceAccess = {
        userId,
        workspaceId,
        tenantId,
        hasAccess: true,
        accessLevel: 'member' // Default access level
      };

      logger.info('User workspace access verified', { userId, workspaceId, accessLevel: access.accessLevel });
      return access;

    } catch (error) {
      if (error instanceof WorkspaceAccessError || error instanceof WorkspaceNotFoundError) {
        throw error;
      }
      
      logger.error('Error verifying user workspace access', { 
        error: error instanceof Error ? error.message : 'Unknown error',
        userId, 
        workspaceId, 
        tenantId 
      });
      throw new WorkspaceAccessError('Failed to verify workspace access', {
        userId,
        workspaceId,
        tenantId,
        originalError: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  private async enrichWorkspaceWithAgents(workspace: Workspace): Promise<Workspace> {
    try {
      // Use a more efficient query that gets agents in a single call
      const agents = await this.agentsRepo.getAgentsByWorkspace(workspace.id);
      
      // Map agents with proper error handling
      const mappedAgents: Agent[] = agents.map(agent => {
        if (!agent.workspace_id) {
          logger.warn('Agent found without workspace_id', { agentId: agent.id, workspaceId: workspace.id });
        }
        
        return {
          id: agent.id,
          tenantId: agent.tenant_id,
          workspaceId: agent.workspace_id ?? workspace.id, // Use workspace.id as fallback
          name: agent.name,
          description: agent.description,
          status: agent.status,
          createdAt: agent.created_at,
          updatedAt: agent.updated_at,
        };
      });

      // Update metadata with current agent IDs
      const updatedMetadata = {
        ...workspace.metadata,
        agentIds: mappedAgents.map(agent => agent.id),
        lastAgentUpdate: new Date().toISOString()
      };

      logger.debug('Workspace enriched with agents', { 
        workspaceId: workspace.id, 
        agentCount: mappedAgents.length 
      });

      return {
        ...workspace,
        agents: mappedAgents,
        agentCount: mappedAgents.length,
        metadata: updatedMetadata,
      };
    } catch (error) {
      logger.error('Failed to enrich workspace with agents', { 
        workspaceId: workspace.id, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      
      // If agents fetch fails, return workspace without agents but with error metadata
      return {
        ...workspace,
        agents: [],
        agentCount: 0,
        metadata: {
          ...workspace.metadata,
          agentIds: [],
          lastAgentUpdate: new Date().toISOString(),
          agentFetchError: error instanceof Error ? error.message : 'Unknown error'
        } as WorkspaceMetadata,
      };
    }
  }

  private mapDb(db: DbWorkspace): Workspace {
    return {
      id: db.id,
      tenantId: db.tenant_id,
      email: (db as any).email,
      name: db.name,
      slug: db.slug,
      description: db.description,
      status: db.status,
      createdAt: db.created_at,
      updatedAt: db.updated_at,
      metadata: (db as any).metadata || {},
    };
  }
}

export default WorkspaceRepository;


