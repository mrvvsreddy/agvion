// knowledge/services/KnowledgeService.ts
import { KnowledgeRepository } from './KnowledgeRepository';
import { KnowledgeValidator } from './KnowledgeValidator';
import { CacheManager } from './resilience';
import {
  KnowledgeBase,
  CreateKnowledgeBaseRequest,
  GetKnowledgeBasesRequest,
  GetKnowledgeBaseRequest,
  UpdateKnowledgeBaseRequest,
  DeleteKnowledgeBaseRequest
} from './types';
import logger from '../../../../utils/logger';
import { RedisService } from '../../../../auth/services/RedisService';
import SupabaseService from '../../../../database/config/supabase';
import { CONFIG } from './resilience';

// Constants
const LOCK_TTL_SEC = 10;
const CACHE_TTL_SEC = 1800;
const RATE_LIMIT_WINDOW_MS = 60000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 100;
const RATE_LIMIT_CLEANUP_INTERVAL_MS = 300000; // 5 minutes

// Type-safe cache data structure
interface CachedHomeData {
  knowledge?: KnowledgeBase[];
}

// File upload structure with exact optional types
interface FileUpload {
  buffer: Buffer;
  fileName: string;
  mimeType?: string;
}

export class KnowledgeService {
  private static instance: KnowledgeService;
  private repository: KnowledgeRepository;
  private validator: KnowledgeValidator;
  private cache: CacheManager;
  private redis: RedisService;
  private rateLimitMap: Map<string, number[]>;
  private cleanupIntervalId: NodeJS.Timeout | null = null;

  private constructor() {
    this.repository = new KnowledgeRepository();
    this.validator = new KnowledgeValidator();
    this.cache = new CacheManager();
    this.redis = RedisService.getInstance();
    this.rateLimitMap = new Map();

    // Setup cleanup with proper interval tracking
    this.setupRateLimitCleanup();
  }

  static getInstance(): KnowledgeService {
    if (!KnowledgeService.instance) {
      KnowledgeService.instance = new KnowledgeService();
    }
    return KnowledgeService.instance;
  }

  private cleanupListeners: Array<() => void> = [];

  /**
   * Setup rate limit cleanup with proper lifecycle management
   */
  private setupRateLimitCleanup(): void {
    // Clear old interval
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
    }

    // FIXED: Clear old listeners to prevent memory leaks
    this.cleanupListeners.forEach(fn => fn());
    this.cleanupListeners = [];

    // Setup new interval
    this.cleanupIntervalId = setInterval(
      () => this.cleanupRateLimitMap(),
      RATE_LIMIT_CLEANUP_INTERVAL_MS
    );
    
    // Ensure cleanup on process exit with removal tracking
    if (typeof process !== 'undefined') {
      const signalCleanup = () => {
        if (this.cleanupIntervalId) {
          clearInterval(this.cleanupIntervalId);
          this.cleanupIntervalId = null;
        }
      };

      const removeTermListener = () => process.removeListener('SIGTERM', signalCleanup);
      const removeIntListener = () => process.removeListener('SIGINT', signalCleanup);

      process.once('SIGTERM', signalCleanup);
      process.once('SIGINT', signalCleanup);

      this.cleanupListeners.push(removeTermListener, removeIntListener);
    }
  }

  /**
   * Generate unique request ID for tracing
   */
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Sanitize string input
   */
  private sanitizeInput(input: string, maxLength: number = 255): string {
    if (!input || typeof input !== 'string') {
      return '';
    }
    // Remove null bytes and control characters
    return input
      .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
      .trim()
      .substring(0, maxLength);
  }

  /**
   * Check rate limit with improved efficiency
   */
  private checkRateLimit(key: string): boolean {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;

    const timestamps = this.rateLimitMap.get(key) || [];
    const recentTimestamps = timestamps.filter(t => t > windowStart);

    if (recentTimestamps.length >= RATE_LIMIT_MAX_REQUESTS) {
      logger.warn('Rate limit exceeded', { key, count: recentTimestamps.length });
      return false;
    }

    recentTimestamps.push(now);
    this.rateLimitMap.set(key, recentTimestamps);
    return true;
  }

  /**
   * Cleanup old rate limit entries (optimized)
   */
  private cleanupRateLimitMap(): void {
    const now = Date.now();
    const windowStart = now - RATE_LIMIT_WINDOW_MS;
    let cleanedCount = 0;

    for (const [key, timestamps] of this.rateLimitMap.entries()) {
      const recentTimestamps = timestamps.filter(t => t > windowStart);
      if (recentTimestamps.length === 0) {
        this.rateLimitMap.delete(key);
        cleanedCount++;
      } else if (recentTimestamps.length < timestamps.length) {
        this.rateLimitMap.set(key, recentTimestamps);
      }
    }

    if (cleanedCount > 0) {
      logger.debug('Rate limit map cleanup completed', { 
        cleanedEntries: cleanedCount, 
        remainingEntries: this.rateLimitMap.size 
      });
    }
  }

  /**
   * Acquire distributed lock with token
   */
  private async acquireLock(lockKey: string, ttlSec: number = LOCK_TTL_SEC): Promise<string | null> {
    const lockToken = `${Date.now()}-${Math.random().toString(36).substring(2)}`;

    try {
      // Use RedisService.setIfNotExists for atomic lock acquisition
      const acquired = await this.redis.setIfNotExists(lockKey, lockToken, ttlSec);
      
      if (acquired) {
        logger.debug('Lock acquired', { lockKey, lockToken });
        return lockToken;
      }

      logger.debug('Lock not acquired (already exists)', { lockKey });
      return null;
    } catch (error) {
      logger.warn('Failed to acquire lock', {
        lockKey,
        error: error instanceof Error ? error.message : String(error)
      });
      return null;
    }
  }

  /**
   * Release distributed lock with token verification
   */
  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    try {
      // Use Lua script for atomic token verification and deletion
      const luaScript = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
          return redis.call("del", KEYS[1])
        else
          return 0
        end
      `;
      
      const result = await this.redis.evalScript<number>(luaScript, [lockKey], [lockToken]);
      
      if (result === 1) {
        logger.debug('Lock released', { lockKey, lockToken });
      } else if (result === 0) {
        // Token mismatch or lock already expired
        logger.warn('Lock token mismatch or lock expired', { 
          lockKey,
          expectedToken: lockToken?.substring(0, 8)
        });
      }
    } catch (error) {
      // Fallback: Verify token before delete to prevent race conditions
      try {
        const currentToken = await this.redis.get(lockKey);
        if (currentToken === lockToken) {
          await this.redis.deleteKey(lockKey);
          logger.debug('Lock released (fallback with verification)', { lockKey });
        } else {
          logger.warn('Lock token mismatch - not releasing', { 
            lockKey,
            expectedToken: lockToken?.substring(0, 8),
            currentToken: currentToken?.substring(0, 8)
          });
        }
      } catch (fallbackError) {
        logger.warn('Failed to release lock (fallback also failed)', {
          lockKey,
          lockToken,
          error: error instanceof Error ? error.message : String(error),
          fallbackError: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
        });
      }
    }
  }

  /**
   * Build KnowledgeBase object from table data
   */
  private async buildKnowledgeBase(table: any, tenantId: string): Promise<KnowledgeBase> {
    let hasData = false;
    let size = '0 KB';

    // Get vector count
    try {
      const client: any = SupabaseService.getInstance().getClient();
      const { count } = await client
        .from('agent_vector_data')
        .select('*', { count: 'exact', head: true })
        .eq('table_id', table.id);
      hasData = (count || 0) > 0;
    } catch (error) {
      logger.debug('Error fetching vector count', {
        tableId: table.id.substring(0, 8),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Get file stats
    try {
      const files = await this.repository.getFileManifests(table.id, 100);
      if (files.length > 0) {
        hasData = true;
        const totalBytes = files.reduce((acc: number, f: any) => acc + (Number(f.sizeBytes) || 0), 0);
        const totalKB = Math.max(1, Math.round(totalBytes / 1024));
        size = `${files.length} file${files.length > 1 ? 's' : ''} — ${totalKB < 1024 ? `${totalKB} KB` : `${(totalKB / 1024).toFixed(2)} MB`}`;
      }
    } catch (error) {
      logger.debug('Error fetching file stats', {
        tableId: table.id.substring(0, 8),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const name = table.description?.match(/Knowledge base:\s*(.+)/)?.[1] || table.table_name;

    return {
      id: table.id,
      name,
      type: 'knowledge',
      agentId: table.agent_id,
      tenantId,
      tableName: table.table_name,
      description: table.description || undefined,
      hasData,
      size,
      createdAt: table.created_at,
      updatedAt: table.updated_at
    };
  }

  /**
   * Invalidate cache with error handling
   */
  private async invalidateCacheSafely(cacheKey: string, requestId: string): Promise<void> {
    try {
      await this.cache.invalidate(cacheKey);
      logger.debug('Cache invalidated', { requestId, cacheKey });
    } catch (error) {
      logger.warn('Cache invalidation failed', {
        requestId,
        cacheKey,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async createKnowledgeBase(request: CreateKnowledgeBaseRequest): Promise<{
    success: boolean;
    data?: KnowledgeBase;
    message?: string;
  }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();
    let lockToken: string | null = null;
    let lockKey: string | null = null;

    try {
      logger.info('Creating knowledge base', {
        requestId,
        name: request.name,
        tenantId: request.tenantId?.substring(0, 8)
      });

      // Rate limiting
      const rateLimitKey = `kb_create:${request.tenantId}`;
      if (!this.checkRateLimit(rateLimitKey)) {
        logger.warn('Rate limit exceeded', { requestId, rateLimitKey });
        return { success: false, message: 'Rate limit exceeded. Please try again later.' };
      }

      // Validate session
      const session = await this.validator.validateSession(request.sessionToken);
      if (!session.valid) {
        logger.warn('Invalid session', { requestId });
        return { success: false, message: 'Invalid or expired session' };
      }

      // Sanitize and validate name
      const sanitizedName = this.sanitizeInput(request.name);
      if (!sanitizedName) {
        logger.warn('Invalid knowledge base name', { requestId, name: request.name });
        return { success: false, message: 'Invalid knowledge base name' };
      }

      const nameValidation = this.validator.validateKnowledgeBaseName(sanitizedName);
      if (!nameValidation.valid) {
        logger.warn('Name validation failed', { requestId, error: nameValidation.error });
        return { success: false, message: nameValidation.error || 'Invalid knowledge base name' };
      }

      // Validate agent ID format (varchar string, not UUID)
      if (!request.agentId || typeof request.agentId !== 'string') {
        logger.warn('Invalid agent ID', { requestId });
        return { success: false, message: 'Agent ID is required' };
      }

      // Validate agent ID format (alphanumeric with dashes/underscores, 1-64 chars)
      if (!/^[A-Za-z0-9\-_]{1,64}$/.test(request.agentId)) {
        logger.warn('Invalid agent ID format', { requestId, agentId: request.agentId.substring(0, 8) });
        return { success: false, message: 'Invalid agent ID format' };
      }

      // Validate agent access
      const hasAccess = await this.validator.validateAgentAccess(request.agentId, request.tenantId);
      if (!hasAccess) {
        logger.warn('Agent access denied', { requestId, agentId: request.agentId.substring(0, 8) });
        return { success: false, message: 'Agent access denied' };
      }

      // Generate table name
      const tableName = this.validator.generateTableName(sanitizedName, request.agentId);

      // Acquire lock
      lockKey = `kb_create:${request.agentId}:${tableName}`;
      lockToken = await this.acquireLock(lockKey);

      if (!lockToken) {
        logger.warn('Failed to acquire lock', { requestId, lockKey });
        return { success: false, message: 'Knowledge base creation in progress, please retry' };
      }

      try {
        // Check for existing knowledge base (idempotency)
        const existing = await this.repository.findByAgent(request.agentId, undefined, request.tenantId);
        const matchExisting = existing?.find(
          (t: any) => t.table_name === tableName && t.tenant_id === request.tenantId
        );

        if (matchExisting) {
          logger.info('Knowledge base already exists', {
            requestId,
            knowledgeBaseId: matchExisting.id.substring(0, 8)
          });
          const kb = await this.buildKnowledgeBase(matchExisting, request.tenantId);
          return { success: true, data: kb, message: 'Knowledge base already existed' };
        }

        // Create in database
        const table = await this.repository.createTable({
          agentId: request.agentId,
          tenantId: request.tenantId,
          tableName,
          description: `Knowledge base: ${sanitizedName}`
        });

        const kb = await this.buildKnowledgeBase(table, request.tenantId);

        // FIXED: Await cache invalidation to prevent race conditions
        try {
          await this.invalidateCacheSafely(`agent:studio:home:${table.agent_id}`, requestId);
        } catch (error) {
          // Log but don't fail the operation
          logger.warn('Cache invalidation failed but operation succeeded', { requestId, error });
        }

        const duration = Date.now() - startTime;
        logger.info('Knowledge base created successfully', {
          requestId,
          knowledgeBaseId: kb.id.substring(0, 8),
          agentId: request.agentId.substring(0, 8),
          duration
        });

        return { success: true, data: kb };

      } catch (error: any) {
        // Handle unique constraint violation
        const code = error?.code || error?.status || error?.error?.code || '';
        const msg = error?.message || error?.error?.message || '';

        if (code === '23505' || code === 'P2002' || /unique constraint/i.test(msg)) {
          logger.warn('Unique constraint violation', { requestId, tableName });
          
          // Try to return existing
          const existing = await this.repository.findByAgent(request.agentId, undefined, request.tenantId);
          const match = existing?.find(
            (t: any) => t.table_name === tableName && t.tenant_id === request.tenantId
          );
          
          if (match) {
            const kb = await this.buildKnowledgeBase(match, request.tenantId);
            return { success: true, data: kb, message: 'Knowledge base already existed' };
          }
          return { success: false, message: 'Knowledge base with this name already exists' };
        }
        throw error;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to create knowledge base', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        name: request.name,
        tenantId: request.tenantId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to create knowledge base' };
    } finally {
      // Ensure lock is released
      if (lockKey && lockToken) {
        await this.releaseLock(lockKey, lockToken);
      }
    }
  }

  async getKnowledgeBases(request: GetKnowledgeBasesRequest): Promise<{
    success: boolean;
    data?: KnowledgeBase[];
    message?: string;
  }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Fetching knowledge bases', {
        requestId,
        agentId: request.agentId?.substring(0, 8),
        tenantId: request.tenantId?.substring(0, 8)
      });

      // Validate session
      const session = await this.validator.validateSession(request.sessionToken);
      if (!session.valid) {
        logger.warn('Invalid session', { requestId });
        return { success: false, message: 'Invalid or expired session' };
      }

      // Validate agent ID
      if (!request.agentId) {
        logger.warn('Missing agent ID', { requestId });
        return { success: false, message: 'Agent ID is required' };
      }

      // Validate agent access
      const hasAccess = await this.validator.validateAgentAccess(request.agentId, request.tenantId);
      if (!hasAccess) {
        logger.warn('Agent access denied', {
          requestId,
          agentId: request.agentId.substring(0, 8)
        });
        return { success: false, message: 'Invalid agent or access denied' };
      }

      // Try cache with proper type safety
      const cacheKey = `agent:studio:home:${request.agentId}`;
      const cacheResult = await this.cache.get<CachedHomeData>(cacheKey);

      // FIXED: Proper null-safety checks for cache data
      if (
        cacheResult.hit && 
        cacheResult.data && 
        cacheResult.data.knowledge && 
        Array.isArray(cacheResult.data.knowledge) && 
        cacheResult.data.knowledge.length > 0
      ) {
        const duration = Date.now() - startTime;
        logger.info('Cache hit for knowledge bases', {
          requestId,
          count: cacheResult.data.knowledge.length,
          duration
        });
        // FIXED: Explicitly assign non-undefined array
        return { success: true, data: cacheResult.data.knowledge };
      }

      // Load from database - only fetch 'knowledge' type tables for knowledge bases
      const tables = await this.repository.findByAgent(request.agentId, ['knowledge'], request.tenantId);
      // Filter by tenant and ensure type is 'knowledge' (double-check)
      const filtered = tables.filter((t: any) => 
        t.tenant_id === request.tenantId && 
        (t.type === 'knowledge' || !t.type) // Allow legacy tables without type
      );

      if (filtered.length === 0) {
        logger.info('No knowledge bases found', { requestId });
        return { success: true, data: [] };
      }

      // Build knowledge bases in batches
      const knowledgeBases: KnowledgeBase[] = [];
      const BATCH_SIZE = CONFIG.BATCH_SIZE || 10;

      for (let i = 0; i < filtered.length; i += BATCH_SIZE) {
        const batch = filtered.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map((table: any) => this.buildKnowledgeBase(table, request.tenantId))
        );
        knowledgeBases.push(...batchResults);
      }

      // Update cache with proper error handling
      if (!cacheResult.severity || cacheResult.severity === 'low') {
        try {
          const cachedHome = (await this.redis.getJson<CachedHomeData>(cacheKey)) || {};
          await this.redis.setJson(cacheKey, { ...cachedHome, knowledge: knowledgeBases }, CACHE_TTL_SEC);
          logger.debug('Cache updated', { requestId, cacheKey });
        } catch (cacheError) {
          logger.debug('Failed to update cache', {
            requestId,
            error: cacheError instanceof Error ? cacheError.message : String(cacheError)
          });
        }
      }

      const duration = Date.now() - startTime;
      logger.info('Knowledge bases fetched successfully', {
        requestId,
        count: knowledgeBases.length,
        duration
      });

      return { success: true, data: knowledgeBases };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to fetch knowledge bases', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        agentId: request.agentId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to fetch knowledge bases' };
    }
  }

  async getKnowledgeBase(request: GetKnowledgeBaseRequest): Promise<{
    success: boolean;
    data?: KnowledgeBase;
    message?: string;
  }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Fetching knowledge base', {
        requestId,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        agentId: request.agentId?.substring(0, 8)
      });

      // Validate session
      const session = await this.validator.validateSession(request.sessionToken);
      if (!session.valid) {
        logger.warn('Invalid session', { requestId });
        return { success: false, message: 'Invalid or expired session' };
      }

      // Validate agent ID
      if (!request.agentId) {
        logger.warn('Missing agent ID', { requestId });
        return { success: false, message: 'Agent ID is required' };
      }

      // Validate knowledge base ID
      if (!this.validator.validateKnowledgeBaseId(request.knowledgeBaseId)) {
        logger.warn('Invalid knowledge base ID', { requestId, id: request.knowledgeBaseId });
        return { success: false, message: 'Invalid knowledge base ID format' };
      }

      // Validate agent access
      const hasAccess = await this.validator.validateAgentAccess(request.agentId, request.tenantId);
      if (!hasAccess) {
        logger.warn('Agent access denied', {
          requestId,
          agentId: request.agentId.substring(0, 8)
        });
        return { success: false, message: 'Invalid agent or access denied' };
      }

      // Load from database
      const table = await this.repository.findById(request.knowledgeBaseId);
      if (!table || table.agent_id !== request.agentId || table.tenant_id !== request.tenantId) {
        logger.warn('Knowledge base not found or access denied', {
          requestId,
          knowledgeBaseId: request.knowledgeBaseId.substring(0, 8),
          found: !!table
        });
        return { success: false, message: 'Knowledge base not found' };
      }

      const kb = await this.buildKnowledgeBase(table, request.tenantId);

      const duration = Date.now() - startTime;
      logger.info('Knowledge base fetched successfully', {
        requestId,
        knowledgeBaseId: kb.id.substring(0, 8),
        duration
      });

      return { success: true, data: kb };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to fetch knowledge base', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to fetch knowledge base' };
    }
  }

  async updateKnowledgeBase(request: UpdateKnowledgeBaseRequest): Promise<{
    success: boolean;
    data?: KnowledgeBase;
    message?: string;
  }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Updating knowledge base', {
        requestId,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        name: request.name
      });

      // Rate limiting
      const rateLimitKey = `kb_update:${request.tenantId}:${request.knowledgeBaseId}`;
      if (!this.checkRateLimit(rateLimitKey)) {
        logger.warn('Rate limit exceeded', { requestId, rateLimitKey });
        return { success: false, message: 'Rate limit exceeded. Please try again later.' };
      }

      // Validate session
      const session = await this.validator.validateSession(request.sessionToken);
      if (!session.valid) {
        logger.warn('Invalid session', { requestId });
        return { success: false, message: 'Invalid or expired session' };
      }

      // Validate agent ID
      if (!request.agentId) {
        logger.warn('Missing agent ID', { requestId });
        return { success: false, message: 'Agent ID is required' };
      }

      // Validate knowledge base ID
      if (!this.validator.validateKnowledgeBaseId(request.knowledgeBaseId)) {
        logger.warn('Invalid knowledge base ID', { requestId });
        return { success: false, message: 'Invalid knowledge base ID format' };
      }

      // Sanitize and validate name if provided
      let sanitizedName: string | undefined;
      if (request.name) {
        sanitizedName = this.sanitizeInput(request.name);
        if (!sanitizedName) {
          logger.warn('Invalid knowledge base name', { requestId, name: request.name });
          return { success: false, message: 'Invalid knowledge base name' };
        }

        const nameValidation = this.validator.validateKnowledgeBaseName(sanitizedName);
        if (!nameValidation.valid) {
          logger.warn('Name validation failed', { requestId, error: nameValidation.error });
          return { success: false, message: nameValidation.error || 'Invalid knowledge base name' };
        }
      }

      // Validate agent access
      const hasAccess = await this.validator.validateAgentAccess(request.agentId, request.tenantId);
      if (!hasAccess) {
        logger.warn('Agent access denied', {
          requestId,
          agentId: request.agentId.substring(0, 8)
        });
        return { success: false, message: 'Invalid agent or access denied' };
      }

      // Verify knowledge base exists
      const table = await this.repository.findById(request.knowledgeBaseId);
      if (!table || table.agent_id !== request.agentId || table.tenant_id !== request.tenantId) {
        logger.warn('Knowledge base not found', {
          requestId,
          knowledgeBaseId: request.knowledgeBaseId.substring(0, 8)
        });
        return { success: false, message: 'Knowledge base not found' };
      }

      // Update database
      const updateData: any = {};
      if (sanitizedName) {
        updateData.description = `Knowledge base: ${sanitizedName}`;
      }

      try {
        const updatedTable = await this.repository.updateTable(request.knowledgeBaseId, updateData);
        const kb = await this.buildKnowledgeBase(updatedTable, request.tenantId);

        // FIXED: Await cache invalidation to prevent race conditions
        try {
          await this.invalidateCacheSafely(`agent:studio:home:${updatedTable.agent_id}`, requestId);
        } catch (error) {
          // Log but don't fail the operation
          logger.warn('Cache invalidation failed but operation succeeded', { requestId, error });
        }

        const duration = Date.now() - startTime;
        logger.info('Knowledge base updated successfully', {
          requestId,
          knowledgeBaseId: kb.id.substring(0, 8),
          duration
        });

        return { success: true, data: kb };
      } catch (error: any) {
        const code = error?.code || error?.status || error?.error?.code || '';
        const msg = error?.message || error?.error?.message || '';

        if (code === '23505' || code === 'P2002' || /unique constraint/i.test(msg)) {
          logger.warn('Unique constraint violation on update', { requestId });
          return { success: false, message: 'Knowledge base with this name already exists' };
        }
        throw error;
      }
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to update knowledge base', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to update knowledge base' };
    }
  }

  async deleteKnowledgeBase(request: DeleteKnowledgeBaseRequest): Promise<{
    success: boolean;
    message?: string;
  }> {
    const requestId = this.generateRequestId();
    const startTime = Date.now();

    try {
      logger.info('Deleting knowledge base', {
        requestId,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        agentId: request.agentId?.substring(0, 8)
      });

      // Rate limiting
      const rateLimitKey = `kb_delete:${request.tenantId}:${request.knowledgeBaseId}`;
      if (!this.checkRateLimit(rateLimitKey)) {
        logger.warn('Rate limit exceeded', { requestId, rateLimitKey });
        return { success: false, message: 'Rate limit exceeded. Please try again later.' };
      }

      // Validate session
      const session = await this.validator.validateSession(request.sessionToken);
      if (!session.valid) {
        logger.warn('Invalid session', { requestId });
        return { success: false, message: 'Invalid or expired session' };
      }

      // Validate agent ID
      if (!request.agentId) {
        logger.warn('Missing agent ID', { requestId });
        return { success: false, message: 'Agent ID is required' };
      }

      // Validate knowledge base ID
      if (!this.validator.validateKnowledgeBaseId(request.knowledgeBaseId)) {
        logger.warn('Invalid knowledge base ID', { requestId });
        return { success: false, message: 'Invalid knowledge base ID format' };
      }

      // Validate agent access
      const hasAccess = await this.validator.validateAgentAccess(request.agentId, request.tenantId);
      if (!hasAccess) {
        logger.warn('Agent access denied', {
          requestId,
          agentId: request.agentId.substring(0, 8)
        });
        return { success: false, message: 'Invalid agent or access denied' };
      }

      // Verify knowledge base exists
      const table = await this.repository.findById(request.knowledgeBaseId);
      if (!table || table.tenant_id !== request.tenantId || table.agent_id !== request.agentId) {
        logger.warn('Knowledge base not found', {
          requestId,
          knowledgeBaseId: request.knowledgeBaseId.substring(0, 8)
        });
        return { success: false, message: 'Knowledge base not found' };
      }

      // Delete
      await this.repository.deleteTable(request.knowledgeBaseId);

      // FIXED: Await cache invalidation to prevent race conditions
      try {
        await this.invalidateCacheSafely(`agent:studio:home:${table.agent_id}`, requestId);
      } catch (error) {
        // Log but don't fail the operation
        logger.warn('Cache invalidation failed but operation succeeded', { requestId, error });
      }

      const duration = Date.now() - startTime;
      logger.info('Knowledge base deleted successfully', {
        requestId,
        knowledgeBaseId: request.knowledgeBaseId.substring(0, 8),
        duration
      });

      return { success: true, message: 'Knowledge base deleted successfully' };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Failed to delete knowledge base', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        duration
      });
      return { success: false, message: 'Failed to delete knowledge base' };
    }
  }

  /**
   * Health check endpoint
   */
  async healthCheck(): Promise<{ healthy: boolean; details: any }> {
    const checks: any = {
      repository: false,
      validator: false,
      cache: false,
      redis: false
    };

    try {
      checks.repository = !!this.repository;
      checks.validator = !!this.validator;
      checks.cache = !!this.cache;

      // Check Redis connection
      try {
        checks.redis = await this.redis.ping();
      } catch (error) {
        logger.warn('Redis ping failed in health check', { error });
        checks.redis = false;
      }

      const healthy = Object.values(checks).every(v => v === true);
      logger.info('Health check completed', { healthy, checks });

      return { healthy, details: checks };
    } catch (error) {
      logger.error('Health check failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      return { healthy: false, details: checks };
    }
  }

  // ============= Backward Compatibility Methods =============

  /**
   * Save full converted text into a single row in agent_table_rows.row_data
   */
  private async saveFullTextRow(options: {
    knowledgeBaseId: string;
    agentId: string;
    tenantId: string;
    text: string;
    source?: 'pdf' | 'files' | 'text' | 'document' | 'upload';
    fileName?: string;
  }): Promise<void> {
    const { knowledgeBaseId, agentId, tenantId, text, source, fileName } = options;
    if (!text || typeof text !== 'string') return;
    try {
      const client: any = SupabaseService.getInstance().getClient();
      const now = new Date().toISOString();
      const rowData = {
        type: 'knowledge_text',
        source: source || 'upload',
        agentId,
        tenantId,
        fileName: fileName || null,
        text
      };
      await client
        .from('agent_table_rows')
        .insert([
          {
            table_id: knowledgeBaseId,
            row_data: rowData,
            created_at: now,
            updated_at: now
          }
        ]);
      logger.info('Full text saved to agent_table_rows', {
        knowledgeBaseId: knowledgeBaseId.substring(0, 8),
        bytes: text.length
      });
    } catch (error) {
      logger.warn('Failed to save full text row', {
        knowledgeBaseId: knowledgeBaseId?.substring(0, 8),
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  async uploadToKnowledgeBase(request: {
    knowledgeBaseId: string;
    agentId: string;
    tenantId: string;
    files?: FileUpload[];
    textContent?: string;
  }): Promise<any> {
    const requestId = this.generateRequestId();
    
    try {
      logger.info('Uploading to knowledge base', {
        requestId,
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8),
        filesCount: request.files?.length || 0,
        hasTextContent: !!request.textContent
      });

      const DocumentService = (await import('./DocumentService')).default;
      const result = await DocumentService.upload(request);

      // Persist full text in a single row if available
      if (request.textContent && request.textContent.trim().length > 0) {
        await this.saveFullTextRow({
          knowledgeBaseId: request.knowledgeBaseId,
          agentId: request.agentId,
          tenantId: request.tenantId,
          text: request.textContent,
          source: 'text'
        });
      } else if (result) {
        // Try to detect extracted text from processing result
        const extractedDirect =
          typeof (result as any)?.extractedText === 'string' ? (result as any).extractedText : null;
        if (extractedDirect && extractedDirect.trim().length > 0) {
          await this.saveFullTextRow({
            knowledgeBaseId: request.knowledgeBaseId,
            agentId: request.agentId,
            tenantId: request.tenantId,
            text: extractedDirect,
            source: 'pdf'
          });
        } else if (Array.isArray((result as any)?.files)) {
          try {
            const filesArr: any[] = (result as any).files;
            const texts: string[] = [];
            for (const f of filesArr) {
              const t =
                typeof f?.extractedText === 'string'
                  ? f.extractedText
                  : typeof f?.text === 'string'
                    ? f.text
                    : null;
              if (t && t.trim().length > 0) {
                texts.push(t);
              }
            }
            if (texts.length > 0) {
              const merged = texts.join('\n\n');
              await this.saveFullTextRow({
                knowledgeBaseId: request.knowledgeBaseId,
                agentId: request.agentId,
                tenantId: request.tenantId,
                text: merged,
                source: 'files'
              });
            }
          } catch {}
        }
      }

      logger.info('Upload completed', { requestId, success: !!result });
      return result;
    } catch (error) {
      logger.error('Upload failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        knowledgeBaseId: request.knowledgeBaseId?.substring(0, 8)
      });
      throw error;
    }
  }

  async uploadDocument(
    buffer: Buffer,
    fileName: string,
    mimeType: string | undefined,
    options: { agentId: string; tenantId: string; knowledgeBaseId: string }
  ): Promise<any> {
    const requestId = this.generateRequestId();
    
    try {
      // Sanitize filename
      const sanitizedFileName = this.sanitizeInput(fileName);
      if (!sanitizedFileName) {
        throw new Error('Invalid filename');
      }

      logger.info('Uploading document', {
        requestId,
        fileName: sanitizedFileName,
        mimeType,
        knowledgeBaseId: options.knowledgeBaseId?.substring(0, 8)
      });

      const DocumentService = (await import('./DocumentService')).default;
      
      // FIXED: Construct file object with proper optional type handling
      const fileUpload: FileUpload = {
        buffer,
        fileName: sanitizedFileName,
        ...(mimeType !== undefined ? { mimeType } : {})
      };

      const result = await DocumentService.upload({
        knowledgeBaseId: options.knowledgeBaseId,
        agentId: options.agentId,
        tenantId: options.tenantId,
        files: [fileUpload]
      });

      // Try to persist extracted text (if returned by document processor)
      try {
        const extractedDirect =
          typeof (result as any)?.extractedText === 'string' ? (result as any).extractedText : null;
        if (extractedDirect && extractedDirect.trim().length > 0) {
          await this.saveFullTextRow({
            knowledgeBaseId: options.knowledgeBaseId,
            agentId: options.agentId,
            tenantId: options.tenantId,
            text: extractedDirect,
            source: 'document',
            fileName: sanitizedFileName
          });
        } else if (Array.isArray((result as any)?.files)) {
          const fileItem = (result as any).files.find((f: any) => f?.fileName === sanitizedFileName) || (result as any).files[0];
          const t =
            typeof fileItem?.extractedText === 'string'
              ? fileItem.extractedText
              : typeof fileItem?.text === 'string'
                ? fileItem.text
                : null;
          if (t && t.trim().length > 0) {
            await this.saveFullTextRow({
              knowledgeBaseId: options.knowledgeBaseId,
              agentId: options.agentId,
              tenantId: options.tenantId,
              text: t,
              source: 'document',
              fileName: sanitizedFileName
            });
          }
        }
      } catch (e) {
        logger.debug('No extracted text available to persist', {
          requestId,
          error: e instanceof Error ? e.message : String(e)
        });
      }

      logger.info('Document upload completed', { requestId, fileName: sanitizedFileName });
      return result;
    } catch (error) {
      logger.error('Document upload failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        fileName
      });
      throw error;
    }
  }

  async editDocument(
    fileId: string,
    newContent: string,
    options: { agentId: string; tenantId: string }
  ): Promise<any> {
    const requestId = this.generateRequestId();
    
    try {
      // Sanitize content
      const sanitizedContent = this.sanitizeInput(newContent, 10000000); // 10MB limit

      logger.info('Editing document', {
        requestId,
        fileId: fileId?.substring(0, 8),
        contentLength: sanitizedContent.length
      });

      const DocumentService = (await import('./DocumentService')).default;
      const result = await DocumentService.editDocument(fileId, sanitizedContent, options);

      logger.info('Document edit completed', { requestId, fileId: fileId?.substring(0, 8) });
      return result;
    } catch (error) {
      logger.error('Document edit failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        fileId: fileId?.substring(0, 8)
      });
      throw error;
    }
  }

  async deleteDocument(
    fileId: string,
    options: { agentId: string; tenantId: string; hard?: boolean }
  ): Promise<any> {
    const requestId = this.generateRequestId();
    
    try {
      logger.info('Deleting document', {
        requestId,
        fileId: fileId?.substring(0, 8),
        hard: options.hard
      });

      const DocumentService = (await import('./DocumentService')).default;
      const result = await DocumentService.deleteDocument(fileId, options);

      logger.info('Document delete completed', { requestId, fileId: fileId?.substring(0, 8) });
      return result;
    } catch (error) {
      logger.error('Document delete failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        fileId: fileId?.substring(0, 8)
      });
      throw error;
    }
  }

  async bulkDeleteDocuments(
    fileIds: string[],
    options: { agentId: string; tenantId: string; hard?: boolean }
  ): Promise<{ success: boolean; deleted: number }> {
    const requestId = this.generateRequestId();
    
    try {
      logger.info('Bulk deleting documents', {
        requestId,
        fileIdsCount: fileIds?.length || 0,
        hard: options.hard
      });

      const DocumentService = (await import('./DocumentService')).default;
      const result = await DocumentService.bulkDelete(fileIds, options);

      logger.info('Bulk delete completed', { 
        requestId, 
        deleted: result.deleted,
        total: fileIds?.length || 0
      });
      return result;
    } catch (error) {
      logger.error('Bulk delete failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        fileIdsCount: fileIds?.length || 0
      });
      throw error;
    }
  }

  async searchKnowledgeBase(
    query: string,
    knowledgeBaseId: string,
    options: { agentId: string; tenantId: string; fileNames?: string[]; limit?: number; threshold?: number }
  ): Promise<any[]> {
    const requestId = this.generateRequestId();
    
    try {
      // Sanitize query
      const sanitizedQuery = this.sanitizeInput(query, 10000);
      if (!sanitizedQuery) {
        throw new Error('Invalid search query');
      }

      logger.info('Searching knowledge base', {
        requestId,
        query: sanitizedQuery.substring(0, 100),
        knowledgeBaseId: knowledgeBaseId?.substring(0, 8),
        limit: options.limit
      });

      const VectorService = (await import('./VectorService')).default;
      const results = await VectorService.search(sanitizedQuery, knowledgeBaseId, options);

      logger.info('Search completed', {
        requestId,
        resultsCount: results.length,
        knowledgeBaseId: knowledgeBaseId?.substring(0, 8)
      });

      return results;
    } catch (error) {
      logger.error('Search failed', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
        knowledgeBaseId: knowledgeBaseId?.substring(0, 8)
      });
      throw error;
    }
  }

  /**
   * Graceful shutdown - cleanup resources
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down KnowledgeService');
    
    if (this.cleanupIntervalId) {
      clearInterval(this.cleanupIntervalId);
      this.cleanupIntervalId = null;
    }
    
    this.rateLimitMap.clear();
    logger.info('KnowledgeService shutdown complete');
  }
}

export default KnowledgeService.getInstance();