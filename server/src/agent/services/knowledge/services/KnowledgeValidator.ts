// path: knowledge/services/KnowledgeValidator.ts
import { RedisService } from '../../../../auth/services/RedisService';
import logger from '../../../../utils/logger';
import crypto from 'crypto';

interface SessionData {
  userId: string;
  // Add other session properties as needed
}

export class KnowledgeValidator {
  private redis: RedisService;

  constructor() {
    this.redis = RedisService.getInstance();
  }

  async validateSession(sessionToken: string): Promise<{ valid: boolean; userId?: string }> {
    if (!sessionToken || typeof sessionToken !== 'string' || sessionToken.length === 0) {
      return { valid: false };
    }
    
    // Security: Prevent token injection by validating format
    if (!/^[A-Za-z0-9\-_]+$/.test(sessionToken)) {
      logger.warn('Invalid session token format', { tokenLength: sessionToken.length });
      return { valid: false };
    }

    const session = await this.redis.getSession(sessionToken) as SessionData | null;
    if (!session) {
      return { valid: false };
    }
    return { valid: true, userId: session.userId };
  }

  async validateAgentAccess(
    agentId: string,
    tenantId: string
  ): Promise<boolean> {
    // Security: Validate input format
    if (!agentId || !tenantId || typeof agentId !== 'string' || typeof tenantId !== 'string') {
      return false;
    }

    // Security: Prevent ID injection - validate UUID or alphanumeric format
    if (!/^[A-Za-z0-9\-_]{1,64}$/.test(agentId) || !/^[A-Za-z0-9\-_]{1,64}$/.test(tenantId)) {
      logger.warn('Invalid agent or tenant ID format', { agentId: agentId.substring(0, 8), tenantId: tenantId.substring(0, 8) });
      return false;
    }

    try {
      const AgentService = (await import('../../AgentService')).default;
      const result = await AgentService.getAgentById(tenantId, agentId);
      return result.success && result.agent?.tenant_id === tenantId;
    } catch (error) {
      logger.warn('Agent validation error', { error: error instanceof Error ? error.message : String(error) });
      return false;
    }
  }

  validateFileName(fileName: string): { valid: boolean; error?: string } {
    if (!fileName || typeof fileName !== 'string' || fileName.length === 0) {
      return { valid: false, error: 'File name is required' };
    }

    // Security: Prevent path traversal and malicious filenames
    if (fileName.length > 255) {
      return { valid: false, error: 'File name too long (max 255 characters)' };
    }

    // Security: Block path traversal attempts
    if (fileName.includes('..') || fileName.includes('/') || fileName.includes('\\')) {
      return { valid: false, error: 'File name contains invalid characters' };
    }

    // Security: Block control characters and dangerous patterns
    if (/[\x00-\x1f\x7f]/.test(fileName) || /[<>:"|?*]/.test(fileName)) {
      return { valid: false, error: 'File name contains invalid characters' };
    }

    // Allow alphanumeric, spaces, hyphens, underscores, dots
    if (!/^[\w\s\-\.]+$/i.test(fileName)) {
      return { valid: false, error: 'File name contains invalid characters' };
    }

    return { valid: true };
  }

  validateFileType(fileName: string, mimeType?: string): boolean {
    // Security: Only allow PDF files
    const isPDF = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
    return isPDF;
  }

  validateFileSize(
    buffer: Buffer,
    maxSizeBytes: number
  ): { valid: boolean; error?: string } {
    if (!Buffer.isBuffer(buffer)) {
      return { valid: false, error: 'Invalid file buffer' };
    }

    if (buffer.length > maxSizeBytes) {
      return {
        valid: false,
        error: `File exceeds maximum size of ${Math.round(maxSizeBytes / 1024 / 1024)} MB`
      };
    }

    // Security: Prevent empty files
    if (buffer.length === 0) {
      return { valid: false, error: 'File is empty' };
    }

    return { valid: true };
  }

  validateKnowledgeBaseId(id: string): boolean {
    if (!id || typeof id !== 'string') {
      return false;
    }
    // Security: Validate UUID format
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  }

  validateKnowledgeBaseName(name: string): { valid: boolean; error?: string } {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return { valid: false, error: 'Knowledge base name is required' };
    }

    if (name.length > 100) {
      return { valid: false, error: 'Knowledge base name too long (max 100 characters)' };
    }

    // Security: Prevent injection in names
    if (/[<>:"|?*\\/]/.test(name)) {
      return { valid: false, error: 'Knowledge base name contains invalid characters' };
    }

    return { valid: true };
  }

  generateTableName(name: string, agentId: string): string {
    // Security: Sanitize name to prevent SQL injection
    let sanitized = name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .replace(/_{2,}/g, '_')
      .replace(/^_|_$/g, '');
    
    if (sanitized.length === 0) sanitized = 'knowledge_base';
    if (/^\d/.test(sanitized)) sanitized = `kb_${sanitized}`;
    if (sanitized.length > 40) sanitized = sanitized.substring(0, 40);
    
    // Security: Add cryptographically secure hash
    const hash = crypto.createHash('sha256')
      .update(`${name}:${agentId}:${Date.now()}`)
      .digest('hex')
      .substring(0, 16);
    
    return `${sanitized}_${hash}`;
  }

  async resolveAgentId(agentToken: string, tenantId: string): Promise<string | null> {
    // Security: Validate inputs
    if (!agentToken || !tenantId || typeof agentToken !== 'string' || typeof tenantId !== 'string') {
      return null;
    }

    try {
      const AgentTokenService = (await import('../../AgentTokenService')).default;
      const tokenData = await AgentTokenService.validateAgentToken(agentToken);
      
      if (tokenData && tokenData.tenantId === tenantId) {
        // Security: Validate agent ID format
        if (/^[A-Za-z0-9\-_]{1,64}$/.test(tokenData.agentId)) {
          return tokenData.agentId;
        }
      }
      
      // Try direct agent ID (16 char alphanumeric)
      if (/^[A-Za-z0-9]{16}$/.test(agentToken)) {
        const AgentService = (await import('../../AgentService')).default;
        const result = await AgentService.getAgentById(tenantId, agentToken);
        if (result.success && result.agent?.tenant_id === tenantId) {
          return agentToken;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn('Agent ID resolution error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
}