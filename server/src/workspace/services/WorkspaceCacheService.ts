import redisClient from '../../redis';
import { Workspace, WorkspaceMetadata } from '../types';
import { WorkspaceCacheError } from '../errors/WorkspaceErrors';
import logger from '../../utils/logger';

/**
 * Simplified workspace caching service that works with existing Redis structure
 * 
 * Uses single key format: workspace:{workspaceId} containing complete workspace data
 * This matches the existing Redis structure and is already efficient
 */
export class WorkspaceCacheService {
  private readonly redisService = redisClient;

  // Cache configuration - matches existing Redis structure
  private static readonly CACHE_PREFIX = 'workspace:';
  private static readonly CACHE_TTL_SECONDS = 24 * 60 * 60; // 24 hours

  /**
   * Get workspace from cache using existing Redis structure
   */
  async getWorkspace(workspaceId: string): Promise<Workspace | null> {
    try {
      const cacheKey = this.getCacheKey(workspaceId);
      const workspace = await this.redisService.getJson<Workspace>(cacheKey);
      
      if (workspace) {
        logger.debug('Workspace loaded from cache', { workspaceId });
        return workspace;
      }
      
      return null;
    } catch (error) {
      if (this.isCacheMissError(error)) {
        logger.debug('Cache miss for workspace', { workspaceId });
        return null;
      }
      
      logger.warn('Redis error while fetching workspace from cache', { 
        workspaceId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null; // Don't throw - fall back to database
    }
  }

  /**
   * Cache workspace using existing Redis structure
   */
  async setWorkspace(workspaceId: string, workspace: Workspace): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(workspaceId);
      await this.redisService.setJson(cacheKey, workspace, WorkspaceCacheService.CACHE_TTL_SECONDS);
      logger.debug('Workspace cached successfully', { workspaceId });
    } catch (error) {
      logger.warn('Failed to cache workspace', { 
        workspaceId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      // Don't throw - caching failure shouldn't break the operation
    }
  }

  /**
   * Get workspace metadata from cache (extracted from workspace data)
   */
  async getWorkspaceMetadata(workspaceId: string): Promise<WorkspaceMetadata | null> {
    try {
      const workspace = await this.getWorkspace(workspaceId);
      return workspace?.metadata ?? null;
    } catch (error) {
      logger.warn('Failed to get workspace metadata from cache', { 
        workspaceId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return null;
    }
  }

  /**
   * Invalidate workspace cache (single key)
   */
  async invalidateWorkspace(workspaceId: string): Promise<void> {
    try {
      const cacheKey = this.getCacheKey(workspaceId);
      await this.redisService.deleteKey(cacheKey);
      
      logger.info('Workspace cache invalidated', { workspaceId, cacheKey });
    } catch (error) {
      logger.warn('Failed to invalidate workspace cache', { 
        workspaceId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      // Don't throw - cache invalidation failure shouldn't break the operation
    }
  }

  /**
   * Check if workspace exists in cache
   */
  async hasWorkspace(workspaceId: string): Promise<boolean> {
    try {
      const workspace = await this.getWorkspace(workspaceId);
      return !!workspace;
    } catch (error) {
      logger.warn('Failed to check workspace cache existence', { 
        workspaceId, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      });
      return false;
    }
  }

  /**
   * Private helper methods
   */

  private getCacheKey(workspaceId: string): string {
    return `${WorkspaceCacheService.CACHE_PREFIX}${workspaceId}`;
  }

  private isCacheMissError(error: unknown): boolean {
    return error instanceof Error && 
           (error.message.includes('ENOENT') || 
            error.message.includes('not found') ||
            error.message.includes('Cache miss'));
  }
}

// Export singleton instance for convenience
export const workspaceCacheService = new WorkspaceCacheService();
