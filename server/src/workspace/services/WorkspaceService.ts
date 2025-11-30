import SessionService from '../../auth/services/SessionService';
import { WorkspaceRepository } from '../repositories/WorkspaceRepository';
import { WorkspaceCacheService } from './WorkspaceCacheService';
import {
  Workspace,
  Agent,
  WorkspaceData,
  WorkspaceStats,
  WorkspaceMetadata,
  UserWorkspaceAccess
} from '../types';
import {
  WorkspaceError,
  WorkspaceAuthError,
  WorkspaceAccessError,
  WorkspaceNotFoundError,
  WorkspaceValidationError,
  WorkspaceCacheError,
  isWorkspaceError,
  hasStatusCode
} from '../errors/WorkspaceErrors';
import logger from '../../utils/logger';

/**
 * Secure workspace service with proper error handling, authorization, and caching
 * 
 * Key improvements:
 * - No session token logging (security)
 * - Proper user-workspace authorization checks
 * - Consistent error handling with proper HTTP status codes
 * - Type-safe metadata handling
 * - Proper cache invalidation strategy
 * - No singleton pattern for better testability
 */
export class WorkspaceService {
  private readonly sessionService: SessionService;
  private readonly workspaceRepo: WorkspaceRepository;
  private readonly cacheService: WorkspaceCacheService;

  constructor(
    sessionService?: SessionService,
    workspaceRepo?: WorkspaceRepository,
    cacheService?: WorkspaceCacheService
  ) {
    this.sessionService = sessionService || SessionService.getInstance();
    this.workspaceRepo = workspaceRepo || new WorkspaceRepository();
    this.cacheService = cacheService || new WorkspaceCacheService();
  }

  /**
   * Get comprehensive workspace data including agents and stats
   * 
   * Security: Validates session and verifies user has access to workspace
   * Performance: Uses Redis caching with proper invalidation
   * Type Safety: Returns properly typed data structures
   */
  async getWorkspaceData(sessionToken: string): Promise<WorkspaceData> {
    try {
      // Validate session and extract user context (NO TOKEN LOGGING)
      const sessionData = await this.validateSession(sessionToken);
      const { userId, tenantId, workspaceId } = this.extractUserContext(sessionData);

      // Verify user has access to the workspace (CRITICAL SECURITY CHECK)
      await this.workspaceRepo.verifyUserWorkspaceAccess(userId, workspaceId, tenantId);

      logger.info('Fetching workspace data', { userId, workspaceId });

      // Try to get workspace from cache first
      let workspace = await this.cacheService.getWorkspace(workspaceId);

      // If not in cache, fetch from database and cache it
      if (!workspace) {
        workspace = await this.fetchAndCacheWorkspace(workspaceId);
      }

      if (!workspace) {
        throw new WorkspaceNotFoundError(workspaceId, { userId, tenantId });
      }

      // Extract agents and calculate stats
      const agents = workspace.agents ?? [];
      const stats = await this.calculateWorkspaceStats(workspaceId, agents);

      logger.info('Workspace data prepared', {
        userId,
        workspaceId,
        workspaceName: workspace.name,
        totalAgents: stats.totalAgents,
        activeAgents: stats.activeAgents
      });

      return {
        workspace,
        agents,
        stats,
      };

    } catch (error) {
      this.handleWorkspaceError(error, 'Failed to get workspace data');
    }
  }

  /**
   * Get workspace metadata only
   * 
   * Security: Validates session and verifies user has access to workspace
   * Type Safety: Returns properly typed metadata
   */
  async getWorkspaceMetadata(sessionToken: string): Promise<WorkspaceMetadata> {
    try {
      const sessionData = await this.validateSession(sessionToken);
      const { userId, tenantId, workspaceId } = this.extractUserContext(sessionData);

      // Verify user has access to the workspace
      await this.workspaceRepo.verifyUserWorkspaceAccess(userId, workspaceId, tenantId);

      logger.info('Fetching workspace metadata', { userId, workspaceId });

      // Get workspace from cache or database
      let workspace = await this.cacheService.getWorkspace(workspaceId);

      if (!workspace) {
        workspace = await this.fetchAndCacheWorkspace(workspaceId);
      }

      if (!workspace) {
        throw new WorkspaceNotFoundError(workspaceId, { userId, tenantId });
      }

      return workspace.metadata ?? {};

    } catch (error) {
      this.handleWorkspaceError(error, 'Failed to get workspace metadata');
    }
  }

  /**
   * Update workspace metadata
   * 
   * Security: Validates session and verifies user has access to workspace
   * Cache: Properly invalidates cache after successful update
   * Type Safety: Validates metadata structure
   */
  async updateWorkspaceMetadata(sessionToken: string, metadata: WorkspaceMetadata): Promise<Workspace> {
    try {
      const sessionData = await this.validateSession(sessionToken);
      const { userId, tenantId, workspaceId } = this.extractUserContext(sessionData);

      // Verify user has access to the workspace
      const access = await this.workspaceRepo.verifyUserWorkspaceAccess(userId, workspaceId, tenantId);

      // Check if user has permission to update metadata
      if (!['owner', 'admin'].includes(access.accessLevel)) {
        throw new WorkspaceAccessError('Insufficient permissions to update workspace metadata', {
          userId,
          workspaceId,
          accessLevel: access.accessLevel
        });
      }

      // Validate metadata structure
      this.validateMetadata(metadata);

      logger.info('Updating workspace metadata', { userId, workspaceId });

      // Update workspace metadata in database
      const updatedWorkspace = await this.workspaceRepo.updateWorkspaceMetadata(workspaceId, metadata);
      if (!updatedWorkspace) {
        throw new WorkspaceError('Failed to update workspace metadata', 'UPDATE_FAILED', 500);
      }

      // Invalidate cache to ensure consistency
      await this.cacheService.invalidateWorkspace(workspaceId);

      logger.info('Workspace metadata updated successfully', { userId, workspaceId });

      return updatedWorkspace;

    } catch (error) {
      this.handleWorkspaceError(error, 'Failed to update workspace metadata');
    }
  }

  /**
   * Private helper methods
   */

  private async validateSession(sessionToken: string) {
    const sessionData = await this.sessionService.validate(sessionToken);
    if (!sessionData) {
      throw new WorkspaceAuthError('Invalid session token');
    }
    return sessionData;
  }

  private extractUserContext(sessionData: any) {
    const userId = sessionData.userId;
    const tenantId = sessionData.tenantId;
    const workspaceId = sessionData.metadata?.workspaceId;

    if (!userId || !tenantId) {
      throw new WorkspaceAuthError('Invalid session data: missing user context');
    }

    if (!workspaceId) {
      throw new WorkspaceAuthError('No workspace found in session');
    }

    return { userId, tenantId, workspaceId };
  }


  private async fetchAndCacheWorkspace(workspaceId: string): Promise<Workspace | null> {
    try {
      logger.info('Fetching workspace with agents from database', { workspaceId });

      const workspace = await this.workspaceRepo.getWorkspaceWithAgents(workspaceId);

      if (workspace) {
        // Cache the workspace data using the cache service
        await this.cacheService.setWorkspace(workspaceId, workspace);
        logger.info('Workspace with agents cached successfully', { workspaceId });
      }

      return workspace;
    } catch (error) {
      logger.error('Error fetching workspace from database', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      throw new WorkspaceError('Failed to fetch workspace from database', 'DATABASE_ERROR', 500);
    }
  }


  private async calculateWorkspaceStats(workspaceId: string, agents: Agent[]): Promise<WorkspaceStats> {
    try {
      const totalAgents = agents.length;
      const activeAgents = agents.filter(agent => agent.status === 'active').length;

      // TODO: Implement actual conversation and error counting
      // For now, return 0 to avoid misleading data
      const totalConversations = 0;
      const totalErrors = 0;

      return {
        totalAgents,
        activeAgents,
        totalConversations,
        totalErrors,
      };
    } catch (error) {
      logger.error('Error calculating workspace stats', {
        workspaceId,
        error: error instanceof Error ? error.message : 'Unknown error'
      });

      // Return safe defaults rather than throwing
      return {
        totalAgents: 0,
        activeAgents: 0,
        totalConversations: 0,
        totalErrors: 0,
      };
    }
  }

  private validateMetadata(metadata: WorkspaceMetadata): void {
    if (!metadata || typeof metadata !== 'object') {
      throw new WorkspaceValidationError('Metadata must be a valid object');
    }

    // Add specific validation rules here
    if (metadata.agentIds && !Array.isArray(metadata.agentIds)) {
      throw new WorkspaceValidationError('agentIds must be an array', 'agentIds');
    }

    if (metadata.version && typeof metadata.version !== 'number') {
      throw new WorkspaceValidationError('version must be a number', 'version');
    }
  }


  private handleWorkspaceError(error: unknown, context: string): never {
    if (isWorkspaceError(error)) {
      logger.error(context, {
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error.details
      });
      throw error;
    }

    if (hasStatusCode(error)) {
      logger.error(context, {
        error: error.message,
        statusCode: error.statusCode
      });
      throw error;
    }

    logger.error(context, {
      error: error instanceof Error ? error.message : 'Unknown error'
    });

    throw new WorkspaceError(
      error instanceof Error ? error.message : 'Unknown error occurred',
      'INTERNAL_ERROR',
      500
    );
  }
}

// Export class instead of singleton for better testability
export default WorkspaceService;