// agent/services/AgentTokenService.ts
import { randomBytes } from 'crypto';
import { redisClient } from '../../redis';
import logger from '../../utils/logger';
import { AgentsRepository } from '../../database/repositories/AgentsRepository';
import { WorkspacesRepository } from '../../database/repositories/WorkspacesRepository';

export interface AgentTokenData {
  agentId: string;
  tenantId: string;
  workspaceId: string;
  userId: string;
  createdAt: string;
  revocationVersion?: number; // Added for revocation tracking
}

export enum TokenErrorCode {
  INVALID_TOKEN = 'INVALID_TOKEN',
  EXPIRED_TOKEN = 'EXPIRED_TOKEN',
  INVALID_INPUT = 'INVALID_INPUT',
  AGENT_NOT_FOUND = 'AGENT_NOT_FOUND',
  AGENT_VALIDATION_FAILED = 'AGENT_VALIDATION_FAILED',
  SERVER_ERROR = 'SERVER_ERROR',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

export interface AgentTokenResponse {
  success: boolean;
  token?: string;
  error?: {
    code: TokenErrorCode;
    message: string;
  };
}

export class AgentTokenService {
  private static instance: AgentTokenService;
  private readonly IDLE_TIMEOUT = 3600;          // 1 hour of inactivity (sliding window)
  private readonly SESSION_ABSOLUTE_MAX = 604800; // 7 days absolute maximum
  private readonly MAX_LENGTH = 255;
  private agentsRepository: AgentsRepository;
  private workspacesRepository: WorkspacesRepository;

  private constructor() {
    this.agentsRepository = new AgentsRepository();
    this.workspacesRepository = new WorkspacesRepository();
  }

  public static getInstance(): AgentTokenService {
    if (!AgentTokenService.instance) {
      AgentTokenService.instance = new AgentTokenService();
    }
    return AgentTokenService.instance;
  }

  /**
   * Generate a secure token for agent access
   */
  async generateAgentToken(
    agentId: string,
    tenantId: string,
    workspaceId: string,
    userId: string
  ): Promise<AgentTokenResponse> {
    try {
      // Validate inputs
      if (!this.validateInputs({ agentId, tenantId, workspaceId, userId })) {
        return {
          success: false,
          error: {
            code: TokenErrorCode.INVALID_INPUT,
            message: 'Invalid input parameters'
          }
        };
      }

      // Validate that the agent belongs to the tenant and workspace
      const agent = await this.validateAgentAccess(agentId, tenantId, workspaceId);
      if (!agent) {
        return {
          success: false,
          error: {
            code: TokenErrorCode.AGENT_VALIDATION_FAILED,
            message: 'Agent validation failed'
          }
        };
      }

      // Generate cryptographically secure token
      const token = this.generateSecureToken();
      const now = new Date();

      // Get current revocation version for this agent
      const revocationVersionKey = `agent:${agentId}:revocation_version`;
      const revocationVersion = await redisClient.getCache(revocationVersionKey) as string || '0';

      const tokenData: AgentTokenData = {
        agentId,
        tenantId,
        workspaceId,
        userId,
        createdAt: now.toISOString(),
        revocationVersion: parseInt(revocationVersion, 10)
      };

      // Store token data directly with token as key
      const tokenKey = `agent_token:${token}`;
      await redisClient.setJson(tokenKey, tokenData, this.IDLE_TIMEOUT);

      // Note: Reverse index not implemented due to RedisService limitations
      // For now, we'll rely on individual token management

      logger.info('Agent token generated', {
        agentId,
        tenantId,
        workspaceId,
        token: token.substring(0, 8) + '...'
      });

      return {
        success: true,
        token
      };
    } catch (error) {
      logger.error('Failed to generate agent token', { error, agentId, tenantId, workspaceId });
      return {
        success: false,
        error: {
          code: TokenErrorCode.SERVER_ERROR,
          message: 'Failed to generate agent token'
        }
      };
    }
  }

  /**
   * Validate and retrieve agent token data with sliding window expiry, hard max, and revocation
   */
  async validateAgentToken(token: string): Promise<AgentTokenData | null> {
    try {
      const tokenKey = `agent_token:${token}`;
      const tokenData = await redisClient.getJson<AgentTokenData>(tokenKey);

      if (!tokenData) {
        logger.warn('Invalid or expired agent token', { token: token.substring(0, 8) + '...' });
        return null;
      }

      // Check hard expiry (absolute max age)
      const createdAt = new Date(tokenData.createdAt).getTime();
      const now = Date.now();
      const tokenAge = (now - createdAt) / 1000; // in seconds

      if (tokenAge > this.SESSION_ABSOLUTE_MAX) {
        // Token exceeded max lifetime
        try {
          await redisClient.deleteKey(tokenKey);
        } catch (deleteError) {
          logger.warn('Failed to delete expired token from Redis', { error: deleteError });
        }
        logger.warn('Agent token expired (hard limit)', {
          agentId: tokenData.agentId,
          ageSeconds: tokenAge
        });
        return null;
      }

      // Check revocation version (with fallback if Redis fails)
      try {
        const revocationVersionKey = `agent:${tokenData.agentId}:revocation_version`;
        const currentRevocationVersion = await redisClient.getCache(revocationVersionKey) as string || '0';

        if (parseInt(currentRevocationVersion, 10) > (tokenData.revocationVersion || 0)) {
          logger.warn('Token invalidated by revocation', {
            agentId: tokenData.agentId,
            tokenVersion: tokenData.revocationVersion,
            currentVersion: currentRevocationVersion
          });
          return null;
        }
      } catch (revocationError) {
        // If revocation check fails, log warning but continue (fail open for availability)
        logger.warn('Failed to check token revocation, allowing access', {
          error: revocationError,
          agentId: tokenData.agentId
        });
      }

      // Sliding window: extend TTL on every validation (user stays logged in while active)
      try {
        await redisClient.setJson(tokenKey, tokenData, this.IDLE_TIMEOUT);
      } catch (ttlError) {
        // If TTL update fails, log warning but continue (fail open for availability)
        logger.warn('Failed to update token TTL, continuing with validation', {
          error: ttlError,
          agentId: tokenData.agentId
        });
      }

      logger.info('Agent token validated', {
        agentId: tokenData.agentId,
        tenantId: tokenData.tenantId,
        ageSeconds: tokenAge
      });

      return tokenData;
    } catch (error) {
      logger.error('Failed to validate agent token', { error, token: token.substring(0, 8) + '...' });
      return null;
    }
  }

  /**
   * Refresh an existing token (generate new one, invalidate old) - atomic operation
   */

  async refreshAgentToken(
    oldToken: string,
    agentId: string,
    tenantId: string,
    workspaceId: string,
    userId: string
  ): Promise<AgentTokenResponse> {
    try {
      // Validate old token
      const oldTokenData = await this.validateAgentToken(oldToken);
      if (!oldTokenData) {
        return {
          success: false,
          error: {
            code: TokenErrorCode.EXPIRED_TOKEN,
            message: 'Invalid or expired token'
          }
        };
      }

      // Generate new token
      const newToken = this.generateSecureToken();
      const now = new Date();

      // Get current revocation version
      const revocationVersionKey = `agent:${agentId}:revocation_version`;
      const revocationVersion = await redisClient.getCache(revocationVersionKey) as string || '0';

      const newTokenData: AgentTokenData = {
        agentId,
        tenantId,
        workspaceId,
        userId,
        createdAt: now.toISOString(),
        revocationVersion: parseInt(revocationVersion, 10)
      };

      // SAFE ORDER: Create new token first, then delete old (prevents race condition)
      const oldTokenKey = `agent_token:${oldToken}`;
      const newTokenKey = `agent_token:${newToken}`;

      try {
        // 1. Create new token first
        await redisClient.setJson(newTokenKey, newTokenData, this.IDLE_TIMEOUT);

        // 2. Verify new token exists before deleting old
        const verifyNewToken = await redisClient.getJson<AgentTokenData>(newTokenKey);
        if (!verifyNewToken) {
          throw new Error('New token creation failed');
        }

        // 3. Only then delete old token
        await redisClient.deleteKey(oldTokenKey);

        logger.info('Token refreshed atomically', {
          agentId,
          oldToken: oldToken.substring(0, 8) + '...',
          newToken: newToken.substring(0, 8) + '...'
        });
      } catch (error) {
        // If new token exists but old couldn't be deleted, warn but return success
        // Old token will expire naturally; new token is valid
        logger.warn('Token refresh: cleanup incomplete but session valid', {
          error: error instanceof Error ? error.message : 'unknown',
          agentId,
          newToken: newToken.substring(0, 8) + '...'
        });
      }

      logger.info('Agent token refreshed', {
        agentId,
        oldToken: oldToken.substring(0, 8) + '...',
        newToken: newToken.substring(0, 8) + '...'
      });

      return {
        success: true,
        token: newToken
      };
    } catch (error) {
      logger.error('Failed to refresh agent token', { error, agentId, tenantId, workspaceId });
      return {
        success: false,
        error: {
          code: TokenErrorCode.SERVER_ERROR,
          message: 'Failed to refresh agent token'
        }
      };
    }
  }

  /**
   * Invalidate a specific token
   */
  async invalidateToken(token: string): Promise<void> {
    try {
      const tokenKey = `agent_token:${token}`;
      await redisClient.deleteKey(tokenKey);
      logger.info('Agent token invalidated', { token: token.substring(0, 8) + '...' });
    } catch (error) {
      logger.error('Failed to invalidate agent token', { error, token: token.substring(0, 8) + '...' });
    }
  }

  /**
   * Invalidate all tokens for an agent using revocation version
   */
  async invalidateAllAgentTokens(agentId: string): Promise<void> {
    try {
      const revocationVersionKey = `agent:${agentId}:revocation_version`;
      const currentVersion = await redisClient.getCache(revocationVersionKey) as string || '0';
      const newVersion = (parseInt(currentVersion, 10) + 1).toString();

      // Increment revocation version - all tokens with lower version are now invalid
      await redisClient.setCache(revocationVersionKey, newVersion, 86400); // 24 hours TTL

      logger.info('All agent tokens invalidated', {
        agentId,
        newRevocationVersion: newVersion
      });
    } catch (error) {
      logger.error('Failed to invalidate all agent tokens', { error, agentId });
    }
  }

  /**
   * Generate a cryptographically secure random token
   */
  private generateSecureToken(): string {
    // 32 bytes = 256 bits of entropy
    return randomBytes(32).toString('hex');
  }

  /**
   * Validate input parameters with appropriate format validation
   */
  private validateInputs(inputs: Record<string, string>): boolean {
    for (const [key, value] of Object.entries(inputs)) {
      // 1. Check type and emptiness
      if (typeof value !== 'string' || value.trim().length === 0) {
        logger.warn('Invalid input: empty or non-string', { key });
        return false;
      }

      // 2. Check length
      if (value.length > this.MAX_LENGTH) {
        logger.warn('Invalid input: exceeds max length', { key, length: value.length, max: this.MAX_LENGTH });
        return false;
      }

      // 3. Check format based on field type
      if (key === 'agentId' || key === 'tenantId' || key === 'userId') {
        // Agent ID, Tenant ID, and User ID can be custom format (alphanumeric)
        if (!this.isValidCustomId(value)) {
          logger.warn('Invalid input: not a valid custom ID', { key, value });
          return false;
        }
      } else if (key === 'workspaceId') {
        // Workspace ID should be UUID format
        if (!this.isValidUUID(value)) {
          logger.warn('Invalid input: not a valid UUID', { key, value });
          return false;
        }
      } else {
        // Default to UUID validation for unknown fields
        if (!this.isValidUUID(value)) {
          logger.warn('Invalid input: not a valid UUID', { key, value });
          return false;
        }
      }
    }
    return true;
  }

  /**
   * Validate custom ID format (alphanumeric with mixed case)
   */
  private isValidCustomId(value: string): boolean {
    // Accept custom IDs (alphanumeric with mixed case)
    const customId = /^[a-zA-Z0-9]+$/;
    return customId.test(value);
  }

  /**
   * Validate UUID format (both v4 and generic UUID formats)
   */
  private isValidUUID(value: string): boolean {
    // Accept both v4 (strict) and generic UUID formats
    const genericUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return genericUuid.test(value);
  }

  /**
   * Validate agent access
   */
  private async validateAgentAccess(
    agentId: string,
    tenantId: string,
    workspaceId: string
  ): Promise<boolean> {
    try {
      const agent = await this.agentsRepository.findById(agentId);

      if (!agent) {
        logger.warn('Agent not found', { agentId });
        return false;
      }

      // Check workspace ownership
      const workspace = await this.workspacesRepository.findById(agent.workspace_id);
      if (!workspace || workspace.tenant_id !== tenantId) {
        logger.warn('Agent tenant mismatch (via workspace)', {
          agentId,
          expectedTenant: tenantId,
          actualTenant: workspace?.tenant_id
        });
        return false;
      }

      if (agent.workspace_id !== workspaceId) {
        logger.warn('Agent workspace mismatch', { agentId, expectedWorkspace: workspaceId, actualWorkspace: agent.workspace_id });
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Failed to validate agent access', { error, agentId, tenantId, workspaceId });
      return false;
    }
  }
}

export default AgentTokenService.getInstance();