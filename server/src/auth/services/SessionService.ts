// auth/services/SessionService.ts
import crypto from 'crypto';
import { RedisService } from './RedisService';
import logger from '../../utils/logger';

export interface SessionData {
  userId: string;
  email: string;
  // Note: accountId currently maps to tenants.id until a dedicated accounts table is added.
  // This logical separation prepares for future multi-user/team support.
  // accountId = the human owner, workspaceId = the workspace context
  accountId: string; // Renamed from tenantId for logical account/workspace separation
  tenantId: string; // Keep for backward compatibility during migration
  workspaceId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  emailVerified: boolean;
  loginTime: string;
  rememberMe: boolean;
  metadata?: {
    ipAddress?: string | undefined;
    userAgentHash?: string | undefined;
    loginMethod?: string | undefined;
    mfaVerified?: boolean | undefined;
    sessionVersion?: number | undefined;
    workspaceId?: string | null | undefined;
    workspaceIds?: string[] | undefined;
    allowedAgentIds?: string[] | undefined; // For agent-level permissions
    workspaceRole?: 'owner' | 'admin' | 'approver' | undefined; // For future RBAC
  };
}

class SessionService {
  private static instance: SessionService;
  private redisService: RedisService;

  private constructor() {
    this.redisService = RedisService.getInstance();
  }

  public static getInstance(): SessionService {
    if (!SessionService.instance) {
      SessionService.instance = new SessionService();
    }
    return SessionService.instance;
  }

  public generateSessionToken(): string {
    return crypto.randomBytes(32).toString('base64url');
  }

  public async createOrReplaceSession(
    user: {
      id: string;
      email: string;
      tenant_id: string;
      role: string;
      first_name: string | null;
      last_name: string | null;
      email_verified: boolean;
    },
    rememberMe: boolean,
    ipAddress?: string,
    userAgent?: string,
    workspaceId?: string | null,
    workspaceIds?: string[]
  ): Promise<{ token: string; ttlSeconds: number }> {
    const token = this.generateSessionToken();
    const ttlSeconds = rememberMe ? 30 * 24 * 60 * 60 : 24 * 60 * 60;
    const sessionData: SessionData = {
      userId: user.id,
      email: user.email,
      accountId: user.tenant_id, // Logical account ID (maps to tenants.id)
      tenantId: user.tenant_id, // Keep for backward compatibility
      workspaceId: workspaceId ?? null,
      firstName: user.first_name,
      lastName: user.last_name,
      emailVerified: user.email_verified,
      loginTime: new Date().toISOString(),
      rememberMe,
      metadata: {
        ipAddress,
        userAgentHash: userAgent ? crypto.createHash('sha256').update(userAgent).digest('hex') : undefined,
        loginMethod: 'password',
        mfaVerified: false,
        sessionVersion: 1,
        workspaceId: workspaceId ?? null,
        workspaceIds,
        allowedAgentIds: [], // Initialize empty, can be populated later
        workspaceRole: 'owner' // Default role
      }
    };

    await this.redisService.replaceUserSession(user.id, token, sessionData, ttlSeconds);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
    logger.info('Session created/replaced', { userId: user.id, tokenHash });
    return { token, ttlSeconds };
  }

  public async validate(token: string): Promise<SessionData | null> {
    const session = await this.redisService.getSession(token) as SessionData | null;
    if (!session) return null;
    // Validate mapping (user -> token) to enforce single-session mapping
    const mapped = await this.redisService.getUserSession(session.userId);
    if (mapped !== token) {
      // mapping mismatch → treat as invalid
      return null;
    }
    return session;
  }

  public async refresh(token: string, rememberMe: boolean): Promise<void> {
    // SECURITY FIX #7: Use remaining TTL instead of fresh TTL to prevent session extension attacks
    const remainingTTL = await this.redisService.getSessionTTL(token);
    if (remainingTTL === null) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
      logger.warn('Cannot refresh session: TTL not found', { tokenHash });
      return;
    }
    // Reapply the REMAINING TTL, not a fresh 24-30 days
    await this.redisService.updateSessionTTL(token, remainingTTL);
  }

  public async revoke(token: string): Promise<void> {
    const session = await this.redisService.getSession(token) as SessionData | null;
    if (session?.userId) {
      await this.redisService.deleteUserSession(session.userId);
    }
    await this.redisService.deleteSession(token);
  }

  public async revokeAll(userId: string): Promise<void> {
    const current = await this.redisService.getUserSession(userId);
    if (current) {
      await this.redisService.deleteSession(current);
    }
    await this.redisService.deleteUserSession(userId);
  }

  public async updateSessionWorkspace(token: string, workspaceId: string, workspaceIds?: string[]): Promise<boolean> {
    const session = await this.redisService.getSession(token) as SessionData | null;
    if (!session) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
      logger.warn('Session not found for workspace update', { tokenHash });
      return false;
    }

    // Update session data with workspace info
    session.workspaceId = workspaceId;
    if (session.metadata) {
      session.metadata.workspaceId = workspaceId;
      if (workspaceIds) {
        session.metadata.workspaceIds = workspaceIds;
      }
    }

    // SECURITY FIX #7: Use remaining TTL instead of recomputing fresh TTL
    const remainingTTL = await this.redisService.getSessionTTL(token);
    if (remainingTTL === null) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex').substring(0, 16);
      logger.warn('Cannot update workspace: session TTL not found', { tokenHash });
      return false;
    }

    // Update session in Redis with REMAINING TTL (not fresh 24-30 days)
    await this.redisService.replaceUserSession(session.userId, token, session, remainingTTL);
    logger.info('Session updated with workspace', { userId: session.userId, workspaceId });
    return true;
  }
}

export default SessionService;


